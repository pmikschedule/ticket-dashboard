/**
 * Gantt — 신규개발 건의 일정.
 *
 * 계산은 전부 순수 함수입니다. 화면은 여기서 나온 좌표(%)를 그대로 그립니다.
 *
 * **없는 일정을 지어내지 않습니다.** 시작·종료를 알 수 없는 건은 막대를 그리는
 * 대신 '일정 미정' 으로 따로 모읍니다. 임의로 오늘부터 일주일 같은 값을 넣으면
 * 보는 사람은 그게 실제 계획인 줄 압니다.
 */

import { PIPELINE_STATUSES, STATUS_LABELS, type PipelineStatus, type Status } from './constants'
import type { LeadTimeRow } from './types'

const DAY_MS = 86_400_000

/**
 * 상태에서 진척률을 끌어냅니다.
 *
 * 별도로 입력받는 값이 아니라 **상태로부터 유도한 값**입니다.
 * 화면에 그 사실을 밝혀 두어야 실제 측정치로 오해하지 않습니다.
 */
export const STATUS_PROGRESS: Record<PipelineStatus, number> = {
  intake: 0,
  triage: 10,
  in_progress: 40,
  testing: 70,
  deploy: 90,
  done: 100,
}

/**
 * 보류 중인 건의 진척은 **모릅니다** — null 을 돌려줍니다.
 *
 * 보류는 파이프라인 밖이라 환산할 단계가 없습니다. 0% 로 채우면 90% 까지 갔다가
 * 멈춘 건이 시작도 안 한 것처럼 보이고, 그 화면을 팀 전체가 봅니다.
 */
export function progressOf(status: Status): number | null {
  if (status === 'on_hold') return null
  return STATUS_PROGRESS[status] ?? 0
}

export interface GanttBar {
  ticketId: number
  subject: string
  assignee: string
  status: Status
  statusLabel: string
  /** 상태에서 유도한 진척률. 보류 중이면 알 수 없어 null 입니다 */
  progress: number | null
  /** 지금 보류 중 */
  held: boolean
  start: Date
  end: Date
  /** 계획 일정이 없어 접수일·기한으로 대신 그린 경우 */
  inferred: boolean
  /** 종료가 오늘보다 이전인데 완료되지 않음 */
  overdue: boolean
  estimatedDays: number | null
  /** 타임라인 왼쪽에서의 위치 (%) */
  offsetPercent: number
  /** 막대 길이 (%) */
  widthPercent: number
}

export interface GanttScale {
  start: Date
  end: Date
  totalDays: number
  /** 월 구분선 — 라벨과 위치(%) */
  months: { label: string; offsetPercent: number }[]
  /** 오늘 위치(%). 범위 밖이면 null */
  todayPercent: number | null
}

