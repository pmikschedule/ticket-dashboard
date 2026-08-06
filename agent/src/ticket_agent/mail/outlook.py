"""Outlook COM 백엔드 (Windows 전용, pywin32).

관리자 PC에서만 동작합니다. import 자체는 어느 OS 에서나 되지만
`OutlookMailClient()` 를 만드는 순간 win32com 이 필요합니다.
"""

from __future__ import annotations

import logging
import os
import tempfile
from datetime import datetime, timezone
from typing import Iterable

from ..models import Attachment, RawMail
from ..textutil import sanitize_filename
from .base import MailError

log = logging.getLogger(__name__)

OL_FOLDER_INBOX = 6
OL_MAIL_ITEM = 0
OL_FORMAT_PLAIN = 1

# 첨부 하나가 이 크기를 넘으면 건너뜁니다. Storage 비용과 메모리를 위한 상한.
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024


def _to_utc(value) -> datetime | None:
    """pywin32 의 시간 값을 tz-aware UTC datetime 으로."""
    if value is None:
        return None
    try:
        dt = datetime(
            value.year, value.month, value.day, value.hour, value.minute, value.second
        )
    except (AttributeError, ValueError):
        return None
    return dt.replace(tzinfo=timezone.utc)


class OutlookMailClient:
    """Outlook 데스크톱에 COM 으로 붙습니다."""

    def __init__(self) -> None:
        try:
            import win32com.client  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - Windows 전용 경로
            raise MailError(
                "pywin32 를 불러올 수 없습니다. Outlook 백엔드는 Windows + Outlook "
                "데스크톱에서만 동작합니다. 개발 중이라면 AGENT_MAIL_BACKEND=fixture 로 두세요."
            ) from exc

        try:
            self._app = win32com.client.Dispatch("Outlook.Application")
            self._ns = self._app.GetNamespace("MAPI")
        except Exception as exc:  # pragma: no cover - Windows 전용 경로
            raise MailError(f"Outlook 에 연결하지 못했습니다: {exc}") from exc

    # ── 폴더 ────────────────────────────────────────────────────────────────
    def _resolve_folder(self, path: str):
        """'받은 편지함/요청' 같은 경로를 폴더 객체로."""
        parts = [p.strip() for p in (path or "").split("/") if p.strip()]
        if not parts:
            return self._ns.GetDefaultFolder(OL_FOLDER_INBOX)

        root_name = parts[0]
        inbox = self._ns.GetDefaultFolder(OL_FOLDER_INBOX)
        if root_name.lower() in ("inbox", "받은 편지함", inbox.Name.lower()):
            current = inbox
            parts = parts[1:]
        else:
            current = self._find_child(self._ns.Folders, root_name, path)
            parts = parts[1:]

        for name in parts:
            current = self._find_child(current.Folders, name, path)
        return current

    @staticmethod
    def _find_child(collection, name: str, full_path: str):
        for folder in collection:
            if folder.Name.strip().lower() == name.strip().lower():
                return folder
        available = ", ".join(f.Name for f in collection)
        raise MailError(
            f"아웃룩 폴더를 찾지 못했습니다: '{name}' (경로 '{full_path}'). "
            f"같은 위치의 폴더들: {available or '(없음)'}"
        )

    # ── 수집 ────────────────────────────────────────────────────────────────
    def fetch(
        self, folder: str, limit: int = 50, since: datetime | None = None
    ) -> Iterable[RawMail]:
        target = self._resolve_folder(folder)
        items = target.Items
        items.Sort("[ReceivedTime]", True)  # 최신순으로 훑고 마지막에 뒤집습니다

        collected: list[RawMail] = []
        for item in items:
            if len(collected) >= limit:
                break
            try:
                if getattr(item, "Class", None) != 43:  # olMail
                    continue
                received = _to_utc(getattr(item, "ReceivedTime", None))
                if since and received and received < since:
                    # 최신순이므로 여기서부터는 전부 오래된 메일입니다.
                    break
                collected.append(self._to_raw_mail(item, folder, received))
            except Exception as exc:  # 한 통이 깨져도 스캔 전체를 멈추지 않습니다
                log.warning("메일 한 건을 읽지 못해 건너뜁니다: %s", exc)

        collected.reverse()  # 오래된 것부터 처리
        return collected

    def _to_raw_mail(self, item, folder: str, received: datetime | None) -> RawMail:
        return RawMail(
            message_id=str(item.EntryID),
            subject=(getattr(item, "Subject", "") or "").strip(),
            body=(getattr(item, "Body", "") or ""),
            body_html=(getattr(item, "HTMLBody", "") or None),
            sender_email=self._sender_address(item),
            sender_name=(getattr(item, "SenderName", "") or None),
            received_at=received,
            folder=folder,
            attachments=self._read_attachments(item),
        )

    @staticmethod
    def _sender_address(item) -> str:
        """Exchange 내부 주소(/O=…)면 SMTP 주소로 바꿔서 돌려줍니다."""
        address = (getattr(item, "SenderEmailAddress", "") or "").strip()
        addr_type = (getattr(item, "SenderEmailType", "") or "").upper()
        if addr_type == "EX" or address.startswith("/"):
            try:
                sender = item.Sender
                if sender is not None:
                    entry = sender.GetExchangeUser()
                    if entry is not None and entry.PrimarySmtpAddress:
                        return str(entry.PrimarySmtpAddress).strip()
            except Exception:  # pragma: no cover - 환경 의존
                log.debug("Exchange 주소를 SMTP 로 바꾸지 못했습니다", exc_info=True)
        return address

    def _read_attachments(self, item) -> list[Attachment]:
        """COM 첨부는 바이트로 직접 못 읽어서 임시 파일을 거칩니다."""
        results: list[Attachment] = []
        try:
            count = int(item.Attachments.Count)
        except Exception:
            return results

        for index in range(1, count + 1):
            tmp_path = None
            try:
                attachment = item.Attachments.Item(index)
                size = int(getattr(attachment, "Size", 0) or 0)
                if size > MAX_ATTACHMENT_BYTES:
                    log.warning(
                        "첨부 '%s' 는 %d바이트로 상한(%d)을 넘어 건너뜁니다",
                        attachment.FileName,
                        size,
                        MAX_ATTACHMENT_BYTES,
                    )
                    continue
                name = sanitize_filename(str(attachment.FileName))
                fd, tmp_path = tempfile.mkstemp(prefix="ticket-att-")
                os.close(fd)
                attachment.SaveAsFile(tmp_path)
                with open(tmp_path, "rb") as handle:
                    content = handle.read()
                results.append(Attachment(file_name=name, content=content))
            except Exception as exc:
                log.warning("첨부 %d번을 읽지 못해 건너뜁니다: %s", index, exc)
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass
        return results

    # ── 처리 표시 ───────────────────────────────────────────────────────────
    def mark_processed(self, message_id: str, move_to: str | None = None) -> None:
        item = self._ns.GetItemFromID(message_id)
        try:
            item.UnRead = False
            item.Save()
        except Exception as exc:
            log.warning("읽음 표시에 실패했습니다 (%s): %s", message_id, exc)

        if move_to:
            try:
                item.Move(self._resolve_folder(move_to))
            except Exception as exc:
                raise MailError(f"'{move_to}' 폴더로 옮기지 못했습니다: {exc}") from exc

    # ── 발송 ────────────────────────────────────────────────────────────────
    def send_reply(
        self,
        message_id: str | None,
        to_email: str,
        subject: str,
        body: str,
        cc_emails: str | None = None,
        display_only: bool = True,
    ) -> str:
        mail = None
        if message_id:
            try:
                mail = self._ns.GetItemFromID(message_id).Reply()
            except Exception as exc:
                # 원본이 지워졌거나 다른 PC 의 EntryID 일 수 있습니다. 새 메일로 대체합니다.
                log.warning("원본 메일(%s)에 회신하지 못해 새 메일로 보냅니다: %s", message_id, exc)

        if mail is None:
            mail = self._app.CreateItem(OL_MAIL_ITEM)
            mail.To = to_email
            mail.Subject = subject
        else:
            # Reply() 는 수신자·제목을 이미 채워 주지만, 명시적으로 맞춰 둡니다.
            mail.To = to_email
            mail.Subject = subject

        if cc_emails:
            mail.CC = cc_emails

        mail.BodyFormat = OL_FORMAT_PLAIN
        existing = getattr(mail, "Body", "") or ""
        mail.Body = body + ("\n\n" + existing if existing.strip() else "")

        if display_only:
            mail.Display(False)  # 모달로 띄우면 에이전트가 멈추므로 False
            return "아웃룩에 회신 창을 띄웠습니다. 사람이 확인 후 발송합니다."

        mail.Send()
        return "아웃룩으로 발송했습니다."

    def close(self) -> None:
        self._app = None
        self._ns = None
