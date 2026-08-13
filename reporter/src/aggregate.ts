/**
 * 집계 규칙 — 전부 순수 함수입니다.
 *
 * 렌더링 코드에서 직접 계산하지 않습니다. 보고서 숫자가 틀렸을 때
 * 들여다볼 곳이 여기 한 곳이어야 합니다.
 *
 * 날짜는 `YYYY-MM-DD` **문자열 비교**로 다룹니다. Date 로 파싱하면 타임존 때문에
 * 월말·월초가 하루씩 밀립니다 — 보고 기간 경계에서 정확히 틀리는 지점입니다.
 */

import { mergedLabel } from './taskmap.ts'
import type {
  DeskDecision,
  DeskProject,
  DeskState,
  DeskWork,
  MonthBar,
  ReportModel,
  SeverityBucket,
  ChipKind,
  TicketRow,
  WorkGroup,
  WorkRow,
  WorkType,
} from './types.ts'

// ---------------------------------------------------------------------------
// 기간
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 그 달의 마지막 날. 윤년 포함해 Date 가 알아서 계산합니다 (UTC 고정) */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthWindow(year: number, month: number): { from: string; to: string } {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
  }
}

/** `2026-08-07` → `8/7`. 값이 없으면 null */
export function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return `${Number(m[2])}/${Number(m[3])}`
}

/** `2026-08` 같은 접두사에 속하는지 */
export function inMonth(iso: string | null | undefined, year: number, month: number): boolean {
  if (!iso) return false
  return iso.startsWith(`${year}-${pad2(month)}`)
}

export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

// ---------------------------------------------------------------------------
// 업무 판정 (기획서 6.1)
// ---------------------------------------------------------------------------

/**
 * 완료 / 지연 / 진행중.
 *
 * **마감일이 없는 업무는 지연으로 판정하지 않습니다.** desk 실측에서 38건 중
 * 17건이 마감일 없음이었습니다. 이것들을 지연으로 몰면 보고서가 매달 빨갛게
 * 뜨고, 읽는 사람이 지연 표시 자체를 무시하게 됩니다.
 */
export function classifyWork(work: DeskWork, asOf: string): ChipKind {
  if (work.status === 'done') return 'done'
  if (work.due && work.due < asOf) return 'late'
  return 'ing'
}

/**
 * 일정 칸 표기.
 *
 * 이전 스냅샷의 마감일(`prevDue`)이 지금과 다르면 변경 이력을 그대로 보여 줍니다.
 * 스냅샷이 한 개뿐인 첫 실행에서는 prevDue 가 없으므로 현재 마감일만 나옵니다.
 */
export function scheduleLabel(work: DeskWork, prevDue?: string | null): string {
  const now = shortDate(work.due)
  if (!now) return '(계획)'
  const before = shortDate(prevDue)
  if (before && prevDue !== work.due) return `${before} → ${now}`
  return now
}

/** 프로젝트 진척율 = 완료 마일스톤 / 전체. 마일스톤이 없으면 null */
export function projectProgress(project: DeskProject | undefined): number | null {
  const ms = project?.milestones
  if (!ms || ms.length === 0) return null
  return Math.round((ms.filter((m) => m.done).length / ms.length) * 100)
}

/**
 * 업무 행에 찍을 진척율.
 *
 * `work.progress` 는 실측 38건 **전부 null** 이라 업무 단위로는 산출이 불가능합니다.
 * 완료는 100%, 그 외는 **비웁니다.**
 *
 * 한때 미완료 행에 소속 프로젝트의 진척율을 찍었습니다. 프로젝트 수치가 업무
 * 수치처럼 보여서 각주로 해명해야 했습니다. 표를 프로젝트로 묶으면서 그 수치는
 * 묶음 머리행으로 올라갔고 — 원래 있어야 할 자리입니다 — 행에서는 뺐습니다.
 */
export function rowProgress(work: DeskWork, chip: ChipKind): number | null {
  if (chip === 'done') return 100
  if (typeof work.progress === 'number') return work.progress
  return null
}

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
 * 진행 내용. 없으면 **빈 문자열** — 제목을 베껴 채우지 않습니다.
 *
 * 태스크 맵으로 통합된 항목은 앞에 `구성 2/3` 이 붙습니다. 진척율 칸의 숫자가
 * 마일스톤 기준인지 구성원 기준인지 이 꼬리표로 갈립니다.
 */
