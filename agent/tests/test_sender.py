"""발송 파이프라인 — 가짜 백엔드로 검증합니다."""

from __future__ import annotations

from ticket_agent.models import OutboundEmail
from ticket_agent.sender import Sender

from .test_collector import make_config


class FakeMail:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.sent: list[dict] = []

    def fetch(self, *a, **kw):
        raise AssertionError("발송 경로에서 수집이 일어나면 안 됩니다")

    def mark_processed(self, *a, **kw):
        raise AssertionError("발송 경로에서 처리 표시가 일어나면 안 됩니다")

    def send_reply(
        self, message_id, to_email, subject, body, cc_emails=None, display_only=True
    ) -> str:
        if self.fail:
            raise RuntimeError("아웃룩이 응답하지 않습니다")
        self.sent.append(
            {
                "message_id": message_id,
                "to_email": to_email,
                "subject": subject,
                "body": body,
                "cc_emails": cc_emails,
                "display_only": display_only,
            }
        )
        return "창을 띄웠습니다" if display_only else "발송했습니다"

    def close(self):
        pass


class FakeStore:
    def __init__(self, queued: list[OutboundEmail], ticket=None, comments=()) -> None:
        self.queued = queued
        self.ticket = ticket
        self.comments = list(comments)
        self.sent_marks: list[tuple[int, str, int]] = []
        self.failed_marks: list[tuple[int, str, int]] = []

    def claim_queued_emails(self, limit=10):
        return self.queued[:limit]

    def mark_email_sent(self, email_id, note, attempts):
        self.sent_marks.append((email_id, note, attempts))

    def mark_email_failed(self, email_id, error, attempts):
        self.failed_marks.append((email_id, error, attempts))

    def source_message_id(self, ticket_id):
        return f"outlook-entry-{ticket_id}"

    def get_ticket(self, ticket_id):
        return self.ticket

    def list_comments(self, ticket_id):
        return self.comments


def email(**overrides) -> OutboundEmail:
    defaults = dict(
        id=1,
        ticket_id=42,
        to_email="user@example.co.kr",
        subject="RE: ERP 오류",
        body="처리 완료되었습니다.",
    )
    defaults.update(overrides)
    return OutboundEmail(**defaults)


class TestSender:
    def test_sends_queued_email_in_display_mode_by_default(self):
        """기획서 5-4 — 곧바로 보내지 않고 창을 띄웁니다."""
        mail, store = FakeMail(), FakeStore([email()])
        result = Sender(make_config(), mail, store).run_once()

        assert result.sent == 1
        assert mail.sent[0]["display_only"] is True
        assert store.sent_marks == [(1, "창을 띄웠습니다", 0)]

    def test_send_mode_sends_immediately(self):
        mail, store = FakeMail(), FakeStore([email()])
        Sender(make_config(send_mode="send"), mail, store).run_once()

        assert mail.sent[0]["display_only"] is False

    def test_reply_is_threaded_to_original_mail(self):
        mail, store = FakeMail(), FakeStore([email(ticket_id=77)])
        Sender(make_config(), mail, store).run_once()

        assert mail.sent[0]["message_id"] == "outlook-entry-77"

    def test_config_cc_is_used_when_queue_has_none(self):
        config = make_config(reply_cc=["lead@example.co.kr", "pm@example.co.kr"])
        mail, store = FakeMail(), FakeStore([email(cc_emails=None)])
        Sender(config, mail, store).run_once()

        assert mail.sent[0]["cc_emails"] == "lead@example.co.kr,pm@example.co.kr"

    def test_queue_cc_wins_over_config(self):
        config = make_config(reply_cc=["lead@example.co.kr"])
        mail, store = FakeMail(), FakeStore([email(cc_emails="override@example.co.kr")])
        Sender(config, mail, store).run_once()

        assert mail.sent[0]["cc_emails"] == "override@example.co.kr"

    def test_empty_body_is_rebuilt_from_ticket(self):
        ticket = {
            "subject": "ERP 전표 저장 오류",
            "reporter_name": "김영희",
            "received_at": "2026-08-05T09:00:00+00:00",
            "ticket_meta": {"status": "done", "completed_at": "2026-08-05T15:00:00+00:00"},
        }
        store = FakeStore(
            [email(subject="", body="")], ticket=ticket, comments=[{"content": "핫픽스 배포"}]
        )
        mail = FakeMail()
        Sender(make_config(), mail, store).run_once()

        assert mail.sent[0]["subject"] == "RE: ERP 전표 저장 오류"
        assert "김영희님" in mail.sent[0]["body"]
        assert "핫픽스 배포" in mail.sent[0]["body"]

    def test_meta_as_list_is_handled(self):
        """관계 조회가 배열로 오는 경우."""
        ticket = {
            "subject": "제목",
            "received_at": "2026-08-05T09:00:00+00:00",
            "ticket_meta": [{"status": "done", "completed_at": "2026-08-05T10:00:00+00:00"}],
        }
        mail, store = FakeMail(), FakeStore([email(subject="", body="")], ticket=ticket)
        result = Sender(make_config(), mail, store).run_once()

        assert result.sent == 1

    def test_failure_is_recorded_not_swallowed(self):
        mail, store = FakeMail(fail=True), FakeStore([email()])
        result = Sender(make_config(), mail, store).run_once()

        assert result.sent == 0
        assert result.failed == 1
        assert store.failed_marks[0][0] == 1
        assert "아웃룩이 응답하지 않습니다" in store.failed_marks[0][1]

    def test_missing_ticket_is_an_error_not_a_blank_email(self):
        mail, store = FakeMail(), FakeStore([email(subject="", body="")], ticket=None)
        result = Sender(make_config(), mail, store).run_once()

        assert result.failed == 1
        assert mail.sent == []

    def test_one_failure_does_not_block_the_rest(self):
        class FlakyMail(FakeMail):
            def send_reply(self, message_id, to_email, subject, body, cc_emails=None, display_only=True):
                if to_email == "bad@example.co.kr":
                    raise RuntimeError("주소 오류")
                return super().send_reply(
                    message_id, to_email, subject, body, cc_emails, display_only
                )

        queued = [
            email(id=1, to_email="bad@example.co.kr"),
            email(id=2, to_email="good@example.co.kr"),
        ]
        mail, store = FlakyMail(), FakeStore(queued)
        result = Sender(make_config(), mail, store).run_once()

        assert result.sent == 1
        assert result.failed == 1
        assert mail.sent[0]["to_email"] == "good@example.co.kr"

    def test_empty_queue_is_a_no_op(self):
        mail, store = FakeMail(), FakeStore([])
        result = Sender(make_config(), mail, store).run_once()

        assert result.picked == 0
        assert mail.sent == []
