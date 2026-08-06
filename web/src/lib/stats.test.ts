import { describe, expect, it } from 'vitest'

import {
  buildDashboardStats,
  countBySystem,
  intakeTrend,
  median,
  percentile,
  summarizeLeadTime,
} from './stats'
import type { LeadTimeRow } from './types'

function row(overrides: Partial<LeadTimeRow> = {}): LeadTimeRow {
  return {
    ticket_id: 1,
    subject: '제목',
    received_at: '2026-08-05T09:00:00+00:00',
    due_date: null,
    planned_start_date: null,
    planned_end_date: null,
    status: 'intake',
    work_type: 'maintenance',
    severity: 'medium',
    system_type: 'erp',
    category: 'error',
    assignee_id: null,
    estimated_days: null,
    promoted_at: null,
    completed_at: null,
    resolution: null,
    hold_reason: null,
    hold_hours: 0,
    started_at: null,
    wait_hours: null,
    repair_hours: null,
    lead_time_hours: null,
    ...overrides,
  }
}

const SYSTEMS = [
  { code: 'erp', name: 'ERP' },
  { code: 'api', name: '연동 API' },
]

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
    expect(summary.samples).toBe(0)
    expect(summary.averageHours).toBeNull()
    expect(summary.medianHours).toBeNull()
  })

  it('완료 건만 모수에 넣습니다', () => {
    const summary = summarizeLeadTime([
      row({ lead_time_hours: 2 }),
      row({ lead_time_hours: 4 }),
      row({ lead_time_hours: null }),
    ])
    expect(summary.samples).toBe(2)
    expect(summary.averageHours).toBe(3)
  })

  it('음수 리드타임은 제외합니다', () => {
    // 완료를 되돌렸다 다시 완료하는 등으로 시각이 뒤집힐 수 있습니다.
    const summary = summarizeLeadTime([row({ lead_time_hours: -5 }), row({ lead_time_hours: 10 })])
    expect(summary.samples).toBe(1)
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
    const stats = buildDashboardStats(rows, SYSTEMS)
    expect(stats.bySeverity).toHaveLength(4)
    expect(stats.byStatus).toHaveLength(7)
    expect(stats.byCategory).toHaveLength(4)
    expect(stats.byWorkType).toHaveLength(3)
  })

  it('시스템별 집계', () => {
    const stats = buildDashboardStats(rows, SYSTEMS)
    expect(stats.bySystem.find((b) => b.code === 'erp')?.count).toBe(2)
    expect(stats.bySystem.find((b) => b.code === 'api')?.count).toBe(1)
  })

  it('완료 건이 없는 시스템의 평균 리드타임은 null', () => {
    const stats = buildDashboardStats(rows, SYSTEMS)
    const api = stats.leadTimeBySystem.find((entry) => entry.code === 'api')
    expect(api?.averageHours).toBeNull()
    expect(api?.completed).toBe(0)
  })

  it('빈 입력에도 터지지 않습니다', () => {
    const stats = buildDashboardStats([])
    expect(stats.total).toBe(0)
    expect(stats.leadTime.averageHours).toBeNull()
  })
})

describe('countBySystem — 등록표 기반', () => {
  it('등록되지 않은 코드는 미분류로 모읍니다', () => {
    const buckets = countBySystem([row({ system_type: 'sap' }), row({ system_type: 'erp' })], SYSTEMS)
    expect(buckets.find((b) => b.code === 'erp')?.count).toBe(1)
    expect(buckets.find((b) => b.code === null)?.label).toBe('미분류')
    expect(buckets.find((b) => b.code === null)?.count).toBe(1)
  })

  it('null 시스템도 미분류', () => {
    const buckets = countBySystem([row({ system_type: null })], SYSTEMS)
    expect(buckets.find((b) => b.code === null)?.count).toBe(1)
  })

  it('미분류가 0건이면 항목을 만들지 않습니다', () => {
    const buckets = countBySystem([row({ system_type: 'erp' })], SYSTEMS)
    expect(buckets.some((b) => b.code === null)).toBe(false)
  })

  it('등록표가 비어 있으면 전부 미분류', () => {
    const buckets = countBySystem([row({ system_type: 'erp' })], [])
    expect(buckets).toHaveLength(1)
    expect(buckets[0].code).toBeNull()
  })
})

