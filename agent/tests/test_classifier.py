from datetime import date, datetime, timezone

from ticket_agent.classifier import _fallback, build_user_message, parse_response
from ticket_agent.models import RawMail


def make_mail(**overrides) -> RawMail:
    defaults = dict(
        message_id="fixture-test",
        subject="ERP 저장 오류",
        body="전표 저장이 되지 않습니다.",
        sender_email="user@example.co.kr",
        sender_name="김영희",
        received_at=datetime(2026, 8, 5, 9, 12, tzinfo=timezone.utc),
    )
    defaults.update(overrides)
    return RawMail(**defaults)


class TestParseResponse:
    def test_valid_payload(self):
        result = parse_response(
            {
                "is_request": True,
                "title": "ERP 전표 저장 오류",
                "category": "error",
                "severity": "critical",
                "system_type": "erp",
                "due_date": "2026-08-06",
                "confidence": 0.92,
                "reason": "저장 실패 증상이 명시됨",
            },
            make_mail(),
            "claude-opus-5",
        )
        assert result.is_request is True
        assert result.category == "error"
        assert result.severity == "critical"
        assert result.due_date == date(2026, 8, 6)
        assert result.confidence == 0.92
        assert result.error is None

    def test_unknown_enum_falls_back_instead_of_raising(self):
        """스키마를 벗어난 값이 와도 저장은 되어야 합니다 — DB check 제약에 걸리면 티켓이 사라집니다."""
        result = parse_response(
            {
                "is_request": True,
                "title": "x",
                "category": "urgent",
                "severity": "blocker",
                "system_type": "mainframe",
                "due_date": None,
                "confidence": 0.5,
                "reason": "",
            },
            make_mail(),
            "claude-opus-5",
        )
        assert result.category == "error"
        assert result.severity == "medium"
        assert result.system_type == "etc"

    def test_empty_title_falls_back_to_subject(self):
        result = parse_response(
            {"is_request": True, "title": "  ", "category": "error", "severity": "low",
             "system_type": "etc", "due_date": None, "confidence": 0.1, "reason": ""},
            make_mail(subject="제목 있음"),
            "m",
        )
        assert result.title == "제목 있음"

    def test_empty_title_and_subject_falls_back_to_body_first_line(self):
        result = parse_response(
            {"is_request": True, "title": "", "category": "error", "severity": "low",
             "system_type": "etc", "due_date": None, "confidence": 0.1, "reason": ""},
            make_mail(subject="", body="본문 첫 줄입니다\n둘째 줄"),
            "m",
        )
        assert result.title == "본문 첫 줄입니다"

    def test_malformed_due_date_becomes_none(self):
        result = parse_response(
            {"is_request": True, "title": "t", "category": "new", "severity": "low",
             "system_type": "etc", "due_date": "다음 주 금요일", "confidence": 0.5, "reason": ""},
            make_mail(),
            "m",
        )
        assert result.due_date is None

    def test_confidence_is_clamped(self):
        result = parse_response(
            {"is_request": True, "title": "t", "category": "new", "severity": "low",
             "system_type": "etc", "due_date": None, "confidence": 7.5, "reason": ""},
            make_mail(),
            "m",
        )
        assert result.confidence == 1.0

    def test_non_numeric_confidence_becomes_none(self):
        result = parse_response(
            {"is_request": True, "title": "t", "category": "new", "severity": "low",
             "system_type": "etc", "due_date": None, "confidence": "높음", "reason": ""},
            make_mail(),
            "m",
        )
        assert result.confidence is None

    def test_not_a_request(self):
        result = parse_response(
            {"is_request": False, "title": "회식 투표", "category": "error", "severity": "low",
             "system_type": "etc", "due_date": None, "confidence": 0.95, "reason": "일상 대화"},
            make_mail(),
            "m",
        )
        assert result.is_request is False


class TestFallback:
    def test_fallback_keeps_ticket_alive(self):
        """기획서 3.1 — 분류에 실패해도 반려하지 않고 적재합니다."""
        result = _fallback(make_mail(), "API 오류: timeout", "claude-opus-5")
        assert result.is_request is True
        assert result.failed is True
        assert result.error == "API 오류: timeout"
        assert result.category == "error"
        assert result.severity == "medium"
        assert result.system_type == "etc"

    def test_fallback_title_uses_subject(self):
        assert _fallback(make_mail(subject="원래 제목"), "err").title == "원래 제목"

    def test_fallback_title_without_subject_or_body(self):
        assert _fallback(make_mail(subject="", body=""), "err").title == "(제목 없음)"


class TestBuildUserMessage:
    def test_includes_key_fields(self):
        message = build_user_message(make_mail())
        assert "<subject>ERP 저장 오류</subject>" in message
        assert "user@example.co.kr" in message
        assert "2026-08-05" in message

    def test_quoted_reply_is_removed(self):
        mail = make_mail(body="새 요청\n\n-----Original Message-----\n옛날 요청")
        assert "옛날 요청" not in build_user_message(mail)

    def test_missing_received_date_is_labelled(self):
        assert "(알 수 없음)" in build_user_message(make_mail(received_at=None))
