/**
 * desk `/api/state` 의 실측 구조와, 보고서 렌더러가 받는 모델.
 *
 * desk 쪽 타입은 **2026-08-11 실측**을 그대로 옮긴 것입니다
 * (work 38 · projects 12 · systems 11 · people 7 · decisions 2).
 * 값이 없는 필드가 많으므로 거의 전부 nullable 입니다 — 낙관적으로 좁히면
 * 런타임에 undefined 가 화면에 찍힙니다.
 */

export interface DeskWorkDetail {
  analysis: string | null
  duration: string | null
  improvements: string | null
  testCases: unknown[]
  checklist: unknown[]
  notes: string | null
}

export interface DeskWork {
  id: string
  owner: string | null
  title: string
  project: string | null
  system: string | null
  parent: string | null
  /**
   * desk 의 업무 상태.
   *
   * 2026-08-13 스냅샷부터 `hold` 가 등장했습니다 (그 전 실측은 셋뿐이었습니다).
   * **보류는 파이프라인의 단계가 아니라 옆길입니다** — 보고서 표에서는 빼고
   * 이슈 절로 올립니다. 진행중에 섞으면 '일하고 있는 것'으로 읽힙니다.
   */
  status: 'todo' | 'ing' | 'done' | 'hold'
  start: string | null
  due: string | null
  completedOn: string | null
  /** 38건 전부 null 이었습니다. 업무 단위 진척율은 산출할 수 없습니다 */
  progress: number | null
  types: string[]
  detail: DeskWorkDetail | null
  /** 38건 전부 null 이었습니다 */
  assessment: string | null
  log: unknown[]
}

export interface DeskMilestone {
  name: string
  done: boolean
}

export interface DeskProject {
  key: string
  title: string
  codename: string | null
  parent: string | null
  system: string | null
  systems: string[] | null
  overview: string | null
  memo: string | null
  assessment: string | null
  current: string | null
  policy: string | null
  milestones: DeskMilestone[] | null
  /** 프로젝트째 멈춰 있음. desk 화면의 `보류` 배지 */
  hold?: boolean
  participants: string[] | null
  start: string | null
  due: string | null
}

export interface DeskDecision {
  id: string
  at: string | null
  status: string | null
  escalate: boolean | string | null
  title: string
  body: string | null
  project: string | null
  system: string | null
  work: string | null
}

export interface DeskState {
  updatedAt: string | null
  work: DeskWork[]
  projects: DeskProject[]
  decisions: DeskDecision[]
  systems: unknown[]
  people: unknown[]
}

/** 수집 메타를 덧붙인 스냅샷. 원본 state 는 **가공 없이** 보존합니다. */
export interface Snapshot {
  meta: {
    scannedAt: string
    yearMonth: string
    sourceUpdatedAt: string | null
    counts: { work: number; projects: number; decisions: number }
  }
  state: DeskState
}

// ---------------------------------------------------------------------------
// 티켓 대시보드 (Supabase) — 운영 현황 집계 원천
// ---------------------------------------------------------------------------

/**
 * 대분류.
 *
 * 값은 `supabase/schema.sql` 15.2 의 check 제약 · `agent/constants.py` ·
 * `web/src/lib/constants.ts` 와 **같아야 합니다.** 이 도구는 별개 패키지라
 * import 로 공유할 수 없어 옮겨 적었습니다 (등급 4종도 같은 사정입니다).
 */
export const WORK_TYPES = ['incident', 'maintenance', 'development'] as const
export type WorkType = (typeof WORK_TYPES)[number]

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  incident: '장애',
  maintenance: '유지보수',
  development: '신규개발',
}

/** 대시보드에서 읽어 오는 티켓의 최소 형태. 대분류 3종을 모두 담습니다 */
export interface TicketRow {
  id: string
  title: string
  /** 접수일 = tickets.received_at. created_at 이 아닙니다 */
  receivedAt: string
  /** 모르는 값이면 null — 아무 칸에도 넣지 않고 각주로 드러냅니다 */
  workType: WorkType | null
  /** 등급은 장애에만 뜻이 있습니다. 유지보수·신규개발은 채워져 있어도 안 씁니다 */
  severity: 'critical' | 'high' | 'medium' | 'low' | null
  system: string | null
  resolution: string | null
}

