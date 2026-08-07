"""수집 파이프라인 (기획서 2 — 1~3단계).

메일 스캔 → LLM 판별·분류 → 첨부 업로드 → DB 적재.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from .classifier import Classifier
from .config import Config
from .constants import SCAN_OUTCOME_PENDING
from .window import parse_last_scan, resolve_scan_window
from .mail import MailClient
from .models import RawMail, ScanResult
from .store import StoreError, TicketStore

log = logging.getLogger(__name__)

#: 마지막 스캔 시각을 담는 app_settings 키. 이 값이 있으면 '첫 기동' 이 아닙니다.
LAST_SCAN_SETTING = "last_scan_at"


class Collector:
    def __init__(
        self,
        config: Config,
        mail: MailClient,
        classifier: Classifier,
        store: TicketStore,
    ) -> None:
        self._config = config
        self._mail = mail
        self._classifier = classifier
        self._store = store

    def run_once(self) -> ScanResult:
        """폴더를 한 번 훑습니다. 스케줄러가 반복 호출합니다."""
        # 시스템 등록표와 접수 판정 기준을 매 스캔마다 다시 읽습니다.
        # 운영 중에 설정을 바꿔도 에이전트 재시작이 필요 없습니다.
        self._classifier.set_systems(self._store.list_systems())
        include_rules, exclude_rules = self._store.intake_rules()
        self._classifier.set_intake_rules(
            include_rules,
            exclude_rules,
            self._store.setting("intake_ambiguous_policy", "include"),
        )

        # 어디서부터 읽을지. 첫 기동은 SCAN_SINCE 부터 전부, 그다음부터는
        # 최근 며칠치만 봅니다. 근거는 window.py 에 적었습니다.
        started_at = datetime.now(timezone.utc)
        window = resolve_scan_window(
            last_scan_at=parse_last_scan(self._store.setting(LAST_SCAN_SETTING)),
            scan_since=self._config.scan_since,
            lookback_days=self._config.scan_lookback_days,
            now=started_at,
            configured_limit=self._config.scan_limit,
        )
        log.info("수집 범위: %s", window.describe())

        mails = list(
            self._mail.fetch(
                folder=self._config.outlook_folder,
                limit=window.limit,
                since=window.since,
            )
        )
        log.info("'%s' 에서 메일 %d건을 읽었습니다.", self._config.outlook_folder, len(mails))

        scanned = created = duplicates = not_request = pending = 0
        errors: list[str] = []

        for mail in mails:
            scanned += 1
            try:
                outcome = self._process(mail)
            except Exception as exc:  # 한 통이 실패해도 나머지는 계속합니다
                message = f"{mail.message_id}: {exc}"
                log.exception("메일 처리 실패 — %s", message)
                errors.append(message)
                continue

            if outcome == "duplicate":
                duplicates += 1
            elif outcome == "not_request":
                not_request += 1
            elif outcome == "pending":
                pending += 1
            else:
                created += 1

        # 스캔을 **시작한** 시각을 남깁니다. 끝난 시각을 쓰면 도는 동안 도착한
        # 메일이 다음 창에서도 빠집니다. 되돌아 읽는 폭은 넉넉한 편이 낫습니다 —
        # 겹쳐 읽은 메일은 중복으로 걸러지지만 못 읽은 메일은 아무도 모릅니다.
        self._store.set_setting(LAST_SCAN_SETTING, started_at.isoformat())

        return ScanResult(
            scanned=scanned,
            created=created,
            skipped_duplicate=duplicates,
            skipped_not_request=not_request,
            pending=pending,
            errors=errors,
        )

    def _process(self, mail: RawMail) -> str:
        existing = self._store.find_ticket_by_message_id(mail.message_id)
        if existing is not None:
            log.debug("이미 티켓 %s 로 적재된 메일입니다: %s", existing, mail.message_id)
            self._mark_done(mail)
            return "duplicate"

        classification = self._classifier.classify(mail)

        # 판별에 **실패한** 경우가 먼저입니다. is_request 를 보기 전에 걸러야
        # 합니다 — 실패했을 때의 is_request 는 판단이 아니라 자리채움입니다.
        if classification.failed:
            log.warning(
                "분류에 실패해 판단 대기로 남깁니다: %r (%s)",
                mail.subject,
                classification.error,
            )
            scan_id = self._store.record_scanned_mail(
                mail, classification, None, outcome=SCAN_OUTCOME_PENDING
            )
            self._keep_attachments(scan_id, mail)
            self._mark_done(mail)
            return "pending"

        if not classification.is_request:
            log.info(
                "요구사항 메일이 아니라 티켓을 만들지 않습니다: %r (%s)",
                mail.subject,
                classification.reason or "사유 없음",
            )
            # 티켓은 안 만들지만 **기록은 남깁니다.** 이게 없으면 LLM 오판을
            # 아무도 알 수 없습니다. 검토 화면에서 사람이 구제할 수 있습니다.
            scan_id = self._store.record_scanned_mail(mail, classification, None)
            self._keep_attachments(scan_id, mail)
            self._mark_done(mail)
            return "not_request"

        try:
            ticket_id = self._store.create_ticket(mail, classification)
        except StoreError:
            raise
        except Exception as exc:
            raise StoreError(f"티켓 적재 실패: {exc}") from exc

        self._store.record_scanned_mail(mail, classification, ticket_id)

        for attachment in mail.attachments:
            self._store.upload_attachment(ticket_id, attachment)

        log.info(
            "티켓 #%s 생성: %r [%s/%s/%s/%s]",
            ticket_id,
            classification.title,
            classification.work_type,
            classification.category,
            classification.severity,
            classification.system_type or "미분류",
        )

        self._mark_done(mail)
        return "created"

    def _keep_attachments(self, scan_id: int | None, mail: RawMail) -> None:
        """티켓이 안 된 메일의 첨부를 보관합니다.

        후속 메일에 붙은 화면 캡처가 정작 그 메일을 보낸 이유인 경우가 많은데,
        예전에는 티켓이 될 때만 올려서 그게 유실됐습니다.

        스캔 기록이 없으면(적재 실패) 건너뜁니다 — 붙일 곳이 없는 파일을
        Storage 에 남기면 아무도 못 찾는 쓰레기가 됩니다.
        """
        if scan_id is None:
            if mail.attachments:
                log.warning(
                    "스캔 기록이 없어 첨부 %d개를 보관하지 못했습니다: %s",
                    len(mail.attachments),
                    mail.message_id,
                )
            return

        for attachment in mail.attachments:
            self._store.upload_scan_attachment(scan_id, attachment)

    def _mark_done(self, mail: RawMail) -> None:
        """적재에 성공한 뒤에만 부릅니다. 표시가 실패해도 티켓은 이미 살아 있습니다."""
        try:
            self._mail.mark_processed(
                mail.message_id, self._config.outlook_done_folder or None
            )
        except Exception as exc:
            log.warning("메일 처리 표시에 실패했습니다 (%s): %s", mail.message_id, exc)
