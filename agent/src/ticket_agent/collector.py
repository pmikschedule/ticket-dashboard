"""수집 파이프라인 (기획서 2 — 1~3단계).

메일 스캔 → LLM 판별·분류 → 첨부 업로드 → DB 적재.
"""

from __future__ import annotations

import logging

from .classifier import Classifier
from .config import Config
from .mail import MailClient
from .models import RawMail, ScanResult
from .store import StoreError, TicketStore

log = logging.getLogger(__name__)


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
        mails = list(
            self._mail.fetch(
                folder=self._config.outlook_folder,
                limit=self._config.scan_limit,
                since=self._config.scan_since,
            )
        )
        log.info("'%s' 에서 메일 %d건을 읽었습니다.", self._config.outlook_folder, len(mails))

        scanned = created = duplicates = not_request = classify_failed = 0
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
            else:
                created += 1
                if outcome == "created_with_error":
                    classify_failed += 1

        return ScanResult(
            scanned=scanned,
            created=created,
            skipped_duplicate=duplicates,
            skipped_not_request=not_request,
            classify_failed=classify_failed,
            errors=errors,
        )

    def _process(self, mail: RawMail) -> str:
        existing = self._store.find_ticket_by_message_id(mail.message_id)
        if existing is not None:
            log.debug("이미 티켓 %s 로 적재된 메일입니다: %s", existing, mail.message_id)
            self._mark_done(mail)
            return "duplicate"

        classification = self._classifier.classify(mail)

        if not classification.is_request:
            log.info(
                "요구사항 메일이 아니라 건너뜁니다: %r (%s)",
                mail.subject,
                classification.reason or "사유 없음",
            )
            self._mark_done(mail)
            return "not_request"

        try:
            ticket_id = self._store.create_ticket(mail, classification)
        except StoreError:
            raise
        except Exception as exc:
            raise StoreError(f"티켓 적재 실패: {exc}") from exc

        for attachment in mail.attachments:
            self._store.upload_attachment(ticket_id, attachment)

        log.info(
            "티켓 #%s 생성: %r [%s/%s/%s]%s",
            ticket_id,
            classification.title,
            classification.category,
            classification.severity,
            classification.system_type,
            " ⚠️ 분류 실패" if classification.failed else "",
        )

        self._mark_done(mail)
        return "created_with_error" if classification.failed else "created"

    def _mark_done(self, mail: RawMail) -> None:
        """적재에 성공한 뒤에만 부릅니다. 표시가 실패해도 티켓은 이미 살아 있습니다."""
        try:
            self._mail.mark_processed(
                mail.message_id, self._config.outlook_done_folder or None
            )
        except Exception as exc:
            log.warning("메일 처리 표시에 실패했습니다 (%s): %s", mail.message_id, exc)