export function workDetailText(work: DeskWork): string {
  const text = (work.detail?.notes ?? work.assessment ?? '').trim()
  const label = mergedLabel(work)
  if (!label) return text
  return text ? `${label} · ${text}` : label
}

/**
 * 그 달의 보고 대상 업무.
 *
 * - 그 달에 완료된 것
 * - 월말 기준 진행 중이거나 지연인 것
 *
 * 손도 대지 않은 `todo` 는 빠집니다. 월간 보고서는 그 달에 무슨 일이
 * 있었는지를 적는 문서이지 백로그 목록이 아닙니다.
 *
 * 정렬은 **지연 → 완료 → 진행중**입니다.
 *
 * 지연이 맨 위인 이유는 지면이 모자랄 때 잘려 나가는 쪽이 지연 건이면 안 되기
 * 때문이고, 완료가 진행중보다 위인 이유는 월간 보고서가 **그 달에 끝난 일**을
 * 보고하는 문서이기 때문입니다. 진행중을 위에 뒀더니 요약 띠에는 '완료 9건'
 * 인데 표에는 완료가 한 건도 없는 보고서가 나왔습니다 — 같은 장에서 숫자와
 * 목록이 어긋나 보입니다.
 */
const CHIP_ORDER: Record<ChipKind, number> = { late: 0, done: 1, ing: 2 }

interface Picked {
  work: DeskWork
  row: WorkRow
}

function pickWork(
  state: DeskState,
  year: number,
  month: number,
  prevDueById: Map<string, string | null>,
): Picked[] {
  const asOf = monthWindow(year, month).to

  return state.work
    .filter((w) => {
      // 보류는 단계가 아니라 옆길입니다 — 표에서 빼고 3장 이슈로 올립니다
      if (w.status === 'hold') return false
      if (w.status === 'done') return inMonth(w.completedOn, year, month)
      if (w.status === 'ing') return true
      // todo 는 마감일이 지난 경우(지연)에만 보고 대상입니다
      return Boolean(w.due && w.due < asOf)
    })
    .map((w) => {
      const chip = classifyWork(w, asOf)
      return {
        work: w,
        row: {
          title: w.title,
          owner: (w.owner ?? '').trim() || '—',
          detail: workDetailText(w),
          chip,
          progress: rowProgress(w, chip),
          schedule: scheduleLabel(w, prevDueById.get(w.id)),
        } satisfies WorkRow,
      }
    })
    .sort((a, b) => {
      const d = CHIP_ORDER[a.row.chip] - CHIP_ORDER[b.row.chip]
      if (d !== 0) return d
      const ka = a.work.completedOn ?? a.work.due ?? '9999-99-99'
      const kb = b.work.completedOn ?? b.work.due ?? '9999-99-99'
      return ka.localeCompare(kb)
    })
}

export function selectWorkRows(
  state: DeskState,
  year: number,
  month: number,
  prevDueById: Map<string, string | null> = new Map(),
): WorkRow[] {
  return pickWork(state, year, month, prevDueById).map((x) => x.row)
}

/** 프로젝트가 없는 업무가 모이는 자리. 숨기지 않습니다 — 실제로 한 일입니다 */
export const UNGROUPED_KEY = '__ungrouped__'
export const UNGROUPED_TITLE = '프로젝트 미지정'

/**
 * 그 달의 업무를 **프로젝트로 묶습니다.**
 *
 * desk 는 시스템(운영 대상)과 프로젝트(구축 작업)를 별개 축으로 두는데, 묶음
 * 기준은 프로젝트입니다. 연결률이 `work.system` 19/38 vs `work.project` 26/38 로
 * 높고, 프로젝트에는 마일스톤이 있어 묶음 진척율이 나옵니다.
 *
 * **업무가 없는 프로젝트는 아예 만들지 않습니다.** desk 에는 그 달에 아무 일도
 * 없었던 프로젝트가 여럿이고, 빈 줄로 늘어놓으면 표의 절반이 0건이 됩니다.
 *
 * 묶음 순서는 지연 있는 것 → 업무 많은 것 순이고, 미지정은 항상 맨 뒤입니다.
 */
