"""메일 백엔드 선택."""

from __future__ import annotations

from ..config import Config
from .base import MailClient, MailError

__all__ = ["MailClient", "MailError", "build_mail_client"]


def build_mail_client(config: Config) -> MailClient:
    """설정에 맞는 백엔드를 만듭니다 (config.mail_backend 는 이미 auto 가 해소된 값)."""
    if config.mail_backend == "outlook":
        from .outlook import OutlookMailClient

        return OutlookMailClient()

    from .fixture import FixtureMailClient

    return FixtureMailClient(config.fixture_mail_path, config.fixture_outbox_dir)
