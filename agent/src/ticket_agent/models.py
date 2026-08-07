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
    #: 본문에 딸려 온 것이라 첨부에서 뺀 파일들의 **이름만**. 내용은 안 담습니다.
    #: 이름이라도 남기는 이유는, 잘못 뺀 경우에 그 사실이 어디에도 안 남으면
    #: 요청자가 다시 보내 줄 때까지 아무도 모르기 때문입니다.
    skipped_inline: tuple[str, ...] = ()


@dataclass(frozen=True)
class Classification:
    """LLM 판별 결과.

    `is_request` 가 False 면 티켓으로 만들지 않습니다.

    `error` 가 채워져 있으면 **판별 자체를 못 한 것**입니다. 이때는 티켓을
    만들지 않고 스크리닝의 '판단 대기' 로 보냅니다 — 요청인지 아닌지를 모르는데
    티켓을 만들면 그 티켓은 통계 모수에 들어가고 담당자에게 할당되고 요청자에게
    회신까지 나갑니다. 추측을 사실로 만드는 셈입니다.

    기획서 3.1 의 "내용이 부실해도 반려하지 않는다" 는 **판별에 성공한** 경우
    이야기입니다. LLM 이 요청이라고 판단했으면 세부가 비어 있어도 티켓이 되고
    `triage` 로 갑니다. 그건 그대로입니다.

    메일을 버리지 않는다는 원칙은 양쪽 다 지킵니다 — 실패한 건도 `scanned_mails`
    에 원문째 남고 화면에 뜹니다. 달라지는 것은 **누가 접수를 정하느냐**입니다.

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
class ManualIntake:
    """수동 등록 큐에서 꺼낸 한 건.

    사람이 직접 넣은 것이므로 **요청 여부는 이미 결정돼 있습니다.**
    LLM 은 분류만 합니다.
    """

    id: int
    raw_text: str
    subject: str | None = None
    reporter_email: str | None = None
    reporter_name: str | None = None
    received_at: datetime | None = None
    channel: str = "verbal"
    attempts: int = 0

    def as_mail(self) -> "RawMail":
        """분류기가 받는 형태로 감쌉니다. 메일과 같은 경로를 타게 하려는 것입니다."""
        return RawMail(
            message_id=f"manual-{self.id}",
            subject=(self.subject or "").strip(),
            body=self.raw_text or "",
            sender_email=(self.reporter_email or "").strip(),
            sender_name=self.reporter_name,
            received_at=self.received_at,
            folder=None,
        )


@dataclass(frozen=True)
class ManualResult:
    picked: int = 0
    created: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return f"수동 등록 {self.picked}건 · 티켓 생성 {self.created}건 · 실패 {self.failed}건"


@dataclass(frozen=True)
class ScanResult:
    scanned: int = 0
    created: int = 0
    skipped_duplicate: int = 0
    skipped_not_request: int = 0
    #: 분류에 실패해 티켓을 만들지 않고 '판단 대기' 로 남긴 건.
    #: created 에 **포함되지 않습니다** — 티켓이 아니기 때문입니다.
    pending: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"스캔 {self.scanned}건 · 신규 티켓 {self.created}건 · "
            f"중복 {self.skipped_duplicate}건 · 대상아님 {self.skipped_not_request}건 · "
            f"판단대기 {self.pending}건 · 오류 {len(self.errors)}건"
        )


@dataclass(frozen=True)
class SendResult:
    picked: int = 0
    sent: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return f"발송 대상 {self.picked}건 · 처리 {self.sent}건 · 실패 {self.failed}건"
