"""Supabase 접근 계층. DB·Storage 호출은 전부 여기를 지납니다.

에이전트는 service_role 키를 씁니다 — 로그인 세션 없이 적재해야 하고,
브라우저에 노출되지 않는 로컬 프로세스이기 때문입니다. RLS 는 우회됩니다.
"""

from __future__ import annotations

import logging
import mimetypes
from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

from .constants import FALLBACK_STATUS
from .models import Attachment, Classification, OutboundEmail, RawMail
from .textutil import sanitize_filename

log = logging.getLogger(__name__)


class StoreError(RuntimeError):
    """DB·Storage 오류."""


def _iso(value: datetime | None) -> str:
    return (value or datetime.now(timezone.utc)).isoformat()


class TicketStore:
    def __init__(self, url: str, service_key: str, bucket: str) -> None:
        self._client: Client = create_client(url, service_key)
        self._bucket = bucket

    # ── 티켓 ────────────────────────────────────────────────────────────────
    def find_ticket_by_message_id(self, message_id: str) -> int | None:
        """이미 적재한 메일인지 확인합니다. 주기 스캔은 같은 메일을 다시 읽습니다."""
        response = (
            self._client.table("tickets")
            .select("id")
            .eq("source_message_id", message_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0]["id"] if rows else None

    def create_ticket(self, mail: RawMail, classification: Classification) -> int:
        """tickets + ticket_meta 를 함께 만듭니다.

        meta insert 가 실패하면 ticket 을 지웁니다 — 상태 없는 티켓이 목록에
        떠 버리면 담당자가 손댈 수 없기 때문입니다.
        """
        ticket_payload: dict[str, Any] = {
            "subject": classification.title or mail.subject or "(제목 없음)",
            "description": mail.body or "",
            "body_html": mail.body_html,
            "reporter_email": mail.sender_email or "unknown@unknown",
            "reporter_name": mail.sender_name,
            "received_at": _iso(mail.received_at),
            "due_date": classification.due_date.isoformat() if classification.due_date else None,
            "source_message_id": mail.message_id,
            "source_folder": mail.folder,
        }

        response = self._client.table("tickets").insert(ticket_payload).execute()
        rows = response.data or []
        if not rows:
            raise StoreError(f"티켓 insert 가 행을 돌려주지 않았습니다: {mail.message_id}")
        ticket_id = int(rows[0]["id"])

        meta_payload = {
            "ticket_id": ticket_id,
            "category": classification.category,
            "severity": classification.severity,
            "system_type": classification.system_type,
            # 분류에 실패했으면 사람이 먼저 보도록 '분석/할당' 으로 넣습니다.
            "status": FALLBACK_STATUS if classification.failed else "intake",
            "llm_model": classification.model,
            "llm_confidence": classification.confidence,
            "llm_reason": classification.reason,
            "llm_error": classification.error,
        }
        try:
            self._client.table("ticket_meta").insert(meta_payload).execute()
        except Exception as exc:
            self._client.table("tickets").delete().eq("id", ticket_id).execute()
            raise StoreError(
                f"ticket_meta insert 에 실패해 티켓 {ticket_id} 을 되돌렸습니다: {exc}"
            ) from exc

        return ticket_id

    def get_ticket(self, ticket_id: int) -> dict[str, Any] | None:
        response = (
            self._client.table("tickets")
            .select("*, ticket_meta(*)")
            .eq("id", ticket_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None

    def list_comments(self, ticket_id: int) -> list[dict[str, Any]]:
        response = (
            self._client.table("comments")
            .select("content, created_at, users(name)")
            .eq("ticket_id", ticket_id)
            .order("created_at")
            .execute()
        )
        return response.data or []

    def status_history(self, ticket_id: int) -> list[dict[str, Any]]:
        response = (
            self._client.table("ticket_status_history")
            .select("from_status, to_status, changed_at")
            .eq("ticket_id", ticket_id)
            .order("changed_at")
            .execute()
        )
        return response.data or []

    # ── 첨부 ────────────────────────────────────────────────────────────────
    def upload_attachment(self, ticket_id: int, attachment: Attachment) -> str | None:
        """Storage 에 올리고 attachments 행을 만듭니다. 경로를 돌려줍니다.

        첨부 하나가 실패해도 티켓은 살립니다 — 본문이 더 중요합니다.
        """
        safe_name = sanitize_filename(attachment.file_name)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        path = f"{ticket_id}/{stamp}-{safe_name}"
        content_type = (
            attachment.content_type
            or mimetypes.guess_type(safe_name)[0]
            or "application/octet-stream"
        )

        try:
            self._client.storage.from_(self._bucket).upload(
                path,
                attachment.content,
                {"content-type": content_type, "upsert": "false"},
            )
        except Exception as exc:
            log.warning("첨부 '%s' 업로드 실패 (티켓 %s): %s", safe_name, ticket_id, exc)
            return None

        try:
            self._client.table("attachments").insert(
                {
                    "ticket_id": ticket_id,
                    "file_name": safe_name,
                    "file_url": path,
                    "content_type": content_type,
                    "size_bytes": attachment.size_bytes,
                }
            ).execute()
        except Exception as exc:
            log.warning("첨부 '%s' 의 DB 행 생성 실패 (티켓 %s): %s", safe_name, ticket_id, exc)
            return None

        return path

    # ── 발송 큐 ─────────────────────────────────────────────────────────────
    def claim_queued_emails(self, limit: int = 10) -> list[OutboundEmail]:
        """대기 중인 발송 요청을 오래된 순으로 가져옵니다."""
        response = (
            self._client.table("outbound_emails")
            .select("id, ticket_id, to_email, cc_emails, subject, body, attempts")
            .eq("status", "queued")
            .order("requested_at")
            .limit(limit)
            .execute()
        )
        return [
            OutboundEmail(
                id=int(row["id"]),
                ticket_id=int(row["ticket_id"]),
                to_email=row["to_email"],
                subject=row["subject"],
                body=row["body"],
                cc_emails=row.get("cc_emails"),
                attempts=int(row.get("attempts") or 0),
            )
            for row in (response.data or [])
        ]

    def mark_email_sent(self, email_id: int, note: str, attempts: int) -> None:
        self._client.table("outbound_emails").update(
            {
                "status": "sent",
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "attempts": attempts + 1,
                "error": note,
            }
        ).eq("id", email_id).execute()

    def mark_email_failed(self, email_id: int, error: str, attempts: int) -> None:
        """3회까지는 큐에 남겨 재시도하고, 그 뒤에는 failed 로 확정합니다.

        조용히 사라지면 아무도 발송이 안 된 걸 모릅니다.
        """
        next_attempts = attempts + 1
        status = "queued" if next_attempts < 3 else "failed"
        self._client.table("outbound_emails").update(
            {"status": status, "attempts": next_attempts, "error": error[:2000]}
        ).eq("id", email_id).execute()

    def source_message_id(self, ticket_id: int) -> str | None:
        """회신을 원본 메일 스레드에 붙이기 위해 필요합니다."""
        response = (
            self._client.table("tickets")
            .select("source_message_id")
            .eq("id", ticket_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0].get("source_message_id") if rows else None
