"""에이전트가 주고받는 값 객체들. 전부 순수 데이터입니다."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass(frozen=True)
class Attachment:
    """메일에 붙어 있던 파일 하나."""

    file_name: str
    content: bytes
    content_type: str | None = None

    @property
    def size_bytes(self) -> int:
        return len(self.content)


@dataclass(frozen=True)
class RawMail:
    """아웃룩에서 읽어온 메일 한 통. 아직 티켓이 아닙니다."""

    message_id: str  # Outlook EntryID. 중복 적재를 막는 유일 키
    subject: str
    body: str
    sender_email: str
    sender_name: str | None = None
    received_at: datetime | None = None
    body_html: str | None = None
    folder: str | None = None
    attachments: list[Attachment] = field(default_factory=list)


@dataclass(frozen=True)
class Classification:
    """LLM 판별 결과.

    `is_request` 가 False 면 티켓으로 만들지 않습니다.
    `error` 가 채워져 있으면 판별에 실패한 것이고, 그래도 티켓은 만들어집니다
    (기획서 3.1 예외 처리 — "내용이 부실해도 반려하지 않는다").

    `work_type` 은 LLM 이 장애/유지보수 둘 중에서만 고릅니다.
    신규개발 승격은 공수 판단이 필요해 관리자가 화면에서 합니다.

    `system_type` 이 None 이면 미분류입니다. 등록된 시스템이 없거나
    LLM 이 고르지 못한 경우인데, 없는 값을 지어내지 않습니다.
    """

    is_request: bool
    title: str
    category: str
    severity: str
    work_type: str = "maintenance"
    system_type: str | None = None
    due_date: date | None = None
    confidence: float | None = None
    reason: str | None = None
    model: str | None = None
    error: str | None = None

    @property
    def failed(self) -> bool:
        return self.error is not None


@dataclass(frozen=True)
class OutboundEmail:
    """발송 큐에서 꺼낸 한 건."""

    id: int
    ticket_id: int
    to_email: str
    subject: str
    body: str
    cc_emails: str | None = None
    attempts: int = 0


@dataclass(frozen=True)
class ScanResult:
    scanned: int = 0
    created: int = 0
    skipped_duplicate: int = 0
    skipped_not_request: int = 0
    classify_failed: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"스캔 {self.scanned}건 · 신규 티켓 {self.created}건 · "
            f"중복 {self.skipped_duplicate}건 · 대상아님 {self.skipped_not_request}건 · "
            f"분류실패(적재됨) {self.classify_failed}건 · 오류 {len(self.errors)}건"
        )


@dataclass(frozen=True)
class SendResult:
    picked: int = 0
    sent: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return f"발송 대상 {self.picked}건 · 처리 {self.sent}건 · 실패 {self.failed}건"
