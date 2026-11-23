"""desk 수집 — 저장소 루트 `contracts/desk/*.json` 과 같은 답을 내는가.

같은 파일을 reporter(vitest)·web(vitest)도 읽습니다. 기대값은 reporter 구현(옛 수집기)
으로 계산해 둔 것이라, 여기서 통과하면 에이전트가 reporter 와 **같은 행**을 올립니다.
자료는 전부 가상입니다.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import httpx
import pytest

from ticket_agent import constants as C
from ticket_agent.desk import (
    CookieError,
    DeskAuth,
    DeskError,
    days_left,
    fetch_state,
    iso_ms,
    jwt_expiry,
    make_snapshot,
    normalize_cookie,
    parse_instant,
    parse_state_response,
    readable_error,
    snapshot_row,
    to_upload,
)

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts" / "desk"


def load(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def cases(name: str) -> list[dict]:
    return load(name)["cases"]


def ids(name: str) -> list[str]:
    return [c["name"] for c in cases(name)]


# ── 상수 ─────────────────────────────────────────────────────────────────────


class TestConstants:
    c = load("constants.json")

    def test_수집_요청_상태(self):
        assert list(C.SCAN_REQUEST_STATUSES) == self.c["request_statuses"]

    def test_멈춤_판정과_스캔_상한(self):
        assert C.DESK_STALE_RUNNING_MINUTES == self.c["stale_running_minutes"]
        assert C.DESK_SCAN_TIMEOUT_SECONDS == self.c["scan_timeout_seconds"]
        assert C.DESK_EXPIRY_WARN_DAYS == self.c["expiry_warn_days"]

    def test_비밀값_이름(self):
        assert {
            "cookie": C.DESK_COOKIE_SECRET,
            "client_id": C.DESK_CLIENT_ID_SECRET,
            "client_secret": C.DESK_CLIENT_SECRET_SECRET,
        } == self.c["secret_keys"]

    def test_설정_이름(self):
        assert {
            "auth_source": C.DESK_SETTING_AUTH_SOURCE,
            "cookie_expires_at": C.DESK_SETTING_COOKIE_EXPIRES_AT,
            "last_scan_at": C.DESK_SETTING_LAST_SCAN_AT,
            "last_scan_ok": C.DESK_SETTING_LAST_SCAN_OK,
            "last_scan_note": C.DESK_SETTING_LAST_SCAN_NOTE,
        } == self.c["setting_keys"]

    def test_인증_출처(self):
        assert list(C.DESK_AUTH_SOURCES) == self.c["auth_sources"]

    def test_schema_sql_의_check_제약이_같은_값(self):
        """여기가 틀리면 에이전트의 상태 변경이 check 제약에 걸려 요청이 running 에 멈춥니다."""
        sql = (ROOT / "supabase" / "schema.sql").read_text(encoding="utf-8")
        values = ", ".join(f"'{s}'" for s in self.c["request_statuses"])
        assert f"check (status in ({values}))" in sql

    def test_schema_sql_이_설정_행을_미리_만듭니다(self):
        """웹의 updateSetting 은 update 만 합니다 — 행이 없으면 아무 일도 안 일어납니다."""
        sql = (ROOT / "supabase" / "schema.sql").read_text(encoding="utf-8")
        for key in self.c["setting_keys"].values():
            assert re.search(rf"\('{key}',", sql), key


# ── 스냅샷 → 행 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", cases("snapshot_rows.json"), ids=ids("snapshot_rows.json"))
def test_스냅샷_행(case):
    at = parse_instant(case["scanned_at"])
    assert iso_ms(at) == case["scanned_at"]  # 시각 모양이 JS toISOString 과 같습니다
    row = snapshot_row(make_snapshot(case["response"]["state"], at))
    assert row == case["expected_row"]
    assert sorted(row) == ["counts", "day", "scanned_at", "source_at", "state"]


def test_마이크로초는_버리고_밀리초까지만():
    at = parse_instant("2026-11-23T08:59:59.999999+00:00")
    assert make_snapshot({"work": []}, at)["meta"]["scannedAt"] == "2026-11-23T08:59:59.999Z"


# ── 올릴 것 고르기 ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", cases("to_upload.json"), ids=ids("to_upload.json"))
def test_올릴_것(case):
    local = [(item["file"], item["scannedAt"]) for item in case["local"]]
    assert to_upload(local, case["remote"]) == case["expected"]


# ── 실패 이유 가리기 ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", cases("readable_error.json"), ids=ids("readable_error.json"))
def test_실패_이유(case):
    assert readable_error(case["input"]) == case["expected"]
    assert readable_error(RuntimeError(case["input"])) == case["expected"] or case["input"] == ""


# ── 쿠키 ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", cases("cookies.json"), ids=ids("cookies.json"))
def test_쿠키(case):
    token = normalize_cookie(case["raw"])
    assert token == case["normalized"]
    if case["error"]:
        with pytest.raises(CookieError) as exc:
            jwt_expiry(token)
        assert exc.value.kind == case["error"]
    else:
        assert iso_ms(jwt_expiry(token)) == case["expires_at"]


@pytest.mark.parametrize("case", cases("days_left.json"), ids=ids("days_left.json"))
def test_남은_일수(case):
    assert days_left(parse_instant(case["expires_at"]), parse_instant(case["now"])) == case["days"]


# ── desk 응답 ────────────────────────────────────────────────────────────────


def kind_of(status: int, body: str) -> tuple[str, object]:
    try:
        result = parse_state_response(status, body)
    except DeskError as exc:
        return exc.kind, None
    return "ok", result


@pytest.mark.parametrize("case", cases("fetch_responses.json"), ids=ids("fetch_responses.json"))
def test_응답_판정(case):
    kind, result = kind_of(case["status"], case["body"])
    assert kind == case["kind"]
    if kind == "ok":
        assert len(result.state["work"]) == case["work"]
        assert result.email == case["email"]


@pytest.mark.parametrize("case", cases("fetch_responses.json"), ids=ids("fetch_responses.json"))
def test_네트워크를_거쳐도_같은_판정(case):
    """리디렉션을 따라가지 않습니다 — 따라가면 로그인 HTML 을 JSON 으로 읽으려다 깨집니다."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        headers = {"location": "https://example.invalid/login"} if case["status"] in (301, 302) else {}
        return httpx.Response(case["status"], content=case["body"].encode("utf-8"), headers=headers)

    auth = DeskAuth.cookie("settings", "fake.token.value", parse_instant("2026-12-01T00:00:00Z"))
    try:
        result = fetch_state("https://desk.example.invalid/", auth, transport=httpx.MockTransport(handler))
        kind = "ok"
    except DeskError as exc:
        kind, result = exc.kind, None
    assert kind == case["kind"]
    assert len(seen) == 1  # 한 번만 — 리디렉션을 따라갔으면 둘입니다
    assert str(seen[0].url) == "https://desk.example.invalid/api/state"
    assert seen[0].headers["cookie"] == "CF_Authorization=fake.token.value"
    if kind == "ok":
        assert result.email == case["email"]