describe('MTTA / MTTR — 장애만 대상', () => {
  const mixed = [
    row({ work_type: 'incident', wait_hours: 2, repair_hours: 4 }),
    row({ work_type: 'incident', wait_hours: 6, repair_hours: 8 }),
    // 신규개발은 섞이면 평균이 무의미해지므로 제외돼야 합니다
    row({ work_type: 'development', wait_hours: 500, repair_hours: 900 }),
  ]

  it('장애 건만 모수에 넣습니다', () => {
    const stats = buildDashboardStats(mixed)
    expect(stats.incidentWait.samples).toBe(2)
    expect(stats.incidentRepair.samples).toBe(2)
  })

  it('대기와 수리를 따로 냅니다', () => {
    const stats = buildDashboardStats(mixed)
    expect(stats.incidentWait.averageHours).toBe(4)
    expect(stats.incidentRepair.averageHours).toBe(6)
  })

  it('장애가 없으면 null — 0 이 아닙니다', () => {
    const stats = buildDashboardStats([row({ work_type: 'maintenance' })])
    expect(stats.incidentRepair.samples).toBe(0)
    expect(stats.incidentRepair.averageHours).toBeNull()
  })

  it('착수하지 않은 장애는 수리 시간 모수에서 빠집니다', () => {
    const stats = buildDashboardStats([
      row({ work_type: 'incident', wait_hours: null, repair_hours: null }),
    ])
    expect(stats.incidentRepair.samples).toBe(0)
  })
})

describe('종료 방식과 통계 모수', () => {
  it('반려·중복·취소·처리안함은 리드타임 모수에서 빠집니다', () => {
    const rows = [
      row({ ticket_id: 1, resolution: 'fixed', lead_time_hours: 10 }),
      row({ ticket_id: 2, resolution: 'rejected', lead_time_hours: 0.05 }),
      row({ ticket_id: 3, resolution: 'duplicate', lead_time_hours: 0.05 }),
      row({ ticket_id: 4, resolution: 'cancelled', lead_time_hours: 0.05 }),
      row({ ticket_id: 5, resolution: 'wontfix', lead_time_hours: 0.05 }),
    ]
    const summary = summarizeLeadTime(rows)
    expect(summary.samples).toBe(1)
    expect(summary.averageHours).toBe(10)
  })

  it('종료 방식이 없는 건은 남깁니다 — 빼면 옛 데이터의 모수가 사라집니다', () => {
    const summary = summarizeLeadTime([row({ resolution: null, lead_time_hours: 8 })])
    expect(summary.samples).toBe(1)
  })

  it('MTTR 모수에서도 반려가 빠집니다', () => {
    const stats = buildDashboardStats([
      row({ ticket_id: 1, work_type: 'incident', resolution: 'fixed', repair_hours: 6 }),
      row({ ticket_id: 2, work_type: 'incident', resolution: 'rejected', repair_hours: 0.01 }),
    ])
    expect(stats.incidentRepair.samples).toBe(1)
    expect(stats.incidentRepair.averageHours).toBe(6)
  })

  it('완료 건의 종료 방식을 세고, 안 고른 건은 따로 셉니다', () => {
    const stats = buildDashboardStats([
      row({ ticket_id: 1, status: 'done', resolution: 'fixed' }),
      row({ ticket_id: 2, status: 'done', resolution: 'rejected' }),
      row({ ticket_id: 3, status: 'done', resolution: null }),
      row({ ticket_id: 4, status: 'in_progress', resolution: null }),
    ])
    const byKey = Object.fromEntries(stats.byResolution.map((b) => [b.key, b.count]))
    expect(byKey.fixed).toBe(1)
    expect(byKey.rejected).toBe(1)
    // 완료가 아닌 건은 종료 방식 집계에 끼지 않습니다.
    expect(stats.unspecifiedResolution).toBe(1)
  })

  it('보류 중인 건을 셉니다', () => {
    const stats = buildDashboardStats([
      row({ ticket_id: 1, status: 'on_hold' }),
      row({ ticket_id: 2, status: 'in_progress' }),
    ])
    expect(stats.onHold).toBe(1)
  })
})
