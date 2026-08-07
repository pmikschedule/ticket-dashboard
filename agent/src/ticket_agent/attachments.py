"""사용자가 붙인 첨부와 본문에 딸려 온 이미지를 가릅니다.

서명의 회사 로고, 명함 이미지, 본문에 끼워 넣은 스크린샷의 썸네일 같은 것들은
아웃룩이 보기에 첨부와 똑같습니다. 그대로 두면 티켓마다 로고 파일이 하나씩
쌓이고, 첨부 목록에서 정작 필요한 파일이 묻힙니다.

**판정은 여기서만 합니다.** MAPI 속성을 읽는 것은 Windows 전용이지만 읽고 나서
무엇을 버릴지 정하는 규칙은 순수 함수라, 윈도우 없이 테스트할 수 있습니다.

가르는 기준은 세 가지입니다. 하나라도 걸리면 본문에 딸린 것으로 봅니다.

  1. `PR_ATTACHMENT_HIDDEN` 이 참        — 아웃룩이 첨부 목록에서 이미 숨긴 것
  2. `PR_ATTACH_FLAGS` 에 ATT_MHTML_REF — 본문이 참조한다고 메일이 직접 말한 것
  3. `Content-ID` 가 본문 HTML 의 `cid:` 로 참조됨

3번에서 **본문 참조까지 확인하는 것이 중요합니다.** Content-ID 는 있는데 본문이
안 쓰는 첨부가 있습니다 — 사용자가 붙인 진짜 파일인데 메일 클라이언트가 습관적으로
ID 를 달아 둔 경우입니다. ID 만 보고 버리면 그 파일이 사라집니다.

확신이 없으면 **남깁니다.** 잘못 남긴 로고는 눈에 거슬리는 정도지만, 잘못 버린
첨부는 요청자가 다시 보내 줘야 알 수 있습니다.
"""

from __future__ import annotations

import re

# olAttachmentType. 6 = olOLE — 본문에 끼워 넣은 OLE 개체입니다.
# 5(olEmbeddeditem, 전달된 메일)는 사용자가 붙인 것이므로 남깁니다.
OL_OLE = 6

# PR_ATTACH_FLAGS 의 ATT_MHTML_REF. 본문이 이 첨부를 참조한다는 표시입니다.
ATT_MHTML_REF = 0x00000004

#: 확장자만으로는 아무것도 정하지 않습니다. 크기 기준을 켰을 때 대상이 될
#: 후보를 좁히는 용도입니다.
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp", ".ico")


def normalize_content_id(content_id: str | None) -> str:
    """`<abc@def>` 처럼 꺾쇠에 싸여 오는 값을 벗깁니다."""
    value = (content_id or "").strip()
    if value.startswith("<") and value.endswith(">"):
        value = value[1:-1]
    return value.strip()


def body_references(body_html: str | None, content_id: str) -> bool:
    """본문 HTML 이 이 Content-ID 를 `cid:` 로 참조하는지."""
    cid = normalize_content_id(content_id)
    if not cid or not body_html:
        return False
    # cid:abc@def / "cid:abc@def" / 'CID:ABC@DEF' 를 모두 잡습니다.
    return re.search(rf"cid:\s*{re.escape(cid)}", body_html, re.IGNORECASE) is not None


def is_inline(
    *,
    file_name: str = "",
    content_id: str | None = None,
    hidden: bool = False,
    attach_flags: int = 0,
    attach_type: int | None = None,
    body_html: str | None = None,
    min_image_bytes: int = 0,
    size_bytes: int = 0,
) -> bool:
    """본문에 딸려 온 것이면 True. 사용자가 붙인 파일이면 False.

    `min_image_bytes` 는 기본값 0 — **꺼져 있습니다.** 위 세 기준으로 안 걸리는
    서명 이미지를 크기로 마저 거르고 싶을 때만 켭니다. 크기는 근거가 약합니다.
    작은 파일이 곧 로고는 아니고, 요청자가 잘라 붙인 오류 화면도 작습니다.
    """
    if hidden:
        return True

    if attach_flags & ATT_MHTML_REF:
        return True

    if attach_type == OL_OLE:
        return True

    if content_id and body_references(body_html, content_id):
        return True

    if min_image_bytes > 0 and 0 < size_bytes < min_image_bytes:
        if file_name.lower().endswith(IMAGE_SUFFIXES):
            return True

    return False
