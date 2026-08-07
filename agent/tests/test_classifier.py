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
            "gemini-2.5-flash",
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
            "gemini-2.5-flash",
        )
        assert result.category == "error"
        assert result.severity == "medium"
        assert result.system_type is None  # 없는 분류를 지어내지 않습니다

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
    def test_fallback_does_not_guess_is_request(self):
        """판별을 못 했으면 판별했다고 하지 않습니다.

        예전에는 여기서 is_request=True 를 찍어 티켓을 만들었습니다. 그건
        판단이 아니라 추측이고, 추측으로 만든 티켓은 통계 모수에 들어가고
        담당자에게 할당되고 요청자에게 회신까지 나갑니다.

        메일은 그래도 버려지지 않습니다 — collector 가 failed 를 보고
        스크리닝의 '판단 대기' 로 보냅니다 (test_collector 참고).
        """
        result = _fallback(make_mail(), "API 오류: timeout", "gemini-2.5-flash")
        assert result.is_request is False
        assert result.failed is True
        assert result.error == "API 오류: timeout"
        assert result.work_type == "maintenance"
        assert result.category == "error"
        assert result.severity == "medium"
        assert result.system_type is None

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


class TestSchemaAndPrompt:
    """Gemini 로 보내는 스키마·프롬프트가 제약을 지키는지 확인합니다."""

    def test_schema_has_no_union_types(self):
        """Gemini 는 ["string","null"] 같은 union 타입을 거절합니다."""
        from ticket_agent.classifier import build_response_schema

        for name, spec in build_response_schema()["properties"].items():
            assert isinstance(spec["type"], str), f"{name} 의 type 이 배열입니다"

    def test_schema_has_no_additional_properties(self):
        """Gemini 스키마 지원 범위 밖입니다."""
        from ticket_agent.classifier import build_response_schema

        assert "additionalProperties" not in build_response_schema()

    def test_due_date_is_plain_string(self):
        """null 대신 빈 문자열로 받습니다."""
        from ticket_agent.classifier import build_response_schema

        assert build_response_schema()["properties"]["due_date"]["type"] == "string"

    def test_system_type_enum_follows_argument(self):
        """시스템 종류가 설정 테이블로 옮겨가도 스키마가 따라오도록."""
        from ticket_agent.classifier import build_response_schema

        schema = build_response_schema(["crm", "mes"])
        assert schema["properties"]["system_type"]["enum"] == ["crm", "mes"]

    def test_work_type_enum_excludes_development(self):
        """공수 판단은 코드가 못 합니다. 신규개발 승격은 관리자 몫입니다."""
        from ticket_agent.classifier import build_response_schema

        assert build_response_schema()["properties"]["work_type"]["enum"] == [
            "incident",
            "maintenance",
        ]

    def test_registry_dicts_render_with_description(self):
        from ticket_agent.classifier import build_system_prompt

        prompt = build_system_prompt(
            [{"code": "erp", "name": "ERP", "description": "회계·인사 기간계"}]
        )
        assert "erp : ERP — 회계·인사 기간계" in prompt

    def test_empty_system_types_omits_the_field(self):
        """등록된 시스템이 없으면 항목 자체를 빼야 합니다.
        빈 enum 은 스키마 위반이고, 기본값을 넣으면 없는 분류가 생깁니다."""
        from ticket_agent.classifier import build_response_schema

        schema = build_response_schema([])
        assert "system_type" not in schema["properties"]
        assert "system_type" not in schema["required"]

    def test_prompt_lists_system_types(self):
        from ticket_agent.classifier import build_system_prompt

        prompt = build_system_prompt(["crm", "mes"])
        assert "crm" in prompt and "mes" in prompt

    def test_prompt_handles_empty_system_types(self):
        from ticket_agent.classifier import build_system_prompt

        assert "등록된 시스템이 없습니다" in build_system_prompt([])


class TestParseWithCustomSystemTypes:
    def test_registered_type_is_kept(self):
        result = parse_response(
            {"is_request": True, "title": "t", "category": "error", "severity": "low",
             "system_type": "mes", "due_date": "", "confidence": 0.5, "reason": "r"},
            make_mail(), "m", ["crm", "mes"],
        )
        assert result.system_type == "mes"

    def test_unregistered_type_becomes_unclassified(self):
        result = parse_response(
            {"is_request": True, "title": "t", "category": "error", "severity": "low",
             "system_type": "sap", "due_date": "", "confidence": 0.5, "reason": "r"},
            make_mail(), "m", ["crm", "mes"],
        )
        assert result.system_type is None

    def test_empty_due_date_string_becomes_none(self):
        """Gemini 는 null 대신 빈 문자열을 돌려줍니다."""
        result = parse_response(
            {"is_request": True, "title": "t", "category": "error", "severity": "low",
             "system_type": "etc", "due_date": "", "confidence": 0.5, "reason": "r"},
            make_mail(), "m",
        )
        assert result.due_date is None

    def test_empty_reason_becomes_none(self):
        result = parse_response(
            {"is_request": True, "title": "t", "category": "error", "severity": "low",
             "system_type": "etc", "due_date": "", "confidence": 0.5, "reason": "   "},
            make_mail(), "m",
        )
        assert result.reason is None


class TestIntakeCriteria:
    """판정 기준이 설정에서 오는지 — 코드에 박혀 있으면 운영자가 못 고칩니다."""

    def test_configured_rules_replace_defaults(self):
        from ticket_agent.classifier import build_intake_criteria

        text = build_intake_criteria(["결제 오류만"], ["나머지 전부"])
        assert "결제 오류만" in text
        assert "나머지 전부" in text
        assert "회식" not in text  # 기본 기준이 섞이지 않습니다

    def test_empty_rules_fall_back_to_defaults(self):
        """DB 를 못 읽었다고 근거 없이 판정하게 두지 않습니다."""
        from ticket_agent.classifier import build_intake_criteria, DEFAULT_INCLUDE_RULES

        text = build_intake_criteria([], [])
        assert DEFAULT_INCLUDE_RULES[0] in text

    def test_blank_entries_are_ignored(self):
        from ticket_agent.classifier import build_intake_criteria

        text = build_intake_criteria(["  ", ""], ["실제 기준"])
        assert "실제 기준" in text

    def test_ambiguous_policy_include_is_default(self):
        from ticket_agent.classifier import build_intake_criteria

        assert "애매하면 true" in build_intake_criteria([], [])

    def test_ambiguous_policy_exclude(self):
        from ticket_agent.classifier import build_intake_criteria

        text = build_intake_criteria([], [], ambiguous_policy="exclude")
        assert "애매하면 false" in text
        assert "애매하면 true" not in text

    def test_prompt_embeds_criteria(self):
        from ticket_agent.classifier import build_system_prompt

        prompt = build_system_prompt(include_rules=["고유한기준문구"], exclude_rules=["제외문구"])
        assert "고유한기준문구" in prompt
        assert "제외문구" in prompt
