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
  /** `8/6` · `7/13 → 8/6`(금주 변경) · `(계획)` */
  schedule: string
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
  reportedOn: string
  subtitle: string

  /** 비교에 쓴 지난주 스냅샷 날짜. null 이면 **기준 주차**(비교 대상 없음) */
  baseline: string | null

  summary: { done: number; started: number; ing: number; late: number; added: number }

  /**
   * 표 장(章)들. **한 장에 안 들어가면 잘라내지 않고 장을 늘립니다** —
   * 진행 현황은 이 보고서의 본문이고, 목록에 있는 것은 다 실립니다.
   * 묶음 하나가 두 장에 걸치면 뒷장 머리행에 `continued` 가 섭니다.
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

/** 통합 항목이면 '구성 2/3' 을 앞에 답니다 — 진척율이 무엇을 센 값인지 밝힙니다 */
function withMergedLabel(w: DeskWork): string {
  const text = (w.detail?.notes ?? w.assessment ?? '').trim()
  const label = mergedLabel(w)
  if (!label) return text
  return text ? `${label} · ${text}` : label
}

function toRow(w: DeskWork, d: WorkDiff, asOf: string): WeeklyRow {
  const changedFrom = d.dueChangedFrom.get(w.id) ?? null
  const chip = chipOf(w, d, asOf)
  return {
    id: w.id,
    title: w.title,
    owner: (w.owner ?? '').trim() || '—',
    detail: withMergedLabel(w),
    chip,
    progress: rowProgress(w, chip === 'done'),
    schedule: scheduleOf(w, changedFrom),
    dueChangedFrom: changedFrom,
  }
}

function sortRows(a: WeeklyRow, b: WeeklyRow): number {
  const c = CHIP_ORDER[a.chip] - CHIP_ORDER[b.chip]
  if (c !== 0) return c
  return a.owner.localeCompare(b.owner, 'ko') || a.title.localeCompare(b.title, 'ko')
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
    const rows = works.map((w) => toRow(w, d, asOf)).sort(sortRows)
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
 * 차주 계획 — 다음 주가 마감인 미완료 업무. 지어내지 않고 desk 의 일정만 옮깁니다.
 *
 * `max` 로 자르는 것은 지면 사정이고, **몇 건 중 몇 건인지는 부르는 쪽이 알아야**
 * 각주에 적을 수 있습니다. 그래서 자른 목록과 전체 건수를 같이 돌려줍니다.
 */
export function selectPlans(state: DeskState, next: Week, max: number): { items: string[]; total: number } {
  const all = state.work
    .filter((w) => w.status !== 'done' && inWeek(w.due, next))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
    .map((w) => `${w.title} (${shortDate(w.due)}${w.owner ? ` · ${w.owner}` : ''})`)
  return { items: all.slice(0, max), total: all.length }
}

export interface WeeklyOptions {
  week: Week
  nextWeek: Week
  reportedOn: string
  subtitle: string
  /** 비교에 쓴 지난주 스냅샷 날짜. 없으면 null (기준 주차) */
  baseline: string | null
  /** 정체 판정용 과거 스냅샷들 (오래된 것부터). 2개 미만이면 정체를 안 냅니다 */
  history?: DeskState[]
  /** 표 배치. 넘치면 3·4장을 줄이거나 내려보내고, 그래도 넘치면 장을 늘립니다 */
  table: WeeklyTableOptions
  /** 그 주 운영 현황의 원천. 대시보드를 못 읽었으면 빈 배열 */
  tickets: ReportTicket[]
}

export function buildWeekly(
  before: DeskState | null,
  state: DeskState,
  opt: WeeklyOptions,
): WeeklyModel {
  const asOf = lateAsOf(opt.week, opt.reportedOn)
  const d = diffWork(before, state)
  const all = groupWork(state, d, opt.week, asOf, opt.baseline !== null)

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
    if (r.dueChangedFrom) changes.push({ label: r.title, body: `일정 ${r.schedule} · ${r.owner}` })
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
  const allPlans = selectPlans(state, opt.nextWeek, Number.POSITIVE_INFINITY)

  // **자리는 여기서 정해집니다.** 3·4장에 실을 것이 몇 건인지 알아야 "압축하면
  // 이슈가 지워지는가" 를 볼 수 있고, 지워진다면 압축 대신 다음 장으로 내립니다.
  const fitted = fitTable(all, opt.table, { changes: allChanges, plans: allPlans.total })
  const shown = fitted.pages.reduce((n, page) => n + page.reduce((k, g) => k + g.rows.length, 0), 0)
  const plans = { items: allPlans.items.slice(0, fitted.maxPlans), total: allPlans.total }
  // 마일스톤이 없는 프로젝트는 레일에 그릴 것이 없어 빠집니다. 몇 개인지 적습니다.
  const railless = state.projects.length - projectRails(state).length
  const held = heldItems(state).length
  const footnotes: string[] = []
  if (held > 0) footnotes.push(`보류 ${held}건은 표에서 빼고 3장에 실었습니다`)
  if (railless > 0) footnotes.push(`마일스톤 없는 프로젝트 ${railless}개는 진행 장에서 제외`)
  if (!opt.baseline) {
    footnotes.push('기준 주차 — 지난주 스냅샷이 없어 변화분(완료·착수·신규·일정변경)을 산출하지 않았습니다')
  }
  if (shown < totalRows) {
    // 장 수 상한(TABLE_FIT.maxPages)까지 갔는데도 남은 경우에만 나옵니다
    footnotes.push(`업무 ${totalRows}건 중 ${shown}건 표기`)
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
    footnotes.push('진행내용 공란 = desk 에 기록 없음')
  }

  return {
    period: {
      label: opt.week.id,
      from: opt.week.from,
      to: opt.week.to,
      range: rangeLabel(opt.week),
    },
    reportedOn: opt.reportedOn,
    subtitle: opt.subtitle,
    baseline: opt.baseline,
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
 */
export type WeeklyLayout = 'base' | 'compact' | 'spill'

export interface WeeklyTableOptions {
  /** 앞에서부터 시도합니다. 마지막이 `spill` 이어야 합니다 (더 물러설 곳이 없는 배치) */
  layouts: { mode: WeeklyLayout; budget: number; maxChanges: number; maxPlans: number }[]
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
  const fits = (l: (typeof layouts)[number]) =>
    need <= l.budget + EPS &&
    (l.mode === 'base' || (demand.changes <= l.maxChanges && demand.plans <= l.maxPlans))
  const chosen = layouts.find(fits) ?? layouts[layouts.length - 1]!

  // 한 장에 들어가면 쪽을 나눌 것도 없습니다
  if (need <= chosen.budget + EPS) {
    return { mode: chosen.mode, pages: [groups], maxChanges: chosen.maxChanges, maxPlans: chosen.maxPlans }
  }
  return {
    mode: chosen.mode,
    pages: paginateGroups(groups, {
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
