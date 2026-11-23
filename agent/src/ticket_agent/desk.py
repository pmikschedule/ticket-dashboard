"""desk 수집 — `/api/state` 를 읽어 스냅샷으로 보존합니다 (DESIGN.md 14장).

**reporter 와 같은 규칙입니다** (`reporter/src/desk.ts` · `upload.ts` · `requests.ts`).
desk 수집은 한때 특정 Mac 의 reporter 가 했고, 지금은 이 에이전트가 합니다. 두 구현이
같은 행을 만드는지는 저장소 루트 `contracts/desk/*.json` 을 양쪽 테스트가 함께 읽어
확인합니다 — 한쪽만 고치면 그쪽 테스트가 깨집니다.

**원본 JSON 을 가공하지 않고 통째로 저장합니다.** 보고서 서식이 나중에 바뀌어도 과거
스냅샷에서 다시 뽑을 수 있어야 합니다. desk 는 현재 상태만 보관하므로 오늘 안 떠
놓으면 오늘의 상태는 영영 복원되지 않습니다.

IO 는 네트워크 한 곳(`fetch_state`)과 로컬 파일(`LocalSnapshots` · `ScanState`)
뿐입니다. DB 는 store.py 를 거칩니다 (desk_worker.py).
"""

from __future__ import annotations

import base64
import json
import math
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import httpx

from . import __version__
from .constants import DESK_AUTH_SERVICE_TOKEN

UTC = timezone.utc

# 한국 시각. **고정 +09:00 입니다** — 윈도우 파이썬에는 시간대 자료(tzdata)가 없어
# zoneinfo 가 'Asia/Seoul' 을 못 찾습니다. 한국은 서머타임이 없으므로 고정값이 정확합니다.
KST = timezone(timedelta(hours=9))

# 정기 수집 회차 — 월 18:00 · 화 09:00 (한국 시각). 주간 구간이 화~월이라 월요일이
# 끝나야 그 주가 닫히고, 그래서 두 번 뜹니다 (reporter launchd 와 같은 시각).
SCHEDULE: tuple[tuple[int, int, int], ...] = ((0, 18, 0), (1, 9, 0))  # (요일 월=0, 시, 분)

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


# ---------------------------------------------------------------------------
# 오류 — 사람이 읽을 문장을 담습니다. 비밀값은 절대 넣지 않습니다
# ---------------------------------------------------------------------------


class DeskError(RuntimeError):
    """desk 수집 실패. `kind` 로 갈래를 나눕니다 (contracts/desk/fetch_responses.json)."""

    kind = "error"


class DeskAuthMissing(DeskError):
    kind = "auth_missing"


class DeskAuthExpired(DeskError):
    kind = "auth_expired"


class DeskHttpError(DeskError):
    kind = "http_error"

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class DeskBadResponse(DeskError):
    kind = "bad_body"


class DeskTimeout(DeskError):
    kind = "timeout"


