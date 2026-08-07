/**
 * 코드값 상수.
 *
 * DB check 제약(supabase/schema.sql)과 에이전트의 constants.py 와 **같은 값**을 씁니다.
 * 셋 중 하나만 고치면 저장이 실패하므로 세 곳을 함께 수정하세요.
 */

/**
 * 상태. 보드 열 순서이기도 합니다.
 *
 * on_hold(보류)는 **파이프라인의 단계가 아니라 옆길**입니다. 어느 단계에서든
 * 들어갔다 원래 자리로 돌아옵니다. 그래서 순서가 있는 이동에는 STATUSES 가
 * 아니라 PIPELINE_STATUSES 를 씁니다.
 *
 * 보드에서는 '진행 중' 옆에 둡니다 — 끝으로 밀어 두면 보류 건이 잊힙니다.
 */
export const STATUSES = [
  'intake',
  'triage',
  'in_progress',
  'on_hold',
  'testing',
  'deploy',
  'done',
] as const
export type Status = (typeof STATUSES)[number]

/** 순서가 있는 단계. 보류는 여기 없습니다. */
export const PIPELINE_STATUSES = [
  'intake',
  'triage',
  'in_progress',
  'testing',
  'deploy',
  'done',
] as const
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number]

export function isPipelineStatus(status: Status): status is PipelineStatus {
  return status !== 'on_hold'
}

/**
 * 내부 화면용 라벨 — 영어.
 *
 * 저장값이 원래 영어이고, 이슈 트래킹 단계는 한국어로 옮기면 오히려 어색해집니다
 * ('triage' 를 '분석/할당' 두 단어로 붙여 놨던 것이 그 증상이었습니다).
 * 화면과 DB·로그가 같은 단어를 쓰면 옮겨 읽을 일이 없습니다.
 */
export const STATUS_LABELS: Record<Status, string> = {
  intake: 'Intake',
  triage: 'Triage',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  testing: 'Testing',
  deploy: 'Deploy',
  done: 'Done',
}

/**
 * 요청자에게 나가는 회신 메일용 라벨 — 한국어.
 *
 * 메일을 받는 사람은 재무팀·물류팀·인사팀이지 IT 팀이 아닙니다.
 * 그분들에게 'Deploy' 는 설명이 필요한 단어입니다.
 * 에이전트 쪽 같은 목적의 라벨은 agent/src/ticket_agent/constants.py 에 있습니다.
 */
export const STATUS_LABELS_KO: Record<Status, string> = {
  intake: '접수 대기',
  triage: '분석 중',
  in_progress: '진행 중',
  on_hold: '보류',
  testing: '테스트',
  deploy: '배포',
  done: '완료',
}

/** 칸반 열 색상. 진행할수록 짙어지고, 보류만 옆길이라 따뜻한 색입니다. */
export const STATUS_ACCENT: Record<Status, string> = {
  intake: 'bg-slate-400',
  triage: 'bg-sky-400',
  in_progress: 'bg-indigo-500',
  on_hold: 'bg-amber-400',
  testing: 'bg-violet-500',
  deploy: 'bg-orange-500',
  done: 'bg-emerald-500',
}

/**
 * 종료 방식 — 상태와 다른 축입니다.
 *
 * 상태는 "지금 누가 무엇을 하고 있는가", 종료 방식은 "어떻게 끝났는가".
 * done 하나로 뭉치면 "완료 12건" 중 몇 건을 실제로 고쳤는지 알 수 없습니다.
 */
export const RESOLUTIONS = ['fixed', 'rejected', 'duplicate', 'wontfix', 'cancelled'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  fixed: 'Fixed',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
  wontfix: "Won't Fix",
  cancelled: 'Cancelled',
}

export const RESOLUTION_LABELS_KO: Record<Resolution, string> = {
  fixed: '처리 완료',
  rejected: '반려 (오접수)',
  duplicate: '중복',
  wontfix: '처리하지 않음',
  cancelled: '요청자 취소',
}

export const RESOLUTION_HINTS: Record<Resolution, string> = {
  fixed: '요청한 대로 처리했습니다.',
  rejected: '요청이 아니었거나 우리 담당이 아닙니다 (자동 접수 오판 포함).',
  duplicate: '같은 내용의 티켓이 이미 있습니다.',
  wontfix: '검토했고, 하지 않기로 결정했습니다.',
  cancelled: '요청자가 거둬들였습니다.',
}

/** 종료 방식이 없을 때 화면에 쓰는 문구. 'fixed' 로 채우지 않습니다. */
export const UNSPECIFIED_RESOLUTION = '미지정'

