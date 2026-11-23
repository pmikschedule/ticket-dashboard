"""desk 수집 — 순수 함수·로컬 파일·인증 고르기.

계약 자료(contracts/desk)로 못박는 것은 test_desk_contracts.py 에 있습니다.
여기는 에이전트에만 있는 것들입니다: 정기 회차, 로컬 사본, 인증 우선순위.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from ticket_agent.config import ConfigError, _switch
from ticket_agent.desk import (
    KST,
    DeskAuth,
    LocalSnapshots,
    ScanState,
    WarnStamp,
    epoch_ms,
    fetch_state,
    is_missing_object,
    iso_ms,
    kst_label,
    latest_slot,
    make_snapshot,
    parse_instant,
    schedule_decision,
    should_warn,
)
from ticket_agent.secrets import DESK_AUTH_MISSING, choose_desk_auth

UTC = timezone.utc

# 가상 JWT — contracts/desk/cookies.json 과 같은 것 (만료 2026-11-25T03:44:00Z)
JWT = (
    "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Uta2lkIiwidHlwIjoiSldUIn0."
    "eyJhdWQiOlsiZmFrZS1hdWRpZW5jZSJdLCJlbWFpbCI6InRlc3RlckBleGFtcGxlLmNvbSIsImV4cCI6MTc5NTU3ODI0MCwiaWF0IjoxNzkyOTg2MjQwLCJ0eXBlIjoiYXBwIn0."
    "ZmFrZS1zaWduYXR1cmUtbm90LWEtcmVhbC10b2tlbg"
)
JWT_EXP = datetime(2026, 11, 25, 3, 44, tzinfo=UTC)


def kst(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=KST)


# ── 시각 ─────────────────────────────────────────────────────────────────────


class TestParseInstant:
    """파이썬 3.10 의 fromisoformat 이 못 읽는 모양을 읽어야 합니다."""

    @pytest.mark.parametrize(
        "text, expected",
        [
            ("2026-11-23T00:12:34.12+00:00", "2026-11-23T00:12:34.120Z"),  # Postgres 가 끝 0 을 뗌
            ("2026-11-23T00:12:34Z", "2026-11-23T00:12:34.000Z"),
            ("2026-11-23T00:12:34.123456+00:00", "2026-11-23T00:12:34.123Z"),
            ("2026-11-23T09:12:34+09:00", "2026-11-23T00:12:34.000Z"),
            ("2026-11-23T09:12:34.5+0900", "2026-11-23T00:12:34.500Z"),
            ("2026-11-23 00:12:34+00", "2026-11-23T00:12:34.000Z"),
            ("2026-11-23T00:12", "2026-11-23T00:12:00.000Z"),  # 시간대가 없으면 UTC
        ],
    )
    def test_여러_모양(self, text, expected):
        assert iso_ms(parse_instant(text)) == expected

    def test_못_읽으면_예외(self):
        with pytest.raises(ValueError):
            parse_instant("어제")

    def test_밀리초_비교는_아래를_버립니다(self):
        assert epoch_ms("2026-11-23T00:00:00.123999Z") == epoch_ms("2026-11-23T00:00:00.123Z")

    def test_한국_시각_표시(self):
        assert kst_label(JWT_EXP) == "11/25 12:44"


# ── 정기 회차 ────────────────────────────────────────────────────────────────


class TestSchedule:
    """월 18:00 · 화 09:00 (한국 시각). 2026-11-23 은 월요일입니다."""

    @pytest.mark.parametrize(
        "now, slot",
        [
            (kst(2026, 11, 23, 17, 59), kst(2026, 11, 17, 9)),  # 월 18시 직전 → 지난 화
            (kst(2026, 11, 23, 18, 0), kst(2026, 11, 23, 18)),  # 정각 포함
            (kst(2026, 11, 24, 8, 59), kst(2026, 11, 23, 18)),
            (kst(2026, 11, 24, 9, 0), kst(2026, 11, 24, 9)),
            (kst(2026, 11, 29, 12, 0), kst(2026, 11, 24, 9)),  # 일요일
        ],
    )
    def test_가장_최근_회차(self, now, slot):
        assert latest_slot(now) == slot
        assert latest_slot(now.astimezone(UTC)) == slot  # UTC 로 받아도 같습니다

    def test_처음이면_바로_한_번(self):
        kind, slot = schedule_decision(kst(2026, 11, 23, 12), None, None)
        assert kind == "due" and slot == kst(2026, 11, 17, 9)

    def test_이번_회차를_이미_했으면_다시_안_합니다(self):
        """실패했어도 같습니다. 쿠키가 만료됐으면 몇 번을 해도 같은 이유로 실패합니다."""
        last = iso_ms(kst(2026, 11, 23, 18))
        assert schedule_decision(kst(2026, 11, 23, 23), last, None)[0] == "done"

    def test_꺼져_있다_켜지면_놓친_회차는_한_번만(self):
        """월 18:00 과 화 09:00 을 둘 다 놓쳤어도 마지막 회차 하나만 합니다."""
        last = iso_ms(kst(2026, 11, 17, 9))
        kind, slot = schedule_decision(kst(2026, 11, 25, 10), last, None)
        assert kind == "due" and slot == kst(2026, 11, 24, 9)

    def test_회차_뒤에_성공한_수집이_있으면_건너뜁니다(self):
        last = iso_ms(kst(2026, 11, 17, 9))
        success = iso_ms(kst(2026, 11, 23, 18, 30))  # 화면 요청으로 받은 것
        assert schedule_decision(kst(2026, 11, 23, 19), last, success)[0] == "covered"

    def test_망가진_기록은_없는_것으로(self):
        assert schedule_decision(kst(2026, 11, 23, 19), "엉망", "엉망")[0] == "due"


# ── 인증 고르기 ──────────────────────────────────────────────────────────────


class TestChooseDeskAuth:
    def test_설정_화면이_env_를_이깁니다(self):
        """화면에서 새 쿠키를 넣었는데 .env 의 옛 쿠키가 이기면 바꾼 줄 알고 계속 실패합니다."""
        choice = choose_desk_auth(db_cookie=JWT, env_cookie="other.jwt.value")
        assert choice.auth is not None and choice.auth.source == "settings"
        assert choice.auth.expires_at == JWT_EXP

    def test_화면에_없으면_env(self):
        choice = choose_desk_auth(db_cookie="  ", env_cookie=f"CF_Authorization={JWT}")
        assert choice.auth is not None and choice.auth.source == "env"
        assert choice.auth.headers() == {"Cookie": f"CF_Authorization={JWT}"}

    def test_Service_Token_이_쿠키를_이깁니다(self):
        choice = choose_desk_auth(
            db_cookie=JWT, env_cookie="", env_client_id="id.access", env_client_secret="s3cr3t"
        )
        auth = choice.auth
        assert auth is not None and auth.source == "service_token" and auth.origin == "env"
        assert auth.headers() == {"CF-Access-Client-Id": "id.access", "CF-Access-Client-Secret": "s3cr3t"}
        assert auth.expires_at is None and not auth.expired(datetime.now(UTC))

    def test_Service_Token_도_화면이_우선(self):
        choice = choose_desk_auth(
            db_cookie="",
            env_cookie="",
            db_client_id="db.access",
            db_client_secret="db-secret",
            env_client_id="env.access",
            env_client_secret="env-secret",
        )
        assert choice.auth is not None and choice.auth.origin == "settings"

    def test_반쪽_Service_Token_은_안_쓰고_알립니다(self):
        choice = choose_desk_auth(db_cookie=JWT, env_cookie="", env_client_id="id.access")
        assert choice.auth is not None and choice.auth.source == "settings"
        assert any("반쪽" in n for n in choice.notes)

    def test_못_읽는_쿠키는_건너뛰고_알립니다(self):
        choice = choose_desk_auth(db_cookie="not-a-jwt", env_cookie=JWT)
        assert choice.auth is not None and choice.auth.source == "env"
        assert any("설정 화면" in n for n in choice.notes)

    def test_만료된_쿠키도_고릅니다(self):
        """만료됐다고 .env 의 옛 값으로 조용히 넘어가지 않습니다 — 수집이 이유를 밝히며 실패합니다."""
        choice = choose_desk_auth(db_cookie=JWT, env_cookie="")
        assert choice.auth is not None and choice.auth.expired(JWT_EXP + timedelta(seconds=1))

    def test_아무것도_없으면_어디에_넣을지_알려_줍니다(self):
        choice = choose_desk_auth(db_cookie="", env_cookie="")
        assert choice.auth is None and choice.problem == DESK_AUTH_MISSING
        assert "설정 화면" in DESK_AUTH_MISSING

    def test_repr_에_값이_안_나옵니다(self):
        auth = choose_desk_auth(db_cookie=JWT, env_cookie="").auth
        assert JWT not in repr(auth) and JWT[-4:] in auth.hint
        token = choose_desk_auth("", "", env_client_id="id.access", env_client_secret="s3cr3t-value").auth
        assert "s3cr3t-value" not in repr(token) and "s3cr3t-value" not in token.hint


def test_요청_헤더():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.headers)
        return httpx.Response(200, json={"state": {"work": []}})

    auth = DeskAuth.service_token("env", "id.access", "s3cr3t")
    fetch_state("https://desk.example.invalid", auth, transport=httpx.MockTransport(handler))
    assert seen["cf-access-client-id"] == "id.access"
    assert seen["cf-access-client-secret"] == "s3cr3t"
    assert "cookie" not in seen
    assert seen["user-agent"].startswith("ticket-agent/")


def test_연결_실패는_사람이_읽을_문장():
    def handler(request):
        raise httpx.ConnectError("이름을 찾을 수 없음")

    auth = DeskAuth.cookie("settings", JWT, JWT_EXP)
    with pytest.raises(Exception) as exc:
        fetch_state("https://desk.example.invalid", auth, transport=httpx.MockTransport(handler))
    assert "연결하지 못했습니다" in str(exc.value)
    assert JWT not in str(exc.value)


# ── 경고 간격 · 표 없음 ──────────────────────────────────────────────────────


class TestWarn:
    def test_처음이면_찍습니다(self):
        assert should_warn(None, "a", 0, 3600)

    def test_같은_내용은_간격_안에_다시_안_찍습니다(self):
        assert not should_warn(WarnStamp(0, "a"), "a", 3599, 3600)
        assert should_warn(WarnStamp(0, "a"), "a", 3600, 3600)

    def test_내용이_바뀌면_바로(self):
        assert should_warn(WarnStamp(0, "a"), "b", 1, 3600)


@pytest.mark.parametrize(
    "code, message, expected",
    [
        ("PGRST205", "", True),
        ("42P01", "", True),
        (None, "Could not find the table 'public.desk_scan_requests' in the schema cache", True),
        (None, 'relation "desk_scan_requests" does not exist', True),
        ("42501", "permission denied", False),
        (None, None, False),
    ],
)
def test_표_없음_판정(code, message, expected):
    assert is_missing_object(code, message) is expected


# ── 로컬 파일 ────────────────────────────────────────────────────────────────


class TestLocalSnapshots:
    def test_저장하면_파일과_색인이_생깁니다(self, tmp_path):
        local = LocalSnapshots(tmp_path)
        snap = make_snapshot({"work": [{"id": "w-1"}], "updatedAt": "x"}, parse_instant("2026-11-23T01:00:00Z"))
        path = local.save(snap)
        assert path.name == "2026-11-23.json"
        assert json.loads(path.read_text(encoding="utf-8")) == snap
        assert local.index() == {"2026-11-23": "2026-11-23T01:00:00.000Z"}

    def test_같은_날은_덮어씁니다(self, tmp_path):
        local = LocalSnapshots(tmp_path)
        for at in ("2026-11-23T01:00:00Z", "2026-11-23T09:00:00Z"):
            local.save(make_snapshot({"work": []}, parse_instant(at)))
        assert local.days() == ["2026-11-23"]
        assert local.index()["2026-11-23"] == "2026-11-23T09:00:00.000Z"

    def test_색인이_없거나_빠졌으면_그_파일만_읽어_채웁니다(self, tmp_path):
        local = LocalSnapshots(tmp_path)
        local.save(make_snapshot({"work": []}, parse_instant("2026-11-16T09:00:00Z")))
        # 색인을 쓰기 전에 꺼진 경우를 흉내: 파일만 하나 더 둡니다
        extra = make_snapshot({"work": []}, parse_instant("2026-11-17T00:00:00Z"))
        (local.dir / "2026-11-17.json").write_text(json.dumps(extra), encoding="utf-8")
        assert local.index() == {
            "2026-11-16": "2026-11-16T09:00:00.000Z",
            "2026-11-17": "2026-11-17T00:00:00.000Z",
        }
        (local.dir / "_index.json").unlink()
        assert len(local.index()) == 2

    def test_깨진_파일은_올리지_않습니다(self, tmp_path):
        local = LocalSnapshots(tmp_path)
        local.dir.mkdir(parents=True)
        (local.dir / "2026-11-20.json").write_text("{깨짐", encoding="utf-8")
        assert local.index() == {}

    def test_색인과_다른_파일은_날짜로_안_칩니다(self, tmp_path):
        local = LocalSnapshots(tmp_path)
        local.save(make_snapshot({"work": []}, parse_instant("2026-11-16T09:00:00Z")))
        (local.dir / "메모.json").write_text("{}", encoding="utf-8")
        assert local.days() == ["2026-11-16"]


def test_수집_상태는_덧붙여_씁니다(tmp_path):
    state = ScanState(tmp_path)
    assert state.load() == {}
    state.update(last_slot="a")
    state.update(last_ok=True)
    assert state.load() == {"last_slot": "a", "last_ok": True}


class TestSwitch:
    @pytest.mark.parametrize("raw, expected", [("", True), ("on", True), ("OFF", False), ("0", False), ("yes", True)])
    def test_켜고_끄기(self, monkeypatch, raw, expected):
        monkeypatch.setenv("DESK_SCAN", raw)
        assert _switch("DESK_SCAN", True) is expected

    def test_모르는_값은_조용히_넘기지_않습니다(self, monkeypatch):
        monkeypatch.setenv("DESK_SCAN", "maybe")
        with pytest.raises(ConfigError, match="DESK_SCAN"):
            _switch("DESK_SCAN", True)