class CookieError(ValueError):
    """붙여 넣은 쿠키를 못 읽음. kind = empty | not_jwt | no_exp (contracts/desk/cookies.json)."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


# ---------------------------------------------------------------------------
# 시각 — JS 의 Date 와 같은 모양으로 쓰고, 어떤 모양이 와도 읽습니다
# ---------------------------------------------------------------------------


def now_utc() -> datetime:
    return datetime.now(UTC)


def iso_ms(value: datetime) -> str:
    """JS `Date.toISOString()` 과 같은 모양 — `2026-11-23T08:59:59.999Z`.

    스냅샷의 `scannedAt` 이 이 모양입니다. 마이크로초는 버립니다 (JS 는 밀리초까지만).
    """
    u = value.astimezone(UTC)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


_ISO = re.compile(
    r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$"
)


def parse_instant(text: str) -> datetime:
    """ISO 시각 → 시간대가 붙은 datetime.

    파이썬 3.10 의 `fromisoformat` 은 `Z` 도, 소수 둘째 자리(`.12`)도 못 읽습니다.
    Postgres 는 끝의 0 을 떼고 돌려주므로(`…:34.12+00:00`) 그대로 넘기면 깨집니다.
    그래서 모양을 맞춘 뒤 넘깁니다. 시간대가 없으면 UTC 로 봅니다.
    """
    m = _ISO.match((text or "").strip())
    if not m:
        raise ValueError(f"시각 형식을 읽지 못했습니다: {text!r}")
    day, clock, frac, tz = m.groups()
    if len(clock) == 5:
        clock += ":00"
    micro = (frac or "").ljust(6, "0")[:6]
    if not tz or tz in ("Z", "z"):
        offset = "+00:00"
    else:
        digits = tz[1:].replace(":", "").ljust(4, "0")
        offset = f"{tz[0]}{digits[:2]}:{digits[2:4]}"
    return datetime.fromisoformat(f"{day}T{clock}.{micro}{offset}")


def epoch_ms(text: str) -> int:
    """시점(밀리초). JS `Date.parse` 처럼 밀리초 아래는 버립니다."""
    return (parse_instant(text) - _EPOCH) // timedelta(milliseconds=1)


def kst_label(value: datetime) -> str:
    """사람이 읽을 한국 시각 — `11/25 12:44`."""
    k = value.astimezone(KST)
    return f"{k.month}/{k.day} {k.hour:02d}:{k.minute:02d}"


def days_left(expires_at: datetime, now: datetime) -> int:
    """만료까지 남은 일수 — 내림. 음수면 이미 만료 (reporter `daysLeft` 와 같습니다)."""
    return math.floor((expires_at - now) / timedelta(days=1))


# ---------------------------------------------------------------------------
# 쿠키 — 붙여 넣은 값을 정리하고 만료를 읽습니다 (서명 검증 없이 읽기만)
# ---------------------------------------------------------------------------

_COOKIE_IN_HEADER = re.compile(r"(?:^|[;\s])CF_Authorization=([^;\s]*)", re.IGNORECASE)


def normalize_cookie(raw: str | None) -> str:
    """붙여 넣은 쿠키를 값만 남깁니다.

    개발자 도구에서 복사하면 값만 오기도 하고, `CF_Authorization=…` 이나 쿠키 헤더
    통째로 오기도 합니다. 앞뒤 공백·줄바꿈·따옴표·세미콜론도 딸려 옵니다.
    웹의 `deskAuth.normalizeCookie` 와 같은 규칙입니다 (contracts/desk/cookies.json).
    """
    text = (raw or "").strip()
    hit = _COOKIE_IN_HEADER.search(text)
    if hit:
        text = hit.group(1)
    text = text.strip().strip(";").strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        text = text[1:-1].strip()
    return text


def _b64url(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def jwt_expiry(token: str) -> datetime:
    """JWT 페이로드의 `exp`. **서명은 검증하지 않습니다** — 만료일을 알리려는 것뿐이고,
    진짜인지는 desk(Cloudflare Access)가 판정합니다."""
    if not token:
        raise CookieError("empty", "desk 쿠키가 비어 있습니다")
    parts = token.split(".")
    if len(parts) < 2 or not parts[1]:
        raise CookieError("not_jwt", "desk 쿠키가 JWT 형식이 아닙니다 — CF_Authorization 값을 복사했는지 확인하세요")
    try:
        payload = json.loads(_b64url(parts[1]).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise CookieError("not_jwt", "desk 쿠키가 JWT 형식이 아닙니다 — CF_Authorization 값을 복사했는지 확인하세요") from exc
    exp = payload.get("exp") if isinstance(payload, dict) else None
    if isinstance(exp, bool) or not isinstance(exp, (int, float)) or exp <= 0:
        raise CookieError("no_exp", "desk 쿠키(JWT)에 만료 시각(exp)이 없습니다")
    return datetime.fromtimestamp(exp, tz=UTC)


def mask_tail(value: str) -> str:
    """끝 4글자만 남깁니다. 로그·화면에 찍어도 되는 모양입니다."""
    if len(value) <= 4:
        return "•" * len(value)
    return "•" * min(8, len(value) - 4) + value[-4:]


class DeskAuth:
    """desk 에 붙을 인증 한 벌. **값은 repr·로그에 안 나옵니다.**

    source = service_token | settings | env. origin 은 Service Token 이 어디서 왔는지
    (settings | env) — doctor 가 알려 줄 때만 씁니다.
    """

    __slots__ = ("source", "origin", "expires_at", "hint", "_headers")

    def __init__(
        self,
        source: str,
        headers: dict[str, str],
        hint: str,
        expires_at: datetime | None = None,
        origin: str = "",
    ) -> None:
        self.source = source
        self.origin = origin or source
        self.expires_at = expires_at
        self.hint = hint
        self._headers = dict(headers)

    @classmethod
    def cookie(cls, source: str, token: str, expires_at: datetime) -> "DeskAuth":
        return cls(source, {"Cookie": f"CF_Authorization={token}"}, mask_tail(token), expires_at)

    @classmethod
    def service_token(cls, origin: str, client_id: str, client_secret: str) -> "DeskAuth":
        return cls(
            DESK_AUTH_SERVICE_TOKEN,
            {"CF-Access-Client-Id": client_id, "CF-Access-Client-Secret": client_secret},
            mask_tail(client_id),
            None,
            origin,
        )

    def headers(self) -> dict[str, str]:
        return dict(self._headers)

    def expired(self, now: datetime) -> bool:
        return self.expires_at is not None and self.expires_at <= now

    def fingerprint(self) -> tuple[str, str]:
        """바뀌었는지 볼 때 쓰는 값 — 출처와 만료일. 비밀값에서 유도하지 않습니다."""
        return (self.source, iso_ms(self.expires_at) if self.expires_at else "")

    def __repr__(self) -> str:  # 값이 실수로라도 찍히지 않게
        return f"DeskAuth(source={self.source!r}, hint={self.hint!r})"


# ---------------------------------------------------------------------------
# desk 응답 → state
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FetchResult:
    state: dict[str, Any]
    email: str | None
    tier: str | None


def auth_expired_message(source: str) -> str:
    if source == DESK_AUTH_SERVICE_TOKEN:
        return (
            "desk 인증 만료 — Cloudflare Access 가 Service Token 을 받지 않고 로그인으로 돌려보냈습니다. "
            "토큰이 폐기됐거나 desk 정책에서 빠졌을 수 있습니다"
        )
    return (
        "desk 인증 만료 — 대시보드 설정에서 desk 쿠키를 다시 넣어 주세요 "
        "(Cloudflare Access 가 로그인으로 돌려보냈습니다)"
    )


def parse_state_response(status: int, body: bytes | str, source: str = "") -> FetchResult:
    """응답 → state. reporter `fetchState` 와 같은 판정입니다.

    Cloudflare Access 는 인증에 실패하면 **302 로 로그인 페이지를 돌려줍니다.** 리디렉션을
    따라가면 로그인 HTML 을 JSON 으로 읽으려다 엉뚱한 곳에서 터지므로, 따라가지 않고
    상태 코드로 판정합니다.
    """
    if status in (301, 302):
        raise DeskAuthExpired(auth_expired_message(source))
    if not 200 <= status < 300:
        hint = " — 인증이 거부됐습니다" if status in (401, 403) else ""
        raise DeskHttpError(status, f"desk 응답이 HTTP {status} 입니다{hint}")
    try:
        data = json.loads(body)
    except ValueError as exc:
        raise DeskBadResponse(
            "desk 응답이 JSON 이 아닙니다 — 로그인 화면이 왔거나 API 형식이 바뀌었을 수 있습니다"
        ) from exc
    state = data.get("state") if isinstance(data, dict) else None
    if not isinstance(state, dict) or not isinstance(state.get("work"), list):
        raise DeskBadResponse("desk 응답에 state.work 가 없습니다 — API 형식이 바뀌었을 수 있습니다")
    email = data.get("email")
    tier = data.get("tier")
    return FetchResult(
        state=state,
        email=email if isinstance(email, str) else None,
        tier=tier if isinstance(tier, str) else None,
    )


def fetch_state(
    desk_url: str,
    auth: DeskAuth,
    timeout: float = 60.0,
    transport: httpx.BaseTransport | None = None,
) -> FetchResult:
    """`GET {desk_url}/api/state` 한 번. 리디렉션은 따라가지 않습니다.

    Supabase 와 같은 httpx 를 씁니다 — 프록시·인증서가 같은 길로 나갑니다.
    """
    url = desk_url.rstrip("/") + "/api/state"
    headers = {
        "Accept": "application/json",
        "User-Agent": f"ticket-agent/{__version__}",
        **auth.headers(),
    }
    try:
        with httpx.Client(
            timeout=httpx.Timeout(timeout, connect=min(15.0, timeout)),
            follow_redirects=False,
            transport=transport,
        ) as client:
            response = client.get(url, headers=headers)
    except httpx.TimeoutException as exc:
        raise DeskTimeout(f"desk 가 {int(timeout)}초 안에 응답하지 않았습니다") from exc
    except httpx.HTTPError as exc:
        raise DeskError(f"desk 에 연결하지 못했습니다 — {type(exc).__name__}: {exc}") from exc
    return parse_state_response(response.status_code, response.content, auth.source)


# ---------------------------------------------------------------------------
# 스냅샷 → 행 (contracts/desk/snapshot_rows.json)
# ---------------------------------------------------------------------------


def make_snapshot(state: dict[str, Any], scanned_at: datetime) -> dict[str, Any]:
    """reporter `makeSnapshot` 과 같은 모양 — 로컬 파일도 이 모양 그대로 남깁니다."""
    at = iso_ms(scanned_at)

    def count(key: str) -> int:
        value = state.get(key)
        return len(value) if isinstance(value, list) else 0

    return {
        "meta": {
            "scannedAt": at,
            "yearMonth": at[:7],
            "sourceUpdatedAt": state.get("updatedAt"),
            "counts": {
                "work": count("work"),
                "projects": count("projects"),
                "decisions": count("decisions"),
            },
        },
        "state": state,
    }


def snapshot_row(snap: dict[str, Any]) -> dict[str, Any]:
    """스냅샷 → `desk_snapshots` 행 (reporter `snapshotRow`).

    **state 를 가공하지 않습니다.** day 는 스캔 시각의 **UTC 날짜**입니다 — reporter 가
    그렇게 써 왔고, 같은 날을 두 구현이 다른 날로 올리면 덮어쓰기 규칙이 깨집니다.
    """
    meta = snap["meta"]
    return {
        "day": meta["scannedAt"][:10],
        "scanned_at": meta["scannedAt"],
        "source_at": meta.get("sourceUpdatedAt"),
        "state": snap["state"],
        "counts": meta["counts"],
    }


def to_upload(local: Iterable[tuple[str, str]], remote: dict[str, str]) -> list[str]:
    """올려야 할 로컬 스냅샷 — 대시보드에 **없거나, 있어도 로컬이 더 늦게 뜬** 것.

    `local` 은 (파일 이름, scannedAt). reporter `toUpload` 와 같습니다: 같은 날 두 번째
    스캔이 로컬만 덮어쓰고 대시보드에 아침 것이 남는 일을 막습니다. 시각은 문자열이
    아니라 시점(밀리초)으로 비교합니다 — `Z` 와 `+00:00` 이 섞여 옵니다.
    """
    out: list[str] = []
    for file_name, scanned_at in local:
        up = remote.get(file_name[:10])
        if not up or epoch_ms(scanned_at) > epoch_ms(up):
            out.append(file_name)
    return out


# ---------------------------------------------------------------------------
# 화면에 보일 실패 이유 (contracts/desk/readable_error.json)
# ---------------------------------------------------------------------------

MAX_REASON = 300

# reporter `readableError` 와 같은 순서·같은 규칙입니다. JS 의 `\w` 는 ASCII 만 보므로
# 여기서는 re.ASCII 를 붙입니다 — 안 붙이면 한글까지 토큰으로 먹습니다.
_MASKS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"CF_Authorization=[^\s;,'\"]+", re.IGNORECASE), "CF_Authorization=•••"),
    (re.compile(r"Bearer\s+[^\s'\"]+", re.IGNORECASE), "Bearer •••"),
    (re.compile(r"eyJ[\w-]+\.[\w-]+(\.[\w-]+)?", re.ASCII), "•••"),
    (re.compile(r"sb_(publishable|secret)_[\w-]+", re.ASCII), r"sb_\1_•••"),
    (re.compile(r"[A-Za-z0-9_-]{33,}"), "•••"),
)


def readable_error(err: object) -> str:
    """`desk_scan_requests.error`·설정 화면에 들어갈 문장 — **비밀값을 지웁니다.**

    팀원 전원이 읽습니다. 지금 오류 문구에는 쿠키·키가 안 들어가지만, 라이브러리가
    요청 내용을 오류에 실어 오는 날이 오면 그대로 퍼지므로 토큰처럼 생긴 것은 가립니다.
    """
    if isinstance(err, BaseException):
        raw = str(err) or type(err).__name__
    else:
        raw = "" if err is None else str(err)
    text = raw
    for pattern, replacement in _MASKS:
        text = pattern.sub(replacement, text)
    text = re.sub(r"\s+", " ", text).strip() or "이유가 기록되지 않은 오류"
    return text if len(text) <= MAX_REASON else text[: MAX_REASON - 1] + "…"


@dataclass(frozen=True)
class WarnStamp:
    at: float
    msg: str


def should_warn(prev: WarnStamp | None, msg: str, now: float, every: float) -> bool:
    """같은 경고를 다시 찍을 차례인가 — 처음이거나, 내용이 바뀌었거나, 간격이 지났으면.

    표가 아직 없거나 오프라인이면 10초마다 같은 실패가 납니다. 매번 찍으면 진짜
    처리 기록이 묻히고, 안 찍으면 왜 화면이 기다리기만 하는지 아무도 모릅니다.
    """
    if prev is None or prev.msg != msg:
        return True
    return now - prev.at >= every


def is_missing_object(code: str | None, message: str | None) -> bool:
    """표·함수가 아직 DB 에 없다는 오류인가 (schema.sql 미적용). reporter 와 같습니다."""
    if code in ("PGRST202", "PGRST205", "42P01", "42883"):
        return True
    return bool(
        re.search(r"Could not find the (table|function)|does not exist", message or "", re.IGNORECASE)
    )


# ---------------------------------------------------------------------------
# 정기 수집 회차
# ---------------------------------------------------------------------------


def latest_slot(now: datetime) -> datetime:
    """지금(포함) 이전의 가장 늦은 정기 회차 (한국 시각)."""
    local = now.astimezone(KST)
    best: datetime | None = None
    for back in range(8):
        d: date = (local - timedelta(days=back)).date()
        for weekday, hour, minute in SCHEDULE:
            if d.weekday() != weekday:
                continue
            slot = datetime(d.year, d.month, d.day, hour, minute, tzinfo=KST)
            if slot <= local and (best is None or slot > best):
                best = slot
    assert best is not None  # 회차가 주 2번이라 8일 안에 반드시 있습니다
    return best


def schedule_decision(
    now: datetime, last_slot: str | None, last_success_at: str | None
) -> tuple[str, datetime]:
    """정기 수집을 할 차례인가.

    - done    — 이번 회차는 이미 했습니다 (성공이든 실패든 **한 번만**)
    - covered — 회차 뒤에 성공한 수집이 이미 있습니다. 다시 받을 필요가 없습니다
    - due     — 합니다. 꺼져 있다 켜졌으면 놓친 회차 중 **마지막 것 한 번만** 합니다

    실패한 회차를 다시 시도하지 않는 이유: 쿠키가 만료됐으면 몇 번을 해도 같은
    이유로 실패합니다. 사람이 쿠키를 바꾸면 그때 한 번 확인 수집을 합니다
    (`DeskWorker.check_auth`).
    """
    slot = latest_slot(now)
    if last_slot:
        try:
            if parse_instant(last_slot) >= slot:
                return "done", slot
        except ValueError:
            pass
    if last_success_at:
        try:
            if parse_instant(last_success_at) >= slot:
                return "covered", slot
        except ValueError:
            pass
    return "due", slot


# ---------------------------------------------------------------------------
# 로컬 파일 — 스냅샷 사본과 수집 상태
# ---------------------------------------------------------------------------

_DAY_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")


def _write_atomic(path: Path, text: str) -> None:
    """쓰다 꺼져도 반쪽 파일이 남지 않게 임시 파일에 쓴 뒤 바꿔 끼웁니다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class LocalSnapshots:
    """`<data>/desk-snapshots/YYYY-MM-DD.json` — 하루 한 개, 다시 뜨면 덮어씁니다.

    **로컬이 원본이고 대시보드가 사본입니다.** 업로드가 실패해도 여기 남아 있다가
    다음 수집 때 다시 올라갑니다. 파일 모양은 reporter `data/snapshots` 와 같습니다.

    올릴 것을 고를 때 날짜별 scannedAt 이 필요한데, 스냅샷 하나가 수백 KB 라 매번
    전부 읽지 않도록 `_index.json` 에 적어 둡니다. 색인에 없는 파일만 읽어 채웁니다.
    """

    def __init__(self, data_dir: Path) -> None:
        self.dir = Path(data_dir) / "desk-snapshots"
        self._index_path = self.dir / "_index.json"

    def save(self, snap: dict[str, Any]) -> Path:
        day = snap["meta"]["scannedAt"][:10]
        path = self.dir / f"{day}.json"
        _write_atomic(path, json.dumps(snap, ensure_ascii=False, indent=2))
        index = self.index()
        index[day] = snap["meta"]["scannedAt"]
        _write_atomic(self._index_path, json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True))
        return path

    def read(self, day: str) -> dict[str, Any]:
        with open(self.dir / f"{day}.json", encoding="utf-8") as fh:
            return json.load(fh)

    def days(self) -> list[str]:
        if not self.dir.is_dir():
            return []
        return sorted(p.name[:10] for p in self.dir.iterdir() if _DAY_FILE.match(p.name))

    def index(self) -> dict[str, str]:
        """날짜 → scannedAt. 색인이 없거나 어긋나면 **빠진 파일만** 읽어 채웁니다."""
        try:
            with open(self._index_path, encoding="utf-8") as fh:
                loaded = json.load(fh)
            index = {k: v for k, v in loaded.items() if isinstance(v, str)} if isinstance(loaded, dict) else {}
        except (OSError, ValueError):
            index = {}
        days = self.days()
        present = set(days)
        changed = False
        for day in list(index):
            if day not in present:
                del index[day]
                changed = True
        for day in days:
            if day not in index:
                try:
                    index[day] = self.read(day)["meta"]["scannedAt"]
                    changed = True
                except (OSError, ValueError, KeyError, TypeError):
                    continue  # 깨진 파일은 올리지 않습니다. 다음 수집이 덮어씁니다
        if changed:
            _write_atomic(self._index_path, json.dumps(index, ensure_ascii=False, indent=2, sort_keys=True))
        return index


class ScanState:
    """`<data>/desk-state.json` — 정기 회차와 마지막 결과.

    대시보드가 아니라 로컬에 두는 이유: DB 에 못 닿을 때도 '이번 회차는 했다' 를
    알아야 같은 실패를 10초마다 되풀이하지 않습니다.
    """

    def __init__(self, data_dir: Path) -> None:
        self.path = Path(data_dir) / "desk-state.json"

    def load(self) -> dict[str, Any]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def update(self, **values: Any) -> None:
        data = self.load()
        data.update(values)
        _write_atomic(self.path, json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True))
