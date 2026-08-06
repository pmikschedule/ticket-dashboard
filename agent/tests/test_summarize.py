from ticket_agent.summarize import build_reply_body, build_reply_subject, lead_time_text


class TestBuildReplySubject:
    def test_adds_re_prefix(self):
        assert build_reply_subject("ERP 저장 오류") == "RE: ERP 저장 오류"

    def test_does_not_double_prefix(self):
        assert build_reply_subject("RE: ERP 저장 오류") == "RE: ERP 저장 오류"

    def test_empty_subject_gets_default(self):
        assert build_reply_subject("") == "RE: 요청 처리 결과"


class TestLeadTime:
    def test_minutes(self):
        assert lead_time_text("2026-08-05T09:00:00+00:00", "2026-08-05T09:30:00+00:00") == "30분"

    def test_hours(self):
        assert lead_time_text("2026-08-05T09:00:00+00:00", "2026-08-05T14:00:00+00:00") == "5.0시간"

    def test_days(self):
        assert lead_time_text("2026-08-01T09:00:00+00:00", "2026-08-04T09:00:00+00:00") == "3.0일"

    def test_missing_completion_returns_dash(self):
        assert lead_time_text("2026-08-05T09:00:00+00:00", None) == "-"

    def test_malformed_input_returns_dash(self):
        assert lead_time_text("어제", "오늘") == "-"


class TestBuildReplyBody:
    TICKET = {
        "subject": "ERP 전표 저장 오류",
        "reporter_name": "김영희",
        "received_at": "2026-08-05T09:12:00+00:00",
    }
    META = {
        "category": "error",
        "severity": "critical",
        "system_type": "erp",
        "status": "done",
        "completed_at": "2026-08-05T15:12:00+00:00",
    }

    def test_contains_greeting_with_reporter_name(self):
        assert "김영희님, 안녕하세요." in build_reply_body(self.TICKET, self.META)

    def test_greeting_without_reporter_name(self):
        ticket = {**self.TICKET, "reporter_name": None}
        body = build_reply_body(ticket, self.META)
        assert body.startswith("안녕하세요.")

    def test_labels_are_korean(self):
        body = build_reply_body(self.TICKET, self.META)
        assert "오류" in body
        assert "Critical" in body
        assert "ERP" in body
        assert "완료" in body

    def test_lead_time_is_included(self):
        assert "6.0시간" in build_reply_body(self.TICKET, self.META)

    def test_comments_section_appears_when_present(self):
        body = build_reply_body(
            self.TICKET,
            self.META,
            comments=[{"content": "핫픽스 배포 완료"}, {"content": "회계팀 확인 완료"}],
        )
        assert "■ 처리 내역" in body
        assert "핫픽스 배포 완료" in body
        assert "회계팀 확인 완료" in body

    def test_comments_section_is_omitted_when_empty(self):
        """빈 제목만 남기지 않습니다."""
        assert "■ 처리 내역" not in build_reply_body(self.TICKET, self.META, comments=[])

    def test_blank_comments_are_filtered(self):
        body = build_reply_body(self.TICKET, self.META, comments=[{"content": "   "}])
        assert "■ 처리 내역" not in body

    def test_missing_meta_does_not_raise(self):
        body = build_reply_body(self.TICKET, None)
        assert "안녕하세요" in body
