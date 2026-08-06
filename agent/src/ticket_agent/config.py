"""환경설정. .env 를 읽고 필요한 값이 없으면 즉시 실패합니다."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv


class ConfigError(RuntimeError):
    """설정이 잘못됐을 때. 조용히 기본값으로 넘어가지 않습니다."""


def _require(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigError(
            f"{name} 이(가) 설정되지 않았습니다. agent/.env 를 확인하세요 "
            f"(.env.example 을 복사해서 만듭니다)."
        )
    return value


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    raw = _optional(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} 은 정수여야 합니다 (받은 값: {raw!r})") from exc


def _optional_int(name: str) -> int | None:
    """비워 두면 None. 모델마다 허용 범위가 달라 기본은 '보내지 않음' 입니다."""
    raw = _optional(name)
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} 은 정수여야 합니다 (받은 값: {raw!r})") from exc


def _csv(name: str) -> list[str]:
    raw = _optional(name)
    return [item.strip() for item in raw.split(",") if item.strip()]


def resolve_mail_backend(requested: str) -> str:
    """'auto' 를 실제 백엔드 이름으로 바꿉니다."""
    requested = (requested or "auto").lower()
    if requested == "auto":
        return "outlook" if sys.platform == "win32" else "fixture"
    if requested not in ("outlook", "fixture"):
        raise ConfigError(
            f"AGENT_MAIL_BACKEND 는 outlook | fixture | auto 중 하나여야 합니다 "
            f"(받은 값: {requested!r})"
        )
    return requested


def parse_since(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ConfigError(
            f"SCAN_SINCE 는 ISO8601 형식이어야 합니다 (예: 2026-08-01T00:00:00Z). 받은 값: {raw!r}"
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_key: str
    supabase_bucket: str

    gemini_api_key: str
    gemini_model: str
    gemini_thinking_budget: int | None

    mail_backend: str
    outlook_folder: str
    outlook_done_folder: str
    scan_limit: int
    scan_since: datetime | None

    send_mode: str
    send_poll_interval: int
    reply_cc: list[str] = field(default_factory=list)

    fixture_mail_path: Path = Path("fixtures/sample_mails.json")
    fixture_outbox_dir: Path = Path(".fixture-outbox")

    log_level: str = "INFO"

    @property
    def sends_immediately(self) -> bool:
        return self.send_mode == "send"


def load_config(env_file: str | os.PathLike[str] | None = None) -> Config:
    """.env 를 읽어 Config 를 만듭니다.

    Supabase/Gemini 자격증명은 필수입니다 — 없으면 즉시 ConfigError.
    """
    load_dotenv(env_file, override=False)

    send_mode = (_optional("AGENT_SEND_MODE", "display") or "display").lower()
    if send_mode not in ("display", "send"):
        raise ConfigError(
            f"AGENT_SEND_MODE 는 display | send 중 하나여야 합니다 (받은 값: {send_mode!r})"
        )

    return Config(
        supabase_url=_require("SUPABASE_URL"),
        supabase_service_key=_require("SUPABASE_SERVICE_KEY"),
        supabase_bucket=_optional("SUPABASE_BUCKET", "ticket-attachments") or "ticket-attachments",
        gemini_api_key=_require("GEMINI_API_KEY"),
        gemini_model=_optional("GEMINI_MODEL", "gemini-2.5-flash") or "gemini-2.5-flash",
        gemini_thinking_budget=_optional_int("GEMINI_THINKING_BUDGET"),
        mail_backend=resolve_mail_backend(_optional("AGENT_MAIL_BACKEND", "auto")),
        outlook_folder=_optional("OUTLOOK_FOLDER", "받은 편지함") or "받은 편지함",
        outlook_done_folder=_optional("OUTLOOK_DONE_FOLDER"),
        scan_limit=_int("SCAN_LIMIT", 50),
        scan_since=parse_since(_optional("SCAN_SINCE")),
        send_mode=send_mode,
        send_poll_interval=_int("SEND_POLL_INTERVAL", 30),
        reply_cc=_csv("REPLY_CC"),
        fixture_mail_path=Path(
            _optional("FIXTURE_MAIL_PATH", "fixtures/sample_mails.json") or "fixtures/sample_mails.json"
        ),
        fixture_outbox_dir=Path(
            _optional("FIXTURE_OUTBOX_DIR", ".fixture-outbox") or ".fixture-outbox"
        ),
        log_level=(_optional("LOG_LEVEL", "INFO") or "INFO").upper(),
    )