/**
 * 실제 처리 작업으로 셀 종료 방식.
 *
 * 반려·중복·취소는 팀이 고친 것이 아니므로 MTTA/MTTR·리드타임 모수에서 뺍니다.
 * 넣어 두면 "반려까지 3분" 같은 건이 평균을 끌어내려 지표가 좋아 보입니다.
 *
 * wontfix 는 **뺍니다** — 검토는 했지만 수리는 안 했으므로 수리 시간이 없습니다.
 * null(미지정)은 넣습니다. 옛 데이터이고, 빼면 지표의 모수가 사라집니다.
 */
export const NON_WORK_RESOLUTIONS: readonly Resolution[] = [
  'rejected',
  'duplicate',
  'wontfix',
  'cancelled',
]

export function countsAsWork(resolution: Resolution | null | undefined): boolean {
  return !resolution || !NON_WORK_RESOLUTIONS.includes(resolution)
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

/**
 * 대분류. 라이프사이클 6단계는 셋 다 동일하고 관리 방식만 갈립니다.
 *
 *  incident    장애      — MTTR 측정 대상
 *  maintenance 유지보수  — 단순 수정·개선. 주간 현황 대상
 *  development 신규개발  — 공수 1주일 이상. 관리자가 수동 승격. Gantt 대상
 *
 * LLM 은 앞의 둘만 고릅니다. 공수 판단에 필요한 정보가 메일에 없기 때문입니다.
 */
export const WORK_TYPES = ['incident', 'maintenance', 'development'] as const
export type WorkType = (typeof WORK_TYPES)[number]

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  incident: '장애',
  maintenance: '유지보수',
  development: '신규개발',
}

export const WORK_TYPE_STYLE: Record<WorkType, string> = {
  incident: 'bg-rose-50 text-rose-700 ring-rose-200',
  maintenance: 'bg-sky-50 text-sky-700 ring-sky-200',
  development: 'bg-violet-50 text-violet-700 ring-violet-200',
}

/** 대분류별 차트 색. 순서가 아니라 종류라서 라벨이 항목을 구분합니다. */
export const WORK_TYPE_RAMP: Record<WorkType, string> = {
  incident: '#0d366b',
  maintenance: '#2a78d6',
  development: '#86b6ef',
}

/** 중분류 */
export const CATEGORIES = ['error', 'improve', 'fix', 'new'] as const
export type Category = (typeof CATEGORIES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  error: '오류',
  improve: '개선',
  fix: '수정',
  new: '신규',
}

/**
 * 시스템 종류는 **하드코딩하지 않습니다.**
 * public.systems 등록표를 운영자가 설정 화면에서 관리합니다.
 * 코드는 자유 문자열이고, 등록되지 않은 값은 화면에서 '미분류' 로 보입니다.
 */
export type SystemCode = string

/** 미분류 표시 문구. null 이거나 등록표에 없는 코드일 때 씁니다. */
export const UNCLASSIFIED_SYSTEM = '미분류'

/** 접수 판정 기준의 종류 */
export const RULE_KINDS = ['include', 'exclude'] as const
export type RuleKind = (typeof RULE_KINDS)[number]

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  include: '접수 대상',
  exclude: '제외 대상',
}

/**
 * 스캔한 메일의 처리 결과.
 *
 * `excluded` 와 `pending` 은 둘 다 티켓이 없지만 뜻이 정반대입니다.
 * 제외는 **판단이 끝난** 것이고, 판단 대기는 분류가 실패해 **시작도 못 한**
 * 것입니다. 하나로 합치면 "걸렀다" 안에 "모르겠다" 가 섞여 들어갑니다.
 *
 * `ticketed` 와 `linked` 도 다릅니다. 앞은 이 메일이 그 티켓이 **된** 것이고,
 * 뒤는 기존 티켓에 코멘트로 **붙은** 것입니다. 합치면 "메일 한 통 = 티켓 한 건"
 * 이라는 통계 전제가 조용히 깨집니다.
 */
export const SCAN_OUTCOMES = ['ticketed', 'excluded', 'pending', 'linked'] as const
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number]

export const SCAN_OUTCOME_LABELS: Record<ScanOutcome, string> = {
  ticketed: '티켓 생성됨',
  excluded: '제외됨',
  pending: '판단 대기',
  linked: '후속 연결됨',
}

export const ROLES = ['admin', 'member'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  admin: '관리자',
  member: '팀원',
}
