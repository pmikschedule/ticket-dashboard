import { describe, expect, it } from 'vitest'

import { buildWeeklyRows, selectWeekly, summarizeWeekly, weekRange, weeklyFileName } from './weekly'
import type { LeadTimeRow } from './types'

function row(overrides: Partial<LeadTimeRow> = {}): LeadTimeRow {
  return {
    ticket_id: 1,
    subject: '제목',
    received_at: '2026-08-05T09:00:00+09:00',
    due_date: null,
    planned_start_date: null,
    planned_end_date: null,
    status: 'in_progress',
    work_type: 'maintenance',
    severity: 'medium',
    system_type: 'erp',
    category: 'error',
    assignee_id: null,
    estimated_days: null,
    promoted_at: null,
    completed_at: null,
    started_at: null,
    wait_hours: null,
    repair_hours: null,
    lead_time_hours: null,
    ...overrides,
  }
}

const LOOKUPS = {
  systemLabel: (code: string | null) => (code === 'erp' ? 'ERP' : undefined),
  userName: (id: string | null) => (id === 'u1' ? '김영희' : undefined),
}

// 2026-08-06 은 목요일 → 그 주는 8/3(월) ~ 8/9(일)
const THURSDAY = new Date('2026-08-06T12:00:00+09:00')

describe('weekRange', () => {
  it('월요일부터 일요일까지', () => {
    const range = weekRange(THURSDAY)
    expect(range.start.getDay()).toBe(1)
    expect(range.end.getDay()).toBe(0)
    expect(range.label).toBe('2026-08-03 ~ 2026-08-09')
  })

  it('일요일에도 그 주의 월요일을 시작으로 봅니다', () => {
    // 2026-08-09 는 일요일. 다음 주가 아니라 8/3 시작이어야 합니다.
    expect(weekRange(new Date('2026-08-09T12:00:00+09:00')).label).toBe('2026-08-03 ~ 2026-08-09')
  })

  it('월요일도 그날이 시작', () => {
    expect(weekRange(new Date('2026-08-03T00:30:00+09:00')).label).toBe('2026-08-03 ~ 2026-08-09')
  })

  it('offset 으로 지난 주', () => {
    expect(weekRange(THURSDAY, 1).label).toBe('2026-07-27 ~ 2026-08-02')
  })
})

describe('selectWeekly', () => {
  const range = weekRange(THURSDAY)

  it('신규개발은 제외합니다', () => {
    const rows = selectWeekly([row({ work_type: 'development' })], range)
    expect(rows).toHaveLength(0)
  })

  it('금주 완료된 건은 포함', () => {
    const rows = selectWeekly(
      [row({ status: 'done', completed_at: '2026-08-05T10:00:00+09:00' })],
      range,
    )
    expect(rows).toHaveLength(1)
  })

  it('지난 주에 완료된 건은 제외', () => {
    const rows = selectWeekly(
      [row({ status: 'done', completed_at: '2026-07-28T10:00:00+09:00', received_at: '2026-07-20T10:00:00+09:00' })],
      range,
    )
    expect(rows).toHaveLength(0)
  })

  it('이월된 진행 중 건은 포함 — 접수가 지난 주여도', () => {
    const rows = selectWeekly([row({ received_at: '2026-07-01T10:00:00+09:00' })], range)
    expect(rows).toHaveLength(1)
  })

  it('장애도 대상입니다', () => {
    expect(selectWeekly([row({ work_type: 'incident' })], range)).toHaveLength(1)
  })
})

