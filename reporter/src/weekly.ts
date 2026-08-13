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

import { projectProgress, rowProgress, shortDate } from './aggregate.ts'
import { mergedLabel } from './taskmap.ts'
import { projectRails, type ProjectRail } from './milestones.ts'
import { inWeek, rangeLabel, type Week } from './week.ts'
import type { DeskProject, DeskState, DeskWork } from './types.ts'

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
  owners: string[]
  counts: { done: number; started: number; ing: number; late: number; added: number }
  milestones: { done: number; total: number } | null
  progress: number | null
  rows: WeeklyRow[]
}

/** 2장 — 프로젝트 진척. 지난주 값이 없으면 `before` 가 null 이고 증감을 안 그립니다 */
export interface ProgressRow {
  title: string
  before: number | null
  after: number
  milestones: { done: number; total: number }
  /** 금주 늘어난 마일스톤 개수. 비교 대상이 없으면 null */
  delta: number | null
}

export interface WeeklyModel {
  period: { label: string; from: string; to: string; range: string }
  author: string
  reportedOn: string
  subtitle: string
  team: string

  /** 비교에 쓴 지난주 스냅샷 날짜. null 이면 **기준 주차**(비교 대상 없음) */
  baseline: string | null

  summary: { done: number; started: number; ing: number; late: number; added: number }

  /** 프로젝트 묶음 → 하위 태스크. 독립 항목 묶음이 맨 뒤에 하나 붙습니다 */
  groups: WeeklyGroup[]

