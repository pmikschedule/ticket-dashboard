import { describe, expect, it } from 'vitest'

import { buildDashboardStats, intakeTrend, median, percentile, summarizeLeadTime } from './stats'
import type { LeadTimeRow } from './types'

function row(overrides: Partial<LeadTimeRow> = {}): LeadTimeRow {
  return {
    ticket_id: 1,
    subject: '제목',
    received_at: '2026-08-05T09:00:00+00:00',
    status: 'intake',
    severity: 'medium',
    system_type: 'erp',
    category: 'error',
    assignee_id: null,
    completed_at: null,
    lead_time_hours: null,
    ...overrides,
  }
}

describe('median', () => {
  it('빈 배열은 null', () => {
    expect(median([])).toBeNull()
  })
  it('홀수 개는 가운데 값', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('짝수 개는 가운데 두 값의 평균', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('percentile', () => {
  it('빈 배열은 null', () => {
    expect(percentile([], 0.9)).toBeNull()
  })
  it('P90', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
  })
  it('범위를 벗어난 비율은 잘라냅니다', () => {
    expect(percentile([1, 2, 3], 5)).toBe(3)
    expect(percentile([1, 2, 3], -1)).toBe(1)
  })
})

describe('summarizeLeadTime', () => {
  it('완료 건이 없으면 전부 null — 0 으로 채우지 않습니다', () => {
    const summary = summarizeLeadTime([row(), row()])
    expect(summary.completed).toBe(0)
    expect(summary.averageHours).toBeNull()
    expect(summary.medianHours).toBeNull()
  })

  it('완료 건만 모수에 넣습니다', () => {
    const summary = summarizeLeadTime([
      row({ lead_time_hours: 2 }),
      row({ lead_time_hours: 4 }),
      row({ lead_time_hours: null }),
    ])
    expect(summary.completed).toBe(2)
    expect(summary.averageHours).toBe(3)
  })

  it('음수 리드타임은 제외합니다', () => {
    // 완료를 되돌렸다 다시 완료하는 등으로 시각이 뒤집힐 수 있습니다.
    const summary = summarizeLeadTime([row({ lead_time_hours: -5 }), row({ lead_time_hours: 10 })])
    expect(summary.completed).toBe(1)
    expect(summary.averageHours).toBe(10)
  })

  it('최소·최대를 함께 냅니다', () => {
    const summary = summarizeLeadTime([
      row({ lead_time_hours: 1 }),
      row({ lead_time_hours: 50 }),
      row({ lead_time_hours: 10 }),
    ])
    expect(summary.fastestHours).toBe(1)
    expect(summary.slowestHours).toBe(50)
  })
})

describe('intakeTrend', () => {
  const today = new Date('2026-08-10T00:00:00Z')

  it('접수가 없던 날도 0 으로 채웁니다', () => {
    const trend = intakeTrend([], 7, today)
    expect(trend).toHaveLength(7)
    expect(trend.every((entry) => entry.count === 0)).toBe(true)
  })

  it('마지막 항목이 오늘', () => {
    const trend = intakeTrend([], 7, today)
    expect(trend[trend.length - 1].date).toBe('2026-08-10')
  })

  it('같은 날짜는 합산합니다', () => {
    const trend = intakeTrend(
      [
        row({ received_at: '2026-08-09T01:00:00+00:00' }),
        row({ received_at: '2026-08-09T20:00:00+00:00' }),
      ],
      7,
      today,
    )
    expect(trend.find((entry) => entry.date === '2026-08-09')?.count).toBe(2)
  })

  it('기간을 벗어난 접수는 버립니다', () => {
    const trend = intakeTrend([row({ received_at: '2026-01-01T00:00:00+00:00' })], 7, today)
    expect(trend.reduce((sum, entry) => sum + entry.count, 0)).toBe(0)
  })
})

describe('buildDashboardStats', () => {
  const rows = [
    row({ ticket_id: 1, status: 'done', severity: 'critical', system_type: 'erp', lead_time_hours: 6 }),
    row({ ticket_id: 2, status: 'in_progress', severity: 'high', system_type: 'api' }),
    row({ ticket_id: 3, status: 'intake', severity: 'medium', system_type: 'erp' }),
  ]

  it('전체·완료·진행 수', () => {
    const stats = buildDashboardStats(rows)
    expect(stats.total).toBe(3)
    expect(stats.done).toBe(1)
    expect(stats.open).toBe(2)
  })

  it('모든 코드값이 버킷에 남습니다 — 0건도 항목이 사라지지 않습니다', () => {
    const stats = buildDashboardStats(rows)
    expect(stats.bySystem).toHaveLength(5)
    expect(stats.bySeverity).toHaveLength(4)
    expect(stats.byStatus).toHaveLength(6)
    expect(stats.byCategory).toHaveLength(4)
    expect(stats.bySystem.find((b) => b.key === 'infra')?.count).toBe(0)
  })

  it('시스템별 집계', () => {
    const stats = buildDashboardStats(rows)
    expect(stats.bySystem.find((b) => b.key === 'erp')?.count).toBe(2)
    expect(stats.bySystem.find((b) => b.key === 'api')?.count).toBe(1)
  })

  it('완료 건이 없는 시스템의 평균 리드타임은 null', () => {
    const stats = buildDashboardStats(rows)
    const api = stats.leadTimeBySystem.find((entry) => entry.key === 'api')
    expect(api?.averageHours).toBeNull()
    expect(api?.completed).toBe(0)
  })

  it('빈 입력에도 터지지 않습니다', () => {
    const stats = buildDashboardStats([])
    expect(stats.total).toBe(0)
    expect(stats.leadTime.averageHours).toBeNull()
  })
})
