"""LLM 필터링 및 분류 (기획서 3.1) — Google Gemini.

기획서는 1차(요구사항 여부)와 2차(등급·시스템·기한)를 나눠 적었지만,
**한 번의 호출로 처리합니다.** 1차에서 T가 나오면 어차피 같은 본문을 다시
읽어야 하므로 두 번 부르면 비용과 지연만 두 배가 됩니다.
응답 스키마에 `is_request`(1차)와 나머지(2차)를 함께 두고,
`is_request=false` 면 나머지 값을 무시합니다.

**분류 실패는 티켓을 버리지 않습니다.** API 오류·안전 필터·스키마 위반이 나면
안전한 기본값과 함께 `error` 를 채워 돌려주고, 호출자는 그대로 적재합니다.

프로바이더 교체 지점은 `Classifier` 클래스 하나입니다. 판별 결과를 다루는
`parse_response` / `_fallback` / `build_user_message` 는 프로바이더와 무관합니다.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any, Sequence

from google import genai
from google.genai import types
from google.genai import errors as genai_errors

from .constants import (
    CATEGORIES,
    FALLBACK_CATEGORY,
    FALLBACK_SEVERITY,
    FALLBACK_SYSTEM_TYPE,
    FALLBACK_WORK_TYPE,
    LLM_WORK_TYPES,
    SEVERITIES,
)
from .models import Classification, RawMail
from .textutil import first_line, prepare_body_for_llm

log = logging.getLogger(__name__)

BODY_CHAR_LIMIT = 12_000
MAX_OUTPUT_TOKENS = 2_048

SYSTEM_PROMPT = """\
당신은 사내 IT 운영팀의 메일 접수 담당자입니다. 받은 메일 한 통을 읽고
시스템 요구사항·장애 신고인지 판별하고, 맞다면 티켓 메타데이터를 추출합니다.

## 1단계 — 요구사항 메일인가?
{intake_criteria}

## 2단계 — 메타데이터 추출
is_request = true 일 때만 의미가 있습니다.

work_type — 대분류. **둘 중에서만** 고릅니다.
  incident    : 동작하던 것이 멈췄거나 오작동. 지금 업무가 막혀 있음
  maintenance : 그 외 전부 — 수정·개선·신규 요청

  공수가 커서 '신규개발' 로 관리해야 하는 건은 관리자가 나중에 직접 올립니다.
  당신은 공수를 판단하지 마십시오. 판단할 정보가 없습니다.

category — 요청의 성격 (중분류)
  error   : 동작하던 것이 동작하지 않음 (오류·장애)
  improve : 동작은 하지만 더 낫게 (개선)
  fix     : 잘못된 데이터·설정의 정정 (수정)
  new     : 없던 것을 만들어 달라 (신규)

severity — 업무 영향도
  critical : 서비스 전면 중단, 결제·마감 등 되돌릴 수 없는 업무 정지, 다수 사용자 영향
  high     : 핵심 기능 사용 불가하나 우회 수단 있음, 특정 부서 업무 지연
  medium   : 일부 기능 불편, 업무는 계속 가능 (기본값)
  low      : 단순 문의, 표시 오류, 개선 제안

system_type — 대상 시스템. **아래 등록된 목록에서만** 고릅니다.
{system_type_guide}

due_date — 본문에 명시된 요청 기한이 있을 때만 YYYY-MM-DD 로.
  없으면 **빈 문자열**을 넣습니다.
  "이번 주까지", "내일까지" 같은 상대 표현은 메일 수신일 기준으로 환산합니다.
  기한이 적혀 있지 않으면 추측하지 말고 빈 문자열을 넣으십시오.

title — 티켓 목록에 뜰 한 줄 제목. 60자 이내 한국어 명사구.
  메일 제목이 이미 명확하면 그대로 써도 됩니다.
  "RE:", "FW:" 같은 접두사와 발신자 서명은 제외합니다.

confidence — 위 판정 전체에 대한 확신도 0.0~1.0.
reason — 그렇게 판정한 이유 한 문장.

본문이 부실해 판단이 어려워도 반려하지 마십시오. 확실하지 않은 필드는
기본값을 쓰고 confidence 를 낮게 주면 담당자가 화면에서 보완합니다.

