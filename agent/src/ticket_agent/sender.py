"""발송 파이프라인 (기획서 2 — 5단계, 5-4).

웹에서 '완료' 처리하며 발송을 요청하면 outbound_emails 에 행이 생깁니다.
에이전트는 그 큐를 폴링해 아웃룩으로 회신을 만듭니다.

**기본값은 `display`** — 곧바로 보내지 않고 창을 띄워 사람이 확인 후 보냅니다.
Realtime 대신 폴링을 쓰는 이유는 에이전트가 꺼져 있던 동안 쌓인 요청을
재시작 후 그대로 집어가야 하기 때문입니다.
"""

from __future__ import annotations

import logging
import time

from .config import Config
from .mail import MailClient
from .models import OutboundEmail, SendResult
from .store import TicketStore
from .summarize import build_reply_body, build_reply_subject

log = logging.getLogger(__name__)


class Sender:
    def __init__(self, config: Config, mail: MailClient, store: TicketStore) -> None:
        self._config = config
        self._mail = mail
        self._store = store

    def run_once(self, limit: int = 10) -> SendResult:
        queued = self._store.claim_queued_emails(limit=limit)
        if not queued:
            return SendResult()

        log.info("발송 대기 %d건을 처리합니다.", len(queued))
        sent = failed = 0
        errors: list[str] = []

        for email in queued:
            try:
                note = self._send(email)
                self._store.mark_email_sent(email.id, note, email.attempts)
                sent += 1
                log.info("발송 큐 #%s (티켓 #%s) 처리: %s", email.id, email.ticket_id, note)
            except Exception as exc:
                failed += 1
                message = f"발송 큐 #{email.id}: {exc}"
                errors.append(message)
                log.exception("발송 실패 — %s", message)
                self._store.mark_email_failed(email.id, str(exc), email.attempts)

        return SendResult(picked=len(queued), sent=sent, failed=failed, errors=errors)

    def run_forever(self, limit: int = 10) -> None:
        """폴링 루프. Ctrl+C 로 멈춥니다."""
        interval = max(5, self._config.send_poll_interval)
        log.info(
            "발송 큐를 %d초마다 확인합니다 (모드: %s). Ctrl+C 로 종료합니다.",
            interval,
            self._config.send_mode,
        )
        while True:
            try:
                result = self.run_once(limit=limit)
                if result.picked:
                    log.info(result.summary())
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                # 폴링 루프는 어떤 오류로도 죽지 않습니다. 죽으면 큐가 조용히 쌓입니다.
                log.exception("폴링 중 오류 — 다음 주기에 다시 시도합니다: %s", exc)
            time.sleep(interval)

    def _send(self, email: OutboundEmail) -> str:
        subject, body = self._resolve_content(email)
        cc = email.cc_emails or (",".join(self._config.reply_cc) or None)

        return self._mail.send_reply(
            message_id=self._store.source_message_id(email.ticket_id),
            to_email=email.to_email,
            subject=subject,
            body=body,
            cc_emails=cc,
            display_only=not self._config.sends_immediately,
        )

    def _resolve_content(self, email: OutboundEmail) -> tuple[str, str]:
        """큐의 제목·본문을 그대로 씁니다. 비어 있으면 티켓에서 다시 만듭니다."""
        subject = (email.subject or "").strip()
        body = (email.body or "").strip()
        if subject and body:
            return subject, body

        ticket = self._store.get_ticket(email.ticket_id)
        if ticket is None:
            raise RuntimeError(
                f"티켓 #{email.ticket_id} 을 찾을 수 없어 회신 본문을 만들 수 없습니다."
            )

        meta = ticket.get("ticket_meta") or {}
        if isinstance(meta, list):  # 관계 조회가 배열로 올 수 있습니다
            meta = meta[0] if meta else {}

        comments = self._store.list_comments(email.ticket_id)
        return (
            subject or build_reply_subject(ticket.get("subject") or ""),
            body or build_reply_body(ticket, meta, comments),
        )
