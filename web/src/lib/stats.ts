/**
 * 통계 집계 (기획서 3.2 통계 대시보드) — 전부 순수 함수입니다.
 *
 * 화면 컴포넌트는 여기 함수만 호출하고 직접 집계하지 않습니다.
 * 없는 값은 0 으로 채우지 않고 제외합니다 — "0건" 과 "자료 없음" 은 다른 사실입니다.
 */

import {
  CATEGORIES,
  SEVERITIES,
  STATUSES,
  UNCLASSIFIED_SYSTEM,
  WORK_TYPES,
  type Category,
  type Severity,
  type Status,
  type WorkType,
} from './constants'
import type { LeadTimeRow } from './types'

export interface CountBucket<K extends string> {
  key: K
  count: number
}

/** 시스템은 등록표에서 오므로 코드와 표시명을 함께 담습니다. */
export interface SystemBucket {
  code: string | null
  label: string
  count: number
}

export interface DurationSummary {
  /** 이 지표를 낼 수 있었던 티켓 수 — 평균·중앙값의 모수입니다. */
  samples: number
  averageHours: number | null
  medianHours: number | null
  p90Hours: number | null
  fastestHours: number | null
  slowestHours: number | null
}

const EMPTY_SUMMARY: DurationSummary = {
  samples: 0,
  averageHours: null,
  medianHours: null,
  p90Hours: null,
  fastestHours: null,
  slowestHours: null,
}

export interface DashboardStats {
  total: number
  open: number
  done: number
  byWorkType: CountBucket<WorkType>[]
  bySystem: SystemBucket[]
  bySeverity: CountBucket<Severity>[]
  byStatus: CountBucket<Status>[]
  byCategory: CountBucket<Category>[]
  /** 접수 → 완료. 요청자가 겪은 전체 시간 */
  leadTime: DurationSummary
  /** 접수 → 착수. 손대기까지의 대기 (MTTA) — 장애만 */
  incidentWait: DurationSummary
  /** 착수 → 완료. 실제 수리 시간 (MTTR) — 장애만 */
  incidentRepair: DurationSummary
  leadTimeBySystem: { code: string; label: string; averageHours: number | null; completed: number }[]
  intake: { date: string; count: number }[]
}

function countBy<K extends string>(
  rows: LeadTimeRow[],
  keys: readonly K[],
  field: keyof LeadTimeRow,
): CountBucket<K>[] {
  const counts = new Map<K, number>(keys.map((k) => [k, 0]))
  for (const row of rows) {
    const value = row[field] as unknown as K
    if (counts.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return keys.map((key) => ({ key, count: counts.get(key) ?? 0 }))
}

/** 백분위수. 선형 보간 없이 가장 가까운 아래 인덱스를 씁니다. */
export function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  const clamped = Math.min(1, Math.max(0, fraction))
  const index = Math.min(sorted.length - 1, Math.floor(clamped * (sorted.length - 1)))
  return sorted[index]
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** 시간 배열 하나를 요약합니다. 음수·비유한값은 제외합니다. */
export function summarizeDurations(values: (number | null)[]): DurationSummary {
  const hours = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  )
  if (hours.length === 0) return { ...EMPTY_SUMMARY }

  const sorted = [...hours].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)

  return {
    samples: sorted.length,
    averageHours: total / sorted.length,
    medianHours: median(sorted),
    p90Hours: percentile(sorted, 0.9),
    fastestHours: sorted[0],
    slowestHours: sorted[sorted.length - 1],
  }
}

export function summarizeLeadTime(rows: LeadTimeRow[]): DurationSummary {
  return summarizeDurations(rows.map((row) => row.lead_time_hours))
}

/**
 * 시스템별 건수.
 *
 * 등록표에 없는 코드와 null 은 '미분류' 하나로 모읍니다 — 시스템을 지운 뒤에도
 * 과거 티켓이 사라지지 않고, 대신 미분류로 드러납니다.
 */
export function countBySystem(
  rows: LeadTimeRow[],
  systems: { code: string; name: string }[],
): SystemBucket[] {
  const labels = new Map(systems.map((s) => [s.code, s.name]))
  const counts = new Map<string, number>(systems.map((s) => [s.code, 0]))
  let unclassified = 0

  for (const row of rows) {
    const code = row.system_type
    if (code && counts.has(code)) counts.set(code, (counts.get(code) ?? 0) + 1)
    else unclassified += 1
  }

  const buckets: SystemBucket[] = systems.map((s) => ({
    code: s.code,
    label: labels.get(s.code) ?? s.code,
    count: counts.get(s.code) ?? 0,
  }))

  // 미분류는 0건이면 굳이 보여주지 않습니다. 있으면 반드시 보여줍니다.
  if (unclassified > 0) {
    buckets.push({ code: null, label: UNCLASSIFIED_SYSTEM, count: unclassified })
  }
  return buckets
}

/** 시스템별 평균 리드타임. 완료 건이 없는 시스템은 null 로 남깁니다. */
export function leadTimeBySystem(
  rows: LeadTimeRow[],
  systems: { code: string; name: string }[],
) {
  return systems.map((system) => {
    const summary = summarizeLeadTime(rows.filter((row) => row.system_type === system.code))
    return {
      code: system.code,
      label: system.name,
      averageHours: summary.averageHours,
      completed: summary.samples,
    }
  })
}

/** 최근 N일 접수 추이. 접수가 없던 날도 0으로 채웁니다 — 축이 끊기면 추세가 왜곡됩니다. */
export function intakeTrend(rows: LeadTimeRow[], days = 14, today: Date = new Date()) {
  const buckets = new Map<string, number>()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    buckets.set(date.toISOString().slice(0, 10), 0)
  }

  for (const row of rows) {
    const key = (row.received_at ?? '').slice(0, 10)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  return [...buckets.entries()].map(([date, count]) => ({ date, count }))
}

export function buildDashboardStats(
  rows: LeadTimeRow[],
  systems: { code: string; name: string }[] = [],
  today: Date = new Date(),
): DashboardStats {
  const done = rows.filter((row) => row.status === 'done').length
  // MTTA/MTTR 은 장애만 대상으로 합니다. 신규개발과 섞으면 평균이 무의미해집니다.
  const incidents = rows.filter((row) => row.work_type === 'incident')

  return {
    total: rows.length,
    open: rows.length - done,
    done,
    byWorkType: countBy(rows, WORK_TYPES, 'work_type'),
    bySystem: countBySystem(rows, systems),
    bySeverity: countBy(rows, SEVERITIES, 'severity'),
    byStatus: countBy(rows, STATUSES, 'status'),
    byCategory: countBy(rows, CATEGORIES, 'category'),
    leadTime: summarizeLeadTime(rows),
    incidentWait: summarizeDurations(incidents.map((row) => row.wait_hours)),
    incidentRepair: summarizeDurations(incidents.map((row) => row.repair_hours)),
    leadTimeBySystem: leadTimeBySystem(rows, systems),
    intake: intakeTrend(rows, 14, today),
  }
}