export function selectWorkGroups(
  state: DeskState,
  year: number,
  month: number,
  prevDueById: Map<string, string | null> = new Map(),
): WorkGroup[] {
  const picked = pickWork(state, year, month, prevDueById)
  const projects = new Map(state.projects.map((p) => [p.key, p]))

  const buckets = new Map<string, Picked[]>()
  for (const p of picked) {
    const key = p.work.project && projects.has(p.work.project) ? p.work.project : UNGROUPED_KEY
    const list = buckets.get(key)
    if (list) list.push(p)
    else buckets.set(key, [p])
  }

  const groups: WorkGroup[] = [...buckets.entries()].map(([key, list]) => {
    const project = projects.get(key)
    const ms = project?.milestones ?? null
    return {
      key,
      title: project?.title ?? UNGROUPED_TITLE,
      progress: projectProgress(project),
      milestones: ms && ms.length > 0 ? { done: ms.filter((m) => m.done).length, total: ms.length } : null,
      counts: {
        done: list.filter((x) => x.row.chip === 'done').length,
        ing: list.filter((x) => x.row.chip === 'ing').length,
        late: list.filter((x) => x.row.chip === 'late').length,
      },
      rows: list.map((x) => x.row),
    }
  })

  return groups.sort((a, b) => {
    if (a.key === UNGROUPED_KEY) return 1
    if (b.key === UNGROUPED_KEY) return -1
    if (a.counts.late !== b.counts.late) return b.counts.late - a.counts.late
    if (a.rows.length !== b.rows.length) return b.rows.length - a.rows.length
    return a.title.localeCompare(b.title)
  })
}

/**
 * 표 높이에 들어가는 만큼만 남깁니다.
 *
 * 묶음 머리행도 높이를 먹으므로 "몇 행" 이 아니라 **인치**로 계산해야 맞습니다.
 *
 * 두 단계로 나눕니다.
 *
 * 1. **머리행 먼저.** 프로젝트 목록 자체가 시스템 개발현황이고, 머리행에는
 *    완료·진행·지연 건수와 마일스톤 진척율이 들어 있어 업무 행이 하나도 없어도
 *    뜻이 통합니다. 그래서 머리행을 업무 행보다 우선합니다.
 * 2. **남는 높이를 업무 행에 라운드로빈으로.** 앞에서부터 순서대로 채우면 첫
 *    묶음이 남은 높이를 다 먹고 뒤쪽 프로젝트는 업무가 한 건도 안 보입니다.
 *    한 바퀴에 한 행씩 돌려 모든 묶음이 골고루 갖게 합니다.
 *
 * 지면이 모자라 빠진 업무 건수는 호출부가 꼬리말에 적습니다. 머리행의 건수는
 * **자르기 전 전체**이므로, 행이 접혀도 "몇 건이 있었는지" 는 사라지지 않습니다.
 */
export function fitGroups(
  groups: WorkGroup[],
  budget: number,
  headerH: number,
  rowH: number,
): { groups: WorkGroup[]; droppedRows: number; droppedGroups: number } {
  const EPS = 1e-9
  const kept: { group: WorkGroup; take: number }[] = []
  let used = 0
  let droppedRows = 0
  let droppedGroups = 0

  for (const g of groups) {
    if (used + headerH > budget + EPS) {
      droppedGroups += 1
      droppedRows += g.rows.length
      continue
    }
    used += headerH
    kept.push({ group: g, take: 0 })
  }

  let added = true
  while (added) {
    added = false
    for (const k of kept) {
      if (k.take >= k.group.rows.length) continue
      if (used + rowH > budget + EPS) {
        added = false
        break
      }
      used += rowH
      k.take += 1
      added = true
    }
    if (used + rowH > budget + EPS) break
  }

  for (const k of kept) droppedRows += k.group.rows.length - k.take

  return {
    groups: kept.map((k) => ({ ...k.group, rows: k.group.rows.slice(0, k.take) })),
    droppedRows,
    droppedGroups,
  }
}

