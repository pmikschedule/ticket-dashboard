"""메일 본문 정리 — 전부 순수 함수라 Outlook 없이 테스트가 돕니다."""

from __future__ import annotations

import re

# 인용부 시작을 알리는 표지들. 이 아래는 이전 메일의 반복이라 LLM 에 보내지 않습니다.
# **줄 맨 앞에 있을 때만** 표지로 봅니다 — 문장 중간의 "from:" 은 본문입니다.
_QUOTE_MARKERS = (
    "-----original message-----",
    "-----원본 메시지-----",
    "________________________________",
    "from:",
    "sent:",
    "보낸 사람:",
    "발신자:",
    "보낸 날짜:",
)

# 서명 구분선. 이 줄만 있는 행이 서명의 시작입니다.
_SIGNATURE_LINES = ("--", "___")

# '>' 인용 블록이 이 줄 수 이상 연속되면 그 지점부터 버립니다.
_QUOTE_BLOCK_RUN = 3

_HTML_BLOCK_END = re.compile(r"</(p|div|tr|li|h[1-6]|br)\s*>", re.IGNORECASE)
_HTML_TAG = re.compile(r"<[^>]+>")
_WS_RUN = re.compile(r"[ \t ]+")
_BLANK_RUN = re.compile(r"\n{3,}")

_HTML_ENTITIES = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
}


def html_to_text(html: str) -> str:
    """HTML 본문을 읽을 수 있는 평문으로. 완벽한 렌더링이 목적이 아니라 LLM 입력용입니다."""
    if not html:
        return ""
    text = _HTML_BLOCK_END.sub("\n", html)
    text = _HTML_TAG.sub("", text)
    for entity, char in _HTML_ENTITIES.items():
        text = text.replace(entity, char)
    return normalize_whitespace(text)


def normalize_whitespace(text: str) -> str:
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _WS_RUN.sub(" ", text)
    lines = [line.rstrip() for line in text.split("\n")]
    text = "\n".join(lines)
    return _BLANK_RUN.sub("\n\n", text).strip()


def strip_quoted_reply(text: str) -> str:
    """인용된 이전 메일과 서명을 잘라냅니다.

    스레드가 길어질수록 본문의 대부분이 반복이라, 자르지 않으면
    LLM 이 지난 요청을 새 요청으로 오해합니다.

    판정은 **줄 단위**입니다. 표지가 줄 맨 앞에 있고 그 앞에 실제 내용이
    한 줄이라도 있어야 인용부로 봅니다. 첫 줄의 "From: …" 은 본문입니다 —
    자르면 메일 내용이 통째로 사라집니다.
    """
    if not text:
        return ""

    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    seen_content = False
    quote_run = 0

    for index, line in enumerate(lines):
        stripped = line.strip()
        lowered = stripped.lower()

        if seen_content:
            if any(lowered.startswith(marker) for marker in _QUOTE_MARKERS):
                return normalize_whitespace("\n".join(lines[:index]))
            if stripped in _SIGNATURE_LINES:
                return normalize_whitespace("\n".join(lines[:index]))

            if stripped.startswith(">"):
                quote_run += 1
                if quote_run >= _QUOTE_BLOCK_RUN:
                    return normalize_whitespace("\n".join(lines[: index - quote_run + 1]))
            else:
                quote_run = 0

        if stripped and not stripped.startswith(">"):
            seen_content = True

    return normalize_whitespace(text)


def truncate(text: str, limit: int, suffix: str = "\n…(이하 생략)") -> str:
    """문자 수로 자릅니다. 자른 경우에만 표시가 붙습니다."""
    if limit <= 0 or len(text) <= limit:
        return text
    return text[:limit].rstrip() + suffix


def prepare_body_for_llm(
    plain: str | None, html: str | None = None, limit: int = 12_000
) -> str:
    """LLM 에 보낼 본문을 만듭니다: 평문 우선 → HTML 폴백 → 인용부 제거 → 절단."""
    source = (plain or "").strip()
    if not source and html:
        source = html_to_text(html)
    return truncate(strip_quoted_reply(source), limit)


def sanitize_filename(name: str, fallback: str = "attachment") -> str:
    """Storage 경로에 넣어도 안전한 파일명으로 바꿉니다.

    메일 첨부의 파일명은 발신자가 정한 값입니다. 경로 구분자와 상위 디렉터리
    참조를 그대로 두면 버킷의 다른 경로에 파일을 쓸 수 있습니다.
    """
    name = (name or "").replace("\\", "/").split("/")[-1].strip()
    name = name.replace("\x00", "")
    if name in ("", ".", ".."):
        return fallback
    name = re.sub(r"[^\w.\-가-힣 ()\[\]]", "_", name)
    name = name.strip(". ") or fallback
    return name[:120]


def first_line(text: str, limit: int = 200) -> str:
    """제목 후보로 쓸 첫 줄."""
    for line in (text or "").split("\n"):
        stripped = line.strip()
        if stripped:
            return stripped[:limit]
    return ""
