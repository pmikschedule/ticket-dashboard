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
from .models import Attachment, Classification, ManualIntake, OutboundEmail, RawMail
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

    def _create_ticket_row(
        self,
        ticket_payload: dict[str, Any],
        classification: Classification,
        status: str | None = None,
    ) -> int:
        """tickets + ticket_meta 를 함께 만드는 공통 경로.

        meta insert 가 실패하면 ticket 을 지웁니다 — 상태 없는 티켓이 목록에
        떠 버리면 담당자가 손댈 수 없기 때문입니다.
        """
        response = self._client.table("tickets").insert(ticket_payload).execute()
        rows = response.data or []
        if not rows:
            raise StoreError("티켓 insert 가 행을 돌려주지 않았습니다.")
        ticket_id = int(rows[0]["id"])

        meta_payload = {
            "ticket_id": ticket_id,
            "work_type": classification.work_type,
            "category": classification.category,
            "severity": classification.severity,
            "system_type": classification.system_type,
            "status": status
            or (FALLBACK_STATUS if classification.failed else "intake"),
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

    # ── 수동 등록 큐 ────────────────────────────────────────────────────────
    def claim_manual_intake(self, limit: int = 10) -> list[ManualIntake]:
        """대기 중인 수동 등록을 오래된 순으로 가져옵니다."""
        response = (
            self._client.table("manual_intake")
            .select(
                "id, raw_text, subject, reporter_email, reporter_name, "
                "received_at, channel, attempts"
            )
            .eq("status", "queued")
            .order("requested_at")
            .limit(limit)
            .execute()
        )
        results = []
        for row in response.data or []:
            received = row.get("received_at")
            results.append(
                ManualIntake(
                    id=int(row["id"]),
                    raw_text=row.get("raw_text") or "",
                    subject=row.get("subject"),
                    reporter_email=row.get("reporter_email"),
                    reporter_name=row.get("reporter_name"),
                    received_at=(
                        datetime.fromisoformat(str(received).replace("Z", "+00:00"))
                        if received
                        else None
                    ),
                    channel=row.get("channel") or "verbal",
                    attempts=int(row.get("attempts") or 0),
                )
            )
        return results

    def create_ticket_from_manual(
        self, entry: ManualIntake, classification: Classification
    ) -> int:
        """수동 등록을 티켓으로.

        `source_message_id` 는 비웁니다 — 아웃룩 메일이 아니므로 중복 판정 대상이
        아니고, Postgres 는 unique 컬럼의 NULL 을 여러 개 허용합니다.
        사람이 직접 넣은 건이라 바로 Triage 로 보냅니다.
        """
        payload: dict[str, Any] = {
            "subject": classification.title or entry.subject or "(제목 없음)",
            "description": entry.raw_text or "",
            "reporter_email": (entry.reporter_email or "").strip() or "unknown@unknown",
            "reporter_name": entry.reporter_name,
            "received_at": _iso(entry.received_at),
            "due_date": classification.due_date.isoformat() if classification.due_date else None,
            "intake_channel": entry.channel,
        }
        return self._create_ticket_row(payload, classification, status=FALLBACK_STATUS)

    def mark_manual_done(self, entry_id: int, ticket_id: int, attempts: int) -> None:
        self._client.table("manual_intake").update(
            {
                "status": "done",
                "ticket_id": ticket_id,
                "attempts": attempts + 1,
                "processed_at": datetime.now(timezone.utc).isoformat(),
                "error": None,
            }
        ).eq("id", entry_id).execute()

    def mark_manual_failed(self, entry_id: int, error: str, attempts: int) -> None:
        """3회까지는 큐에 남겨 재시도하고, 그 뒤에는 failed 로 확정합니다.

        조용히 사라지면 등록한 사람은 티켓이 생긴 줄 압니다.
        """
        next_attempts = attempts + 1
        self._client.table("manual_intake").update(
            {
                "status": "queued" if next_attempts < 3 else "failed",
                "attempts": next_attempts,
                "error": error[:2000],
                "processed_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", entry_id).execute()

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

        return self._create_ticket_row(ticket_payload, classification)

    # ── 시스템 등록표 ───────────────────────────────────────────────────────
    def list_systems(self) -> list[dict[str, Any]]:
        """LLM 스키마에 넣을 시스템 목록. 스캔 시작 때마다 읽습니다.

        운영 중에 시스템을 추가해도 에이전트를 재시작할 필요가 없습니다.
        읽기에 실패하면 빈 목록을 돌려줍니다 — 시스템 분류만 못 할 뿐,
        메일 수집 자체가 멈추면 안 됩니다.
        """
        try:
            response = (
                self._client.table("systems")
                .select("code, name, description")
                .eq("is_active", True)
                .order("sort_order")
                .order("code")
                .execute()
            )
            return response.data or []
        except Exception as exc:
            log.warning("시스템 등록표를 읽지 못했습니다. 미분류로 진행합니다: %s", exc)
            return []

    def intake_rules(self) -> tuple[list[str], list[str]]:
        """접수 판정 기준 (include, exclude).

        읽기에 실패하면 빈 목록을 돌려주고, classifier 가 기본 기준으로 넘어갑니다.
        근거 없이 판정하게 두지는 않습니다.
        """
        try:
            response = (
                self._client.table("intake_rules")
                .select("kind, content")
                .eq("is_active", True)
                .order("kind")
                .order("sort_order")
                .execute()
            )
            rows = response.data or []
        except Exception as exc:
            log.warning("접수 기준을 읽지 못했습니다. 기본 기준으로 진행합니다: %s", exc)
            return [], []

        include = [r["content"] for r in rows if r.get("kind") == "include"]
        exclude = [r["content"] for r in rows if r.get("kind") == "exclude"]
        return include, exclude

    def secret(self, key: str) -> str:
        """비밀값 한 건.

        `app_secrets` 는 정책이 하나도 없어 anon/authenticated 로는 못 읽습니다.
        여기서 읽히는 이유는 에이전트가 **service_role 키**로 붙어 RLS 를
        우회하기 때문입니다. 웹은 값을 되돌려받을 방법이 없습니다.

        실패하면 빈 문자열입니다 — 호출자가 .env 로 넘어갑니다.
        """
        try:
            response = (
                self._client.table("app_secrets")
                .select("value")
                .eq("key", key)
                .limit(1)
                .execute()
            )
            rows = response.data or []
            return (rows[0].get("value") if rows else None) or ""
        except Exception as exc:
            # 값은 절대 로그에 남기지 않습니다. 키 이름과 사유만.
            log.warning("비밀값 '%s' 을 읽지 못했습니다: %s", key, exc)
            return ""

    def setting(self, key: str, default: str = "") -> str:
        """app_settings 한 건. 없거나 실패하면 기본값."""
        try:
            response = (
                self._client.table("app_settings")
                .select("value")
                .eq("key", key)
                .limit(1)
                .execute()
            )
            rows = response.data or []
            return (rows[0].get("value") if rows else None) or default
        except Exception as exc:
            log.warning("설정 '%s' 을 읽지 못했습니다. 기본값 사용: %s", key, exc)
            return default

    # ── 스크리닝 ────────────────────────────────────────────────────────────
    def record_scanned_mail(
        self,
        mail: RawMail,
        classification: Classification | None,
        ticket_id: int | None,
        outcome: str | None = None,
    ) -> None:
        """스캔한 메일을 전부 남깁니다 — 티켓이 안 된 것도.

        이게 없으면 LLM 이 잘못 걸러낸 메일은 어디에도 흔적이 남지 않아
        아무도 오판을 알 수 없습니다. 실패해도 수집을 멈추지는 않습니다.

        `outcome` 을 주지 않으면 티켓 유무로 정합니다. 'pending'(분류 실패라
        사람이 정해야 함)은 티켓이 없다는 점에서 'excluded' 와 같아 보이지만
        뜻이 정반대라 — 하나는 판단이 끝났고 하나는 시작도 안 했습니다 —
        부르는 쪽이 명시해야 합니다.
        """
        payload: dict[str, Any] = {
            "message_id": mail.message_id,
            "subject": mail.subject or "",
            "body": mail.body or "",
            "body_html": mail.body_html,
            "sender_email": mail.sender_email or "",
            "sender_name": mail.sender_name,
            "received_at": _iso(mail.received_at),
            "folder": mail.folder,
            "outcome": outcome or ("ticketed" if ticket_id else "excluded"),
            "ticket_id": ticket_id,
        }
        if classification is not None:
            payload.update(
                {
                    "llm_is_request": classification.is_request,
                    "llm_category": classification.category,
                    "llm_severity": classification.severity,
                    "llm_system": classification.system_type,
                    "llm_confidence": classification.confidence,
                    "llm_reason": classification.reason,
                    "llm_error": classification.error,
                    "llm_model": classification.model,
                }
            )

        try:
            self._client.table("scanned_mails").upsert(
                payload, on_conflict="message_id"
            ).execute()
        except Exception as exc:
            log.warning("스캔 기록 적재 실패 (%s): %s", mail.message_id, exc)

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
