"""개발·테스트용 메일 백엔드.

JSON 파일에서 메일을 읽고, 발송은 파일로 기록합니다.
Outlook 없이 수집·분류·적재·발송 흐름 전체를 macOS 에서 돌려 볼 수 있습니다.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from ..models import Attachment, RawMail
from ..textutil import sanitize_filename
from .base import MailError

log = logging.getLogger(__name__)


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class FixtureMailClient:
    """`fixtures/*.json` 의 메일을 읽습니다.

    파일 형식:
        [
          {
            "message_id": "fixture-001",
            "subject": "...",
            "body": "...",
            "sender_email": "...",
            "sender_name": "...",
            "received_at": "2026-08-05T09:12:00Z",
            "folder": "받은 편지함/요청",
            "attachments": [{"file_name": "a.png", "content_base64": "..."}]
          }
        ]
    """

    def __init__(self, mail_path: Path, outbox_dir: Path) -> None:
        self.mail_path = Path(mail_path)
        self.outbox_dir = Path(outbox_dir)
        self._processed: set[str] = set()

    def fetch(
        self, folder: str, limit: int = 50, since: datetime | None = None
    ) -> Iterable[RawMail]:
        if not self.mail_path.exists():
            raise MailError(
                f"fixture 메일 파일이 없습니다: {self.mail_path}. "
                f"FIXTURE_MAIL_PATH 를 확인하거나 fixtures/sample_mails.json 을 만드세요."
            )

        try:
            records = json.loads(self.mail_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise MailError(f"fixture 메일 파일이 올바른 JSON 이 아닙니다: {exc}") from exc

        if not isinstance(records, list):
            raise MailError("fixture 메일 파일의 최상위는 배열이어야 합니다.")

        mails: list[RawMail] = []
        for record in records:
            message_id = str(record.get("message_id") or "").strip()
            if not message_id:
                log.warning("message_id 가 없는 fixture 메일을 건너뜁니다: %r", record.get("subject"))
                continue
            if message_id in self._processed:
                continue

            received = _parse_dt(record.get("received_at"))
            if since and received and received < since:
                continue
            record_folder = record.get("folder")
            if folder and record_folder and record_folder != folder:
                continue

            mails.append(
                RawMail(
                    message_id=message_id,
                    subject=str(record.get("subject") or "").strip(),
                    body=str(record.get("body") or ""),
                    body_html=record.get("body_html"),
                    sender_email=str(record.get("sender_email") or "").strip(),
                    sender_name=record.get("sender_name"),
                    received_at=received,
                    folder=record_folder or folder,
                    attachments=self._read_attachments(record),
                )
            )

        mails.sort(key=lambda m: m.received_at or datetime.min.replace(tzinfo=timezone.utc))
        return mails[:limit]

    @staticmethod
    def _read_attachments(record: dict) -> list[Attachment]:
        results: list[Attachment] = []
        for att in record.get("attachments") or []:
            raw = att.get("content_base64")
            if raw is None:
                content = str(att.get("content") or "").encode("utf-8")
            else:
                try:
                    content = base64.b64decode(raw)
                except (ValueError, TypeError) as exc:
                    log.warning("첨부 base64 디코딩 실패, 건너뜁니다: %s", exc)
                    continue
            results.append(
                Attachment(
                    file_name=sanitize_filename(str(att.get("file_name") or "attachment")),
                    content=content,
                    content_type=att.get("content_type"),
                )
            )
        return results

    def mark_processed(self, message_id: str, move_to: str | None = None) -> None:
        self._processed.add(message_id)
        log.info("[fixture] 처리 완료 표시: %s%s", message_id, f" → {move_to}" if move_to else "")

    def send_reply(
        self,
        message_id: str | None,
        to_email: str,
        subject: str,
        body: str,
        cc_emails: str | None = None,
        display_only: bool = True,
    ) -> str:
        self.outbox_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        path = self.outbox_dir / f"{stamp}-{sanitize_filename(to_email)}.txt"
        path.write_text(
            "\n".join(
                [
                    f"모드: {'display(사람 확인 필요)' if display_only else 'send(자동 발송)'}",
                    f"원본 메일 ID: {message_id or '(없음 — 새 메일)'}",
                    f"받는 사람: {to_email}",
                    f"참조: {cc_emails or '(없음)'}",
                    f"제목: {subject}",
                    "",
                    body,
                ]
            ),
            encoding="utf-8",
        )
        return f"[fixture] {path} 에 기록했습니다."

    def close(self) -> None:
        self._processed.clear()
