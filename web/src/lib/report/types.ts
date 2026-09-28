/**
 * desk `/api/state` 의 실측 구조.
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
  /**
   * 업무별 **진행 기록** — `{ at: 'YYYY-MM-DD', body }` 가 날짜순으로 쌓입니다.
   *
   * 8/11 실측에는 전부 비어 있어 `unknown[]` 로 두었는데, 2026-09-28 실측 88건 중
   * 14건에 기록이 있습니다 (`코드리뷰 진행 중 (Sloan)` 처럼 **그 주의 진행 상황**).
   * 형식이 보장되지 않으므로 타입은 그대로 두고 읽는 쪽(`latestLog`)이 걸러 냅니다.
   */
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

/** desk 의 휴일 — `until` 이 없으면 하루짜리입니다 */
export interface DeskHoliday {
  date: string
  until?: string | null
  name: string
}

export interface DeskState {
  updatedAt: string | null
  work: DeskWork[]
  projects: DeskProject[]
  decisions: DeskDecision[]
  systems: unknown[]
  people: unknown[]
  /**
   * 2026-09 부터 생긴 필드. 주간보고가 '금주 처리 없음' 의 까닭(추석 연휴 등)을
   * 밝힐 때 씁니다. 없던 시절 스냅샷이 있으므로 optional 입니다.
   */
  holidays?: DeskHoliday[]
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
