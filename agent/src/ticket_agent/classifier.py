"""LLM 필터링 및 분류 (기획서 3.1).

기획서는 1차(요구사항 여부)와 2차(등급·시스템·기한)를 나눠 적었지만,
**한 번의 호출로 처리합니다.** 1차에서 True 가 나오면 어차피 같은 본문을 다시
읽어야 하므로 두 번 부르면 비용과 지연만 두 배가 됩니다.
응답 스키마에 `is_request`(1차)와 나머지(2차)를 함께 두고,
`is_request=false` 면 나머지 값을 무시합니다.

**분류 실패는 티켓을 버리지 않습니다.** API 오류·스키마 위반이 나면
안전한 기본값과 함께 `error` 를 채워 돌려주고, 호출자는 그대로 적재합니다.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any

import anthropic

from .constants import (
    CATEGORIES,
    FALLBACK_CATEGORY,
    FALLBACK_SEVERITY,
    FALLBACK_SYSTEM_TYPE,
    SEVERITIES,
    SYSTEM_TYPES,
)
from .models import Classification, RawMail
from .textutil import first_line, prepare_body_for_llm

log = logging.getLogger(__name__)

BODY_CHAR_LIMIT = 12_000
MAX_TOKENS = 4_096

SYSTEM_PROMPT = """\
당신은 사내 IT 운영팀의 메일 접수 담당자입니다. 받은 메일 한 통을 읽고
시스템 요구사항·장애 신고인지 판별하고, 맞다면 티켓 메타데이터를 추출합니다.

## 1단계 — 요구사항 메일인가?
is_request = true 로 판정하는 경우:
- 시스템 오류·장애 신고
- 기능 개선, 수정, 신규 개발 요청
- 데이터 정정, 권한 부여처럼 IT팀의 작업이 필요한 요청

is_request = false 로 판정하는 경우:
- 일상 대화, 인사, 회식·일정 공지
- 광고, 뉴스레터, 스팸, 자동 발송 알림
- 이미 처리된 건에 대한 단순 감사 인사
- 회의록·자료 공유처럼 작업 요청이 아닌 것

애매하면 true 로 판정하십시오. 놓친 요청은 복구할 수 없지만,
잘못 접수된 티켓은 담당자가 화면에서 지우면 됩니다.

## 2단계 — 메타데이터 추출
is_request = true 일 때만 의미가 있습니다.

category — 요청의 성격
  error   : 동작하던 것이 동작하지 않음 (오류·장애)
  improve : 동작은 하지만 더 낫게 (개선)
  fix     : 잘못된 데이터·설정의 정정 (수정)
  new     : 없던 것을 만들어 달라 (신규)

severity — 업무 영향도
  critical : 서비스 전면 중단, 결제·마감 등 되돌릴 수 없는 업무 정지, 다수 사용자 영향
  high     : 핵심 기능 사용 불가하나 우회 수단 있음, 특정 부서 업무 지연
  medium   : 일부 기능 불편, 업무는 계속 가능 (기본값)
  low      : 단순 문의, 표시 오류, 개선 제안

system_type — 대상 시스템
  erp     : ERP, 회계, 인사, 재고 등 기간계
  api     : 외부·내부 시스템 간 연동 인터페이스
  web_app : 사내 웹사이트, 모바일 앱, 그룹웨어
  infra   : 서버, 네트워크, 계정, VPN, 프린터 등 인프라
  etc     : 위에 해당하지 않거나 본문만으로 판단 불가

due_date — 본문에 명시된 요청 기한이 있을 때만 YYYY-MM-DD 로. 없으면 null.
  "이번 주까지", "내일까지" 같은 상대 표현은 메일 수신일 기준으로 환산합니다.
  기한이 적혀 있지 않으면 추측하지 말고 null 을 넣으십시오.

title — 티켓 목록에 뜰 한 줄 제목. 60자 이내 한국어 명사구.
  메일 제목이 이미 명확하면 그대로 써도 됩니다.
  "RE:", "FW:" 같은 접두사와 발신자 서명은 제외합니다.

confidence — 위 판정 전체에 대한 확신도 0.0~1.0.
reason — 그렇게 판정한 이유 한 문장.

