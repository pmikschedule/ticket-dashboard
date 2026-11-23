/**
 * 일정 창과 진척률 — 순수 함수 (2026-11-23).
 *
 * desk 에는 진척률(`work.progress`)이 거의 안 들어옵니다 — 11/23 실측 105건 전부 비어
 * 있었습니다. 시작일도 절반 넘게 비고, 진행 기록(`work.log`)도 비어 있는 일이 많습니다.
 * 그래서 11/20 등록한 BRS HK 7건이 보고서에서 '신규' 칩에 진척율·진행사항 빈칸으로
 * 나갔고, 마감이 코앞인 일이 손도 안 댄 일처럼 읽혔습니다. 요청은 둘이었습니다.
 *
 * 1. **마감 전에 보고서를 쓰면 그 일은 진행 중으로 적습니다** — 완료가 아니고
 *    `시작일 ≤ 기준일 ≤ 마감일` 이면 desk 상태가 대기여도 '진행중'
 * 2. **진척률은 기성고(지난 작업일 ÷ 전체 작업일)로 계산합니다** — 단위는 작업일
 *    (주말·desk `holidays` 제외)이고 기준일 당일은 지난 날로 셉니다
 *
 * **사용자가 desk 에 넣은 값은 계산이 덮어쓰지 않습니다.** 진척률이 들어 있으면
 * 마감이 지났어도 그 값입니다. 시작일이 들어 있으면 그 날부터 셉니다. 계산·추정은
 * 값이 비었을 때만입니다. 시작일을 모르면 **등록일**, 그것도 모르면 마감일을 포함해
 * **10 작업일**(2주) 전을 시작으로 칩니다. desk 에는 지금 등록일 필드가 없습니다
 * (11/23 실측 work 키 15개 — id·owner·title·project·system·parent·status·start·due·
 * completedOn·progress·types·detail·assessment·log). 생기면 `registeredOn` 에 넘깁니다.
 *
 * 추정한 진척률은 **일정이 지난 만큼**이지 일이 된 만큼이 아닙니다. 보고서는 그
 * 값에 '약' 을 붙여 실측(사용자 입력)과 구분합니다.
 */

import { addDays } from './week'
import type { DeskHoliday, DeskWork } from './types'

/** 시작일을 모를 때의 작업 기간 — 2주 */
export const DEFAULT_WORKDAYS = 10

/** 날짜를 하루씩 세는 반복의 상한(약 10년). 잘못된 날짜가 와도 무한히 돌지 않습니다 */
const MAX_SPAN_DAYS = 3660

const ISO = /^\d{4}-\d{2}-\d{2}$/

function day(iso: string | null | undefined): string | null {
  const d = (iso ?? '').slice(0, 10)
  return ISO.test(d) ? d : null
}

/** desk 휴일을 날짜 집합으로 펼칩니다. 구간이 비정상적으로 길면 상한에서 멈춥니다 */
export function holidaySet(holidays: DeskHoliday[] | undefined): Set<string> {
  const out = new Set<string>()
  for (const h of holidays ?? []) {
    const from = day(h.date)
    if (!from) continue
    const until = day(h.until) ?? from
    let d = from
    for (let i = 0; i < MAX_SPAN_DAYS && d <= until; i += 1) {
      out.add(d)
      d = addDays(d, 1)
    }
  }
  return out
}

/** 작업일인가 — 토·일과 desk 휴일이 아니면 */
export function isWorkday(iso: string, holidays: Set<string>): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return dow !== 0 && dow !== 6 && !holidays.has(iso)
}

/** `from`~`to`(둘 다 포함) 사이 작업일 수. `from > to` 면 0 */
export function workdaysBetween(from: string, to: string, holidays: Set<string>): number {
  let n = 0
  let d = from
  for (let i = 0; i < MAX_SPAN_DAYS && d <= to; i += 1) {
    if (isWorkday(d, holidays)) n += 1
    d = addDays(d, 1)
  }
  return n
}

/**
 * 마감일을 포함해 작업일 `n` 개가 되는 시작일. 마감일이 주말이면 그 앞 작업일부터 셉니다.
 * 12/4(금) 마감 · 10일 → 11/23(월).
 */
export function workdaysBefore(due: string, n: number, holidays: Set<string>): string {
  let d = due
  let start = due
  let counted = 0
  for (let i = 0; i < MAX_SPAN_DAYS && counted < n; i += 1) {
    if (isWorkday(d, holidays)) {
      counted += 1
      start = d
    }
    d = addDays(d, -1)
  }
  return start
}

/** 시작일을 어디서 얻었나 — 보고 때 근거로 밝힙니다 */
export type StartSource = 'input' | 'registered' | 'estimated'