// ---------------------------------------------------------------------------
// 운영 현황 (티켓 대시보드) — 대분류 3종
// ---------------------------------------------------------------------------

/**
 * 장애만 골라냅니다.
 *
 * 등급·매우심각 목록은 **장애의 성질**입니다. 유지보수 티켓에도 `severity`
 * 컬럼은 채워져 있지만(DB 기본값 `medium`), 그것까지 세면 '보통 등급 장애'가
 * 유지보수 건수만큼 부풀어 오릅니다.
 */
export function incidentsOf(tickets: TicketRow[]): TicketRow[] {
  return tickets.filter((t) => t.workType === 'incident')
}

/** 빈 대분류 계수기. 셋 다 0 으로 시작합니다 — '없음'과 '집계 안 함'을 섞지 않기 위해서입니다 */
function emptyCounts(): Record<WorkType, number> {
  return { incident: 0, maintenance: 0, development: 0 }
}

/**
 * 대분류별 건수.
 *
 * 대분류를 모르는 티켓(`workType === null`)은 **어느 칸에도 넣지 않습니다.**
 * 유지보수가 기본값이라고 해서 여기서 유지보수로 세면, DB 에 없던 값이
 * 보고서에서 생겨납니다. 빠진 건수는 호출부가 각주에 적습니다.
 */
export function countByWorkType(tickets: TicketRow[]): Record<WorkType, number> {
  const out = emptyCounts()
  for (const t of tickets) {
    if (t.workType) out[t.workType] += 1
  }
  return out
}

/**
 * 티켓 4등급 → 보고서 3칸.
 *
 * `medium` 과 `low` 를 '보통'으로 합칩니다. 등급이 비어 있는 티켓은
 * 어느 칸에도 넣지 않습니다 — '보통'에 넣으면 등급 미지정이 보통으로 둔갑합니다.
 */
export function severityBucket(sev: TicketRow['severity']): SeverityBucket | null {
  switch (sev) {
    case 'critical':
      return 'critical'
    case 'high':
      return 'major'
    case 'medium':
    case 'low':
      return 'normal'
    default:
      return null
  }
}

/** 등급 분포. **장애만 넣어야 합니다** — `incidentsOf` 를 거친 목록을 주세요 */
export function countBySeverity(tickets: TicketRow[]): Record<SeverityBucket, number> {
  const out: Record<SeverityBucket, number> = { critical: 0, major: 0, normal: 0 }
  for (const t of tickets) {
    const b = severityBucket(t.severity)
    if (b) out[b] += 1
  }
  return out
}

export function ticketsInMonth(tickets: TicketRow[], year: number, month: number): TicketRow[] {
  return tickets.filter((t) => inMonth(t.receivedAt, year, month))
}

/**
 * 월별 막대 — 대분류별 건수를 셋 다 담습니다.
 *
 * **데이터가 있는 첫 달부터** 보고 월까지만 그립니다. 시스템 가동 이전 달을
 * 0 으로 채우지 않습니다 — "0건"과 "집계 시작 전"은 다른 사실이고,
 * 0 막대를 그리면 그 달에 아무 일도 없었다는 뜻이 됩니다.
 *
 * 원본 서식이 7칸이므로 그보다 많으면 **최근 7개월**만 남깁니다.
 */
export function monthlySeries(
  tickets: TicketRow[],
  year: number,
  month: number,
  maxBars = 7,
): MonthBar[] {
  const dates = tickets.map((t) => t.receivedAt).filter(Boolean).sort()
  const first = dates[0]
  if (!first) return []

  const startY = Number(first.slice(0, 4))
  const startM = Number(first.slice(5, 7))

  const bars: MonthBar[] = []
  let y = startY
  let m = startM
  while (y < year || (y === year && m <= month)) {
    bars.push({
      label: `${m}월`,
      values: countByWorkType(ticketsInMonth(tickets, y, m)),
      current: y === year && m === month,
    })
    const n = nextMonth(y, m)
    y = n.year
    m = n.month
  }
  return bars.slice(-maxBars)
}