본문이 부실해 판단이 어려워도 반려하지 마십시오. 확실하지 않은 필드는
기본값(etc / medium)을 쓰고 confidence 를 낮게 주면 담당자가 화면에서 보완합니다.
"""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_request": {
            "type": "boolean",
            "description": "시스템 요구사항·장애 신고 메일이면 true",
        },
        "title": {"type": "string", "description": "티켓 제목. 60자 이내"},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "severity": {"type": "string", "enum": list(SEVERITIES)},
        "system_type": {"type": "string", "enum": list(SYSTEM_TYPES)},
        "due_date": {
            "type": ["string", "null"],
            "description": "요청 기한 YYYY-MM-DD. 본문에 없으면 null",
        },
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
    "required": [
        "is_request",
        "title",
        "category",
        "severity",
        "system_type",
        "due_date",
        "confidence",
        "reason",
    ],
    "additionalProperties": False,
}


def build_user_message(mail: RawMail) -> str:
    """LLM 에 보낼 메일 표현. 인용부는 제거하고 본문은 절단합니다."""
    body = prepare_body_for_llm(mail.body, mail.body_html, BODY_CHAR_LIMIT)
    received = mail.received_at.date().isoformat() if mail.received_at else "(알 수 없음)"
    attachments = ", ".join(a.file_name for a in mail.attachments) or "(없음)"
    return (
        f"<mail>\n"
        f"<received_date>{received}</received_date>\n"
        f"<from>{mail.sender_name or ''} &lt;{mail.sender_email}&gt;</from>\n"
        f"<subject>{mail.subject}</subject>\n"
        f"<attachments>{attachments}</attachments>\n"
        f"<body>\n{body}\n</body>\n"
        f"</mail>"
    )


def _clean_enum(value: Any, allowed: tuple[str, ...], fallback: str) -> str:
    text = str(value or "").strip().lower()
    return text if text in allowed else fallback


def _clean_due_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        log.warning("LLM 이 돌려준 due_date 를 해석하지 못했습니다: %r", value)
        return None


def _fallback(mail: RawMail, error: str, model: str | None = None) -> Classification:
    """분류에 실패했을 때. 티켓은 만들되 '분석/할당' 으로 보냅니다."""
    title = mail.subject.strip() or first_line(mail.body) or "(제목 없음)"
    return Classification(
        is_request=True,  # 판별을 못 했으므로 사람이 보게 둡니다
        title=title[:200],
        category=FALLBACK_CATEGORY,
        severity=FALLBACK_SEVERITY,
        system_type=FALLBACK_SYSTEM_TYPE,
        due_date=None,
        confidence=None,
        reason=None,
        model=model,
        error=error,
    )


def parse_response(payload: dict[str, Any], mail: RawMail, model: str) -> Classification:
    """LLM JSON 을 Classification 으로. 스키마를 벗어난 값은 기본값으로 눌러 담습니다."""
    title = str(payload.get("title") or "").strip()
    if not title:
        title = mail.subject.strip() or first_line(mail.body) or "(제목 없음)"

    confidence = payload.get("confidence")
    try:
        confidence = max(0.0, min(1.0, float(confidence))) if confidence is not None else None
    except (TypeError, ValueError):
        confidence = None

    return Classification(
        is_request=bool(payload.get("is_request", True)),
        title=title[:200],
        category=_clean_enum(payload.get("category"), CATEGORIES, FALLBACK_CATEGORY),
        severity=_clean_enum(payload.get("severity"), SEVERITIES, FALLBACK_SEVERITY),
        system_type=_clean_enum(payload.get("system_type"), SYSTEM_TYPES, FALLBACK_SYSTEM_TYPE),
        due_date=_clean_due_date(payload.get("due_date")),
        confidence=confidence,
        reason=(str(payload.get("reason")).strip()[:500] or None)
        if payload.get("reason")
        else None,
        model=model,
    )


class Classifier:
    """Claude 로 메일을 판별·분류합니다."""

    def __init__(self, api_key: str, model: str) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def classify(self, mail: RawMail) -> Classification:
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": build_user_message(mail)}],
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": RESPONSE_SCHEMA},
                },
            )
        except anthropic.APIError as exc:
            log.error("분류 API 호출 실패 (%s): %s", mail.message_id, exc)
            return _fallback(mail, f"API 오류: {exc}", self._model)
        except Exception as exc:  # 네트워크 등
            log.error("분류 중 예상치 못한 오류 (%s): %s", mail.message_id, exc)
            return _fallback(mail, f"예외: {exc}", self._model)

        # 안전 분류기가 거절하면 content 가 비어 있습니다. 인덱싱 전에 확인합니다.
        if response.stop_reason == "refusal":
            detail = getattr(getattr(response, "stop_details", None), "explanation", None)
            return _fallback(mail, f"모델이 응답을 거부했습니다: {detail or '사유 없음'}", self._model)
        if response.stop_reason == "max_tokens":
            return _fallback(mail, "응답이 max_tokens 에서 잘렸습니다.", self._model)

        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            return _fallback(mail, "모델 응답에 텍스트 블록이 없습니다.", self._model)

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            return _fallback(mail, f"응답 JSON 파싱 실패: {exc}", self._model)

        if not isinstance(payload, dict):
            return _fallback(mail, "응답 JSON 의 최상위가 객체가 아닙니다.", self._model)

        return parse_response(payload, mail, self._model)
