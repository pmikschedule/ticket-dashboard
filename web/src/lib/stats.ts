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
  SYSTEM_TYPES,
  type Category,
  type Severity,
  type Status,
  type SystemType,
} from './constants'
import type { LeadTimeRow } from './types'

export interface CountBucket<K extends string> {
  key: K
  count: number
}

export interface LeadTimeSummary {
  /** 완료된 티켓 수 — 평균·중앙값의 모수입니다. */
  completed: number
  averageHours: number | null
  medianHours: number | null
  p90Hours: number | null
  fastestHours: number | null
  slowestHours: number | null
}

export interface DashboardStats {
  total: number
  open: number
  done: number
  bySystem: CountBucket<SystemType>[]
  bySeverity: CountBucket<Severity>[]
  byStatus: CountBucket<Status>[]
  byCategory: CountBucket<Category>[]
  leadTime: LeadTimeSummary
  leadTimeBySystem: { key: SystemType; averageHours: number | null; completed: number }[]
  intake: { date: string; count: number }[]
}

function countBy<K extends string>(rows: LeadTimeRow[], keys: readonly K[], field: keyof LeadTimeRow) {
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

export function summarizeLeadTime(rows: LeadTimeRow[]): LeadTimeSummary {
  const hours = rows
    .map((row) => row.lead_time_hours)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)

  if (hours.length === 0) {
    return {
      completed: 0,
      averageHours: null,
      medianHours: null,
      p90Hours: null,
      fastestHours: null,
      slowestHours: null,
    }
  }

  const sorted = [...hours].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)

  return {
    completed: sorted.length,
    averageHours: total / sorted.length,
    medianHours: median(sorted),
    p90Hours: percentile(sorted, 0.9),
    fastestHours: sorted[0],
    slowestHours: sorted[sorted.length - 1],
  }
}

/** 시스템별 평균 리드타임. 완료 건이 없는 시스템은 null 로 남깁니다. */
export function leadTimeBySystem(rows: LeadTimeRow[]) {
  return SYSTEM_TYPES.map((key) => {
    const summary = summarizeLeadTime(rows.filter((row) => row.system_type === key))
    return { key, averageHours: summary.averageHours, completed: summary.completed }
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

export function buildDashboardStats(rows: LeadTimeRow[], today: Date = new Date()): DashboardStats {
  const done = rows.filter((row) => row.status === 'done').length

  return {
    total: rows.length,
    open: rows.length - done,
    done,
    bySystem: countBy(rows, SYSTEM_TYPES, 'system_type'),
    bySeverity: countBy(rows, SEVERITIES, 'severity'),
    byStatus: countBy(rows, STATUSES, 'status'),
    byCategory: countBy(rows, CATEGORIES, 'category'),
    leadTime: summarizeLeadTime(rows),
    leadTimeBySystem: leadTimeBySystem(rows),
    intake: intakeTrend(rows, 14, today),
  }
}
