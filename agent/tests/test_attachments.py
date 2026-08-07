"""첨부 판정 — 서명 로고는 버리고 사용자가 붙인 파일은 지킵니다.

이 규칙이 틀리면 두 가지로 틀립니다. 로고가 계속 쌓이거나(거슬림), 요청자가
보낸 파일이 사라집니다(복구 불가). 뒤쪽이 훨씬 나쁘므로 애매하면 남깁니다.
"""

from ticket_agent.attachments import body_references, is_inline, normalize_content_id


class TestNormalizeContentId:
    def test_strips_angle_brackets(self):
        assert normalize_content_id("<image001@01DA.5C>") == "image001@01DA.5C"

    def test_leaves_bare_id_alone(self):
        assert normalize_content_id("image001@01DA.5C") == "image001@01DA.5C"

    def test_none_becomes_empty(self):
        assert normalize_content_id(None) == ""

    def test_whitespace_only_becomes_empty(self):
        assert normalize_content_id("   ") == ""


class TestBodyReferences:
    def test_finds_cid_in_html(self):
        html = '<p>안녕하세요</p><img src="cid:logo@corp">'
        assert body_references(html, "logo@corp") is True

    def test_matches_angle_bracketed_id(self):
        html = '<img src="cid:logo@corp">'
        assert body_references(html, "<logo@corp>") is True

    def test_is_case_insensitive(self):
        html = '<IMG SRC="CID:LOGO@CORP">'
        assert body_references(html, "logo@corp") is True

    def test_absent_id_is_not_referenced(self):
        html = '<img src="cid:other@corp">'
        assert body_references(html, "logo@corp") is False

    def test_no_html_means_no_reference(self):
        assert body_references(None, "logo@corp") is False
        assert body_references("", "logo@corp") is False

    def test_empty_id_never_matches(self):
        assert body_references('<img src="cid:x">', "") is False

    def test_id_with_regex_characters_is_escaped(self):
        """Content-ID 에 정규식 특수문자가 흔합니다. 이스케이프를 빠뜨리면 터집니다."""
        html = '<img src="cid:a.b+c(d)@corp">'
        assert body_references(html, "a.b+c(d)@corp") is True
        assert body_references('<img src="cid:aXbXcXdX@corp">', "a.b+c(d)@corp") is False


class TestIsInline:
    def test_plain_attachment_is_kept(self):
        assert is_inline(file_name="요구사항.xlsx", size_bytes=48_000) is False

    def test_hidden_flag_is_inline(self):
        assert is_inline(file_name="image001.png", hidden=True) is True

    def test_mhtml_ref_flag_is_inline(self):
        assert is_inline(file_name="image001.png", attach_flags=0x04) is True

    def test_other_flags_do_not_trigger(self):
        assert is_inline(file_name="image001.png", attach_flags=0x01) is False

    def test_ole_object_is_inline(self):
        assert is_inline(file_name="개체.bin", attach_type=6) is True

    def test_embedded_message_is_kept(self):
        """전달된 메일(olEmbeddeditem=5)은 사람이 붙인 것입니다."""
        assert is_inline(file_name="원본메일.msg", attach_type=5) is False

    def test_referenced_content_id_is_inline(self):
        assert (
            is_inline(
                file_name="logo.png",
                content_id="<logo@corp>",
                body_html='<img src="cid:logo@corp">',
            )
            is True
        )

    def test_unreferenced_content_id_is_kept(self):
        """이게 핵심입니다. ID 만 보고 버리면 진짜 첨부가 사라집니다."""
        assert (
            is_inline(
                file_name="계약서.pdf",
                content_id="<abc123@outlook>",
                body_html="<p>확인 부탁드립니다</p>",
            )
            is False
        )

    def test_content_id_without_html_body_is_kept(self):
        """평문 메일이면 참조를 확인할 방법이 없습니다. 애매하면 남깁니다."""
        assert is_inline(file_name="명함.png", content_id="<card@corp>", body_html=None) is False


class TestMinImageBytes:
    """크기 기준은 기본으로 꺼져 있습니다 — 근거가 약하기 때문입니다."""

    def test_off_by_default(self):
        assert is_inline(file_name="logo.png", size_bytes=800) is False

    def test_small_image_dropped_when_enabled(self):
        assert is_inline(file_name="logo.png", size_bytes=800, min_image_bytes=5_000) is True

    def test_large_image_kept_when_enabled(self):
        assert is_inline(file_name="화면.png", size_bytes=90_000, min_image_bytes=5_000) is False

    def test_small_non_image_kept_when_enabled(self):
        """작아도 이미지가 아니면 서명 장식이 아닙니다."""
        assert is_inline(file_name="메모.txt", size_bytes=800, min_image_bytes=5_000) is False

    def test_unknown_size_is_kept(self):
        """크기를 못 읽었을 때 0 이 들어옵니다. 0 을 '아주 작음' 으로 보면 안 됩니다."""
        assert is_inline(file_name="logo.png", size_bytes=0, min_image_bytes=5_000) is False
