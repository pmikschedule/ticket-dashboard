from ticket_agent.textutil import (
    first_line,
    html_to_text,
    normalize_whitespace,
    prepare_body_for_llm,
    sanitize_filename,
    strip_quoted_reply,
    truncate,
)


class TestStripQuotedReply:
    def test_cuts_at_original_message_marker(self):
        text = "새 요청입니다. 확인 부탁드립니다.\n\n-----Original Message-----\nFrom: 홍길동\n지난 요청 내용"
        assert strip_quoted_reply(text) == "새 요청입니다. 확인 부탁드립니다."

    def test_cuts_at_korean_marker(self):
        text = "저장이 안 됩니다. 급합니다.\n\n-----원본 메시지-----\n이전 메일 본문"
        assert "이전 메일 본문" not in strip_quoted_reply(text)

    def test_cuts_at_signature_delimiter(self):
        text = "API 응답이 느립니다. 개선 요청드립니다.\n-- \n이지훈\n물류팀"
        assert strip_quoted_reply(text) == "API 응답이 느립니다. 개선 요청드립니다."

    def test_cuts_at_three_quoted_lines(self):
        text = "확인했습니다. 아래 건 반영 부탁드려요.\n> 지난 메일 1\n> 지난 메일 2\n> 지난 메일 3\n> 지난 메일 4"
        assert strip_quoted_reply(text) == "확인했습니다. 아래 건 반영 부탁드려요."

    def test_two_quoted_lines_are_kept(self):
        """인용이 짧으면 본문의 일부일 수 있으므로 남깁니다."""
        text = "아래 항목만 반영해 주세요.\n> 항목 A\n> 항목 B"
        assert "항목 B" in strip_quoted_reply(text)

    def test_marker_at_very_start_is_not_treated_as_quote(self):
        """맨 앞의 'From:' 은 본문 자체입니다. 자르면 내용이 통째로 사라집니다."""
        assert strip_quoted_reply("From: 저희 팀에서 요청드립니다") != ""

    def test_empty_input(self):
        assert strip_quoted_reply("") == ""


class TestHtmlToText:
    def test_block_tags_become_newlines(self):
        assert html_to_text("<p>첫 줄</p><p>둘째 줄</p>") == "첫 줄\n둘째 줄"

    def test_entities_are_decoded(self):
        assert html_to_text("<p>A&nbsp;&amp;&nbsp;B</p>") == "A & B"

    def test_tags_are_removed(self):
        assert "span" not in html_to_text('<div><span style="color:red">경고</span></div>')

    def test_empty_input(self):
        assert html_to_text("") == ""


class TestNormalizeWhitespace:
    def test_crlf_becomes_lf(self):
        assert normalize_whitespace("a\r\nb") == "a\nb"

    def test_three_or_more_blank_lines_collapse_to_one(self):
        assert normalize_whitespace("a\n\n\n\n\nb") == "a\n\nb"

    def test_trailing_spaces_are_trimmed(self):
        assert normalize_whitespace("a   \n  b  ") == "a\n b"


class TestTruncate:
    def test_short_text_unchanged(self):
        assert truncate("짧다", 100) == "짧다"

    def test_long_text_gets_suffix(self):
        result = truncate("가" * 50, 10)
        assert result.startswith("가" * 10)
        assert "생략" in result

    def test_zero_limit_disables_truncation(self):
        assert truncate("가" * 50, 0) == "가" * 50


class TestPrepareBodyForLlm:
    def test_falls_back_to_html_when_plain_is_empty(self):
        assert prepare_body_for_llm("", "<p>HTML 본문</p>") == "HTML 본문"

    def test_prefers_plain_over_html(self):
        assert prepare_body_for_llm("평문 본문", "<p>HTML 본문</p>") == "평문 본문"

    def test_strips_quote_and_truncates(self):
        body = "요청 내용입니다.\n\n-----Original Message-----\n" + ("옛" * 5000)
        result = prepare_body_for_llm(body, None, limit=100)
        assert result == "요청 내용입니다."


class TestSanitizeFilename:
    def test_strips_directory_traversal(self):
        assert sanitize_filename("../../etc/passwd") == "passwd"

    def test_strips_windows_path(self):
        assert sanitize_filename(r"C:\temp\report.xlsx") == "report.xlsx"

    def test_keeps_korean_and_extension(self):
        assert sanitize_filename("오류 화면.png") == "오류 화면.png"

    def test_empty_becomes_fallback(self):
        assert sanitize_filename("") == "attachment"

    def test_dot_only_becomes_fallback(self):
        assert sanitize_filename("..") == "attachment"

    def test_null_byte_removed(self):
        assert "\x00" not in sanitize_filename("a\x00b.png")

    def test_length_is_capped(self):
        assert len(sanitize_filename("가" * 300)) <= 120


class TestFirstLine:
    def test_returns_first_non_blank_line(self):
        assert first_line("\n\n  실제 첫 줄  \n둘째 줄") == "실제 첫 줄"

    def test_empty_returns_empty(self):
        assert first_line("") == ""
