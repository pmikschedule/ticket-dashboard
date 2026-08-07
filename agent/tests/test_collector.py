"""수집 파이프라인 — 가짜 백엔드로 흐름 전체를 검증합니다."""

from __future__ import annotations

from datetime import datetime, timezone

from ticket_agent.collector import Collector
from ticket_agent.config import Config
from ticket_agent.models import Attachment, Classification, RawMail
from ticket_agent.store import StoreError


def make_config(**overrides) -> Config:
    defaults = dict(
        supabase_url="https://example.supabase.co",
        supabase_service_key="key",
        supabase_bucket="ticket-attachments",
        gemini_api_key="key",
        gemini_model="gemini-2.5-flash",
        gemini_thinking_budget=None,
        mail_backend="fixture",
        outlook_folder="받은 편지함/요청",
        outlook_done_folder="",
        # 0 = 제한 없음. 범위는 시간(window.py)으로 자릅니다.
        scan_limit=0,
        scan_since=None,
        send_mode="display",
        send_poll_interval=30,
    )
    defaults.update(overrides)
    return Config(**defaults)


def make_mail(message_id: str = "m-1", **overrides) -> RawMail:
    defaults = dict(
        message_id=message_id,
        subject="ERP 오류",
        body="저장이 안 됩니다",
        sender_email="user@example.co.kr",
        received_at=datetime(2026, 8, 5, tzinfo=timezone.utc),
    )
    defaults.update(overrides)
    return RawMail(**defaults)


class FakeMail:
    def __init__(self, mails: list[RawMail]) -> None:
        self.mails = mails
        self.processed: list[tuple[str, str | None]] = []
        self.fetch_calls: list[dict] = []
        self.closed = False

    def fetch(self, folder, limit=50, since=None):
        self.fetch_calls.append({"folder": folder, "limit": limit, "since": since})
        return self.mails

    def mark_processed(self, message_id, move_to=None):
        self.processed.append((message_id, move_to))

    def send_reply(self, *a, **kw):
        raise AssertionError("수집 경로에서 발송이 일어나면 안 됩니다")

    def close(self):
        self.closed = True


class FakeClassifier:
    def __init__(self, results: dict[str, Classification]) -> None:
        self.results = results
        self.calls: list[str] = []
        self.systems: list = []
        self.intake_rules: tuple = ([], [], "include")

    def set_systems(self, systems) -> None:
        self.systems = list(systems)

    def set_intake_rules(self, include_rules, exclude_rules, ambiguous_policy="include"):
        self.intake_rules = (list(include_rules), list(exclude_rules), ambiguous_policy)

    def classify(self, mail: RawMail) -> Classification:
        self.calls.append(mail.message_id)
        return self.results[mail.message_id]


class FakeStore:
    def __init__(self, existing: dict[str, int] | None = None) -> None:
        self.existing = existing or {}
        self.created: list[tuple[RawMail, Classification]] = []
        self.uploads: list[tuple[int, Attachment]] = []
        self.scan_uploads: list[tuple[int, Attachment]] = []
        self.next_id = 100
        self.fail_on_create = False
        self.scan_record_fails = False
        self.systems_registry: list = []
        self.scanned: list = []
        self.rules: tuple = ([], [])
        self.settings: dict = {}

    def find_ticket_by_message_id(self, message_id: str):
        return self.existing.get(message_id)

    def create_ticket(self, mail, classification) -> int:
        if self.fail_on_create:
            raise StoreError("insert 실패")
        self.created.append((mail, classification))
        self.next_id += 1
        self.existing[mail.message_id] = self.next_id
        return self.next_id

    def upload_attachment(self, ticket_id, attachment):
        self.uploads.append((ticket_id, attachment))
        return f"{ticket_id}/{attachment.file_name}"

    def list_systems(self):
        return self.systems_registry

    def intake_rules(self):
        return self.rules

    def setting(self, key, default=""):
        return self.settings.get(key, default)

    def set_setting(self, key, value):
        self.settings[key] = value

    def record_scanned_mail(self, mail, classification, ticket_id, outcome=None):
        self.scanned.append(
            (
                mail.message_id,
                classification,
                ticket_id,
                outcome or ("ticketed" if ticket_id else "excluded"),
            )
        )
        # 실제 store 는 만들어진 행의 id 를 돌려줍니다. 첨부를 여기 매답니다.
        if self.scan_record_fails:
            return None
        return len(self.scanned)

    def upload_scan_attachment(self, scan_id, attachment):
        self.scan_uploads.append((scan_id, attachment))
        return f"scan/{scan_id}/{attachment.file_name}"


