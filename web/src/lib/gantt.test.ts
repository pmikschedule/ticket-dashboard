import { describe, expect, it } from 'vitest'

import { buildGantt, buildScale, progressOf, resolveSpan, summarizeGantt } from './gantt'
import type { LeadTimeRow } from './types'

function row(overrides: Partial<LeadTimeRow> = {}): LeadTimeRow {
  return {
    ticket_id: 1,
    subject: '정산 모듈 개발',
    received_at: '2026-08-01T09:00:00+09:00',
    due_date: null,
    planned_start_date: null,
    planned_end_date: null,
    status: 'in_progress',
    work_type: 'development',
    severity: 'medium',
    system_type: 'erp',
    category: 'new',
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

const LOOKUPS = { userName: (id: string | null) => (id === 'u1' ? '김영희' : undefined) }
const TODAY = new Date('2026-08-15T12:00:00+09:00')

describe('progressOf', () => {
  it('상태에서 유도합니다', () => {
    expect(progressOf('intake')).toBe(0)
    expect(progressOf('in_progress')).toBe(40)
    expect(progressOf('done')).toBe(100)
  })
})

describe('resolveSpan', () => {
  it('계획 일정이 둘 다 있으면 그대로', () => {
    const span = resolveSpan(row({ planned_start_date: '2026-08-10', planned_end_date: '2026-09-10' }))
    expect(span?.inferred).toBe(false)
    expect(span?.start.getMonth()).toBe(7)
  })

  it('계획이 없으면 접수일·기한으로 대신 (inferred)', () => {
    const span = resolveSpan(row({ due_date: '2026-09-01' }))
    expect(span?.inferred).toBe(true)
  })

  it('계획이 한쪽만 있으면 나머지를 실측값으로 메웁니다', () => {
    const span = resolveSpan(row({ planned_start_date: '2026-08-05', due_date: '2026-09-01' }))
    expect(span?.inferred).toBe(true)
    expect(span?.start.getDate()).toBe(5)
  })

  it('둘 다 없으면 null — 일정을 지어내지 않습니다', () => {
    expect(resolveSpan(row({ due_date: null }))).toBeNull()
  })

  it('종료가 시작보다 빠르면 시작에 맞춥니다', () => {
    const span = resolveSpan(row({ planned_start_date: '2026-09-10', planned_end_date: '2026-08-01' }))
    expect(span!.end.getTime()).toBeGreaterThanOrEqual(span!.start.getTime())
  })
})

describe('buildScale', () => {
  it('빈 입력은 null', () => {
    expect(buildScale([], TODAY)).toBeNull()
  })

  it('오늘이 범위 밖이면 축에 포함시킵니다', () => {
    const scale = buildScale(
      [{ start: new Date('2026-01-01'), end: new Date('2026-01-10') }],
      TODAY,
    )!
    expect(scale.end.getTime()).toBeGreaterThan(TODAY.getTime())
    expect(scale.todayPercent).not.toBeNull()
  })

  it('월 구분선이 생깁니다', () => {
    const scale = buildScale(
      [{ start: new Date('2026-08-01'), end: new Date('2026-10-01') }],
      TODAY,
    )!
    expect(scale.months.length).toBeGreaterThanOrEqual(3)
  })
})

describe('buildGantt', () => {
  it('신규개발만 대상입니다', () => {
    const model = buildGantt(
      [
        row({ ticket_id: 1, work_type: 'development', due_date: '2026-09-01' }),
        row({ ticket_id: 2, work_type: 'incident', due_date: '2026-09-01' }),
        row({ ticket_id: 3, work_type: 'maintenance', due_date: '2026-09-01' }),
      ],
      LOOKUPS,
      TODAY,
    )
    expect(model.bars).toHaveLength(1)
    expect(model.bars[0].ticketId).toBe(1)
  })

  it('일정을 알 수 없는 건은 막대 대신 undated 로', () => {
    const model = buildGantt([row({ due_date: null })], LOOKUPS, TODAY)
    expect(model.bars).toHaveLength(0)
    expect(model.undated).toHaveLength(1)
    expect(model.undated[0].assignee).toBe('미배정')
  })

  it('막대는 시작일 순으로 정렬', () => {
    const model = buildGantt(
      [
        row({ ticket_id: 9, planned_start_date: '2026-09-01', planned_end_date: '2026-09-10' }),
        row({ ticket_id: 2, planned_start_date: '2026-08-01', planned_end_date: '2026-08-10' }),
      ],
      LOOKUPS,
      TODAY,
    )
    expect(model.bars.map((b) => b.ticketId)).toEqual([2, 9])
  })

  it('종료가 지났는데 완료가 아니면 기한 초과', () => {
    const model = buildGantt(
      [row({ planned_start_date: '2026-07-01', planned_end_date: '2026-08-01' })],
      LOOKUPS,
      TODAY,
    )
    expect(model.bars[0].overdue).toBe(true)
  })

  it('완료된 건은 종료가 지나도 초과가 아닙니다', () => {
    const model = buildGantt(
      [row({ status: 'done', planned_start_date: '2026-07-01', planned_end_date: '2026-08-01' })],
      LOOKUPS,
      TODAY,
    )
    expect(model.bars[0].overdue).toBe(false)
  })

  it('막대 좌표가 0~100 안에 들어옵니다', () => {
    const model = buildGantt(
      [
        row({ ticket_id: 1, planned_start_date: '2026-08-01', planned_end_date: '2026-08-20' }),
        row({ ticket_id: 2, planned_start_date: '2026-09-01', planned_end_date: '2026-12-31' }),
      ],
      LOOKUPS,
      TODAY,
    )
    for (const bar of model.bars) {
      expect(bar.offsetPercent).toBeGreaterThanOrEqual(0)
      expect(bar.offsetPercent + bar.widthPercent).toBeLessThanOrEqual(100.01)
      expect(bar.widthPercent).toBeGreaterThan(0)
    }
  })

  it('하루짜리도 보이는 너비를 갖습니다', () => {
    const model = buildGantt(
      [row({ planned_start_date: '2026-08-14', planned_end_date: '2026-08-14' })],
      LOOKUPS,
      TODAY,
    )
    expect(model.bars[0].widthPercent).toBeGreaterThan(0)
  })

  it('담당자 이름을 붙입니다', () => {
    const model = buildGantt(
      [row({ assignee_id: 'u1', due_date: '2026-09-01' })],
      LOOKUPS,
      TODAY,
    )
    expect(model.bars[0].assignee).toBe('김영희')
  })
})

describe('summarizeGantt', () => {
  it('일정 있음·미정·초과·유추를 셉니다', () => {
    const model = buildGantt(
      [
        row({ ticket_id: 1, planned_start_date: '2026-08-01', planned_end_date: '2026-08-20' }),
        row({ ticket_id: 2, due_date: '2026-08-05' }), // inferred + overdue
        row({ ticket_id: 3, due_date: null }), // undated
        row({ ticket_id: 4, status: 'done', planned_start_date: '2026-08-01', planned_end_date: '2026-08-10' }),
      ],
      LOOKUPS,
      TODAY,
    )
    const summary = summarizeGantt(model)
    expect(summary.total).toBe(4)
    expect(summary.dated).toBe(3)
    expect(summary.undated).toBe(1)
    expect(summary.inferred).toBe(1)
    expect(summary.done).toBe(1)
    expect(summary.overdue).toBe(1)
  })

  it('빈 모델', () => {
    const summary = summarizeGantt(buildGantt([], LOOKUPS, TODAY))
    expect(summary.total).toBe(0)
  })
})