export interface GanttModel {
  bars: GanttBar[]
  /** 시작·종료를 알 수 없어 막대를 그리지 못한 건 */
  undated: {
    ticketId: number
    subject: string
    assignee: string
    statusLabel: string
    held: boolean
  }[]
  scale: GanttScale | null
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

/**
 * 한 티켓의 일정 구간을 정합니다.
 *
 * 우선순위: 계획 일정 → 접수일·기한. 둘 다 없으면 null 을 돌려주고
 * 호출자가 '일정 미정' 으로 분류합니다.
 */
export function resolveSpan(
  row: LeadTimeRow,
): { start: Date; end: Date; inferred: boolean } | null {
  const plannedStart = parseDate(row.planned_start_date)
  const plannedEnd = parseDate(row.planned_end_date)
  if (plannedStart && plannedEnd) {
    return { start: plannedStart, end: maxDate(plannedEnd, plannedStart), inferred: false }
  }

  // 계획이 한쪽만 있으면 나머지를 실측값으로 메웁니다. 절반이라도 사실입니다.
  const received = parseDate(row.received_at)
  const due = parseDate(row.due_date)

  const start = plannedStart ?? received
  const end = plannedEnd ?? due
  if (start && end) return { start, end: maxDate(end, start), inferred: true }

  return null
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b
}

/** 축 범위를 데이터에 맞추고 양옆에 여백을 둡니다. */
export function buildScale(spans: { start: Date; end: Date }[], today: Date): GanttScale | null {
  if (spans.length === 0) return null

  let min = spans[0].start.getTime()
  let max = spans[0].end.getTime()
  for (const span of spans) {
    min = Math.min(min, span.start.getTime())
    max = Math.max(max, span.end.getTime())
  }
  // 오늘이 범위 밖이면 축에 넣습니다. 오늘 선이 안 보이면 지연을 못 읽습니다.
  min = Math.min(min, today.getTime())
  max = Math.max(max, today.getTime())

  const start = startOfDay(new Date(min - 3 * DAY_MS))
  const end = startOfDay(new Date(max + 3 * DAY_MS))
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS))

  // 월 시작 지점에 구분선을 둡니다.
  const months: { label: string; offsetPercent: number }[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor.getTime() <= end.getTime()) {
    if (cursor.getTime() >= start.getTime()) {
      months.push({
        label: `${cursor.getFullYear()}.${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        offsetPercent: ((cursor.getTime() - start.getTime()) / DAY_MS / totalDays) * 100,
      })
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const todayOffset = ((startOfDay(today).getTime() - start.getTime()) / DAY_MS / totalDays) * 100

  return {
    start,
    end,
    totalDays,
    months,
    todayPercent: todayOffset >= 0 && todayOffset <= 100 ? todayOffset : null,
  }
}

export interface GanttLookups {
  userName: (id: string | null) => string | undefined
}

/**
 * 신규개발 건만 대상으로 Gantt 모델을 만듭니다.
 *
 * 장애·유지보수는 대체로 며칠 안에 끝나서 타임라인에 올리면 선 하나로 뭉갭니다.
 * 그쪽은 주간 현황과 통계로 봅니다.
 */
export function buildGantt(
  rows: LeadTimeRow[],
  lookups: GanttLookups,
  today: Date = new Date(),
): GanttModel {
  const targets = rows.filter((row) => row.work_type === 'development')

  const dated: { row: LeadTimeRow; span: { start: Date; end: Date; inferred: boolean } }[] = []
  const undated: GanttModel['undated'] = []

  for (const row of targets) {
    const span = resolveSpan(row)
    if (span) dated.push({ row, span })
    else
      undated.push({
        ticketId: row.ticket_id,
        subject: row.subject,
        assignee: lookups.userName(row.assignee_id) ?? '미배정',
        statusLabel: STATUS_LABELS[row.status] ?? row.status,
        held: row.status === 'on_hold',
      })
  }

  const scale = buildScale(
    dated.map((entry) => entry.span),
    today,
  )

  const bars: GanttBar[] = dated
    .map(({ row, span }) => {
      const offset = scale
        ? ((span.start.getTime() - scale.start.getTime()) / DAY_MS / scale.totalDays) * 100
        : 0
      const days = Math.max(1, Math.round((span.end.getTime() - span.start.getTime()) / DAY_MS) + 1)
      const width = scale ? (days / scale.totalDays) * 100 : 100

      return {
        ticketId: row.ticket_id,
        subject: row.subject,
        assignee: lookups.userName(row.assignee_id) ?? '미배정',
        status: row.status,
        statusLabel: STATUS_LABELS[row.status] ?? row.status,
        progress: progressOf(row.status),
        held: row.status === 'on_hold',
        start: span.start,
        end: span.end,
        inferred: span.inferred,
        overdue: row.status !== 'done' && span.end.getTime() < startOfDay(today).getTime(),
        estimatedDays: row.estimated_days,
        offsetPercent: Math.max(0, offset),
        widthPercent: Math.max(0.6, Math.min(100 - Math.max(0, offset), width)),
      }
    })
    .sort((a, b) => {
      const byStart = a.start.getTime() - b.start.getTime()
      return byStart !== 0 ? byStart : a.ticketId - b.ticketId
    })

  return { bars, undated, scale }
}

export interface GanttSummary {
  total: number
  dated: number
  undated: number
  overdue: number
  done: number
  /** 보류 중이라 진척을 알 수 없는 건 */
  held: number
  /** 계획 일정이 없어 접수일·기한으로 대신 그린 건 */
  inferred: number
}

export function summarizeGantt(model: GanttModel): GanttSummary {
  return {
    total: model.bars.length + model.undated.length,
    dated: model.bars.length,
    undated: model.undated.length,
    overdue: model.bars.filter((bar) => bar.overdue).length,
    done: model.bars.filter((bar) => bar.status === 'done').length,
    held: model.bars.filter((bar) => bar.held).length +
      model.undated.filter((entry) => entry.held).length,
    inferred: model.bars.filter((bar) => bar.inferred).length,
  }
}

/** 상태별 진척 범례. 화면에 "상태에서 유도한 값" 임을 밝히기 위해 씁니다. */
export const PROGRESS_LEGEND = PIPELINE_STATUSES.map((status) => ({
  status,
  label: STATUS_LABELS[status],
  progress: STATUS_PROGRESS[status],
}))
