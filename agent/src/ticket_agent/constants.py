"""코드값 상수.

DB check 제약(supabase/schema.sql)과 웹의 src/lib/constants.ts 와 **같은 값**을 씁니다.
셋 중 하나만 고치면 저장이 실패하므로 세 곳을 함께 수정하세요.
"""

from __future__ import annotations

# 상태 파이프라인 (docs/SPEC-EMAIL-TICKET.md 3.2)
STATUSES = ("intake", "triage", "in_progress", "testing", "deploy", "done")
STATUS_LABELS = {
    "intake": "접수 대기",
    "triage": "분석/할당",
    "in_progress": "진행 중",
    "testing": "테스트",
    "deploy": "배포",
    "done": "완료",
}

# 장애 등급
SEVERITIES = ("critical", "high", "medium", "low")
SEVERITY_LABELS = {
    "critical": "Critical",
    "high": "High",
    "medium": "Medium",
    "low": "Low",
}

# 요청 유형 — 기획서의 "오류/개선/수정/신규"
CATEGORIES = ("error", "improve", "fix", "new")
CATEGORY_LABELS = {
    "error": "오류",
    "improve": "개선",
    "fix": "수정",
    "new": "신규",
}

# 시스템 구분
SYSTEM_TYPES = ("erp", "api", "web_app", "infra", "etc")
SYSTEM_TYPE_LABELS = {
    "erp": "ERP",
    "api": "연동 API",
    "web_app": "사내 웹/앱",
    "infra": "인프라",
    "etc": "기타",
}

# 분류에 실패했을 때 쓰는 값. 티켓을 버리지 않기 위한 안전한 기본값입니다.
FALLBACK_CATEGORY = "error"
FALLBACK_SEVERITY = "medium"
FALLBACK_SYSTEM_TYPE = "etc"
FALLBACK_STATUS = "triage"