export const START_SOURCE_LABELS: Record<StartSource, string> = {
  input: 'desk 입력',
  registered: '등록일',
  estimated: `마감 전 ${DEFAULT_WORKDAYS}작업일 추정`,
}

export type ScheduleWindow =
  /** 마감일이 없거나 시작일을 쓸 수 없어 판단하지 않습니다 — desk 상태 그대로 */
  | { kind: 'none'; reason: 'no-due' | 'start-after-due' }
  | {
      kind: 'before' | 'within' | 'after'
      start: string
      source: StartSource
      due: string
      /** 시작~마감 작업일 수 */
      total: number
      /** 기준일 다음 날~마감 작업일 수 (기준일 당일은 지난 날) */
      remaining: number
      /** 기성고 % — `within` 이고 total > 0 일 때만. 그 밖에는 null */
      percent: number | null
    }

/**
 * 그 업무의 일정 창과 기준일의 위치.
 *
 * 시작일: desk 입력 → 등록일 → 마감일 포함 10 작업일 전.
 *
 * - 입력한 시작일이 마감보다 늦으면 **계산하지 않습니다** (`start-after-due`).
 *   사람이 넣은 값이 서로 어긋난 것이라 어느 쪽을 고쳐야 하는지 모릅니다 —
 *   추정으로 덮으면 입력값을 덮어쓰는 셈입니다
 * - 등록일이 마감보다 늦거나 그 사이에 작업일이 하나도 없으면 등록일을 버리고
 *   10 작업일 추정으로 갑니다. 등록일은 사람이 '시작' 이라고 넣은 값이 아닙니다
 * - 입력한 시작~마감 사이에 작업일이 없으면(주말 하루짜리 등) 창은 있지만 % 는 null
 *
 * 진척률은 `within`(시작일 ≤ 기준일 ≤ 마감일)에서만 냅니다. 시작 전은 0% 가 아니라
 * **표시하지 않습니다** — 아직 일정이 오지 않은 일에 0% 를 찍으면 늦은 일처럼 읽힙니다.
 * 마감 뒤는 계산하면 100% 인데 끝나지 않은 일이라 **표시하지 않습니다** (지연 칩이 말합니다).
 */
export function scheduleWindow(
  w: Pick<DeskWork, 'start' | 'due'>,
  ref: string,
  holidays: Set<string>,
  registeredOn: string | null = null,
): ScheduleWindow {
  const due = day(w.due)
  if (!due) return { kind: 'none', reason: 'no-due' }

  let start: string
  let source: StartSource
  const input = day(w.start)
  const registered = day(registeredOn)
  if (input) {
    if (input > due) return { kind: 'none', reason: 'start-after-due' }
    start = input
    source = 'input'
  } else if (registered && registered <= due && workdaysBetween(registered, due, holidays) > 0) {
    start = registered
    source = 'registered'
  } else {
    start = workdaysBefore(due, DEFAULT_WORKDAYS, holidays)
    source = 'estimated'
  }

  const total = workdaysBetween(start, due, holidays)
  const remaining = workdaysBetween(addDays(ref, 1), due, holidays)
  const kind = ref < start ? 'before' : ref > due ? 'after' : 'within'
  const percent =
    kind === 'within' && total > 0
      ? Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100)))
      : null
  return { kind, start, source, due, total, remaining, percent }
}

/** 행에 찍을 진척률과 그것이 추정인지 */
export interface RowProgress {
  value: number | null
  /** 일정 경과로 계산한 값이면 true. 사용자 입력·완료(100%)는 false */
  estimated: boolean
}

/**
 * 진척률 — **완료 100% → desk 입력값 → 일정 추정** 순서.
 *
 * 입력값은 마감이 지났어도, 시작 전이어도 그대로입니다. 계산은 입력이 비었을 때만.
 */
export function progressOf(w: Pick<DeskWork, 'progress'>, done: boolean, win: ScheduleWindow): RowProgress {
  if (done) return { value: 100, estimated: false }
  if (typeof w.progress === 'number' && Number.isFinite(w.progress)) {
    return { value: Math.min(100, Math.max(0, Math.round(w.progress))), estimated: false }
  }
  if (win.kind === 'within' && win.percent !== null) return { value: win.percent, estimated: true }
  return { value: null, estimated: false }
}

/**
 * 일정 창 안이면 진행 중입니다 — 완료가 아니고 `시작일 ≤ 기준일 ≤ 마감일`.
 *
 * 보류(`hold`)는 사람이 멈춰 둔 것이라 바꾸지 않습니다 (이슈 절로 갑니다).
 */
export function inProgressBySchedule(w: Pick<DeskWork, 'status'>, win: ScheduleWindow): boolean {
  return w.status !== 'done' && w.status !== 'hold' && win.kind === 'within'
}