반드시 JSON 만 출력하십시오. 설명 문장을 덧붙이지 마십시오.
"""


# 설정이 비어 있을 때 쓰는 최소 기준.
# DB 를 못 읽었다고 아무 근거 없이 판정하게 두지는 않습니다.
DEFAULT_INCLUDE_RULES = (
    "시스템 오류·장애 신고",
    "기능 개선, 수정, 신규 개발 요청",
    "데이터 정정, 권한 부여처럼 IT팀의 작업이 필요한 요청",
)
DEFAULT_EXCLUDE_RULES = (
    "일상 대화, 인사, 회식·일정 공지",
    "광고, 뉴스레터, 스팸, 자동 발송 알림",
    "이미 처리된 건에 대한 단순 감사 인사",
    "회의록·자료 공유처럼 작업 요청이 아닌 것",
)


def build_intake_criteria(
    include_rules: Sequence[str] = (),
    exclude_rules: Sequence[str] = (),
    ambiguous_policy: str = "include",
) -> str:
    """접수 판정 기준을 프롬프트 조각으로 만듭니다 (public.intake_rules).

    비어 있으면 기본 기준을 씁니다 — 근거 없는 판정보다 낫습니다.
    `ambiguous_policy` 는 애매할 때의 편향입니다. 기본값 include 의 근거는
    "메일은 놓치면 복구되지 않지만, 잘못 접수된 티켓은 지우면 된다" 입니다.
    """
    include = [r for r in include_rules if str(r).strip()] or list(DEFAULT_INCLUDE_RULES)
    exclude = [r for r in exclude_rules if str(r).strip()] or list(DEFAULT_EXCLUDE_RULES)

    if ambiguous_policy == "exclude":
        tail = (
            "애매하면 false 로 판정하십시오. 확실한 요청만 접수합니다."
        )
    else:
        tail = (
            "애매하면 true 로 판정하십시오. 놓친 요청은 복구할 수 없지만,\n"
            "잘못 접수된 티켓은 담당자가 화면에서 지우면 됩니다."
        )

    lines = ["is_request = true 로 판정하는 경우:"]
    lines += [f"- {r}" for r in include]
    lines += ["", "is_request = false 로 판정하는 경우:"]
    lines += [f"- {r}" for r in exclude]
    lines += ["", tail]
    return "\n".join(lines)


def build_system_prompt(
    systems: Sequence[Any] = (),
    include_rules: Sequence[str] = (),
    exclude_rules: Sequence[str] = (),
    ambiguous_policy: str = "include",
) -> str:
    """시스템 종류는 운영자가 설정 화면에서 등록합니다 (public.systems).

    `systems` 는 문자열 코드 목록이거나 {"code","name","description"} 딕셔너리 목록입니다.
    설명이 있으면 LLM 이 고를 근거로 함께 넘깁니다.
    """
    lines = []
    for entry in systems:
        if isinstance(entry, dict):
            code = str(entry.get("code") or "").strip()
            if not code:
                continue
            label = str(entry.get("name") or code).strip()
            note = str(entry.get("description") or "").strip()
            lines.append(f"  {code} : {label}" + (f" — {note}" if note else ""))
        else:
            lines.append(f"  {entry}")

    guide = "\n".join(lines) if lines else (
        "  (등록된 시스템이 없습니다. system_type 항목은 응답에서 생략하십시오.)"
    )
    return SYSTEM_PROMPT.format(
        system_type_guide=guide,
        intake_criteria=build_intake_criteria(include_rules, exclude_rules, ambiguous_policy),
    )


def system_codes(systems: Sequence[Any]) -> list[str]:
    """문자열 목록이든 딕셔너리 목록이든 코드만 뽑아냅니다."""
    codes = []
    for entry in systems:
        code = str(entry.get("code") if isinstance(entry, dict) else entry or "").strip()
        if code:
            codes.append(code)
    return codes


def build_response_schema(systems: Sequence[Any] = ()) -> dict[str, Any]:
    """Gemini 가 받는 JSON Schema.

    `additionalProperties` 나 union 타입(`["string","null"]`)은 쓰지 않습니다.
    Gemini 의 스키마 지원 범위를 벗어나면 요청 자체가 거절됩니다.
    없는 값은 null 대신 **빈 문자열**로 받고 파서가 None 으로 바꿉니다.

    등록된 시스템이 없으면 `system_type` 항목 자체를 넣지 않습니다.
    빈 enum 은 스키마 위반이고, 억지로 기본값을 넣으면 없는 분류가 생깁니다.
    """
    properties: dict[str, Any] = {
        "is_request": {
            "type": "boolean",
            "description": "시스템 요구사항·장애 신고 메일이면 true",
        },
        "title": {"type": "string", "description": "티켓 제목. 60자 이내"},
        "work_type": {"type": "string", "enum": list(LLM_WORK_TYPES)},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "severity": {"type": "string", "enum": list(SEVERITIES)},
        "due_date": {
            "type": "string",
            "description": "요청 기한 YYYY-MM-DD. 본문에 없으면 빈 문자열",
        },
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    }
    required = [
        "is_request",
        "title",
        "work_type",
        "category",
        "severity",
        "due_date",
        "confidence",
        "reason",
    ]

    codes = system_codes(systems)
    if codes:
        properties["system_type"] = {"type": "string", "enum": codes}
        required.append("system_type")

    return {"type": "object", "properties": properties, "required": required}


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


def _clean_enum(value: Any, allowed: Sequence[str], fallback: str) -> str:
    text = str(value or "").strip().lower()
    return text if text in allowed else fallback


def _clean_due_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        log.warning("LLM 이 돌려준 due_date 를 해석하지 못했습니다: %r", value)
        return None


def _fallback(mail: RawMail, error: str, model: str | None = None) -> Classification:
    """분류에 실패했을 때. 티켓은 만들되 '분석/할당' 으로 보냅니다."""
    title = mail.subject.strip() or first_line(mail.body) or "(제목 없음)"
    return Classification(
        is_request=True,  # 판별을 못 했으므로 사람이 보게 둡니다
        title=title[:200],
        work_type=FALLBACK_WORK_TYPE,
        category=FALLBACK_CATEGORY,
        severity=FALLBACK_SEVERITY,
        system_type=FALLBACK_SYSTEM_TYPE,
        due_date=None,
        confidence=None,
        reason=None,
        model=model,
        error=error,
    )


def parse_response(
    payload: dict[str, Any],
    mail: RawMail,
    model: str,
    systems: Sequence[Any] = (),
) -> Classification:
    """LLM JSON 을 Classification 으로. 스키마를 벗어난 값은 기본값으로 눌러 담습니다."""
    title = str(payload.get("title") or "").strip()
    if not title:
        title = mail.subject.strip() or first_line(mail.body) or "(제목 없음)"

    confidence = payload.get("confidence")
    try:
        confidence = max(0.0, min(1.0, float(confidence))) if confidence is not None else None
    except (TypeError, ValueError):
        confidence = None

    reason = str(payload.get("reason") or "").strip()

    # 등록되지 않은 코드는 버립니다. 없는 분류를 만드는 것보다 미분류가 낫습니다.
    codes = system_codes(systems)
    raw_system = str(payload.get("system_type") or "").strip().lower()
    system_type = raw_system if raw_system in codes else FALLBACK_SYSTEM_TYPE

    return Classification(
        is_request=bool(payload.get("is_request", True)),
        title=title[:200],
        work_type=_clean_enum(payload.get("work_type"), LLM_WORK_TYPES, FALLBACK_WORK_TYPE),
        category=_clean_enum(payload.get("category"), CATEGORIES, FALLBACK_CATEGORY),
        severity=_clean_enum(payload.get("severity"), SEVERITIES, FALLBACK_SEVERITY),
        system_type=system_type,
        due_date=_clean_due_date(payload.get("due_date")),
        confidence=confidence,
        reason=reason[:500] or None,
        model=model,
    )


# 안전 필터·길이 초과 등으로 본문이 안 온 경우의 사유 설명.
_FINISH_REASON_NOTE = {
    "SAFETY": "안전 필터에 걸렸습니다",
    "PROHIBITED_CONTENT": "금지된 내용으로 분류됐습니다",
    "BLOCKLIST": "차단 목록에 걸렸습니다",
    "SPII": "민감정보로 분류됐습니다",
    "RECITATION": "인용 정책에 걸렸습니다",
    "MAX_TOKENS": "응답이 최대 길이에서 잘렸습니다",
    "MALFORMED_FUNCTION_CALL": "모델이 잘못된 형식으로 응답했습니다",
}


class Classifier:
    """Google Gemini 로 메일을 판별·분류합니다."""

    def __init__(
        self,
        api_key: str,
        model: str,
        systems: Sequence[Any] = (),
        thinking_budget: int | None = None,
    ) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._systems = list(systems)
        self._thinking_budget = thinking_budget
        self._include_rules: list[str] = []
        self._exclude_rules: list[str] = []
        self._ambiguous_policy = "include"

    def set_systems(self, systems: Sequence[Any]) -> None:
        """스캔 시작 때 등록표를 다시 읽어 넣습니다.
        운영 중에 시스템을 추가해도 에이전트를 재시작할 필요가 없습니다."""
        self._systems = list(systems)

    def set_intake_rules(
        self,
        include_rules: Sequence[str],
        exclude_rules: Sequence[str],
        ambiguous_policy: str = "include",
    ) -> None:
        """접수 판정 기준을 설정에서 읽어 넣습니다 (스캔마다 갱신)."""
        self._include_rules = list(include_rules)
        self._exclude_rules = list(exclude_rules)
        self._ambiguous_policy = ambiguous_policy or "include"

    def _config(self) -> types.GenerateContentConfig:
        kwargs: dict[str, Any] = {
            "system_instruction": build_system_prompt(
                self._systems,
                self._include_rules,
                self._exclude_rules,
                self._ambiguous_policy,
            ),
            "response_mime_type": "application/json",
            "response_json_schema": build_response_schema(self._systems),
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            # 분류는 매번 같은 답이 나와야 합니다. 창의성이 필요한 작업이 아닙니다.
            "temperature": 0.0,
        }
        # thinking_budget 은 모델마다 허용 범위가 달라(2.5 Pro 는 0 불가) 기본은 보내지 않습니다.
        if self._thinking_budget is not None:
            kwargs["thinking_config"] = types.ThinkingConfig(
                thinking_budget=self._thinking_budget
            )
        return types.GenerateContentConfig(**kwargs)

    def classify(self, mail: RawMail) -> Classification:
        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=build_user_message(mail),
                config=self._config(),
            )
        except genai_errors.APIError as exc:
            log.error("분류 API 호출 실패 (%s): %s", mail.message_id, exc)
            return _fallback(mail, f"API 오류: {exc}", self._model)
        except Exception as exc:  # 네트워크 등
            log.error("분류 중 예상치 못한 오류 (%s): %s", mail.message_id, exc)
            return _fallback(mail, f"예외: {exc}", self._model)

        # 프롬프트 단계에서 통째로 막힌 경우
        blocked = getattr(getattr(response, "prompt_feedback", None), "block_reason", None)
        if blocked:
            return _fallback(mail, f"요청이 차단됐습니다: {blocked}", self._model)

        candidates = response.candidates or []
        if not candidates:
            return _fallback(mail, "모델이 후보 응답을 돌려주지 않았습니다.", self._model)

        finish = getattr(candidates[0], "finish_reason", None)
        finish_name = getattr(finish, "name", str(finish) if finish else "")
        if finish_name and finish_name != "STOP":
            note = _FINISH_REASON_NOTE.get(finish_name, f"비정상 종료({finish_name})")
            return _fallback(mail, note, self._model)

        text = (response.text or "").strip()
        if not text:
            return _fallback(mail, "모델 응답이 비어 있습니다.", self._model)

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            return _fallback(mail, f"응답 JSON 파싱 실패: {exc}", self._model)

        if not isinstance(payload, dict):
            return _fallback(mail, "응답 JSON 의 최상위가 객체가 아닙니다.", self._model)

        return parse_response(payload, mail, self._model, self._systems)

    def available_models(self, limit: int = 20) -> list[str]:
        """doctor 가 쓰는 점검용. 키가 실제로 어떤 모델을 쓸 수 있는지 보여줍니다."""
        names: list[str] = []
        for entry in self._client.models.list():
            name = (getattr(entry, "name", "") or "").removeprefix("models/")
            actions = getattr(entry, "supported_actions", None) or []
            if name and (not actions or "generateContent" in actions):
                names.append(name)
            if len(names) >= limit:
                break
        return names