def request(**overrides) -> Classification:
    defaults = dict(
        is_request=True,
        title="ERP 전표 저장 오류",
        category="error",
        severity="critical",
        system_type="erp",
    )
    defaults.update(overrides)
    return Classification(**defaults)


def not_request() -> Classification:
    return Classification(
        is_request=False,
        title="회식 투표",
        category="error",
        severity="low",
        system_type="etc",
        reason="일상 대화",
    )


def build(mails, results, store=None, config=None) -> tuple[Collector, FakeMail, FakeStore]:
    mail = FakeMail(mails)
    store = store or FakeStore()
    collector = Collector(config or make_config(), mail, FakeClassifier(results), store)
    return collector, mail, store


class TestCollector:
    def test_creates_ticket_for_request_mail(self):
        mails = [make_mail("m-1")]
        collector, mail, store = build(mails, {"m-1": request()})

        result = collector.run_once()

        assert result.created == 1
        assert result.scanned == 1
        assert len(store.created) == 1
        assert store.created[0][1].title == "ERP 전표 저장 오류"
        assert mail.processed == [("m-1", None)]

    def test_skips_non_request_mail_without_creating_ticket(self):
        collector, mail, store = build([make_mail("m-2")], {"m-2": not_request()})

        result = collector.run_once()

        assert result.skipped_not_request == 1
        assert result.created == 0
        assert store.created == []
        # 대상이 아니어도 처리 표시는 해야 다음 스캔에서 다시 읽지 않습니다.
        assert mail.processed == [("m-2", None)]

    def test_duplicate_mail_is_not_reclassified(self):
        """주기 스캔은 같은 메일을 다시 읽습니다. 두 번 티켓이 되면 안 됩니다."""
        store = FakeStore(existing={"m-1": 42})
        mail = FakeMail([make_mail("m-1")])
        classifier = FakeClassifier({})
        collector = Collector(make_config(), mail, classifier, store)

        result = collector.run_once()

        assert result.skipped_duplicate == 1
        assert result.created == 0
        assert classifier.calls == []  # LLM 을 부르지 않습니다 — 비용이 그냥 나갑니다

    def test_classification_failure_goes_to_pending_not_ticket(self):
        """분류에 실패하면 티켓이 아니라 사람의 판단으로 넘깁니다.

        요청인지 아닌지를 모르는 상태입니다. 여기서 티켓을 만들면 그 티켓은
        통계 모수에 들어가고 담당자에게 할당되고 요청자에게 회신까지 나갑니다.
        """
        failed = request(error="API 오류: timeout", confidence=None)
        collector, _, store = build([make_mail("m-3")], {"m-3": failed})

        result = collector.run_once()

        assert result.pending == 1
        assert result.created == 0
        assert store.created == []  # 티켓은 만들지 않습니다
        assert result.errors == []  # 오류가 아니라 정상 경로입니다

    def test_classification_failure_is_still_recorded(self):
        """티켓을 안 만들 뿐 메일을 버리지는 않습니다 (기획서 3.1)."""
        failed = request(error="API 오류: timeout", confidence=None)
        collector, _, store = build([make_mail("m-3")], {"m-3": failed})

        collector.run_once()

        message_id, classification, ticket_id, outcome = store.scanned[0]
        assert message_id == "m-3"
        assert outcome == "pending"
        assert ticket_id is None
        assert classification.error == "API 오류: timeout"

    def test_pending_mail_is_marked_processed(self):
        """판단 대기로 남긴 뒤에도 메일은 처리 표시합니다.

        안 하면 다음 스캔에서 같은 메일을 다시 분류합니다 — LLM 호출 비용이
        계속 나가고, 사람이 이미 내린 판단을 덮어쓸 수 있습니다.
        """
        failed = request(error="API 오류: timeout", confidence=None)
        collector, mail, _ = build([make_mail("m-3")], {"m-3": failed})

        collector.run_once()

        assert mail.processed == [("m-3", None)]

    def test_first_run_reads_everything_then_records_the_time(self):
        """첫 기동은 갯수 제한 없이 읽고, 다음을 위해 시각을 남깁니다."""
        collector, mail, store = build([make_mail("w-1")], {"w-1": request()})

        collector.run_once()

        assert mail.fetch_calls[0]["limit"] is None
        assert store.settings.get("last_scan_at")

    def test_second_run_only_looks_back_a_few_days(self):
        """두 번째부터는 최근 며칠치만. 중복을 매번 다시 읽지 않습니다."""
        collector, mail, store = build([make_mail("w-2")], {"w-2": request()})
        store.settings["last_scan_at"] = "2026-08-07T00:00:00+00:00"

        collector.run_once()

        since = mail.fetch_calls[0]["since"]
        assert since is not None  # 폴더 전체가 아니라 잘린 창입니다

    def test_pending_mail_attachments_are_kept(self):
        """티켓이 안 돼도 첨부는 보관합니다.

        후속 메일에 붙은 화면 캡처가 정작 그 메일을 보낸 이유인 경우가 많습니다.
        예전에는 티켓이 될 때만 올려서 그게 유실됐습니다.
        """
        failed = request(error="API 오류: timeout", confidence=None)
        mail_with_file = make_mail("m-p1", attachments=[Attachment("screen.png", b"\x89PNG")])
        collector, _, store = build([mail_with_file], {"m-p1": failed})

        collector.run_once()

        assert [a.file_name for _, a in store.scan_uploads] == ["screen.png"]
        assert store.uploads == []  # 티켓 첨부로는 안 올립니다

    def test_excluded_mail_attachments_are_kept(self):
        """제외된 메일도 마찬가지입니다. 오판이면 되살릴 때 파일이 필요합니다."""
        mail_with_file = make_mail("m-p2", attachments=[Attachment("명세.xlsx", b"x")])
        collector, _, store = build([mail_with_file], {"m-p2": not_request()})

        collector.run_once()

        assert [a.file_name for _, a in store.scan_uploads] == ["명세.xlsx"]

    def test_attachments_are_skipped_when_scan_record_failed(self):
        """붙일 곳이 없으면 올리지 않습니다 — 아무도 못 찾는 쓰레기가 됩니다."""
        mail_with_file = make_mail("m-p3", attachments=[Attachment("a.png", b"x")])
        collector, _, store = build([mail_with_file], {"m-p3": not_request()})
        store.scan_record_fails = True

        collector.run_once()

        assert store.scan_uploads == []

    def test_ticketed_mail_does_not_double_store_attachments(self):
        """티켓이 된 메일은 티켓 첨부로만 올립니다. 두 번 올리면 Storage 가 두 배입니다."""
        mail_with_file = make_mail("m-p4", attachments=[Attachment("log.txt", b"x")])
        collector, _, store = build([mail_with_file], {"m-p4": request()})

        collector.run_once()

        assert [a.file_name for _, a in store.uploads] == ["log.txt"]
        assert store.scan_uploads == []

    def test_attachments_are_uploaded(self):
        mail_with_file = make_mail(
            "m-4", attachments=[Attachment("error.png", b"\x89PNG"), Attachment("log.txt", b"x")]
        )
        collector, _, store = build([mail_with_file], {"m-4": request()})

        collector.run_once()

        assert [a.file_name for _, a in store.uploads] == ["error.png", "log.txt"]

    def test_store_failure_is_recorded_and_scan_continues(self):
        store = FakeStore()
        store.fail_on_create = True
        mail = FakeMail([make_mail("m-5"), make_mail("m-6")])
        results = {"m-5": request(), "m-6": request()}
        collector = Collector(make_config(), mail, FakeClassifier(results), store)

        result = collector.run_once()

        assert result.scanned == 2
        assert result.created == 0
        assert len(result.errors) == 2  # 첫 건 실패가 두 번째 건을 막지 않습니다

    def test_move_to_folder_is_passed_through(self):
        config = make_config(outlook_done_folder="받은 편지함/처리완료")
        collector, mail, _ = build([make_mail("m-7")], {"m-7": request()}, config=config)

        collector.run_once()

        assert mail.processed == [("m-7", "받은 편지함/처리완료")]

    def test_mark_processed_failure_does_not_lose_the_ticket(self):
        class BrokenMark(FakeMail):
            def mark_processed(self, message_id, move_to=None):
                raise RuntimeError("아웃룩 연결 끊김")

        mail = BrokenMark([make_mail("m-8")])
        store = FakeStore()
        collector = Collector(make_config(), mail, FakeClassifier({"m-8": request()}), store)

        result = collector.run_once()

        assert result.created == 1
        assert result.errors == []
        assert len(store.created) == 1

    def test_empty_folder_returns_zero_result(self):
        collector, _, _ = build([], {})
        result = collector.run_once()
        assert result.scanned == 0
        assert "스캔 0건" in result.summary()

    def test_summary_is_human_readable(self):
        collector, _, _ = build([make_mail("m-9")], {"m-9": request()})
        assert "신규 티켓 1건" in collector.run_once().summary()