describe('buildWeeklyRows', () => {
  const range = weekRange(THURSDAY)

  it('구분이 붙습니다', () => {
    const rows = buildWeeklyRows(
      [
        row({ ticket_id: 1, status: 'done', completed_at: '2026-08-05T10:00:00+09:00' }),
        row({ ticket_id: 2, received_at: '2026-08-04T10:00:00+09:00' }),
        row({ ticket_id: 3, received_at: '2026-06-01T10:00:00+09:00' }),
      ],
      range,
      LOOKUPS,
      THURSDAY,
    )
    expect(rows.map((r) => r.bucket)).toEqual(['금주 완료', '금주 접수', '진행 중'])
  })

  it('코드값이 아니라 한글 라벨', () => {
    const rows = buildWeeklyRows([row({ work_type: 'incident' })], range, LOOKUPS, THURSDAY)
    expect(rows[0].workType).toBe('장애')
    expect(rows[0].severity).toBe('Medium')
    expect(rows[0].status).toBe('진행 중')
  })

  it('등록표에 없는 시스템은 미분류', () => {
    const rows = buildWeeklyRows([row({ system_type: 'sap' })], range, LOOKUPS, THURSDAY)
    expect(rows[0].system).toBe('미분류')
  })

  it('담당자가 없으면 미배정', () => {
    expect(buildWeeklyRows([row()], range, LOOKUPS, THURSDAY)[0].assignee).toBe('미배정')
  })

  it('기한 초과 표시', () => {
    const rows = buildWeeklyRows([row({ due_date: '2026-08-01' })], range, LOOKUPS, THURSDAY)
    expect(rows[0].overdue).toBe('초과')
  })

  it('완료된 건은 기한이 지나도 초과가 아닙니다', () => {
    const rows = buildWeeklyRows(
      [row({ status: 'done', due_date: '2026-08-01', completed_at: '2026-08-05T10:00:00+09:00' })],
      range,
      LOOKUPS,
      THURSDAY,
    )
    expect(rows[0].overdue).toBe('')
  })

  it('소요 시간은 완료된 건만', () => {
    const rows = buildWeeklyRows(
      [
        row({ ticket_id: 1, status: 'done', completed_at: '2026-08-05T10:00:00+09:00', lead_time_hours: 6 }),
        row({ ticket_id: 2 }),
      ],
      range,
      LOOKUPS,
      THURSDAY,
    )
    expect(rows[0].leadTime).toBe('6.0시간')
    expect(rows[1].leadTime).toBe('')
  })

  it('하루 넘으면 일 단위', () => {
    const rows = buildWeeklyRows(
      [row({ status: 'done', completed_at: '2026-08-05T10:00:00+09:00', lead_time_hours: 48 })],
      range,
      LOOKUPS,
      THURSDAY,
    )
    expect(rows[0].leadTime).toBe('2.0일')
  })

  it('완료 → 접수 → 진행중 순으로 정렬', () => {
    const rows = buildWeeklyRows(
      [
        row({ ticket_id: 9, received_at: '2026-06-01T10:00:00+09:00' }),
        row({ ticket_id: 3, status: 'done', completed_at: '2026-08-05T10:00:00+09:00' }),
      ],
      range,
      LOOKUPS,
      THURSDAY,
    )
    expect(rows.map((r) => r.ticketId)).toEqual([3, 9])
  })
})

describe('summarizeWeekly', () => {
  const range = weekRange(THURSDAY)

  it('구분별 건수와 기한 초과', () => {
    const rows = buildWeeklyRows(
      [
        row({ ticket_id: 1, status: 'done', completed_at: '2026-08-05T10:00:00+09:00' }),
        row({ ticket_id: 2, received_at: '2026-08-04T10:00:00+09:00' }),
        row({ ticket_id: 3, received_at: '2026-06-01T10:00:00+09:00', due_date: '2026-07-01' }),
      ],
      range,
      LOOKUPS,
      THURSDAY,
    )
    const summary = summarizeWeekly(rows)
    expect(summary).toEqual({ completed: 1, received: 1, ongoing: 1, overdue: 1 })
  })

  it('빈 목록', () => {
    expect(summarizeWeekly([])).toEqual({ completed: 0, received: 0, ongoing: 0, overdue: 0 })
  })
})

describe('weeklyFileName', () => {
  it('기간이 파일명에 들어갑니다', () => {
    expect(weeklyFileName(weekRange(THURSDAY))).toBe('주간현황_2026-08-03_2026-08-09.xlsx')
  })
})
