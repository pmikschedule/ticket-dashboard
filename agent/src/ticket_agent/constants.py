"""코드값 상수.

DB check 제약(supabase/schema.sql)과 웹의 src/lib/constants.ts 와 **같은 값**을 씁니다.
셋 중 하나만 고치면 저장이 실패하므로 세 곳을 함께 수정하세요.
"""

from __future__ import annotations

# 상태 (docs/SPEC-EMAIL-TICKET.md 3.2)
#
# on_hold(보류)는 파이프라인의 단계가 아니라 옆길입니다 — 어느 단계에서든 들어갔다
# 원래 자리로 돌아옵니다. 순서가 필요한 곳에서는 PIPELINE_STATUSES 를 쓰세요.
STATUSES = ("intake", "triage", "in_progress", "on_hold", "testing", "deploy", "done")
PIPELINE_STATUSES = ("intake", "triage", "in_progress", "testing", "deploy", "done")

# 라벨은 **한국어로 둡니다.** 에이전트가 이 라벨을 쓰는 곳은 요청자에게 나가는
# 완료 회신 메일뿐이고(summarize.py), 받는 사람은 IT 팀이 아닙니다.
# 내부 화면은 영어를 씁니다 — web/src/lib/constants.ts 의 STATUS_LABELS.
STATUS_LABELS = {
    "intake": "접수 대기",
    "triage": "분석 중",
    "in_progress": "진행 중",
    "on_hold": "보류",
    "testing": "테스트",
    "deploy": "배포",
    "done": "완료",
}

# 종료 방식. 상태와 다른 축이고, done 일 때만 뜻이 있습니다.
RESOLUTIONS = ("fixed", "rejected", "duplicate", "wontfix", "cancelled")
RESOLUTION_LABELS = {
    "fixed": "처리 완료",
    "rejected": "반려 (오접수)",
    "duplicate": "중복",
    "wontfix": "처리하지 않음",
    "cancelled": "요청자 취소",
}

# 장애 등급
SEVERITIES = ("critical", "high", "medium", "low")
SEVERITY_LABELS = {
    "critical": "Critical",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
}

# 대분류 (docs/DESIGN.md). 라이프사이클 6단계는 셋 다 동일하고 관리 방식만 갈립니다.
#   incident    장애      — MTTR 측정 대상
#   maintenance 유지보수  — 단순 수정·개선. 주간 현황 대상
#   development 신규개발  — 공수 1주일 이상. **관리자가 수동 승격** (LLM 이 정하지 않음)
WORK_TYPES = ("incident", "maintenance", "development")
WORK_TYPE_LABELS = {
    "incident": "장애",
    "maintenance": "유지보수",
    "development": "신규개발",
}

# LLM 이 고를 수 있는 대분류는 둘뿐입니다. 공수 판단은 코드가 못 합니다.
LLM_WORK_TYPES = ("incident", "maintenance")
FALLBACK_WORK_TYPE = "maintenance"


# 중분류 — 기획서의 "오류/개선/수정/신규"
CATEGORIES = ("error", "improve", "fix", "new")
CATEGORY_LABELS = {
    "error": "오류",
    "improve": "개선",
    "fix": "수정",
    "new": "신규",
}

# 시스템 구분은 **하드코딩하지 않습니다.**
# public.systems 등록표를 운영자가 설정 화면에서 관리하고,
# 에이전트는 스캔 때마다 읽어 LLM 스키마에 넣습니다.
# 등록된 것이 하나도 없으면 분류하지 않고 미분류(None)로 둡니다.
SYSTEM_TYPES: tuple[str, ...] = ()

# 분류에 실패했을 때 쓰는 값. 티켓을 버리지 않기 위한 안전한 기본값입니다.
FALLBACK_CATEGORY = "error"
FALLBACK_SEVERITY = "medium"
FALLBACK_STATUS = "triage"

# 시스템을 못 정하면 값을 지어내지 않고 비워 둡니다. 화면에는 '미분류' 로 보입니다.
FALLBACK_SYSTEM_TYPE: str | None = None


# 스캔한 메일의 처리 결과. web/src/lib/constants.ts 의 SCAN_OUTCOMES 와
# supabase/schema.sql 의 scanned_mails_outcome_check 제약과 **같은 값**입니다.
#
#   ticketed  티켓이 됐다
#   excluded  요청이 아니라고 판단해 걸렀다   ← 판단이 끝난 상태
#   pending   분류에 실패해 사람이 정해야 한다 ← 판단을 시작도 못 한 상태
#
# excluded 와 pending 은 둘 다 티켓이 없지만 뜻이 정반대입니다. 하나로 합치면
# "걸렀다" 안에 "모르겠다" 가 섞여 들어가고, 스크리닝 화면에서 무엇을 먼저
# 봐야 하는지가 사라집니다.
SCAN_OUTCOME_TICKETED = "ticketed"
SCAN_OUTCOME_EXCLUDED = "excluded"
SCAN_OUTCOME_PENDING = "pending"

SCAN_OUTCOMES = (SCAN_OUTCOME_TICKETED, SCAN_OUTCOME_EXCLUDED, SCAN_OUTCOME_PENDING)
SCAN_OUTCOME_LABELS = {
    "ticketed": "티켓 생성됨",
    "excluded": "제외됨",
    "pending": "판단 대기",
}