/**
 * 보고서의 3칸(매우심각·심각·보통)은 티켓 시스템의 4등급을 접은 것입니다.
 * medium 과 low 를 합쳐 '보통'으로 봅니다.
 */
export type SeverityBucket = 'critical' | 'major' | 'normal'

/** 추이 차트가 그리는 계열. 3종 전부는 막대가 너무 얇아집니다 — 아래 MonthBar 주석 참조 */
export const TREND_TYPES = ['incident', 'maintenance'] as const
export type TrendType = (typeof TREND_TYPES)[number]

// ---------------------------------------------------------------------------
// 렌더러 입력 모델
// ---------------------------------------------------------------------------

export type ChipKind = 'done' | 'ing' | 'late'

export interface WorkRow {
  title: string
  /** desk 의 work.owner. 비어 있으면 '—' (37/38 은 채워져 있습니다) */
  owner: string
  /** 없으면 빈 문자열. 지어내지 않습니다 */
  detail: string
  chip: ChipKind
  /** null 이면 진척율 칸을 비우고 막대도 그리지 않습니다 */
  progress: number | null
  schedule: string
}

/**
 * 표의 묶음 한 덩어리 = 프로젝트 하나.
 *
 * desk 는 시스템(운영 대상)과 프로젝트(구축 작업)를 별개 축으로 둡니다.
 * 묶음 기준으로 프로젝트를 고른 이유는 연결률입니다 — 실측에서
 * `work.system` 은 19/38, `work.project` 는 26/38 이 채워져 있고,
 * 프로젝트에는 마일스톤이 있어 진척율까지 나옵니다.
 */
export interface WorkGroup {
  key: string
  title: string
  /** 마일스톤 기준 진척율. 마일스톤이 없으면 null */
  progress: number | null
  /** `4/9` 처럼 보여 줄 원자료. 없으면 null */
  milestones: { done: number; total: number } | null
  counts: { done: number; ing: number; late: number }
  rows: WorkRow[]
}

/**
 * 추이 차트의 한 달.
 *
 * 대분류별 건수를 **셋 다** 담습니다. 차트는 그중 장애·유지보수 둘만 그립니다 —
 * 한 슬롯 폭이 0.30인치라 셋으로 쪼개면 막대 하나가 0.09인치가 되어 색만 보이고
 * 높이 비교가 안 됩니다. 신규개발은 당월 카드에 나오고, 추이에서 빠졌다는 사실은
 * 각주에 적습니다 — 조용히 빼면 총계가 안 맞아 보입니다.
 */
export interface MonthBar {
  label: string
  values: Record<WorkType, number>
  current: boolean
}

export interface ReportModel {
  period: { from: string; to: string; label: string }
  author: string
  reportedOn: string
  subtitle: string
  team: string

  summary: {
    workTotal: number
    done: number
    ing: number
    late: number
    /** 당월 접수 티켓 전체(대분류 3종 합) */
    ticketTotal: number
    /** 대분류별 당월 건수 */
    ticketCounts: Record<WorkType, number>
    focus: string
  }

  /** 프로젝트별로 묶은 표. 업무가 없는 프로젝트는 아예 들어오지 않습니다 */
  groups: WorkGroup[]

  /**
   * 2장 운영 현황 — 장애만이 아니라 대분류 3종 전부.
   *
   * 등급(`severity`)은 **장애만** 모수입니다. 유지보수·신규개발 티켓에도 등급
   * 컬럼은 있지만(DB 기본값 medium), 그것을 세면 '보통 장애' 가 부풀려집니다.
   */
  operations: {
    series: MonthBar[]
    /** 당월 대분류별 건수 */
    counts: Record<WorkType, number>
    total: number
    /** 전월 총건수. 집계 시작 이전이면 null (0 이 아닙니다) */
    prevTotal: number | null
    /** 당월 **장애**의 등급 분포 */
    severity: Record<SeverityBucket, number>
    criticalTitles: string[]
    /** 차트 아래 각주. 데이터 범위의 한계를 여기 적습니다 */
    note: string
  }

  issues: { label: string; body: string }[]
  plans: string[]

  /** 잘라낸 항목·누락 구간 등 **숨기면 안 되는 사실** */
  footnotes: string[]
}