/** 전월 총건수(대분류 3종 합). 집계 시작 이전이면 null (0 이 아닙니다) */
export function previousMonthTotal(
  tickets: TicketRow[],
  year: number,
  month: number,
): number | null {
  const dates = tickets.map((t) => t.receivedAt).filter(Boolean).sort()
  const first = dates[0]
  if (!first) return null
  const p = prevMonth(year, month)
  const key = `${p.year}-${pad2(p.month)}`
  if (key < first.slice(0, 7)) return null
  return ticketsInMonth(tickets, p.year, p.month).length
}

/** `전월 8건 대비 △0건 (동일)` 형태의 문구 */
export function deltaLabel(current: number, previous: number | null): string {
  if (previous === null) return '전월 비교 없음 (집계 시작 전)'
  const d = current - previous
  if (d === 0) return `전월 ${previous}건 대비 △0건 (동일)`
  const sign = d > 0 ? '▲' : '▼'
  return `전월 ${previous}건 대비 ${sign}${Math.abs(d)}건`
}

// ---------------------------------------------------------------------------
// 이슈 · 차월 계획
// ---------------------------------------------------------------------------

const truthy = (v: unknown) => v === true || v === 'True' || v === 'true'

/**
 * 주요 이슈.
 *
 * 미해소 의사결정(`status !== 'decided'`)과 에스컬레이션 건이 먼저이고,
 * 자리가 남으면 지연 업무로 채웁니다.
 */
export function selectIssues(
  decisions: DeskDecision[],
  lateRows: WorkRow[],
  max: number,
  held: { label: string; body: string }[] = [],
): { label: string; body: string }[] {
  const open = decisions
    .filter((d) => truthy(d.escalate) || (d.status ?? '') !== 'decided')
    .sort((a, b) => (truthy(b.escalate) ? 1 : 0) - (truthy(a.escalate) ? 1 : 0))
    .map((d) => ({
      label: d.title,
      body: firstLine(d.body ?? ''),
    }))

  const late = lateRows.map((r) => ({
    label: r.title,
    body: r.detail || `마감 ${r.schedule} 경과 — 조치 필요`,
  }))

  // 보류는 미해소 의사결정 다음, 지연보다 앞입니다 — 사유를 아는 사람이 있고
  // 누군가의 답을 기다리는 상태라 먼저 풀립니다.
  return [...open, ...held, ...late].slice(0, max)
}

function firstLine(s: string): string {
  const line = s.split('\n').find((l) => l.trim()) ?? ''
  return line.trim()
}

/**
 * 차월 계획 — 다음 달이 마감인 미완료 업무, 그다음 다음 달 마감 프로젝트.
 * 지어내지 않고 desk 에 실제로 적힌 일정만 옮깁니다.
 */
export function selectPlans(state: DeskState, year: number, month: number, max: number): string[] {
  const n = nextMonth(year, month)
  const works = state.work
    .filter((w) => w.status !== 'done' && inMonth(w.due, n.year, n.month))
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
    .map((w) => `${w.title} (${shortDate(w.due)})`)

  const projects = state.projects
    .filter((p) => inMonth(p.due, n.year, n.month))
    .map((p) => `${p.title} 마감 (${shortDate(p.due)})`)

  return [...works, ...projects].slice(0, max)
}

/** 요약 띠의 '중점' — 그 달 완료 건 중 앞의 둘 */
export function focusLine(rows: WorkRow[]): string {
  const done = rows.filter((r) => r.chip === 'done').map((r) => r.title)
  if (done.length === 0) return '완료 건 없음'
  return `${done.slice(0, 2).join(' / ')} 완료`
}

// ---------------------------------------------------------------------------
// 모델 조립
// ---------------------------------------------------------------------------

export interface BuildOptions {
  year: number
  month: number
  author: string
  reportedOn: string
  subtitle: string
  team: string
  prevDueById?: Map<string, string | null>
  /** 표 영역 높이(인치)와 행 높이. 넘치는 만큼 잘라내고 꼬리말에 적습니다 */
  table: { budget: number; headerH: number; rowH: number }
}