  progress: ProgressRow[]
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
 * 마일스톤 증가분.
 *
 * 프로젝트 진척은 업무 상태가 아니라 **마일스톤**이 근거입니다 (기획서 6.2).
 * 업무 3건을 끝내도 마일스톤이 안 닫혔으면 프로젝트 진척은 그대로입니다 —
 * 그걸 올려 주면 매주 진척이 오르는데 프로젝트는 안 끝나는 보고서가 됩니다.
 */
export function diffProgress(before: DeskState | null, after: DeskState): ProgressRow[] {
  const prev = new Map((before?.projects ?? []).map((p) => [p.key, p]))

  return after.projects
    .filter((p) => (p.milestones ?? []).length > 0)
    .map((p) => {
      const ms = p.milestones!
      const doneNow = ms.filter((m) => m.done).length
      const old = prev.get(p.key)
      const oldMs = old?.milestones ?? null
      const doneBefore = oldMs ? oldMs.filter((m) => m.done).length : null
      return {
        title: p.title,
        before: before && oldMs ? projectProgress(old) : null,
        after: projectProgress(p) ?? 0,
        milestones: { done: doneNow, total: ms.length },
        delta: doneBefore === null ? null : doneNow - doneBefore,
      }
    })
    .sort((a, b) => (b.delta ?? -1) - (a.delta ?? -1) || b.after - a.after)
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
    progress: rowProgress(w, chip === 'done' ? 'done' : 'ing'),
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

/** 차주 계획 — 다음 주가 마감인 미완료 업무. 지어내지 않고 desk 의 일정만 옮깁니다 */
export function selectPlans(state: DeskState, next: Week, max: number): string[] {
  return state.work
    .filter((w) => w.status !== 'done' && inWeek(w.due, next))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
    .map((w) => `${w.title} (${shortDate(w.due)}${w.owner ? ` · ${w.owner}` : ''})`)
    .slice(0, max)
}

export interface WeeklyOptions {
  week: Week
  nextWeek: Week
  author: string
  reportedOn: string
  subtitle: string
  team: string
  /** 비교에 쓴 지난주 스냅샷 날짜. 없으면 null (기준 주차) */
  baseline: string | null
  /** 정체 판정용 과거 스냅샷들 (오래된 것부터). 2개 미만이면 정체를 안 냅니다 */
  history?: DeskState[]
  /** 표 영역 높이(인치)와 각 줄 높이. 넘치면 잘라내고 각주에 적습니다 */
  table: { budget: number; headerH: number; ruleH: number; rowH: number }
  /** 2장에 들어가는 프로젝트 수 · 3장에 들어가는 변화 줄 수 */
  maxProgress: number
  maxChanges: number
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
  const groups = fitRows(all, opt.table)
  const shown = groups.reduce((n, g) => n + g.rows.length, 0)

  const flat = all.flatMap((g) => g.rows)
  const summary = {
    done: flat.filter((r) => r.chip === 'done').length,
    started: flat.filter((r) => r.chip === 'started').length,
    ing: flat.filter((r) => r.chip === 'ing').length,
    late: flat.filter((r) => r.chip === 'late').length,
    added: flat.filter((r) => r.chip === 'new').length,
  }

  const allProgress = diffProgress(before, state)
  const progress = allProgress.slice(0, opt.maxProgress)

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
    footnotes.push(`업무 ${totalRows}건 중 ${shown}건 표기`)
  }
  if ((opt.history ?? []).length < 2) {
    footnotes.push('정체(3주 연속 무변화)는 스냅샷 3주치가 쌓여야 판정합니다')
  }
  if (allChanges > opt.maxChanges) {
    footnotes.push(`변화·지연 ${allChanges}건 중 ${opt.maxChanges}건 표기`)
  }
  if (allProgress.length > progress.length) {
    footnotes.push(`진척 프로젝트 ${allProgress.length}개 중 ${progress.length}개 표기`)
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
    author: opt.author,
    reportedOn: opt.reportedOn,
    subtitle: opt.subtitle,
    team: opt.team,
    baseline: opt.baseline,
    summary,
    groups,
    progress,
    rails: projectRails(state),
    changes: changes.slice(0, opt.maxChanges),
    plans: selectPlans(state, opt.nextWeek, 4),
    footnotes,
  }
}

/**
 * 표에 들어가는 만큼만 남깁니다.
 *
 * **행 수가 아니라 인치로 셉니다.** 머리행(0.20)과 업무 행(0.26)의 높이가 달라서
 * 행 수로 세면 예산이 남는데도 행이 잘립니다. 독립 항목 앞의 구분선(0.16)도
 * 자리를 먹으므로 같이 넣습니다 — 빼먹으면 마지막 행이 표 밖으로 흘러나갑니다.
 *
 * 원칙은 월간과 같습니다.
 *
 * 1. **머리행·구분선을 업무 행보다 우선합니다.** 프로젝트 목록 자체가 현황이고,
 *    머리행에 금주 변화 건수와 진척율이 있어 업무 행이 없어도 뜻이 통합니다.
 * 2. **남는 높이는 라운드로빈으로.** 앞에서부터 채우면 첫 프로젝트가 다 먹고
 *    뒤쪽 — 특히 맨 뒤에 오는 독립 항목 — 은 한 건도 안 보입니다.
 */
export function fitRows(
  groups: WeeklyGroup[],
  table: { budget: number; headerH: number; ruleH: number; rowH: number },
): WeeklyGroup[] {
  const EPS = 1e-9
  const kept: { group: WeeklyGroup; take: number }[] = []
  let used = 0

  for (const g of groups) {
    const head = g.standalone ? table.ruleH : table.headerH
    if (used + head > table.budget + EPS) continue
    used += head
    kept.push({ group: g, take: 0 })
  }

  let added = true
  while (added) {
    added = false
    for (const k of kept) {
      if (k.take >= k.group.rows.length) continue
      if (used + table.rowH > table.budget + EPS) return finish(kept)
      used += table.rowH
      k.take += 1
      added = true
    }
  }
  return finish(kept)
}

function finish(kept: { group: WeeklyGroup; take: number }[]): WeeklyGroup[] {
  return kept
    .map((k) => ({ ...k.group, rows: k.group.rows.slice(0, k.take) }))
    // 구분선만 남고 행이 하나도 없는 독립 항목 묶음은 줄만 낭비합니다
    .filter((g) => g.rows.length > 0 || !g.standalone)
}
