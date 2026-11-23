"""desk 수집 실행 — 화면의 수집 요청 · 정기 수집 · 스캔 한 번 (DESIGN.md 14장).

`run` 루프 옆의 **전용 스레드**에서 돕니다. Outlook COM 을 건드리지 않고 Supabase
클라이언트도 메일 쪽과 따로 씁니다 — desk 가 늦거나 쿠키가 만료돼도 메일 수집이
멈추면 안 되고, 그 반대도 마찬가지입니다.

10초마다 한 바퀴:

  1. 수집 요청 — 10분 넘게 running 인 것을 failed 로 닫고, pending 을 한 번의 update 로
     전부 집어 스캔 한 번으로 함께 처리합니다. 결과는 **대시보드에 올라갔을 때만** done
  2. 정기 수집 — 월 18:00 · 화 09:00 (한국 시각). 꺼져 있다 켜지면 놓친 회차 한 번
  3. 인증 상태 — 1분마다 다시 읽어, 바뀌었으면 출처·만료일을 app_settings 에 적습니다.
     화면이 그것으로 만료 7일 전부터 배너를 띄웁니다

DB 는 store.py 를 거칩니다. 판단은 desk.py 의 순수 함수입니다.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Protocol

from .config import Config
from .constants import (
    DESK_AUTH_NONE,
    DESK_SCAN_TIMEOUT_SECONDS,
    DESK_SETTING_AUTH_SOURCE,
    DESK_SETTING_COOKIE_EXPIRES_AT,
    DESK_SETTING_LAST_SCAN_AT,
    DESK_SETTING_LAST_SCAN_NOTE,
    DESK_SETTING_LAST_SCAN_OK,
    DESK_STALE_RUNNING_MINUTES,
    SCAN_REQUEST_PENDING,
    SCAN_REQUEST_RUNNING,
)
from .desk import (
    DeskAuth,
    DeskAuthExpired,
    DeskAuthMissing,
    DeskTimeout,
    FetchResult,
    LocalSnapshots,
    ScanState,
    WarnStamp,
    fetch_state,
    is_missing_object,
    iso_ms,
    kst_label,
    make_snapshot,
    now_utc,
    parse_instant,
    readable_error,
    schedule_decision,
    should_warn,
    snapshot_row,
    to_upload,
)
from .secrets import DeskAuthChoice, resolve_desk_auth

log = logging.getLogger("ticket_agent.desk")

#: 수집 요청을 보는 간격. 화면은 2분까지 기다리므로 넉넉합니다
POLL_SECONDS = 10
#: 인증(app_secrets)을 다시 읽는 간격. 화면에서 쿠키를 바꾸면 이만큼 안에 반영됩니다
AUTH_REFRESH_SECONDS = 60
#: desk 요청 한 번의 상한. 스캔 전체 상한(3분) 안에서 남은 시간과 작은 쪽을 씁니다
FETCH_TIMEOUT_SECONDS = 60
#: desk 스레드의 DB 요청 한 번 상한
STORE_TIMEOUT_SECONDS = 30
#: 같은 경고를 다시 찍는 간격
WARN_EVERY_SECONDS = 3600
#: 인증 상태를 화면에 못 적었을 때 다시 시도하는 간격
PUBLISH_RETRY_SECONDS = 600

TRIGGER_LABELS = {
    "request": "화면 요청",
    "schedule": "정기",
    "manual": "수동",
    "auth_change": "인증 교체 확인",
}

STALE_REASON = (
    f"수집이 {DESK_STALE_RUNNING_MINUTES}분 넘게 끝나지 않아 중단된 것으로 봅니다 — "
    "에이전트가 도중에 꺼졌거나 PC 가 잠들었을 수 있습니다"
)
MISSING_QUEUE = (
    "수집 요청 표(desk_scan_requests)가 DB 에 없습니다 — Supabase SQL Editor 에서 "
    "supabase/schema.sql 을 다시 실행하세요 (25장)"
)


class DeskStore(Protocol):
    """desk 스레드가 쓰는 store.py 의 일부. 테스트는 가짜를 넣습니다."""

    def secrets(self, keys: list[str]) -> dict[str, str]: ...
    def set_settings(self, values: dict[str, str]) -> bool: ...
    def open_scan_requests(self) -> list[dict[str, Any]]: ...
    def fail_stale_scan_requests(self, cutoff_iso: str, now_iso: str, reason: str) -> int: ...
    def claim_scan_requests(self, now_iso: str) -> list[int]: ...
    def finish_scan_requests(
        self, ids: list[int], ok: bool, now_iso: str, day: str | None = None, error: str | None = None
    ) -> None: ...
    def uploaded_snapshot_days(self) -> dict[str, str]: ...
    def upload_snapshot(self, row: dict[str, Any]) -> None: ...


@dataclass(frozen=True)
class ScanOutcome:
    ok: bool
    trigger: str
    at: str
    day: str | None = None
    #: 실패 이유. readable_error 를 거친 문장입니다 — 그대로 DB·화면에 나갑니다
    error: str | None = None
    work: int | None = None

    @property
    def note(self) -> str:
        """설정 화면의 '마지막 수집' 칸에 들어갈 한 줄."""
        label = TRIGGER_LABELS.get(self.trigger, self.trigger)
        if self.ok:
            count = f" · 업무 {self.work}건" if self.work is not None else ""
            return f"{self.day} 스냅샷{count} ({label})"
        return f"{self.error} ({label})"


@dataclass(frozen=True)
class RequestPlan:
    stale: bool
    pending: bool


def plan_requests(rows: list[dict[str, Any]], now: datetime) -> RequestPlan:
    """열린 요청 → 할 일. 순수 함수입니다.

    멈춘 running = 집어 간 뒤 10분이 지나도 안 끝난 것. 시각을 못 읽으면 멈춘 것으로
    보지 않습니다 — DB 쪽 조건(`started_at < cutoff`)이 최종 판정을 합니다.
    """
    cutoff = now - timedelta(minutes=DESK_STALE_RUNNING_MINUTES)
    stale = False
    pending = False
    for row in rows:
        status = row.get("status")
        if status == SCAN_REQUEST_PENDING:
            pending = True
        elif status == SCAN_REQUEST_RUNNING and row.get("started_at"):
            try:
                if parse_instant(str(row["started_at"])) < cutoff:
                    stale = True
            except ValueError:
                pass
    return RequestPlan(stale=stale, pending=pending)


def expired_message(auth: DeskAuth) -> str:
    when = kst_label(auth.expires_at) if auth.expires_at else "?"
    return f"desk 쿠키가 {when} 에 만료됐습니다 — 대시보드 설정에서 desk 쿠키를 다시 넣어 주세요"


class DeskWorker:
    def __init__(
        self,
        config: Config,
        store: DeskStore,
        *,
        fetch: Callable[..., FetchResult] = fetch_state,
        clock: Callable[[], datetime] = now_utc,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.store = store
        self.local = LocalSnapshots(config.desk_data_dir)
        self.state = ScanState(config.desk_data_dir)
        self._fetch = fetch
        self._now = clock
        self._mono = monotonic

        self._choice: DeskAuthChoice | None = None
        self._auth_read_at: float | None = None
        #: 화면에 마지막으로 알린 (출처, 만료일). None = 아직 한 번도 안 알림
        self._published: tuple[str, str] | None = None
        self._publish_retry_at = 0.0
        #: 이번 실행에서 끝낸 정기 회차. 로컬 기록을 못 써도 같은 회차를 되풀이하지 않게
        self._slot_done: datetime | None = None
        self._warned: dict[str, WarnStamp] = {}

    # ── 바퀴 ───────────────────────────────────────────────────────────────
    def run(self, stop: threading.Event) -> None:
        log.info(
            "desk 수집 시작 — 요청 확인 %d초마다 · 정기 수집 월 18:00 · 화 09:00 (한국 시각)",
            POLL_SECONDS,
        )
        while not stop.is_set():
            self.tick()
            stop.wait(POLL_SECONDS)
        log.info("desk 수집을 멈췄습니다.")

    def tick(self) -> None:
        """한 바퀴. 단계마다 예외를 받아 경고로 남기고 다음 단계로 갑니다."""
        for name, step in (
            ("requests", self.check_requests),
            ("schedule", self.check_schedule),
            ("auth", self.check_auth),
        ):
            try:
                step()
            except Exception as exc:  # 스레드가 죽으면 아무도 모릅니다
                self._warn(f"tick:{name}", f"desk {name} 단계 오류 — {readable_error(exc)}")

    # ── 1. 수집 요청 ────────────────────────────────────────────────────────
    def check_requests(self) -> None:
        try:
            rows = self.store.open_scan_requests()
        except Exception as exc:
            if is_missing_object(getattr(exc, "code", None), str(exc)):
                self._warn("requests", MISSING_QUEUE)
            else:
                self._warn("requests", f"수집 요청 확인 실패 — {readable_error(exc)}")
            return
        self._clear("requests")
        if not rows:
            return

        now = self._now()
        plan = plan_requests(rows, now)
        if plan.stale:
            cutoff = now - timedelta(minutes=DESK_STALE_RUNNING_MINUTES)
            closed = self.store.fail_stale_scan_requests(iso_ms(cutoff), iso_ms(now), STALE_REASON)
            if closed:
                log.info("수집 요청 — 멈춘 요청 %d건을 실패로 닫았습니다", closed)
        if not plan.pending:
            return

        ids = self.store.claim_scan_requests(iso_ms(self._now()))
        if not ids:
            return  # 같은 순간 다른 쪽이 집었습니다
        log.info(
            "수집 요청 %d건 (#%s) — 스캔 한 번으로 함께 처리합니다",
            len(ids),
            " #".join(str(i) for i in ids),
        )
        outcome = self.scan("request")
        try:
            self.store.finish_scan_requests(
                ids, outcome.ok, iso_ms(self._now()), day=outcome.day, error=outcome.error
            )
        except Exception as exc:
            # 못 적으면 요청은 running 에 남고, 10분 뒤 다음 바퀴가 실패로 닫습니다
            log.warning("수집 요청 결과를 적지 못했습니다: %s", readable_error(exc))

    # ── 2. 정기 수집 ────────────────────────────────────────────────────────
    def check_schedule(self) -> None:
        st = self.state.load()
        kind, slot = schedule_decision(self._now(), st.get("last_slot"), st.get("last_success_at"))
        if kind == "done" or slot == self._slot_done:
            return
        if kind == "due":
            log.info("정기 수집 — %s 회차", kst_label(slot))
            self.scan("schedule")
        # 성공이든 실패든 이 회차는 끝입니다. 실패를 10초마다 되풀이하지 않습니다 —
        # 로컬 기록을 못 써도(디스크·권한) 이 실행 안에서는 메모리가 막습니다
        self._slot_done = slot
        self.state.update(last_slot=iso_ms(slot))

    # ── 3. 인증 상태 ────────────────────────────────────────────────────────
    def refresh_auth(self, force: bool = False) -> DeskAuthChoice:
        now = self._mono()
        if (
            not force
            and self._choice is not None
            and self._auth_read_at is not None
            and now - self._auth_read_at < AUTH_REFRESH_SECONDS
        ):
            return self._choice
        choice = resolve_desk_auth(self.store, self.config)
        self._choice = choice
        self._auth_read_at = now
        for note in choice.notes:
            self._warn(f"auth-note:{note}", note)
        return choice

    def check_auth(self) -> None:
        """바뀌었으면 출처·만료일을 화면에 알립니다. 쿠키를 새로 받았으면 확인 수집 한 번."""
        choice = self.refresh_auth()
        auth = choice.auth
        fingerprint = auth.fingerprint() if auth else (DESK_AUTH_NONE, "")
        if fingerprint == self._published or self._mono() < self._publish_retry_at:
            return
        if not self.store.set_settings(
            {
                DESK_SETTING_AUTH_SOURCE: fingerprint[0],
                DESK_SETTING_COOKIE_EXPIRES_AT: fingerprint[1],
            }
        ):
            # 10초마다 같은 실패를 되풀이하지 않고 10분 뒤 다시 알립니다
            self._publish_retry_at = self._mono() + PUBLISH_RETRY_SECONDS
            return
        first = self._published is None
        self._published = fingerprint
        if auth is None:
            self._warn("auth", choice.problem or "desk 인증이 없습니다")
            return
        self._clear("auth")
        if first or auth.expired(self._now()):
            return
        # 사람이 화면에서 쿠키를 바꿨습니다. 마지막 수집이 실패였으면 지금 확인합니다 —
        # 다음 정기 회차까지 기다리면 그사이 보고서가 옛 스냅샷으로 나갑니다
        if self.state.load().get("last_ok") is False:
            log.info("desk 인증이 바뀌었습니다 — 확인 수집을 한 번 합니다")
            self.scan("auth_change")

    # ── 스캔 한 번 ──────────────────────────────────────────────────────────
    def scan(self, trigger: str) -> ScanOutcome:
        """받기 → 로컬 사본 → 밀린 것까지 업로드 → 결과 기록. 상한 3분.

        성공은 **대시보드에 올라갔을 때만**입니다. 화면은 대시보드의 스냅샷으로
        보고서를 만들므로, 로컬에만 남은 스냅샷은 화면에게는 없는 것과 같습니다.
        로컬 사본은 남아 다음 수집 때 다시 올라갑니다.
        """
        deadline = self._mono() + DESK_SCAN_TIMEOUT_SECONDS
        try:
            choice = self.refresh_auth(force=True)
            auth = choice.auth
            if auth is None:
                raise DeskAuthMissing(choice.problem or "desk 인증이 없습니다")
            if auth.expired(self._now()):
                raise DeskAuthExpired(expired_message(auth))
            remaining = max(1.0, deadline - self._mono())
            result = self._fetch(
                self.config.desk_url, auth, timeout=min(FETCH_TIMEOUT_SECONDS, remaining)
            )
            snap = make_snapshot(result.state, self._now())
            self.local.save(snap)
            meta = snap["meta"]
            day = meta["scannedAt"][:10]
            log.info(
                "desk 수집 — work %d · projects %d · decisions %d (원본 %s · 계정 %s)",
                meta["counts"]["work"],
                meta["counts"]["projects"],
                meta["counts"]["decisions"],
                meta["sourceUpdatedAt"] or "없음",
                result.email or "?",
            )
            upload_error = self.push(deadline)
            if upload_error:
                outcome = self._outcome(
                    False,
                    trigger,
                    error=readable_error(
                        f"스냅샷은 수집했지만 대시보드에 올리지 못했습니다 — {upload_error}"
                    ),
                )
            else:
                outcome = self._outcome(True, trigger, day=day, work=meta["counts"]["work"])
        except Exception as exc:
            outcome = self._outcome(False, trigger, error=readable_error(exc))

        if outcome.ok:
            log.info("desk 수집 완료 — %s", outcome.note)
        else:
            log.warning("desk 수집 실패 — %s", outcome.note)
        self._record(outcome)
        return outcome

    def push(self, deadline: float) -> str | None:
        """대시보드에 없거나 로컬이 더 늦게 뜬 날짜를 올립니다. 실패면 이유, 성공이면 None."""
        try:
            remote = self.store.uploaded_snapshot_days()
            index = self.local.index()
            todo = to_upload(((f"{day}.json", at) for day, at in sorted(index.items())), remote)
            for name in todo:
                if self._mono() > deadline:
                    raise DeskTimeout(
                        f"수집이 {DESK_SCAN_TIMEOUT_SECONDS // 60}분 안에 끝나지 않았습니다 — "
                        f"올리지 못한 스냅샷은 다음 수집 때 다시 올립니다"
                    )
                self.store.upload_snapshot(snapshot_row(self.local.read(name[:10])))
            if todo:
                log.info("desk 업로드 — 스냅샷 %d개 (%s)", len(todo), ", ".join(n[:10] for n in todo))
            return None
        except Exception as exc:
            return readable_error(exc)

    def _outcome(self, ok: bool, trigger: str, **kw: Any) -> ScanOutcome:
        return ScanOutcome(ok=ok, trigger=trigger, at=iso_ms(self._now()), **kw)

    def _record(self, outcome: ScanOutcome) -> None:
        """결과를 로컬(정기 회차 판단용)과 화면(app_settings)에 남깁니다."""
        local: dict[str, Any] = {"last_ok": outcome.ok, "last_scan_at": outcome.at}
        if outcome.ok:
            local["last_success_at"] = outcome.at
        try:
            self.state.update(**local)
        except OSError as exc:
            log.warning("desk 수집 상태를 로컬에 적지 못했습니다: %s", exc)
        self.store.set_settings(
            {
                DESK_SETTING_LAST_SCAN_AT: outcome.at,
                DESK_SETTING_LAST_SCAN_OK: "true" if outcome.ok else "false",
                DESK_SETTING_LAST_SCAN_NOTE: outcome.note,
            }
        )

    # ── 경고 ───────────────────────────────────────────────────────────────
    def _warn(self, key: str, msg: str) -> None:
        now = self._mono()
        if should_warn(self._warned.get(key), msg, now, WARN_EVERY_SECONDS):
            log.warning("%s (같은 내용은 한 시간에 한 번만 적습니다)", msg)
            self._warned[key] = WarnStamp(now, msg)

    def _clear(self, key: str) -> None:
        self._warned.pop(key, None)


def start_desk_thread(config: Config) -> tuple[threading.Thread, threading.Event] | None:
    """`run` 이 부릅니다. 꺼져 있거나 시작하지 못하면 None — 메일 수집은 그대로 돕니다."""
    if not config.desk_scan_enabled:
        log.info("desk 수집은 꺼져 있습니다 (DESK_SCAN=off)")
        return None
    try:
        from .store import TicketStore  # 테스트가 이 모듈을 Supabase 없이 불러오게

        store = TicketStore(
            config.supabase_url,
            config.supabase_service_key,
            config.supabase_bucket,
            timeout=STORE_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        log.warning("desk 수집을 시작하지 못했습니다 — %s", readable_error(exc))
        return None
    worker = DeskWorker(config, store)
    stop = threading.Event()
    thread = threading.Thread(target=worker.run, args=(stop,), name="desk", daemon=True)
    thread.start()
    return thread, stop