export function buildReport(
  state: DeskState,
  tickets: TicketRow[],
  opt: BuildOptions,
): ReportModel {
  const { year, month } = opt
  const win = monthWindow(year, month)

  const allRows = selectWorkRows(state, year, month, opt.prevDueById)
  const allGroups = selectWorkGroups(state, year, month, opt.prevDueById)
  const fitted = fitGroups(allGroups, opt.table.budget, opt.table.headerH, opt.table.rowH)
  const groups = fitted.groups
  const rows = groups.flatMap((g) => g.rows)

  const monthTickets = ticketsInMonth(tickets, year, month)
  const monthIncidents = incidentsOf(monthTickets)
  const counts = countByWorkType(monthTickets)
  const severity = countBySeverity(monthIncidents)
  const prevTotal = previousMonthTotal(tickets, year, month)
  const series = monthlySeries(tickets, year, month)

  // 꼬리말은 슬라이드 한 칸에 들어가야 하므로 짧게 씁니다.
  // 짧게 쓰되 **빼지는 않습니다** — 잘라낸 행이나 없는 데이터를 적지 않으면
  // 보고서가 실제보다 완전해 보입니다.
  const footnotes: string[] = []
  if (fitted.droppedRows > 0) {
    const g = fitted.droppedGroups > 0 ? ` · 프로젝트 ${fitted.droppedGroups}개 미표기` : ''
    footnotes.push(`안건 ${allRows.length}건 중 ${rows.length}건 표기${g}`)
  }
  if (groups.some((g) => g.progress !== null)) {
    footnotes.push('진척율(묶음)은 프로젝트 마일스톤 기준')
  }
  if (rows.some((r) => !r.detail)) {
    footnotes.push('진행내용 공란 = desk 에 기록 없음')
  }
  if (series.length === 0) {
    footnotes.push('티켓 집계 데이터 없음')
  } else if (series.length < 7) {
    footnotes.push(`처리 추이 ${series.length}개월치 (집계 시작 이후)`)
  }
  // 추이 막대는 장애·유지보수 둘뿐입니다. 신규개발이 실제로 있었던 달이 있으면
  // 그 사실을 적습니다 — 안 적으면 막대 합이 곧 총건수로 읽힙니다.
  if (series.some((b) => b.values.development > 0)) {
    footnotes.push('추이 막대는 장애·유지보수 (신규개발은 당월 카드)')
  }
  const unrated = monthIncidents.filter((t) => severityBucket(t.severity) === null).length
  if (unrated > 0) {
    footnotes.push(`장애 등급 미지정 ${unrated}건 제외`)
  }
  const heldCount = heldItems(state).length
  if (heldCount > 0) footnotes.push(`보류 ${heldCount}건은 표에서 빼고 3장에 실었습니다`)
  const untyped = monthTickets.filter((t) => t.workType === null).length
  if (untyped > 0) {
    footnotes.push(`대분류 미상 ${untyped}건 제외`)
  }

  const critList = monthIncidents
    .filter((t) => severityBucket(t.severity) === 'critical')
    .map((t) => (t.system ? `${t.title} (${t.system})` : t.title))

  return {
    period: {
      from: win.from,
      to: win.to,
      label: `${year}.${pad2(month)}.01 ~ ${pad2(month)}.${pad2(lastDayOfMonth(year, month))}`,
    },
    author: opt.author,
    reportedOn: opt.reportedOn,
    subtitle: opt.subtitle,
    team: opt.team,

    summary: {
      workTotal: allRows.length,
      done: allRows.filter((r) => r.chip === 'done').length,
      ing: allRows.filter((r) => r.chip === 'ing').length,
      late: allRows.filter((r) => r.chip === 'late').length,
      ticketTotal: monthTickets.length,
      ticketCounts: counts,
      focus: focusLine(allRows),
    },

    groups,

    operations: {
      series,
      counts,
      total: monthTickets.length,
      prevTotal,
      severity,
      criticalTitles: critList,
      note: `※ 운영 집계 출처: 티켓 대시보드 (${year}.${pad2(month)} 접수 기준)`,
    },

    issues: selectIssues(
      state.decisions,
      allRows.filter((r) => r.chip === 'late'),
      3,
      heldItems(state),
    ),
    plans: selectPlans(state, year, month, 4),
    footnotes,
  }
}
