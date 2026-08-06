"""메일 백엔드 인터페이스.

운영은 Outlook COM(Windows 전용)이지만 개발·테스트는 macOS 에서 이뤄집니다.
그래서 Outlook 접근은 전부 이 인터페이스 뒤에 두고, 나머지 코드는 구현을 모릅니다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable, Protocol, runtime_checkable

from ..models import RawMail


class MailError(RuntimeError):
    """메일 백엔드 오류."""


@runtime_checkable
class MailClient(Protocol):
    """수집과 발송 양쪽을 담당합니다."""

    def fetch(
        self,
        folder: str,
        limit: int = 50,
        since: datetime | None = None,
    ) -> Iterable[RawMail]:
        """폴더의 메일을 수신일시 오름차순으로 돌려줍니다."""
        ...

    def mark_processed(self, message_id: str, move_to: str | None = None) -> None:
        """처리 완료 표시. `move_to` 가 주어지면 그 폴더로 옮깁니다."""
        ...

    def send_reply(
        self,
        message_id: str | None,
        to_email: str,
        subject: str,
        body: str,
        cc_emails: str | None = None,
        display_only: bool = True,
    ) -> str:
        """회신을 만듭니다.

        `display_only=True` 면 창을 띄우고 사람이 확인 후 보냅니다 (기획서 5-4).
        `message_id` 가 원본 메일을 가리키면 그 메일의 회신으로 스레드가 이어집니다.

        Returns: 사람이 읽을 결과 설명 (로그·DB 기록용).
        """
        ...

    def close(self) -> None:
        ...
