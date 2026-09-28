/**
 * 주간 업무 보고 — 집계 규칙 (기획서 6.1 · 6.4 · 7.1).
 *
 * 월간 보고서와 근본이 다릅니다. 월간은 **그 달의 상태**를 찍지만, 주간은
 * **지난주 대비 무엇이 달라졌는가**가 본문입니다. 그래서 스냅샷 두 개를 대조합니다.
 *
 * **비교 대상이 없으면 변화를 지어내지 않습니다.** 첫 주차에는 diff 가 성립하지
 * 않으므로 `baseline: null` 로 두고 "기준 주차 — 비교 대상 없음" 이라고 밝힌 뒤
 * 현재 상태만 싣습니다. 없는 스냅샷을 빈 스냅샷으로 취급하면 38건 전부가
 * '금주 신규' 가 되어 첫 보고서가 새빨개집니다.
 *
 * 여기도 순수 함수입니다. 렌더링 코드에서 계산하지 않습니다.
 */

/**
 * 월간 집계(`aggregate.ts`)에 있던 작은 순수 함수 셋을 여기 옮겨 왔습니다.
 * 주간 보고가 web 으로 오면서 그쪽을 끌고 올 이유가 없어졌습니다.
 */
function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${Number(m[2])}/${Number(m[3])}` : null
}

/** 프로젝트 진척율 = 완료 마일스톤 / 전체. 마일스톤이 없으면 null (0% 가 아닙니다) */
function projectProgress(project: DeskProject | undefined): number | null {
  const ms = project?.milestones
  if (!ms || ms.length === 0) return null
  return Math.round((ms.filter((m) => m.done).length / ms.length) * 100)
}

/**
 * 업무 행에 찍을 진척율. 완료는 100%, 그 외는 desk 값 그대로, 없으면 비웁니다.
 * `work.progress` 는 실측 38건 전부 비어 있어 업무 단위로는 산출이 안 됩니다.
 */
function rowProgress(work: DeskWork, done: boolean): number | null {
  if (done) return 100
  return typeof work.progress === 'number' ? work.progress : null
}
import { mergedLabel } from './apply'
import { briefText, clampText, listLine, wrapLines } from './clamp'
import { projectRails, type ProjectRail } from './milestones'
import { summarizeOps, type OpsSummary, type ReportTicket } from './ops'
import { inWeek, rangeLabel, type Week } from './week'
import type { DeskProject, DeskState, DeskWork } from './types'

/** 프로젝트가 없는 업무가 갈 자리. 묶지 않고 **한 건씩 독립 항목**으로 세웁니다 */
export const STANDALONE_TITLE = '개별 업무'

export type WeeklyChip = 'late' | 'done' | 'started' | 'new' | 'ing'

export interface WeeklyRow {
  id: string
  title: string
  owner: string
  detail: string
  chip: WeeklyChip
  /** 완료 100%, 그 외는 desk `work.progress`. 없으면 null — 비웁니다 */
  progress: number | null
  /** `8/6` · `7/13 → 8/6`(금주 변경) · `9/18 완료` · `(계획)` */
  schedule: string
  /**
   * 일정 칸의 근거 날짜 — 완료면 완료일, 아니면 마감일. 묶음 행이 `9/15~9/18` 처럼
   * 기간을 적을 때 씁니다. 표시용 문자열(`schedule`)을 다시 파싱하지 않으려고 둡니다.
   */
  date?: string | null
  /**
   * 이 행이 담고 있는 업무 수. 없으면 1 — **묶음 행**(`foldGroups`)만 2 이상입니다.
   * 각주의 '몇 건 중 몇 건' 이 행 수가 아니라 업무 수를 세게 합니다.
   */
  members?: number
  /** 진행사항이 desk 진행 기록에서 왔으면 그 기록의 날짜. 아니면 없음 */
  detailAt?: string | null
  /** desk 마감일 원본. 일정 칸이 완료일을 적는 행에서도 '일정 변경' 은 마감일로 씁니다 */
  due?: string | null
  /** 금주에 마감일이 바뀌었으면 이전 값. 3장 '일정 변경' 이 이걸 씁니다 */
  dueChangedFrom: string | null
}

export interface WeeklyGroup {
  key: string
  title: string
  /** 프로젝트가 아니라 독립 항목 묶음이면 true — 렌더러가 머리행을 그리지 않습니다 */
  standalone: boolean
  /** 앞 장에서 이어진 묶음. 머리행에 '(계속)' 이 붙습니다 */
  continued: boolean
  owners: string[]
  counts: { done: number; started: number; ing: number; late: number; added: number }
  milestones: { done: number; total: number } | null
  progress: number | null
  rows: WeeklyRow[]
}

export interface WeeklyModel {
  period: { label: string; from: string; to: string; range: string }
  /** 보고서를 만든 날 (머리글의 `보고일`) */
  reportedOn: string
  /**
   * 우리가 아는 마지막 시점 — 스냅샷을 뜬 날과 구간 마감 중 이른 쪽.
   * 지연 판정의 기준입니다. 보고일과 다를 수 있습니다 (스냅샷이 밀렸을 때).
   */
  asOf: string
  subtitle: string

  /**
   * desk 가 마지막으로 갱신된 시각(`state.updatedAt`). 없으면 null.
   *
   * 보고는 보통 월요일에 하고 desk 는 금요일에 갱신되므로 **둘은 늘 어긋납니다.**
   * 이 보고서가 말하는 것은 구간이 아니라 그 시점까지의 업무 진행이므로, 어긋난
   * 사실을 머리글에 적어 둡니다 — 안 적으면 보고일 현재로 읽힙니다.
   */
  deskUpdatedAt: string | null

  /** 비교에 쓴 지난주 스냅샷 날짜. null 이면 **기준 주차**(비교 대상 없음) */
  baseline: string | null

  /**
   * 금주에 처리(완료)된 일이 없어 **비교 기준을 앞당겼으면** 그 사실. 아니면 null.
   *
   * 연휴가 낀 주는 완료가 0 이고, 그대로 내면 표가 '진행중' 몇 줄로 끝나 지난
   * 성과가 어느 보고서에도 안 남습니다. 그래서 직전 주의 처리분까지 담되, 담았다는
   * 사실과 까닭을 요약 띠에 적습니다 — 안 적으면 두 주치가 금주 실적으로 읽힙니다.
   */
  widened: { from: string; range: string; reason: string | null } | null

  summary: { done: number; started: number; ing: number; late: number; added: number }

  /**
   * 표 장(章)들. 지금 설정(`build.ts`)은 **한 장**이고, 넘치면 같은 프로젝트·같은
   * 상태끼리 묶어 한 장에 맞춥니다 (`foldGroups`). 장 수 상한을 올리면 묶고도
   * 남은 행을 이어지는 장에 그리고, 뒷장 머리행에 `continued` 가 섭니다.
   */
  pages: WeeklyGroup[][]
  /** 3·4장을 어디에 그리는지. `spill` 이면 별도 장입니다 */
  layout: WeeklyLayout

  /** 2장 — 티켓 대시보드의 그 주 접수 현황 */
  ops: OpsSummary
  /** 2장째 슬라이드 — 프로젝트별 마일스톤 레일 */
  rails: ProjectRail[]
  /** 3장 — 일정 변경 · 정체 · 지연 */
  changes: { label: string; body: string }[]
  plans: string[]
  footnotes: string[]
}

// ---------------------------------------------------------------------------
// diff (기획서 6.4)
// ---------------------------------------------------------------------------

export interface WorkDiff {
  added: Set<string>
  done: Set<string>
  started: Set<string>
  dueChangedFrom: Map<string, string>
  dueFixed: Set<string>
}

export function emptyDiff(): WorkDiff {
  return {
    added: new Set(),
    done: new Set(),
    started: new Set(),
    dueChangedFrom: new Map(),
    dueFixed: new Set(),
  }
}

/**
 * 지난주 스냅샷과 이번주 스냅샷을 `work.id` 로 대조합니다.
 *
 * `before` 가 null 이면 **빈 diff** 를 돌려줍니다. 전부 신규로 잡는 것과 다릅니다 —
 * 모르는 것과 새로 생긴 것은 다른 사실입니다.
 */
export function diffWork(before: DeskState | null, after: DeskState): WorkDiff {
  const d = emptyDiff()
  if (!before) return d

  const prev = new Map(before.work.map((w) => [w.id, w]))

  for (const w of after.work) {
    const p = prev.get(w.id)
    if (!p) {
      d.added.add(w.id)
      continue
    }
    if (p.status !== 'done' && w.status === 'done') d.done.add(w.id)
    if (p.status === 'todo' && w.status === 'ing') d.started.add(w.id)
    if (p.due && w.due && p.due !== w.due) d.dueChangedFrom.set(w.id, p.due)
    if (!p.due && w.due) d.dueFixed.add(w.id)
  }
  return d
}

/**
 * 정체 — **3주 연속 `ing` 이면서 변화가 하나도 없는** 업무 (기획서 6.4).
 *
 * 스냅샷이 3개 미만이면 판정하지 않습니다. 2주치로 '정체' 라고 적으면 이번 주에
 * 착수한 업무가 다음 주에 정체로 뜹니다.
 */
export function stalled(history: DeskState[], current: DeskState): string[] {
  if (history.length < 2) return []

  const recent = history.slice(-2)
  return current.work
    .filter((w) => w.status === 'ing')
    .filter((w) =>
      recent.every((snap) => {
        const p = snap.work.find((x) => x.id === w.id)
        return p !== undefined && p.status === 'ing' && p.due === w.due && p.completedOn === w.completedOn
      }),
    )
    .map((w) => `${w.title}${w.owner ? ` (${w.owner})` : ''}`)
}

// ---------------------------------------------------------------------------
// 행 만들기
// ---------------------------------------------------------------------------

const CHIP_ORDER: Record<WeeklyChip, number> = { late: 0, done: 1, started: 2, new: 3, ing: 4 }

/**
 * 지연 기준일.
 *
 * 주 마지막 날을 그냥 쓰면 **아직 오지 않은 마감이 지연으로 뜹니다** — 수요일에
 * 만든 보고서에서 금요일 마감 건이 빨갛게 나옵니다. 우리가 아는 것은 스냅샷
 * 시점까지이므로 그날과 주말 중 **이른 쪽**을 씁니다. 지난 주차를 뒤늦게
 * 뽑을 때는 주말이 이르므로 그 주 기준으로 판정됩니다.
 */
export function lateAsOf(week: Week, reportedOn: string): string {
  return reportedOn < week.to ? reportedOn : week.to
}

function chipOf(w: DeskWork, d: WorkDiff, asOf: string): WeeklyChip {
  if (w.status === 'done') return 'done'
  if (w.due && w.due < asOf) return 'late'
  if (d.started.has(w.id)) return 'started'
  if (d.added.has(w.id)) return 'new'
  return 'ing'
}

/**
 * 일정 칸. 금주에 바뀐 마감일만 `7/13 → 8/6` 로 폅니다.
 *
 * 월간 보고서는 '이전 스냅샷 아무거나' 와 비교하지만 주간은 **지난주와만** 비교합니다.
 * 지지난주에 바뀐 일정을 이번 주 변경으로 적으면 같은 변경이 매주 올라옵니다.
 */
function scheduleOf(w: DeskWork, changedFrom: string | null): string {
  // 끝난 일은 **언제 끝났는가**가 일정입니다 — desk 의 Weekly Report 도 `9/18 완료`
  // 로 적습니다. 마감일을 적으면 직전 주 처리분을 담았을 때 언제 한 일인지 안 보입니다.
  if (w.status === 'done' && w.completedOn) return `${shortDate(w.completedOn)} 완료`
  const now = shortDate(w.due)
  if (!now) return '(계획)'
  const before = shortDate(changedFrom)
  return before ? `${before} → ${now}` : now
}

/**
 * 그 주의 보고 대상.
 *
 * - 그 주에 완료된 것
 * - 진행 중인 것
 * - 마감일이 지난 미완료(지연)
 * - **그 주에 새로 생긴 것** — 아직 `todo` 라도 넣습니다. 이번 주의 변화입니다
 *
 * 손도 안 댄 `todo` 는 빠집니다. 주간보고는 그 주에 무슨 일이 있었는지를 적는
 * 문서이지 백로그 목록이 아닙니다 (전수는 `npm run list` 가 냅니다).
 *
 * **'금주 완료' 의 근거는 `completedOn` 이 아니라 스냅샷 사이의 전이입니다**
 * (기획서 6.4). desk 의 완료일은 사람이 적는 값이라 비어 있거나 과거로 적히는
 * 일이 있고, 그것을 기준으로 삼으면 **이번 주에 실제로 끝난 일이 어느 주간
 * 보고서에도 안 나옵니다.** 실측 38건 중에도 `done` 인데 완료일이 빈 건이 있습니다.
 * 비교 대상이 없는 첫 주차에만 완료일로 판정합니다 — 그때는 전이를 볼 수 없습니다.
 */
function pick(state: DeskState, d: WorkDiff, week: Week, asOf: string, hasBaseline: boolean): DeskWork[] {
  return state.work.filter((w) => {
    // 보류는 파이프라인의 단계가 아니라 옆길입니다. 표에서 빼고 3장으로 올립니다
    // (`heldRows`). 진행중에 섞으면 멈춰 있는 일이 '일하고 있는 것' 으로 읽힙니다.
    if (w.status === 'hold') return false
    if (d.added.has(w.id)) return true
    if (w.status === 'done') {
      return hasBaseline ? d.done.has(w.id) : inWeek(w.completedOn, week)
    }
    if (w.status === 'ing') return true
    return Boolean(w.due && w.due < asOf)
  })
}

/**
 * 진행 내용 칸의 글.
 *
 * desk 는 업무별 메모를 거의 안 씁니다 — 2026-08-31 실측 66건 중 `detail.notes`
 * 가 채워진 것은 8건, `assessment` 는 **0건**이었습니다. 그 둘만 읽는 동안 이
 * 칸은 거의 빈 채로 나갔습니다.
 *
 * desk 자신의 `Weekly Report` 화면은 같은 자리에 `detail.analysis`(3건)와
 * **프로젝트의 현재 상황**(`projects[].current`, 41건)을 끌어다 씁니다. 같은
 * 순서로 떨어지게 해 두 문서의 문구를 맞춥니다 (8건 → 49건).
 *
 * 순서는 **좁은 것부터**입니다. 업무에 적힌 글이 있으면 그게 그 업무의 사실이고,
 * 프로젝트 상황은 같은 프로젝트의 여러 업무에 똑같이 붙으므로 맨 뒤입니다.
 * 업무의 글 중에서는 **날짜가 붙은 진행 기록(`latestLog`)이 맨 앞**입니다 — 메모는
 * 몇 주째 같은 설명이고 기록은 그 시점의 상황입니다. 태스크 맵의 '주요 진행 내용'
 * (`assessment` 로 들어옵니다)은 화면 안내대로 desk 에 기록이 없을 때의 대체입니다.
 *
 * 여기서는 줄이지 않습니다. 칸 폭에 맞추는 것은 `buildWeekly` 가 묶음 정리
 * (`dedupeBorrowed`) 뒤에 합니다 — 먼저 줄이면 빌려 온 문구를 알아보지 못합니다.
 * 넷 다 없으면 **빈칸으로 둡니다** — 없는 글을 지어내지 않습니다 (공란의 뜻은
 * 각주가 밝힙니다).
 */
function detailText(w: DeskWork, project: DeskProject | undefined, asOf: string): string {
  const own =
    latestLog(w, asOf) ||
    (w.detail?.notes ?? '').trim() ||
    (w.assessment ?? '').trim() ||
    (w.detail?.analysis ?? '').trim()
  return own || (project?.current ?? '').trim()
}

/**
 * 업무의 **가장 최근 진행 기록** (`work.log`). 없으면 빈 문자열.
 *
 * 진행사항 칸의 맨 앞 자리입니다. 메모(`detail.notes`)는 업무를 만들 때 적는
 * 설명이라 몇 주째 같은 글이고, 진행 기록은 날짜가 붙은 **그 시점의 상황**입니다
 * — 2026-09-28 실측에서 '카보너스 통합 안정화' 의 메모는 8월부터 같은 문장이었고
 * 9/21 기록은 `코드리뷰 진행 중` 이었습니다. 현재 진행 상태를 싣는 칸이므로
 * 날짜가 있는 쪽이 이깁니다.
 *
 * `asOf` 보다 뒤 날짜는 건너뜁니다 — 스냅샷 시점에 아직 없던 일로 칩니다.
 * 같은 날짜가 여럿이면 뒤에 적힌 것이 최신입니다 (desk 는 덧붙여 씁니다).
 * 형식이 다른 항목은 조용히 건너뜁니다 — 필드가 문서화돼 있지 않습니다.
 */
export function latestLog(w: DeskWork, asOf: string): string {
  return latestLogEntry(w, asOf)?.body ?? ''
}

function latestLogEntry(w: DeskWork, asOf: string): { at: string; body: string } | null {
  let best: { at: string; body: string } | null = null
  for (const e of w.log ?? []) {
    if (!e || typeof e !== 'object') continue
    const { at, body } = e as { at?: unknown; body?: unknown }
    if (typeof body !== 'string' || !body.trim()) continue
    const day = typeof at === 'string' ? at.slice(0, 10) : ''
    if (day > asOf) continue
    if (!best || day >= best.at) best = { at: day, body: body.trim() }
  }
  return best
}

/** 통합 항목이면 '구성 2/3' 을 앞에 답니다 — 진척율이 무엇을 센 값인지 밝힙니다 */
function withMergedLabel(w: DeskWork, project: DeskProject | undefined, asOf: string): string {
  const text = detailText(w, project, asOf)
  const label = mergedLabel(w)
  if (!label) return text
  return text ? `${label} · ${text}` : label
}

/** 진행사항이 진행 기록에서 왔으면 그 날짜. 묶음 행이 최신 기록을 앞에 세울 때 씁니다 */
function detailDate(w: DeskWork, asOf: string): string | null {
  return latestLogEntry(w, asOf)?.at || null
}

function toRow(
  w: DeskWork,
  d: WorkDiff,
  asOf: string,
  project: DeskProject | undefined,
): WeeklyRow {
  const changedFrom = d.dueChangedFrom.get(w.id) ?? null
  const chip = chipOf(w, d, asOf)
  return {
    id: w.id,
    title: w.title,
    owner: (w.owner ?? '').trim() || '—',
    detail: withMergedLabel(w, project, asOf),
    detailAt: detailDate(w, asOf),
    chip,
    progress: rowProgress(w, chip === 'done'),
    schedule: scheduleOf(w, changedFrom),
    date: w.status === 'done' ? (w.completedOn ?? w.due) : w.due,
    due: w.due,
    dueChangedFrom: changedFrom,
  }
}

function sortRows(a: WeeklyRow, b: WeeklyRow): number {
  const c = CHIP_ORDER[a.chip] - CHIP_ORDER[b.chip]
  if (c !== 0) return c
  return a.owner.localeCompare(b.owner, 'ko') || a.title.localeCompare(b.title, 'ko')
}

/**
 * 프로젝트에서 빌려 온 문구는 **묶음의 첫 행에만 남깁니다.**
 *
 * `projects[].current` 는 그 프로젝트의 **모든** 업무에 똑같이 붙습니다. 그대로
 * 두면 같은 문장이 한 묶음에서 여러 줄 반복되는데 — 실측에서 표에 보이는 10행 중
 * 8행이 "기획 및 개발 동시진행 진행 중" 하나였습니다 — 그건 정보가 아니라
 * 소음이고, 행마다 다른 사실이 적혀 있으리라는 표의 약속을 깹니다.
 *
 * 한 번은 남깁니다. 그 프로젝트가 지금 어디쯤인지는 보고서에 있어야 합니다.
 * 업무 자신의 글(`detail.notes` 등)은 그 업무의 사실이므로 건드리지 않습니다.
 * 통합 항목의 '구성 2/3' 딱지도 그대로 둡니다 — 진척율이 무엇을 센 값인지는
 * 행마다 필요합니다.
 */
function dedupeBorrowed(rows: WeeklyRow[], project: DeskProject | undefined): WeeklyRow[] {
  const borrowed = (project?.current ?? '').trim()
  if (!borrowed) return rows
  let kept = false
  return rows.map((r) => {
    if (!r.detail.endsWith(borrowed)) return r
    if (!kept) {
      kept = true
      return r
    }
    return { ...r, detail: r.detail.slice(0, -borrowed.length).replace(/ · $/, '') }
  })
}

/**
 * 프로젝트 → 하위 태스크로 묶습니다.
 *
 * **프로젝트가 없는 업무는 묶지 않습니다.** 하나로 뭉쳐 '미지정' 이라는 가짜
 * 프로젝트를 만들면 그 안에서 서로 상관없는 일이 한 덩어리로 읽힙니다. 대신
 * `standalone` 묶음 하나에 담아 렌더러가 **머리행 없이 한 건씩** 세웁니다.
 *
 * desk 의 `work.parent` 는 실측 38건 전부 비어 있어 3단계(프로젝트 > 상위 >
 * 하위)는 만들 수 없습니다. 지금 계층은 프로젝트 → 업무 두 단입니다.
 */
export function groupWork(
  state: DeskState,
  d: WorkDiff,
  week: Week,
  asOf: string,
  hasBaseline = false,
): WeeklyGroup[] {
  const projects = new Map<string, DeskProject>(state.projects.map((p) => [p.key, p]))
  const picked = pick(state, d, week, asOf, hasBaseline)

  const buckets = new Map<string, DeskWork[]>()
  const loose: DeskWork[] = []
  for (const w of picked) {
    if (w.project && projects.has(w.project)) {
      const list = buckets.get(w.project)
      if (list) list.push(w)
      else buckets.set(w.project, [w])
    } else {
      loose.push(w)
    }
  }

  const make = (key: string, title: string, works: DeskWork[], standalone: boolean): WeeklyGroup => {
    const project = projects.get(key)
    const ms = project?.milestones ?? null
    const rows = dedupeBorrowed(
      works.map((w) => toRow(w, d, asOf, projects.get(w.project ?? ''))).sort(sortRows),
      project,
    )
    return {
      key,
      title,
      standalone,
      continued: false,
      owners: [...new Set(rows.map((r) => r.owner))],
      counts: {
        done: rows.filter((r) => r.chip === 'done').length,
        started: rows.filter((r) => r.chip === 'started').length,
        ing: rows.filter((r) => r.chip === 'ing').length,
        late: rows.filter((r) => r.chip === 'late').length,
        added: rows.filter((r) => r.chip === 'new').length,
      },
      milestones:
        !standalone && ms && ms.length > 0
          ? { done: ms.filter((m) => m.done).length, total: ms.length }
          : null,
      progress: standalone ? null : projectProgress(project),
      rows,
    }
  }

  const groups = [...buckets.entries()]
    .map(([key, works]) => make(key, projects.get(key)?.title ?? key, works, false))
    .sort((a, b) => {
      if (a.counts.late !== b.counts.late) return b.counts.late - a.counts.late
      if (a.rows.length !== b.rows.length) return b.rows.length - a.rows.length
      return a.title.localeCompare(b.title, 'ko')
    })

  if (loose.length > 0) groups.push(make(STANDALONE_TITLE, STANDALONE_TITLE, loose, true))
  return groups
}

// ---------------------------------------------------------------------------
// 모델 조립
// ---------------------------------------------------------------------------

/**
 * 보류 중인 업무 — 3장 이슈 절에 올립니다.
 *
 * **표에서 빼되 보고서에서 지우지는 않습니다.** 멈춰 있다는 사실 자체가
 * 이슈이고, 조용히 빼면 그 일이 애초에 없었던 것처럼 보입니다.
 * desk 에 보류 사유 필드가 없어 담당자와 소속만 적습니다.
 */
export function heldItems(state: DeskState): { label: string; body: string }[] {
  const projects = new Map(state.projects.map((p) => [p.key, p.title]))
  return state.work
    .filter((w) => w.status === 'hold')
    .map((w) => ({
      label: w.title,
      body: [
        '보류',
        (w.owner ?? '').trim() || null,
        w.project ? projects.get(w.project) : null,
        (w.detail?.notes ?? w.assessment ?? '').trim() || null,
      ]
        .filter(Boolean)
        .join(' · '),
    }))
}

/**
 * 차주 계획 — **아직 살아 있는 미완료**. 지어내지 않고 desk 의 일정만 옮깁니다.
 *
 * 한때 '다음 주가 마감인 미완료' 만 뽑았습니다. 그러면 **마감이 이미 지난
 * 미완료가 계획에서 빠집니다** — 2026-08-31 실측에서 미완료 28건(보류 제외) 중
 * 뽑힌 것이 8건이었고, 빠진 것 중 8건이 마감을 넘긴 건이었습니다. 차주에 제일
 * 먼저 해야 할 일이 차주 계획에 없는 셈입니다. 그래서 **지연분을 앞에 세웁니다.**
 *
 * 보고 시점(월요일)과 desk 갱신 시점(금요일)이 어긋나는 것은 이 보고서에서
 * 중요하지 않습니다. 중요한 것은 **업무가 지금 어디까지 왔는가**이고, 그래서
 * 구간이 아니라 `asOf`(우리가 아는 마지막 시점) 하나로 지연을 가릅니다.
 *
 * **마감이 없는 미완료는 넣지 않습니다** (실측 10건). 언제 할지 정해지지 않은
 * 일을 차주에 하겠다고 적을 근거가 없고, 그것은 표의 진행중 행으로 이미 보입니다.
 *
 * **보류도 뺍니다.** 남을 기다리는 상태이지 우리가 할 일이 아니고, 이미 3장
 * 이슈로 올라가 있습니다 (`heldItems`). 계획에 적으면 하겠다는 약속이 됩니다.
 *
 * **아직 마감이 안 온 금주 마감분도 넣습니다.** 한때 '차주 구간' 마감만 봤는데,
 * 스냅샷이 구간 중간에 떠 있으면 `asOf` 와 차주 시작 사이가 통째로 빠졌습니다 —
 * 2026-09-28 에 9/21 스냅샷으로 만든 보고서가 9/22~9/25 마감 9건을 두고
 * '차주 마감인 업무 없음' 이라고 적었습니다. 그 사이의 일은 지연도 차주도 아닌
 * 채로 사라집니다. 이제 '지연이 아닌 쪽' 은 `asOf` 부터 차주 끝까지입니다.
 *
 * `max` 로 자르는 것은 지면 사정이고, **몇 건 중 몇 건인지는 부르는 쪽이 알아야**
 * 각주에 적을 수 있습니다. 그래서 자른 목록과 전체 건수를 같이 돌려줍니다.
 */
export function selectPlans(
  state: DeskState,
  next: Week,
  asOf: string,
  max: number,
): { items: string[]; total: number } {
  const byDue = (a: DeskWork, b: DeskWork) => (a.due ?? '').localeCompare(b.due ?? '')
  const open = state.work.filter(
    (w) => w.status !== 'done' && w.status !== 'hold' && Boolean(w.due),
  )
  // 경계가 `asOf` 하나라 두 목록은 겹치지도 비지도 않습니다.
  const late = open.filter((w) => (w.due as string) < asOf).sort(byDue)
  const upcoming = open.filter((w) => (w.due as string) >= asOf && (w.due as string) <= next.to).sort(byDue)

  const line = (w: DeskWork, overdue: boolean) =>
    `${w.title} (${shortDate(w.due)}${overdue ? ' 지연' : ''}${w.owner ? ` · ${w.owner}` : ''})`

  const lateLines = late.map((w) => line(w, true))
  const upcomingLines = upcoming.map((w) => line(w, false))
  return {
    items: splitBudget(lateLines, upcomingLines, max),
    total: lateLines.length + upcomingLines.length,
  }
}

/**
 * 차주 계획의 지면을 **지연분과 차주 마감분에 반씩 나눕니다.**
 *
 * 지연 우선으로만 자르면 자리가 넉넉하지 않을 때 전부 지연으로 찹니다 —
 * 2026-08-31 실측에서 후보 13건 중 지연이 8건이라 `PLANS.max` 4줄이 **네 줄 다
 * 지연**이었습니다. '차주 계획' 이라는 제목 아래 밀린 일만 남고 정작 차주에
 * 마감인 일이 한 줄도 안 실립니다.
 *
 * **한쪽이 모자라면 남은 자리는 다른 쪽이 채웁니다** — 자리를 비워 두지
 * 않습니다. 자리가 홀수면 지연 쪽이 한 줄 더 가집니다 (더 급한 쪽입니다).
 *
 * 순서는 나눈 뒤에도 지연이 먼저입니다.
 */
function splitBudget(late: string[], upcoming: string[], max: number): string[] {
  if (!Number.isFinite(max)) return [...late, ...upcoming]
  const half = Math.ceil(max / 2)
  const lateN = Math.min(late.length, Math.max(half, max - upcoming.length))
  const upcomingN = Math.min(upcoming.length, max - lateN)
  return [...late.slice(0, lateN), ...upcoming.slice(0, upcomingN)]
}

export interface WeeklyOptions {
  week: Week
  nextWeek: Week
  /** 보고서를 만든 날 (머리글). 없으면 `snapshotDay` */
  reportedOn: string
  /**
   * 스냅샷을 뜬 날 — **지연 판정의 기준**입니다. 없으면 `reportedOn`.
   *
   * 둘을 나눈 이유: 보고일에 스냅샷 날짜를 적었더니 9/28 에 만든 보고서가
   * `보고일 2026-09-21` 로 나갔습니다. 반대로 지연을 보고일로 재면 스냅샷 뒤에
   * 끝났을지 모르는 일을 늦었다고 적게 됩니다.
   */
  snapshotDay?: string
  /** 비교 기준을 앞당겼으면 그 사실 (`WeeklyModel.widened`) */
  widened?: WeeklyModel['widened']
  subtitle: string
  /** 비교에 쓴 지난주 스냅샷 날짜. 없으면 null (기준 주차) */
  baseline: string | null
  /** 정체 판정용 과거 스냅샷들 (오래된 것부터). 2개 미만이면 정체를 안 냅니다 */
  history?: DeskState[]
  /** 표 배치. 넘치면 묶고(`fold`), 설정에 따라 3·4장을 줄이거나 내려보내고, 그래도 넘치면 자릅니다 */
  table: WeeklyTableOptions
  /** 그 주 운영 현황의 원천. 대시보드를 못 읽었으면 빈 배열 */
  tickets: ReportTicket[]
}

/** 마감일 짧은 꼴. 없으면 `(계획)` — 일정 칸과 같은 말을 씁니다 */
function dueOf(r: WeeklyRow): string {
  return shortDate(r.due) ?? '(계획)'
}

/** 진행사항을 칸에 맞게 줄입니다 (`clamp.briefText`). 안건 이름은 떼어 냅니다 */
function briefRow(r: WeeklyRow, col: ColumnFit): WeeklyRow {
  return r.detail ? { ...r, detail: briefText(r.detail, r.title, col.w, col.sz, col.lines) } : r
}

export function buildWeekly(
  before: DeskState | null,
  state: DeskState,
  opt: WeeklyOptions,
): WeeklyModel {
  const asOf = lateAsOf(opt.week, opt.snapshotDay ?? opt.reportedOn)
  const d = diffWork(before, state)
  const grouped = groupWork(state, d, opt.week, asOf, opt.baseline !== null)
  // 진행사항은 칸 폭을 알아야 줄일 수 있습니다. 칸 폭을 모르면(테스트 등) 원문 그대로
  const cols = opt.table.cols
  const all = cols ? grouped.map((g) => ({ ...g, rows: g.rows.map((r) => briefRow(r, cols.detail)) })) : grouped

  const totalRows = all.reduce((n, g) => n + g.rows.length, 0)
  const flat = all.flatMap((g) => g.rows)
  const summary = {
    done: flat.filter((r) => r.chip === 'done').length,
    started: flat.filter((r) => r.chip === 'started').length,
    ing: flat.filter((r) => r.chip === 'ing').length,
    late: flat.filter((r) => r.chip === 'late').length,
    added: flat.filter((r) => r.chip === 'new').length,
  }

  const ops = summarizeOps(opt.tickets, opt.week)

  // 3장 — 일정 변경이 먼저, 그다음 정체, 남으면 지연.
  // 일정 변경은 **이번 주에 실제로 움직인 사실**이고 정체·지연은 안 움직인 사실입니다.
  const changes: { label: string; body: string }[] = []
  for (const r of flat) {
    // 일정 칸은 완료 건이면 완료일을 적으므로 여기서는 마감일 두 개로 다시 씁니다
    if (r.dueChangedFrom) {
      changes.push({ label: r.title, body: `일정 ${shortDate(r.dueChangedFrom)} → ${dueOf(r)} · ${r.owner}` })
    }
  }
  // 보류는 일정 변경 다음입니다 — 둘 다 '이번 주에 알아야 할 상태' 이고,
  // 정체·지연보다 먼저 사유를 확인해야 하는 쪽입니다.
  changes.push(...heldItems(state))
  for (const s of stalled(opt.history ?? [], state)) {
    changes.push({ label: s, body: '3주 연속 변화 없음 — 확인 필요' })
  }
  for (const r of flat.filter((x) => x.chip === 'late')) {
    changes.push({ label: r.title, body: `마감 ${r.schedule} 경과 · ${r.owner}` })
  }

  const allChanges = changes.length
  const allPlans = selectPlans(state, opt.nextWeek, asOf, Number.POSITIVE_INFINITY)

  // **자리는 여기서 정해집니다.** 3·4장에 실을 것이 몇 건인지 알아야 "압축하면
  // 이슈가 지워지는가" 를 볼 수 있고, 지워진다면 압축 대신 다음 장으로 내립니다.
  const fitted = fitTable(all, opt.table, { changes: allChanges, plans: allPlans.total })
  // **줄바꿈 자리를 여기서 정합니다.** 뷰어마다 한글을 접는 방식이 달라서 —
  // PowerPoint 는 어절, Keynote 는 글자 단위 — 같은 글이 `미등록 시 본인인증 불 / 가…`
  // 처럼 단어 중간에서 끊겼습니다. 어림으로 잰 줄을 그대로 박아 두면 어느 뷰어에서든
  // 같은 두 줄입니다. 어림이 넉넉하므로 박아 둔 한 줄이 다시 접히지 않습니다.
  if (cols) {
    fitted.pages = fitted.pages.map((page) =>
      page.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, detail: wrapLines(r.detail, cols.detail.w, cols.detail.sz).join('\n') })) })),
    )
  }
  const shown = fitted.pages.reduce(
    (n, page) => n + page.reduce((k, g) => k + g.rows.reduce((j, r) => j + (r.members ?? 1), 0), 0),
    0,
  )
  // **여기서 `slice` 하지 않습니다.** 자리를 지연/차주에 나누는 것은 `selectPlans`
  // 안에서 벌어지는 일이라, 몫을 모르는 채 앞에서부터 자르면 그 배분이 통째로
  // 무의미해집니다 (자리가 넉넉할 때 앞이 전부 지연이기 때문입니다). 자리를
  // 알게 된 지금 다시 부릅니다 — 순수 함수라 값이 같습니다.
  const plans = {
    items: selectPlans(state, opt.nextWeek, asOf, fitted.maxPlans).items,
    total: allPlans.total,
  }
  // 마일스톤이 없는 프로젝트는 레일에 그릴 것이 없어 빠집니다. 몇 개인지 적습니다.
  const railless = state.projects.length - projectRails(state).length
  const held = heldItems(state).length
  const footnotes: string[] = []
  if (held > 0) footnotes.push(`보류 ${held}건은 표에서 빼고 3장에 실었습니다`)
  if (railless > 0) footnotes.push(`마일스톤 없는 프로젝트 ${railless}개는 진행 장에서 제외`)
  if (!opt.baseline) {
    footnotes.push('기준 주차 — 지난주 스냅샷이 없어 변화분(완료·착수·신규·일정변경)을 산출하지 않았습니다')
  }
  if (fitted.folded > 0) {
    footnotes.push(`지면에 맞추려고 같은 프로젝트·같은 상태 ${fitted.folded}묶음을 한 행으로 합쳤습니다`)
  }
  if (fitted.hidden > 0) {
    footnotes.push(`행 ${fitted.hidden}건은 프로젝트 머리행의 건수로만 표기 (진행·신규 우선 생략)`)
  }
  if (shown + fitted.hidden < totalRows) {
    // 묶고 줄여도 모자라 행을 잘라 낸 경우에만 나옵니다
    footnotes.push(`업무 ${totalRows}건 중 ${shown + fitted.hidden}건 표기`)
  } else if (fitted.pages.length > 1) {
    footnotes.push(`업무 ${totalRows}건을 표 ${fitted.pages.length}장에 나눠 실었습니다`)
  }
  if ((opt.history ?? []).length < 2) {
    footnotes.push('정체(3주 연속 무변화)는 스냅샷 3주치가 쌓여야 판정합니다')
  }
  if (allChanges > fitted.maxChanges) {
    footnotes.push(`변화·지연 ${allChanges}건 중 ${fitted.maxChanges}건 표기`)
  }
  if (plans.total > plans.items.length) {
    footnotes.push(`차주 계획 ${plans.total}건 중 ${plans.items.length}건 표기`)
  }
  if (flat.some((r) => !r.detail)) {
    footnotes.push('진행내용 공란 = desk 에 기록이 없거나, 같은 묶음의 위 행과 같은 내용')
  }

  return {
    period: {
      label: opt.week.id,
      from: opt.week.from,
      to: opt.week.to,
      range: rangeLabel(opt.week),
    },
    reportedOn: opt.reportedOn,
    asOf,
    subtitle: opt.subtitle,
    deskUpdatedAt: shortDate(state.updatedAt),
    baseline: opt.baseline,
    widened: opt.widened ?? null,
    summary,
    pages: fitted.pages,
    layout: fitted.mode,
    ops,
    rails: projectRails(state),
    changes: changes.slice(0, fitted.maxChanges),
    plans: plans.items,
    footnotes,
  }
}

/**
 * 표 배치 — **행을 자르는 대신 자리를 만듭니다.**
 *
 * 예전에는 `TABLE.bottom` 하나만 예산으로 두고 넘치면 뒤쪽 행을 버렸습니다.
 * 그래서 8건짜리 주에도 "8건 중 7건 표기" 라는 각주가 붙었습니다 — 진행 현황은
 * 이 보고서의 본문이라 거기서 줄이면 보고서가 제 일을 못 합니다.
 *
 * 그래서 `layouts` 를 앞에서부터 시도합니다 (base → compact → spill). 앞의 것이
 * 안 들어가면 3·4장을 압축하고, 그래도 안 되면 3·4장을 다음 장으로 내려 왼쪽 단을
 * 통째로 표에 줍니다. 그러고도 남으면 **표를 이어지는 장에 계속 그립니다.**
 *
 * 3·4장의 줄 수(`maxChanges`·`maxPlans`)가 배치마다 다른 것은 자리가 달라지기
 * 때문입니다. 전용 장으로 내려가면 오히려 **늘어납니다** (이슈 3→9).
 *
 * **지금 설정은 한 장(base 하나, `maxPages: 1`)이고 `fold` 가 켜져 있습니다.**
 * 원래 모양으로 안 들어가면 배치를 바꾸기 전에 같은 프로젝트·같은 상태끼리
 * 묶고(`foldGroups`), 그래도 안 들어갈 때만 행을 자릅니다. 배치를 바꾸는 것은
 * 서식 변경이고 묶는 것은 내용 정리라서, 묶기가 먼저입니다.
 */
export type WeeklyLayout = 'base' | 'compact' | 'spill'

/** 글을 줄일 칸 — 폭(인치)·글자 크기(pt)·줄 수 */
export interface ColumnFit {
  w: number
  sz: number
  lines: number
}

export interface WeeklyTableOptions {
  /** 앞에서부터 시도합니다. 마지막이 `spill` 이어야 합니다 (더 물러설 곳이 없는 배치) */
  layouts: { mode: WeeklyLayout; budget: number; maxChanges: number; maxPlans: number }[]
  /**
   * 넘치면 행을 자르기 전에 **같은 프로젝트·같은 상태끼리 묶습니다** (`foldGroups`).
   * 끄면 예전처럼 자르기만 합니다.
   */
  fold?: boolean
  /** 안건·진행사항 칸. 묶음 행의 이름 목록과 진행사항 글을 이 폭에 맞춥니다 */
  cols?: { title: ColumnFit; detail: ColumnFit }
  /** 이어지는 장의 표 예산. 머리말·요약 띠가 없어 1장보다 넉넉합니다 */
  contBudget: number
  headerH: number
  ruleH: number
  rowH: number
  /** 이어지는 장의 상한. 여기 걸려서 못 실은 행은 각주에 셉니다 */
  maxPages: number
}

export interface FittedTable {
  mode: WeeklyLayout
  pages: WeeklyGroup[][]
  maxChanges: number
  maxPlans: number
  /** 한 행으로 합친 묶음 수 */
  folded: number
  /** 행 없이 머리행 건수로만 남긴 업무 수 */
  hidden: number
}

const EPS = 1e-9

/** 묶음 하나가 먹는 높이 — 머리행(또는 구분선) + 업무 행 */
function groupHeight(g: WeeklyGroup, box: { headerH: number; ruleH: number; rowH: number }): number {
  return (g.standalone ? box.ruleH : box.headerH) + g.rows.length * box.rowH
}

/** 전부 그리는 데 필요한 높이(인치). **행 수가 아니라 인치입니다** — 머리행 높이가 다릅니다 */
export function tableHeight(
  groups: WeeklyGroup[],
  box: { headerH: number; ruleH: number; rowH: number },
): number {
  return groups.reduce((h, g) => h + groupHeight(g, box), 0)
}

/**
 * 3·4장에 실어야 할 건수. **압축이 이것을 지우는지** 판정하는 데 씁니다.
 */
export interface SectionDemand {
  changes: number
  plans: number
}

export function fitTable(
  groups: WeeklyGroup[],
  opt: WeeklyTableOptions,
  demand: SectionDemand = { changes: 0, plans: 0 },
): FittedTable {
  const need = tableHeight(groups, opt)
  const layouts = opt.layouts
  /**
   * 원래 자리(`base`)는 예산만 봅니다 — 3·4장이 원래 자리에서 넘치는 것은
   * 표와 상관없는 일이고, 그것 때문에 보고서 구성을 바꾸지는 않습니다.
   *
   * 반면 **압축은 표 때문에 3·4장을 줄이는 선택**입니다. 줄여서 실제로 이슈나
   * 계획이 지워진다면 압축하지 않고 다음 장으로 내립니다 — 내려보내면 둘 다
   * 지우지 않고 실을 수 있는데 표 자리 때문에 이슈를 감출 이유가 없습니다.
   */
  const allowed = (l: (typeof layouts)[number]) =>
    l.mode === 'base' || (demand.changes <= l.maxChanges && demand.plans <= l.maxPlans)
  const fits = (l: (typeof layouts)[number]) => need <= l.budget + EPS && allowed(l)
  const unfolded = { folded: 0, hidden: 0 }

  // 원래 모양 그대로 들어가는 자리가 있으면 거기 둡니다
  const plain = layouts.find(fits)
  if (plain) {
    return { mode: plain.mode, pages: [groups], maxChanges: plain.maxChanges, maxPlans: plain.maxPlans, ...unfolded }
  }

  // **묶으면 들어가는 자리**를 앞에서부터 찾습니다. 배치를 바꾸는 것(compact·spill)보다
  // 먼저 묶습니다 — 묶는 것은 내용 정리이고 배치를 바꾸는 것은 서식 변경입니다.
  let folded: FoldResult | null = null
  if (opt.fold) {
    for (const l of layouts.filter(allowed)) {
      const f = foldGroups(groups, l.budget, opt)
      if (tableHeight(f.groups, opt) <= l.budget + EPS) {
        return { mode: l.mode, pages: [f.groups], maxChanges: l.maxChanges, maxPlans: l.maxPlans, folded: f.folded, hidden: f.hidden }
      }
      folded = f
    }
  }

  const chosen = layouts[layouts.length - 1]!
  // 묶어도 안 들어가면 **묶은 것을** 자릅니다 — 덜 잃습니다
  const rest = folded ? folded.groups : groups
  return {
    mode: chosen.mode,
    folded: folded?.folded ?? 0,
    hidden: folded?.hidden ?? 0,
    pages: paginateGroups(rest, {
      first: chosen.budget,
      cont: opt.contBudget,
      headerH: opt.headerH,
      ruleH: opt.ruleH,
      rowH: opt.rowH,
      maxPages: opt.maxPages,
    }),
    maxChanges: chosen.maxChanges,
    maxPlans: chosen.maxPlans,
  }
}

export interface PageBox {
  /** 1장의 표 예산 */
  first: number
  /** 이어지는 장의 표 예산 */
  cont: number
  headerH: number
  ruleH: number
  rowH: number
  maxPages: number
}

/**
 * 장을 나눕니다.
 *
 * **묶음이 잘리면 뒷장에 머리행을 다시 세웁니다** (`continued`). 머리행 없이
 * 행만 이어 붙이면 그 행들이 어느 프로젝트의 것인지 뒷장만 본 사람은 알 수
 * 없습니다. 머리행이 한 번 더 자리를 먹지만, 자리보다 뜻이 먼저입니다.
 *
 * 머리행만 놓이고 행이 하나도 안 들어가는 장 끝은 만들지 않습니다 — 그 머리행은
 * 다음 장으로 통째로 넘어갑니다.
 */
export function paginateGroups(groups: WeeklyGroup[], box: PageBox): WeeklyGroup[][] {
  const pages: WeeklyGroup[][] = []
  let page: WeeklyGroup[] = []
  let used = 0
  let cap = box.first

  const flush = () => {
    pages.push(page)
    page = []
    used = 0
    cap = box.cont
  }

  for (const g of groups) {
    const head = g.standalone ? box.ruleH : box.headerH
    let i = 0
    let first = true

    do {
      if (used + head + box.rowH > cap + EPS && page.length > 0) {
        if (pages.length + 1 >= box.maxPages) return finish(pages, page)
        flush()
      }
      const room = Math.max(0, Math.floor((cap - used - head + EPS) / box.rowH))
      // 예산이 한 줄도 못 받는 장(있을 수 없지만 무한 루프는 막습니다)
      if (room === 0 && g.rows.length > 0) return finish(pages, page)

      const take = Math.min(room, g.rows.length - i)
      page.push({ ...g, rows: g.rows.slice(i, i + take), continued: !first })
      used += head + take * box.rowH
      i += take
      first = false
    } while (i < g.rows.length)
  }

  return finish(pages, page)
}

function finish(pages: WeeklyGroup[][], page: WeeklyGroup[]): WeeklyGroup[][] {
  const all = page.length > 0 ? [...pages, page] : pages
  return all.length > 0 ? all : [[]]
}

// ---------------------------------------------------------------------------
// 묶어서 맞추기
// ---------------------------------------------------------------------------

/**
 * 표가 한 장을 넘칠 때 — **자르기 전에 묶습니다.**
 *
 * 예전에는 넘치면 뒤쪽 묶음을 통째로 버렸습니다. 2026-09-21 주에는 desk 에 등록된
 * 주간 업무 16건 중 10건만 표에 남았고, 버린 6건이 어디에도 안 보였습니다 (각주는
 * 슬라이드에 안 그립니다). 한 장이라는 서식은 지키되 **한 건도 소리 없이 빠지지
 * 않게** 합니다.
 *
 * 단위는 **(프로젝트, 상태)** 입니다. 같은 프로젝트에서 같은 주에 완료된 넷은
 * `재가입 구현, 카카오로 가입하기 구현 외 2건 · 완료 · 9/16~9/20 완료` 한 행이
 * 됩니다. 프로젝트를 넘어 묶지는 않습니다 — 머리행이 그 프로젝트의 진척율을
 * 달고 있어서, 다른 프로젝트의 일이 섞이면 그 숫자와 안 맞습니다.
 *
 * 세 단계입니다.
 *
 * 1. **합치기** — 덜 급한 상태부터(진행 → 신규 → 착수 → 완료 → 지연), 큰 묶음부터
 * 2. **머리행 건수로만** — 그래도 넘치면 행을 빼고 머리행의 `지연 1 · 완료 4 · 진행 2`
 *    로만 남깁니다. **업무 수가 적은 묶음부터** 뺍니다 — 행 하나를 비우는 값은 같고,
 *    이름이 안 보이게 되는 업무는 적을수록 좋습니다. 같으면 덜 급한 상태부터.
 *    지연은 빼지 않습니다. 머리행이 없는 독립 항목(프로젝트 미지정)은 건수가 남을
 *    자리가 없어 빼지 않습니다
 * 3. **되살리기** — 남은 자리에 뺀 묶음을 업무 수가 많은 것부터 되살리고, 그다음
 *    합친 묶음을 중요한 상태부터(지연 → 완료 → …) 다시 폅니다. 1·2 단계는
 *    들어갈 때까지 줄일 뿐이라 덜 줄여도 되는 것이 있습니다
 *
 * 2026-09-28(추석 주) 실측에서 이 순서가 아니면 **그 주에 새로 생긴 세 건**이
 * 머리행 숫자로만 남고 직전 주 완료분이 자리를 가져갔습니다. 지금은 한 건짜리
 * 묶음 셋이 빠지고 나머지는 다 이름이 보입니다.
 *
 * 태스크 맵이 먼저입니다. 사람이 묶은 항목·뺀 항목은 여기 오기 전에 이미
 * 반영돼 있고(`applyTaskMap`), 여기는 그러고도 넘칠 때만 돕니다.
 */
export interface FoldResult {
  groups: WeeklyGroup[]
  /** 한 행으로 합친 묶음 수 */
  folded: number
  /** 행 없이 머리행 건수로만 남긴 업무 수 */
  hidden: number
}

type FoldLevel = 'hidden' | 'folded' | 'rows'

interface Bucket {
  /** 묶음(프로젝트)의 순서. 앞일수록 중요합니다 — `groupWork` 가 지연 많은 순으로 세웠습니다 */
  g: number
  chip: WeeklyChip
  rows: WeeklyRow[]
  level: FoldLevel
}

const FOLD_ORDER: WeeklyChip[] = ['ing', 'new', 'started', 'done', 'late']
const HIDE_ORDER: WeeklyChip[] = ['ing', 'new', 'started', 'done']
/** 되살리는 순서 — 표의 행 순서(`CHIP_ORDER`)와 같습니다 */
const KEEP_ORDER: WeeklyChip[] = ['late', 'done', 'started', 'new', 'ing']

export function foldGroups(
  groups: WeeklyGroup[],
  budget: number,
  box: { headerH: number; ruleH: number; rowH: number; cols?: WeeklyTableOptions['cols'] },
): FoldResult {
  const buckets: Bucket[] = []
  groups.forEach((grp, g) => {
    for (const chip of KEEP_ORDER) {
      const rows = grp.rows.filter((r) => r.chip === chip)
      if (rows.length > 0) buckets.push({ g, chip, rows, level: 'rows' })
    }
  })

  const heads = groups.reduce((h, grp) => h + (grp.standalone ? box.ruleH : box.headerH), 0)
  const size = (b: Bucket) => b.rows.reduce((n, r) => n + (r.members ?? 1), 0)
  const rowsOf = (b: Bucket) => (b.level === 'hidden' ? 0 : b.level === 'folded' ? 1 : b.rows.length)
  const fitsNow = () => heads + buckets.reduce((h, b) => h + rowsOf(b) * box.rowH, 0) <= budget + EPS

  // 1. 합치기 — 덜 급한 상태부터, 큰 묶음부터
  fold: for (const chip of FOLD_ORDER) {
    const cands = buckets
      .filter((b) => b.chip === chip && b.rows.length > 1)
      .sort((a, b) => b.rows.length - a.rows.length || a.g - b.g)
    for (const b of cands) {
      if (fitsNow()) break fold
      b.level = 'folded'
    }
  }

  // 2. 머리행 건수로만 — 업무 수가 적은 묶음부터, 같으면 덜 급한 상태·뒤쪽 프로젝트부터.
  //    지연·독립 항목은 남깁니다
  const hideRank = (b: Bucket) => HIDE_ORDER.indexOf(b.chip)
  const hideable = buckets
    .filter((b) => hideRank(b) >= 0 && !groups[b.g]!.standalone)
    .sort((a, b) => size(a) - size(b) || hideRank(a) - hideRank(b) || b.g - a.g)
  for (const b of hideable) {
    if (fitsNow()) break
    b.level = 'hidden'
  }

  // 3. 되살리기 — 한 칸씩 올려 보고 넘치면 물립니다
  const raise = (b: Bucket, to: FoldLevel) => {
    const was = b.level
    b.level = to
    if (!fitsNow()) b.level = was
  }
  const keepRank = (b: Bucket) => KEEP_ORDER.indexOf(b.chip)
  //    뺀 묶음을 업무 수가 많은 것부터 — 이름이 보이는 업무가 가장 많이 늘어나는 순서
  for (const b of buckets
    .filter((x) => x.level === 'hidden')
    .sort((a, b) => size(b) - size(a) || keepRank(a) - keepRank(b) || a.g - b.g)) {
    raise(b, 'folded')
  }
  //    합친 묶음을 중요한 상태부터 다시 폅니다
  for (const b of buckets
    .filter((x) => x.level === 'folded')
    .sort((a, b) => keepRank(a) - keepRank(b) || a.g - b.g)) {
    raise(b, 'rows')
  }

  let folded = 0
  let hidden = 0
  const out = groups.map((grp, g) => {
    const rows: WeeklyRow[] = []
    for (const b of buckets.filter((x) => x.g === g)) {
      if (b.level === 'hidden') {
        hidden += b.rows.reduce((n, r) => n + (r.members ?? 1), 0)
      } else if (b.level === 'folded' && b.rows.length > 1) {
        folded += 1
        rows.push(foldRows(grp, b.chip, b.rows, box.cols))
      } else {
        rows.push(...b.rows)
      }
    }
    return { ...grp, rows }
  })
  return { groups: out, folded, hidden }
}

/**
 * 묶음 행 하나.
 *
 * - 안건: 이름을 들어가는 만큼 늘어놓고 나머지는 `외 N건`
 * - 담당: 가장 많이 맡은 사람 `외 N`
 * - 진행사항: 묶인 업무들의 진행 내용을 **축약해 이어 붙입니다** (`foldedDetail`).
 *   한때 `2건 묶음` 이라고 건수만 적었는데, 그건 내용이 아니라 표시였습니다 —
 *   2026-09-28 요청: "줄이는 게 아니라 항목의 내용을 축약하라" 
 * - 일정: 날짜 폭 (`9/16~9/20 완료`)
 */
function foldRows(
  grp: WeeklyGroup,
  chip: WeeklyChip,
  rows: WeeklyRow[],
  cols: WeeklyTableOptions['cols'],
): WeeklyRow {
  const names = rows.map((r) => r.title)
  const dates = [...new Set(rows.map((r) => r.date).filter((d): d is string => Boolean(d)))].sort()
  const first = shortDate(dates[0])
  const last = shortDate(dates[dates.length - 1])
  const span = !first ? null : first === last ? first : `${first}~${last}`
  return {
    id: `fold:${grp.key}:${chip}`,
    title: cols ? listLine(names, cols.title.w, cols.title.sz) : names.join(', '),
    owner: leadOwner(rows.map((r) => r.owner)),
    detail: foldedDetail(rows, cols?.detail),
    detailAt: null,
    chip,
    progress: chip === 'done' ? 100 : null,
    schedule: span ? (chip === 'done' ? `${span} 완료` : span) : '(계획)',
    date: dates[0] ?? null,
    members: rows.reduce((n, r) => n + (r.members ?? 1), 0),
    due: null,
    dueChangedFrom: null,
  }
}

/**
 * 묶음 행의 진행사항 — 구성원들의 글을 겹치지 않게 모아 칸에 맞게 줄입니다.
 *
 * **날짜 붙은 진행 기록이 앞, 최근 것부터**입니다. 그게 그 묶음의 지금 상황이고,
 * 칸이 좁아 뒤쪽은 `…` 로 잘릴 수 있습니다. 같은 글은 한 번만 — desk 는 한 메모를
 * 여러 업무에 복사해 둡니다 (카보너스 세 건이 같은 문장이었습니다).
 * 아무도 글이 없으면 비웁니다. 지어내지 않습니다.
 */
function foldedDetail(rows: WeeklyRow[], col: ColumnFit | undefined): string {
  const seen = new Set<string>()
  let cut = false
  const parts: string[] = []
  for (const r of [...rows].sort((a, b) => (b.detailAt ?? '').localeCompare(a.detailAt ?? ''))) {
    const t = r.detail.trim()
    if (t.endsWith('…')) cut = true
    const bare = t.replace(/…$/, '').trim()
    if (bare && !seen.has(bare)) {
      seen.add(bare)
      parts.push(bare)
    }
  }
  if (parts.length === 0) return ''
  // 구성원 글이 이미 잘려 있었으면 끝에 그 사실을 남깁니다
  // 쉼표로 잇습니다 — `·` 로 이으면 줄이 `· 사용자 테스트…` 처럼 기호로 시작합니다
  const joined = `${parts.join(', ')}${cut ? '…' : ''}`
  return col ? clampText(joined, col.w, col.sz, col.lines) : joined
}

/** `Ji 외 1` — 가장 많이 맡은 사람을 대표로. 담당 칸(0.62인치)에 이름을 다 늘어놓으면 넘칩니다 */
function leadOwner(owners: string[]): string {
  const count = new Map<string, number>()
  for (const o of owners) if (o && o !== '—') count.set(o, (count.get(o) ?? 0) + 1)
  if (count.size === 0) return '—'
  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
  return sorted.length === 1 ? sorted[0]![0] : `${sorted[0]![0]} 외 ${sorted.length - 1}`
}
