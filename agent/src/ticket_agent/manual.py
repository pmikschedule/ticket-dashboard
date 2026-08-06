"""수동 등록 파이프라인.

메일로 오지 않은 요청(구두·전화·메신저)을 사람이 웹에서 붙여넣으면
`manual_intake` 큐에 쌓이고, 에이전트가 집어가 분류한 뒤 티켓으로 만듭니다.

웹이 직접 LLM 을 부르지 않는 이유는 **API 키 때문**입니다. 정적 사이트라
브라우저에 넣는 순간 노출됩니다. 회신 발송 큐와 같은 구조입니다.

**여기서는 `is_request` 판정을 하지 않습니다.** 사람이 직접 등록한 이상
요청이라는 판단은 이미 끝난 것이고, LLM 은 분류만 합니다.
"""

from __future__ import annotations

import logging

from .classifier import Classifier
from .models import ManualIntake, ManualResult
from .store import StoreError, TicketStore

log = logging.getLogger(__name__)


class ManualProcessor:
    def __init__(self, classifier: Classifier, store: TicketStore) -> None:
        self._classifier = classifier
        self._store = store

    def run_once(self, limit: int = 10) -> ManualResult:
        queued = self._store.claim_manual_intake(limit=limit)
        if not queued:
            return ManualResult()

        log.info("수동 등록 대기 %d건을 처리합니다.", len(queued))
        created = failed = 0
        errors: list[str] = []

        for entry in queued:
            try:
                ticket_id = self._process(entry)
                self._store.mark_manual_done(entry.id, ticket_id, entry.attempts)
                created += 1
                log.info("수동 등록 #%s → 티켓 #%s", entry.id, ticket_id)
            except Exception as exc:
                failed += 1
                message = f"수동 등록 #{entry.id}: {exc}"
                errors.append(message)
                log.exception("수동 등록 실패 — %s", message)
                self._store.mark_manual_failed(entry.id, str(exc), entry.attempts)

        return ManualResult(picked=len(queued), created=created, failed=failed, errors=errors)

    def _process(self, entry: ManualIntake) -> int:
        if not (entry.raw_text or "").strip():
            raise StoreError("본문이 비어 있어 분류할 수 없습니다.")

        classification = self._classifier.classify(entry.as_mail())

        # 사람이 등록한 건이므로 LLM 이 "요청 아님" 이라고 해도 티켓을 만듭니다.
        # 판단은 이미 사람이 했습니다. LLM 의 몫은 분류뿐입니다.
        if not classification.is_request:
            log.info(
                "수동 등록 #%s — LLM 은 요청이 아니라고 봤지만 사람이 등록했으므로 진행합니다.",
                entry.id,
            )

        try:
            return self._store.create_ticket_from_manual(entry, classification)
        except StoreError:
            raise
        except Exception as exc:
            raise StoreError(f"티켓 적재 실패: {exc}") from exc
