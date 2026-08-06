/**
 * 코드값 상수.
 *
 * DB check 제약(supabase/schema.sql)과 에이전트의 constants.py 와 **같은 값**을 씁니다.
 * 셋 중 하나만 고치면 저장이 실패하므로 세 곳을 함께 수정하세요.
 */

export const STATUSES = ['intake', 'triage', 'in_progress', 'testing', 'deploy', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABELS: Record<Status, string> = {
  intake: '접수 대기',
  triage: '분석/할당',
  in_progress: '진행 중',
  testing: '테스트',
  deploy: '배포',
  done: '완료',
}

/** 칸반 열 색상. 진행할수록 짙어집니다. */
export const STATUS_ACCENT: Record<Status, string> = {
  intake: 'bg-slate-400',
  triage: 'bg-sky-400',
  in_progress: 'bg-indigo-500',
  testing: 'bg-violet-500',
  deploy: 'bg-amber-500',
  done: 'bg-emerald-500',
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-rose-100 text-rose-800 ring-rose-300',
  high: 'bg-orange-100 text-orange-800 ring-orange-300',
  medium: 'bg-amber-100 text-amber-800 ring-amber-300',
  low: 'bg-slate-100 text-slate-700 ring-slate-300',
}

/**
 * 차트용 색.
 *
 * 등급은 **순서가 있는 값**(low < medium < high < critical)이므로
 * 카테고리 색이 아니라 단일 색상의 순서형 램프를 씁니다.
 * 흰 배경(#ffffff) 기준으로 검증했습니다 — 명도 단조 증가, 인접 단계 간격,
 * 밝은 끝의 대비 2.11:1, 색상 편차 4° 전부 통과.
 *
 * 등급 이름은 막대 옆에 항상 글자로 적히므로 색이 단독으로 의미를 지지 않습니다.
 */
export const SEVERITY_RAMP: Record<Severity, string> = {
  low: '#86b6ef',
  medium: '#2a78d6',
  high: '#184f95',
  critical: '#0d366b',
}

/**
 * 단일 계열 차트의 색. 막대 옆 라벨이 항목을 구분하므로 색을 돌려 쓸 이유가 없습니다.
 * (흰 배경 대비 4.0:1 이상, 검증 통과)
 */
export const SERIES_HUE = '#2a78d6'

/** 차트 크롬 — 축·격자는 데이터보다 뒤로 물러나야 합니다. */
export const CHART_INK = {
  gridline: '#e2e8f0',
  baseline: '#cbd5e1',
  muted: '#64748b',
} as const

export const CATEGORIES = ['error', 'improve', 'fix', 'new'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  error: '오류',
  improve: '개선',
  fix: '수정',
  new: '신규',
}

export const SYSTEM_TYPES = ['erp', 'api', 'web_app', 'infra', 'etc'] as const
export type SystemType = (typeof SYSTEM_TYPES)[number]

export const SYSTEM_TYPE_LABELS: Record<SystemType, string> = {
  erp: 'ERP',
  api: '연동 API',
  web_app: '사내 웹/앱',
  infra: '인프라',
  etc: '기타',
}

export const ROLES = ['admin', 'member'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: '관리자',
  member: '팀원',
}