class TestScreening:
    """스캔한 메일을 전부 남기는지 — LLM 오판을 사람이 구제할 수 있어야 합니다."""

    def test_ticketed_mail_is_recorded(self):
        collector, _, store = build([make_mail("s-1")], {"s-1": request()})
        collector.run_once()

        assert len(store.scanned) == 1
        message_id, classification, ticket_id, outcome = store.scanned[0]
        assert message_id == "s-1"
        assert ticket_id is not None
        assert outcome == "ticketed"
        assert classification.is_request is True

    def test_rejected_mail_is_still_recorded(self):
        """이게 핵심입니다. 예전에는 로그만 남고 사라졌습니다."""
        collector, _, store = build([make_mail("s-2")], {"s-2": not_request()})
        collector.run_once()

        assert len(store.scanned) == 1
        message_id, classification, ticket_id, outcome = store.scanned[0]
        assert message_id == "s-2"
        assert ticket_id is None                 # 티켓은 안 만들지만
        assert outcome == "excluded"             # 판단은 끝났습니다 (pending 아님)
        assert classification.is_request is False  # 판정 근거는 남습니다
        assert classification.reason == "일상 대화"

    def test_duplicate_is_not_recorded_again(self):
        store = FakeStore(existing={"s-3": 7})
        collector = Collector(make_config(), FakeMail([make_mail("s-3")]), FakeClassifier({}), store)
        collector.run_once()
        assert store.scanned == []


