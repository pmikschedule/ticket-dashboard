"""회신 메일 본문 작성 — 전부 순수 함수입니다.

평소에는 웹에서 만든 초안이 발송 큐에 들어오고 에이전트는 그대로 보냅니다.
여기 함수는 (1) 큐의 본문이 비어 있을 때의 대비책이고,
(2) 웹의 초안 생성 로직(src/lib/reply.ts)과 같은 결과를 내는 참조 구현입니다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable

from .constants import CATEGORY_LABELS, SEVERITY_LABELS, STATUS_LABELS, SYSTEM_TYPE_LABELS


def _fmt_date(value: Any) -> str:
    if not value:
        return "-"
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except ValueError:
        return text[:10]


def lead_time_text(received_at: Any, completed_at: Any) -> str:
    """접수~완료 리드타임을 사람이 읽는 문장으로."""
    if not received_at or not completed_at:
        return "-"
    try:
        start = datetime.fromisoformat(str(received_at).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
    except ValueError:
        return "-"
    hours = (end - start).total_seconds() / 3600
    if hours < 0:
        return "-"
    if hours < 1:
        return f"{int(hours * 60)}분"
    if hours < 24:
        return f"{hours:.1f}시간"
    return f"{hours / 24:.1f}일"


def build_reply_subject(ticket_subject: str) -> str:
    subject = (ticket_subject or "").strip() or "요청 처리 결과"
    return subject if subject.upper().startswith("RE:") else f"RE: {subject}"


def build_reply_body(
    ticket: dict[str, Any],
    meta: dict[str, Any] | None = None,
    comments: Iterable[dict[str, Any]] = (),
    signature: str = "IT 운영팀 드림",
) -> str:
    """처리 결과 회신 본문.

    구성: 인사 → 요청 요약 → 처리 내역(코멘트) → 맺음말.
    코멘트가 하나도 없으면 그 절은 통째로 빠집니다 — 빈 제목만 남기지 않습니다.
    """
    meta = meta or {}
    reporter = (ticket.get("reporter_name") or "").strip()
    greeting = f"{reporter}님, 안녕하세요." if reporter else "안녕하세요."

    lines: list[str] = [
        greeting,
        "",
        "요청하신 건의 처리가 완료되어 결과를 안내드립니다.",
        "",
        "■ 요청 내용",
        f"  · 제목      : {ticket.get('subject') or '-'}",
        f"  · 접수일    : {_fmt_date(ticket.get('received_at'))}",
        f"  · 유형      : {CATEGORY_LABELS.get(meta.get('category'), '-')}"
        f" / {SEVERITY_LABELS.get(meta.get('severity'), '-')}",
        f"  · 대상 시스템: {SYSTEM_TYPE_LABELS.get(meta.get('system_type'), '-')}",
        f"  · 처리 상태  : {STATUS_LABELS.get(meta.get('status'), '-')}",
        f"  · 완료일    : {_fmt_date(meta.get('completed_at'))}"
        f" (소요 {lead_time_text(ticket.get('received_at'), meta.get('completed_at'))})",
    ]

    body_lines = [
        f"  · {(c.get('content') or '').strip()}"
        for c in comments
        if (c.get("content") or "").strip()
    ]
    if body_lines:
        lines += ["", "■ 처리 내역", *body_lines]

    lines += [
        "",
        "확인 후 추가로 필요한 사항이 있으시면 회신 부탁드립니다.",
        "감사합니다.",
        "",
        signature,
    ]
    return "\n".join(lines)
