"""desk 스레드 — 요청 큐 · 정기 수집 · 인증 교체 · 업로드.

Supabase 도 desk 도 없이 돕니다. store 와 fetch 를 가짜로 넣고, 시계도 손으로 돌립니다.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from ticket_agent.config import Config
from ticket_agent.constants import (
    DESK_COOKIE_SECRET,
    DESK_SETTING_AUTH_SOURCE,
    DESK_SETTING_COOKIE_EXPIRES_AT,
    DESK_SETTING_LAST_SCAN_NOTE,
    DESK_SETTING_LAST_SCAN_OK,
)
from ticket_agent.desk import DeskAuthExpired, FetchResult, LocalSnapshots, iso_ms, make_snapshot, parse_instant
from ticket_agent.desk_worker import DeskWorker, plan_requests

UTC = timezone.utc

JWT = (
    "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Uta2lkIiwidHlwIjoiSldUIn0."
    "eyJhdWQiOlsiZmFrZS1hdWRpZW5jZSJdLCJlbWFpbCI6InRlc3RlckBleGFtcGxlLmNvbSIsImV4cCI6MTc5NTU3ODI0MCwiaWF0IjoxNzkyOTg2MjQwLCJ0eXBlIjoiYXBwIn0."
    "ZmFrZS1zaWduYXR1cmUtbm90LWEtcmVhbC10b2tlbg"
)  # 만료 2026-11-25T03:44:00Z
JWT_LATER = (
    "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2Uta2lkIiwidHlwIjoiSldUIn0."
    "eyJlbWFpbCI6Iu2FjOyKpO2EsEBleGFtcGxlLmNvbSIsImV4cCI6MTc5ODE3MDI0MH0."
    "ZmFrZS1zaWduYXR1cmUtbm90LWEtcmVhbC10b2tlbg"
)  # 만료 2026-12-25T03:44:00Z


class FakeStore:
    def __init__(self, cookie: str = JWT) -> None:
        self.secret_values = {DESK_COOKIE_SECRET: cookie} if cookie else {}
        self.settings: dict[str, str] = {}
        self.requests: list[dict[str, Any]] = []
        self.remote: dict[str, str] = {}
        self.uploaded: list[dict[str, Any]] = []
        self.fail_open: Exception | None = None
        self.fail_upload: Exception | None = None
        self.calls: list[str] = []

    def secrets(self, keys):
        return {k: v for k, v in self.secret_values.items() if k in keys}

    def set_settings(self, values):
        self.settings.update(values)
        return True

    def open_scan_requests(self):
        self.calls.append("open")
        if self.fail_open:
            raise self.fail_open
        return [dict(r) for r in self.requests if r["status"] in ("pending", "running")]

    def fail_stale_scan_requests(self, cutoff_iso, now_iso, reason):
        n = 0
        for r in self.requests:
            if r["status"] == "running" and parse_instant(r["started_at"]) < parse_instant(cutoff_iso):
                r.update(status="failed", error=reason, finished_at=now_iso)
                n += 1
        return n

    def claim_scan_requests(self, now_iso):
        got = []
        for r in self.requests:
            if r["status"] == "pending":
                r.update(status="running", started_at=now_iso)
                got.append(r["id"])
        return sorted(got)

    def finish_scan_requests(self, ids, ok, now_iso, day=None, error=None):
        for r in self.requests:
            if r["id"] in ids:
                r.update(status="done" if ok else "failed", snapshot_day=day, error=error, finished_at=now_iso)

    def uploaded_snapshot_days(self):
        return dict(self.remote)

    def upload_snapshot(self, row):
        if self.fail_upload:
            raise self.fail_upload
        self.uploaded.append(row)
        self.remote[row["day"]] = row["scanned_at"]


class Clock:
    def __init__(self, start: datetime) -> None:
        self.now = start
        self.mono = 1000.0

    def __call__(self) -> datetime:
        return self.now

    def monotonic(self) -> float:
        return self.mono

    def advance(self, **kw) -> None:
        delta = timedelta(**kw)
        self.now += delta
        self.mono += delta.total_seconds()


class FakeFetch:
    def __init__(self, work: int = 3, error: Exception | None = None) -> None:
        self.work = work
        self.error = error
        self.calls: list[Any] = []

    def __call__(self, url, auth, timeout=60.0):
        self.calls.append((url, auth, timeout))
        if self.error:
            raise self.error
        return FetchResult(
            state={"updatedAt": "2026-11-23T08:00:00.000Z", "work": [{"id": f"w-{i}"} for i in range(self.work)]},
            email="tester@example.com",
            tier=None,
        )


def make(tmp_path, store=None, fetch=None, start=None, **config):
    clock = Clock(start or datetime(2026, 11, 23, 3, 0, tzinfo=UTC))  # 월 12:00 KST
    cfg = Config(
        supabase_url="https://supabase.invalid",
        supabase_service_key="x",
        supabase_bucket="b",
        gemini_api_key="",
        gemini_model="m",
        gemini_thinking_budget=None,
        mail_backend="fixture",
        outlook_folder="f",
        outlook_done_folder="",
        scan_limit=0,
        scan_since=None,
        send_mode="display",
        send_poll_interval=30,
        desk_data_dir=tmp_path,
        **config,
    )
    store = store or FakeStore()
    fetch = fetch or FakeFetch()
    worker = DeskWorker(cfg, store, fetch=fetch, clock=clock, monotonic=clock.monotonic)
    return worker, store, fetch, clock


def pending(id_: int = 1) -> dict[str, Any]:
    return {"id": id_, "status": "pending", "started_at": None}


# ── 판단 ─────────────────────────────────────────────────────────────────────


def test_열린_요청_판단():
    now = datetime(2026, 11, 23, 3, 0, tzinfo=UTC)
    rows = [
        {"id": 1, "status": "running", "started_at": iso_ms(now - timedelta(minutes=11))},
        {"id": 2, "status": "running", "started_at": iso_ms(now - timedelta(minutes=9))},
    ]
    assert plan_requests(rows, now).stale and not plan_requests(rows, now).pending
    assert plan_requests([pending()], now).pending
    assert not plan_requests(rows[1:], now).stale


# ── 수집 요청 ────────────────────────────────────────────────────────────────


def test_요청을_집어_스캔하고_스냅샷_날짜를_적습니다(tmp_path):
    worker, store, fetch, _ = make(tmp_path)
    store.requests = [pending(1), pending(2)]
    worker.check_requests()
    assert len(fetch.calls) == 1  # 밀린 요청 둘을 스캔 한 번으로
    assert [r["status"] for r in store.requests] == ["done", "done"]
    assert {r["snapshot_day"] for r in store.requests} == {"2026-11-23"}
    assert [row["day"] for row in store.uploaded] == ["2026-11-23"]
    assert store.settings[DESK_SETTING_LAST_SCAN_OK] == "true"
    assert "화면 요청" in store.settings[DESK_SETTING_LAST_SCAN_NOTE]


def test_할_일이_없으면_쿼리_한_번으로_끝납니다(tmp_path):
    worker, store, fetch, _ = make(tmp_path)
    worker.check_requests()
    assert store.calls == ["open"] and fetch.calls == []


def test_업로드가_실패하면_요청은_실패입니다(tmp_path):
    """화면은 대시보드의 스냅샷만 봅니다. 로컬에만 남은 것은 화면에게는 없는 것과 같습니다."""
    worker, store, _, _ = make(tmp_path)
    store.requests = [pending()]
    store.fail_upload = RuntimeError("permission denied for table desk_snapshots")
    worker.check_requests()
    req = store.requests[0]
    assert req["status"] == "failed"
    assert "대시보드에 올리지 못했습니다" in req["error"]
    assert LocalSnapshots(tmp_path).days() == ["2026-11-23"]  # 로컬 사본은 남습니다


def test_다음_수집이_밀린_날짜를_다시_올립니다(tmp_path):
    worker, store, _, clock = make(tmp_path)
    store.fail_upload = RuntimeError("네트워크")
    worker.scan("manual")
    assert store.uploaded == []
    store.fail_upload = None
    clock.advance(days=1)
    worker.scan("manual")
    assert sorted(row["day"] for row in store.uploaded) == ["2026-11-23", "2026-11-24"]


def test_대시보드가_더_늦으면_안_올립니다(tmp_path):
    worker, store, _, _ = make(tmp_path)
    store.remote = {"2026-11-23": "2026-11-23T23:00:00+00:00"}
    worker.scan("manual")
    assert store.uploaded == []


def test_인증이_없으면_어디에_넣을지_적고_desk_에_안_갑니다(tmp_path):
    worker, store, fetch, _ = make(tmp_path, store=FakeStore(cookie=""))
    store.requests = [pending()]
    worker.check_requests()
    assert fetch.calls == []
    assert store.requests[0]["status"] == "failed"
    assert "설정 화면" in store.requests[0]["error"]


def test_만료된_쿠키는_desk_에_묻지_않고_이유를_적습니다(tmp_path):
    worker, store, fetch, _ = make(tmp_path, start=datetime(2026, 11, 26, tzinfo=UTC))
    store.requests = [pending()]
    worker.check_requests()
    assert fetch.calls == []
    error = store.requests[0]["error"]
    assert "11/25 12:44" in error and "다시 넣어" in error
    assert JWT not in error


def test_desk_가_로그인으로_돌려보내면_인증_만료(tmp_path):
    fetch = FakeFetch(error=DeskAuthExpired("desk 인증 만료 — 대시보드 설정에서 desk 쿠키를 다시 넣어 주세요"))
    worker, store, _, _ = make(tmp_path, fetch=fetch)
    store.requests = [pending()]
    worker.check_requests()
    assert store.requests[0]["error"].startswith("desk 인증 만료 — 대시보드 설정에서 desk 쿠키를 다시 넣어 주세요")


def test_멈춘_요청을_닫습니다(tmp_path):
    worker, store, fetch, clock = make(tmp_path)
    store.requests = [{"id": 7, "status": "running", "started_at": iso_ms(clock.now - timedelta(minutes=15))}]
    worker.check_requests()
    assert store.requests[0]["status"] == "failed"
    assert "10분" in store.requests[0]["error"]
    assert fetch.calls == []


def test_표가_없으면_한_시간에_한_번만_경고(tmp_path, caplog):
    worker, store, _, clock = make(tmp_path)
    err = RuntimeError("Could not find the table 'public.desk_scan_requests' in the schema cache")
    store.fail_open = err
    with caplog.at_level(logging.WARNING, logger="ticket_agent.desk"):
        for _ in range(30):  # 5분
            worker.check_requests()
            clock.advance(seconds=10)
    assert sum("25장" in r.getMessage() for r in caplog.records) == 1
    clock.advance(hours=1)
    with caplog.at_level(logging.WARNING, logger="ticket_agent.desk"):
        worker.check_requests()
    assert sum("25장" in r.getMessage() for r in caplog.records) == 2


def test_스캔은_3분을_넘기지_않습니다(tmp_path):
    """업로드가 밀려 있어도 상한을 넘으면 멈추고, 남은 것은 다음 수집이 올립니다."""
    worker, store, _, clock = make(tmp_path)
    local = LocalSnapshots(tmp_path)
    for d in range(16, 23):
        local.save(make_snapshot({"work": []}, datetime(2026, 11, d, 9, tzinfo=UTC)))
    original = store.upload_snapshot

    def slow(row):
        clock.advance(seconds=50)
        original(row)

    store.upload_snapshot = slow
    out = worker.scan("manual")
    assert not out.ok and "3분" in out.error
    assert 0 < len(store.uploaded) < 8


# ── 정기 수집 ────────────────────────────────────────────────────────────────


def test_처음_켜지면_놓친_회차를_한_번_받고_그다음은_조용합니다(tmp_path):
    worker, store, fetch, clock = make(tmp_path)
    worker.check_schedule()
    assert len(fetch.calls) == 1
    for _ in range(10):
        clock.advance(seconds=10)
        worker.check_schedule()
    assert len(fetch.calls) == 1


def test_실패한_회차를_되풀이하지_않습니다(tmp_path):
    fetch = FakeFetch(error=DeskAuthExpired("desk 인증 만료"))
    worker, _, _, clock = make(tmp_path, fetch=fetch)
    for _ in range(20):
        worker.check_schedule()
        clock.advance(minutes=1)
    assert len(fetch.calls) == 1


def test_월요일_18시에_다시_받습니다(tmp_path):
    worker, _, fetch, clock = make(tmp_path)
    worker.check_schedule()
    clock.now = datetime(2026, 11, 23, 9, 0, 5, tzinfo=UTC)  # 월 18:00:05 KST
    worker.check_schedule()
    assert len(fetch.calls) == 2


def test_회차_뒤에_화면_요청으로_받았으면_건너뜁니다(tmp_path):
    worker, store, fetch, clock = make(tmp_path)
    worker.check_schedule()  # 지난 회차 (화 09:00)
    clock.now = datetime(2026, 11, 23, 9, 30, tzinfo=UTC)  # 월 18:30 KST — 18:00 회차를 놓친 채
    store.requests = [pending()]
    worker.check_requests()  # 화면 요청으로 받음
    worker.check_schedule()
    assert len(fetch.calls) == 2  # 회차 수집을 따로 하지 않습니다


# ── 인증 상태 ────────────────────────────────────────────────────────────────


def test_인증_출처와_만료일을_화면에_알립니다(tmp_path):
    worker, store, _, _ = make(tmp_path)
    worker.check_auth()
    assert store.settings[DESK_SETTING_AUTH_SOURCE] == "settings"
    assert store.settings[DESK_SETTING_COOKIE_EXPIRES_AT] == "2026-11-25T03:44:00.000Z"
    assert all(JWT not in v for v in store.settings.values())


def test_인증이_없으면_none_으로_알립니다(tmp_path):
    worker, store, _, _ = make(tmp_path, store=FakeStore(cookie=""))
    worker.check_auth()
    assert store.settings[DESK_SETTING_AUTH_SOURCE] == "none"
    assert store.settings[DESK_SETTING_COOKIE_EXPIRES_AT] == ""


def test_쿠키를_바꾸면_1분_안에_반영하고_실패했던_수집을_한_번_확인합니다(tmp_path):
    worker, store, fetch, clock = make(tmp_path, start=datetime(2026, 11, 26, tzinfo=UTC))
    worker.check_schedule()  # 만료된 쿠키라 실패
    worker.check_auth()
    assert fetch.calls == []
    store.secret_values[DESK_COOKIE_SECRET] = JWT_LATER
    clock.advance(seconds=30)
    worker.check_auth()  # 아직 1분 안 됨 — 다시 안 읽습니다
    assert store.settings[DESK_SETTING_COOKIE_EXPIRES_AT] == "2026-11-25T03:44:00.000Z"
    clock.advance(seconds=31)
    worker.check_auth()
    assert store.settings[DESK_SETTING_COOKIE_EXPIRES_AT] == "2026-12-25T03:44:00.000Z"
    assert len(fetch.calls) == 1  # 확인 수집 한 번
    assert "인증 교체 확인" in store.settings[DESK_SETTING_LAST_SCAN_NOTE]
    clock.advance(minutes=5)
    worker.check_auth()
    assert len(fetch.calls) == 1  # 바뀐 게 없으면 다시 안 합니다


def test_한_바퀴에서_한_단계가_터져도_나머지는_돕니다(tmp_path, caplog):
    worker, store, fetch, _ = make(tmp_path)

    def boom():
        raise RuntimeError("예상 못 한 오류")

    store.open_scan_requests = boom  # check_requests 안에서 잡힙니다
    worker.check_schedule = boom  # tick 이 잡습니다
    with caplog.at_level(logging.WARNING, logger="ticket_agent.desk"):
        worker.tick()
    assert store.settings[DESK_SETTING_AUTH_SOURCE] == "settings"  # 3단계까지 갔습니다


def test_로그에_쿠키_값이_안_나옵니다(tmp_path, caplog):
    fetch = FakeFetch(error=RuntimeError(f"Cookie: CF_Authorization={JWT}; 거부"))
    worker, store, _, _ = make(tmp_path, fetch=fetch)
    store.requests = [pending()]
    with caplog.at_level(logging.DEBUG):
        worker.tick()
    assert all(JWT not in r.getMessage() for r in caplog.records)
    assert JWT not in store.requests[0]["error"]
    assert all(JWT not in v for v in store.settings.values())


@pytest.mark.parametrize("trigger, label", [("schedule", "정기"), ("manual", "수동")])
def test_마지막_수집_한_줄(tmp_path, trigger, label):
    worker, store, _, _ = make(tmp_path)
    out = worker.scan(trigger)
    assert out.ok and out.note == f"2026-11-23 스냅샷 · 업무 3건 ({label})"
    assert store.settings[DESK_SETTING_LAST_SCAN_NOTE] == out.note


# ── 스레드 ───────────────────────────────────────────────────────────────────


def test_꺼져_있으면_스레드를_안_띄웁니다(tmp_path):
    from ticket_agent.desk_worker import start_desk_thread

    worker, *_ = make(tmp_path, desk_scan_enabled=False)
    assert start_desk_thread(worker.config) is None


def test_스레드는_돌다가_신호를_받으면_멈춥니다(tmp_path, monkeypatch):
    import threading

    import ticket_agent.store as store_module
    from ticket_agent.desk_worker import start_desk_thread

    ticked = threading.Event()

    class Store(FakeStore):
        def open_scan_requests(self):
            ticked.set()
            return []

    monkeypatch.setattr(store_module, "TicketStore", lambda *a, **kw: Store())
    # 정기 수집이 첫 바퀴에 desk 로 나가지 않게 이번 회차는 이미 했다고 적어 둡니다
    from ticket_agent.desk import ScanState, latest_slot, now_utc

    ScanState(tmp_path).update(last_slot=iso_ms(latest_slot(now_utc())))
    worker, *_ = make(tmp_path, desk_url="https://desk.example.invalid")
    started = start_desk_thread(worker.config)
    assert started is not None
    thread, stop = started
    assert thread.daemon and thread.name == "desk"
    assert ticked.wait(5)
    stop.set()
    thread.join(5)
    assert not thread.is_alive()


def test_로컬_기록을_못_써도_같은_회차를_되풀이하지_않습니다(tmp_path, monkeypatch):
    worker, _, fetch, clock = make(tmp_path)

    def broken(**values):
        raise OSError("디스크가 가득 찼습니다")

    monkeypatch.setattr(worker.state, "update", broken)
    for _ in range(5):
        worker.tick()
        clock.advance(seconds=10)
    assert len(fetch.calls) == 1


def test_인증_상태를_못_적으면_10분_뒤에_다시(tmp_path):
    worker, store, _, clock = make(tmp_path)
    tries = []

    def failing(values):
        tries.append(values)
        return False

    store.set_settings = failing
    for _ in range(30):  # 5분
        worker.check_auth()
        clock.advance(seconds=10)
    assert len(tries) == 1
    clock.advance(minutes=6)
    worker.check_auth()
    assert len(tries) == 2