class TestSettingsRefresh:
    """설정을 바꿔도 에이전트를 재시작하지 않아야 합니다."""

    def test_systems_are_reloaded_each_scan(self):
        mail = FakeMail([make_mail("c-1")])
        store = FakeStore()
        store.systems_registry = [{"code": "erp", "name": "ERP"}]
        classifier = FakeClassifier({"c-1": request()})
        Collector(make_config(), mail, classifier, store).run_once()

        assert classifier.systems == [{"code": "erp", "name": "ERP"}]

    def test_intake_rules_are_reloaded_each_scan(self):
        mail = FakeMail([make_mail("c-2")])
        store = FakeStore()
        store.rules = (["결제 오류"], ["뉴스레터"])
        store.settings = {"intake_ambiguous_policy": "exclude"}
        classifier = FakeClassifier({"c-2": request()})
        Collector(make_config(), mail, classifier, store).run_once()

        assert classifier.intake_rules == (["결제 오류"], ["뉴스레터"], "exclude")

    def test_missing_setting_falls_back_to_include(self):
        mail = FakeMail([make_mail("c-3")])
        store = FakeStore()
        classifier = FakeClassifier({"c-3": request()})
        Collector(make_config(), mail, classifier, store).run_once()

        assert classifier.intake_rules[2] == "include"
