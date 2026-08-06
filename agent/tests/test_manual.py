"""수동 등록 파이프라인.

핵심 규칙: **사람이 등록한 건은 LLM 이 '요청 아님' 이라고 해도 티켓이 됩니다.**
요청 여부 판단은 등록한 사람이 이미 했고, LLM 의 몫은 분류뿐입니다.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ticket_agent.manual import ManualProcessor
from ticket_agent.models import Classification, ManualIntake


def entry(**overrides) -> ManualIntake:
    defaults = dict(
        id=1,
        raw_text="ERP 전표 화면에서 저장이 안 된다고 회계팀에서 전화가 왔습니다.",
        subject=None,
        reporter_email="kim@example.co.kr",
        reporter_name="김영희",
        received_at=datetime(2026, 8, 6, 10, 0, tzinfo=timezone.utc),
        channel="phone",
    )
    defaults.update(overrides)
    return ManualIntake(**defaults)


def classification(**overrides) -> Classification:
    defaults = dict(
        is_request=True,
        title="ERP 전표 저장 오류",
        work_type="incident",
        category="error",
        severity="high",
        system_type="erp",
    )
    defaults.update(overrides)
    return Classification(**defaults)


class FakeClassifier:
    def __init__(self, result: Classification) -> None:
        self.result = result
        self.seen: list = []

    def classify(self, mail):
        self.seen.append(mail)
        return self.result


class FakeStore:
    def __init__(self, queued: list[ManualIntake]) -> None:
        self.queued = queued
        self.created: list = []
        self.done: list = []
        self.failed: list = []
        self.fail_on_create = False
        self.next_id = 500

    def claim_manual_intake(self, limit=10):
        return self.queued[:limit]

    def create_ticket_from_manual(self, entry, classification):
        if self.fail_on_create:
            raise RuntimeError("insert 실패")
        self.created.append((entry, classification))
        self.next_id += 1
        return self.next_id

    def mark_manual_done(self, entry_id, ticket_id, attempts):
        self.done.append((entry_id, ticket_id, attempts))

    def mark_manual_failed(self, entry_id, error, attempts):
        self.failed.append((entry_id, error, attempts))


class TestManualProcessor:
    def test_creates_ticket(self):
        store = FakeStore([entry()])
        result = ManualProcessor(FakeClassifier(classification()), store).run_once()

        assert result.created == 1
        assert len(store.created) == 1
        assert store.done[0][1] == 501

    def test_llm_saying_not_a_request_does_not_block(self):
        """이게 핵심입니다. 사람이 등록했으면 요청입니다."""
        store = FakeStore([entry()])
        result = ManualProcessor(
            FakeClassifier(classification(is_request=False, reason="일상 대화로 보임")), store
        ).run_once()

        assert result.created == 1
        assert len(store.created) == 1

    def test_classification_is_still_applied(self):
        store = FakeStore([entry()])
        ManualProcessor(FakeClassifier(classification(severity="critical")), store).run_once()

        _, applied = store.created[0]
        assert applied.severity == "critical"
        assert applied.work_type == "incident"

    def test_empty_body_fails_without_creating_ticket(self):
        store = FakeStore([entry(raw_text="   ")])
        result = ManualProcessor(FakeClassifier(classification()), store).run_once()

        assert result.failed == 1
        assert store.created == []
        assert "본문이 비어" in store.failed[0][1]

    def test_store_failure_is_recorded(self):
        store = FakeStore([entry()])
        store.fail_on_create = True
        result = ManualProcessor(FakeClassifier(classification()), store).run_once()

        assert result.failed == 1
        assert store.failed[0][0] == 1

    def test_one_failure_does_not_block_the_rest(self):
        store = FakeStore([entry(id=1, raw_text=""), entry(id=2)])
        result = ManualProcessor(FakeClassifier(classification()), store).run_once()

        assert result.created == 1
        assert result.failed == 1

    def test_empty_queue_is_a_no_op(self):
        store = FakeStore([])
        result = ManualProcessor(FakeClassifier(classification()), store).run_once()

        assert result.picked == 0
        assert store.created == []


class TestAsMail:
    def test_wraps_into_mail_shape(self):
        mail = entry().as_mail()
        assert mail.message_id == "manual-1"
        assert "회계팀에서 전화" in mail.body
        assert mail.sender_email == "kim@example.co.kr"

    def test_missing_reporter_is_blank_not_crash(self):
        """구두 요청은 요청자 메일을 모를 수 있습니다."""
        mail = entry(reporter_email=None, reporter_name=None).as_mail()
        assert mail.sender_email == ""
        assert mail.sender_name is None

    def test_missing_subject_is_blank(self):
        """제목을 비우면 LLM 이 만들어 줍니다."""
        assert entry(subject=None).as_mail().subject == ""
