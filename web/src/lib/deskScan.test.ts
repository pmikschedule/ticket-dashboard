import { describe, expect, it } from 'vitest'

import { SCAN_REQUEST_STATUSES } from './constants'
import {
  SCAN_FRESH_MINUTES,
  SCAN_POLL_MS,
  SCAN_WAIT_MS,
  isMissingTable,
  judgePoll,
  planScan,
  pollAttempts,
  progressText,
  shortDay,
  wantsFreshScan,
} from './deskScan'
import { resolveWeek } from './report/week'
import type { ScanRequestRow } from './types'

const NOW = Date.parse('2026-11-23T02:30:00.000Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

function req(over: Partial<ScanRequestRow>): ScanRequestRow {
  return {
    id: 1,
    status: 'pending',
    requested_by: 'u',
    requested_at: ago(1),
    started_at: null,
    finished_at: null,
    snapshot_day: null,
    error: null,
    ...over,
  }
}

describe('수집 요청 상태 코드값', () => {
  it('schema.sql 25장 · reporter/src/types.ts 와 같은 네 값입니다', () => {
    expect([...SCAN_REQUEST_STATUSES]).toEqual(['pending', 'running', 'done', 'failed'])
  })
})

describe('planScan — 요청할지, 같이 기다릴지, 방금 것을 쓸지', () => {
  it('아무 요청도 없으면 새로 요청합니다', () => {
    expect(planScan([], NOW).kind).toBe('request')
  })

  it('대기 중인 요청이 있으면 새로 넣지 않고 같이 기다립니다', () => {
    const p = planScan([req({ id: 7, status: 'pending' })], NOW)
    expect(p).toEqual({ kind: 'wait', request: expect.objectContaining({ id: 7 }) })
  })

  it('수집 중인 요청도 같이 기다립니다', () => {
    const p = planScan([req({ id: 8, status: 'running', started_at: ago(0.5) })], NOW)
    expect(p.kind).toBe('wait')
  })

  it(`${SCAN_FRESH_MINUTES}분 안에 끝난 수집은 다시 요청하지 않고 씁니다`, () => {
    const p = planScan(
      [req({ id: 3, status: 'done', requested_at: ago(2), finished_at: ago(SCAN_FRESH_MINUTES - 1), snapshot_day: '2026-11-23' })],
      NOW,
    )
    expect(p).toEqual({ kind: 'reuse', request: expect.objectContaining({ id: 3 }) })
  })

  it('그보다 오래된 수집은 다시 요청합니다 — 그사이 desk 를 고쳤을 수 있습니다', () => {
    const p = planScan([req({ status: 'done', requested_at: ago(10), finished_at: ago(SCAN_FRESH_MINUTES + 1) })], NOW)
    expect(p.kind).toBe('request')
  })

  it('열린 요청이 방금 끝난 수집보다 먼저입니다 — 그 뒤에 들어온 요청입니다', () => {
    const p = planScan(
      [
        req({ id: 3, status: 'done', requested_at: ago(2), finished_at: ago(1) }),
        req({ id: 4, status: 'pending', requested_at: ago(0.5) }),
      ],
      NOW,
    )
    expect(p).toEqual({ kind: 'wait', request: expect.objectContaining({ id: 4 }) })
  })

  it('실패한 요청은 다시 쓰지 않고 새로 요청합니다 — 그사이 쿠키를 갱신했을 수 있습니다', () => {
    expect(planScan([req({ status: 'failed', finished_at: ago(0.5), error: '쿠키 만료' })], NOW).kind).toBe('request')
  })

  it('10분 넘게 멈춘 수집은 기다리지 않습니다 — 기다리면 시간 초과만 남습니다', () => {
    const p = planScan([req({ status: 'running', requested_at: ago(15), started_at: ago(14) })], NOW)
    expect(p.kind).toBe('request')
  })
})

describe('judgePoll — 기다리는 요청의 지금 상태', () => {
  it('끝났으면 스냅샷 날짜와 함께 끝냅니다', () => {
    expect(judgePoll(req({ status: 'done', snapshot_day: '2026-11-23' }), 5_000)).toEqual({ kind: 'done', day: '2026-11-23' })
  })

  it('실패했으면 수집 PC 가 적은 이유를 그대로 보여 줍니다', () => {
    const v = judgePoll(req({ status: 'failed', error: '쿠키가 만료됐습니다' }), 5_000)
    expect(v).toEqual({ kind: 'failed', reason: '쿠키가 만료됐습니다' })
  })

  it('이유가 비어 있어도 빈 문장으로 두지 않습니다', () => {
    const v = judgePoll(req({ status: 'failed', error: '  ' }), 5_000)
    expect(v.kind === 'failed' && v.reason.length > 0).toBe(true)
  })

  it('요청이 사라졌으면 실패입니다', () => {
    expect(judgePoll(null, 0).kind).toBe('failed')
  })

  it('상한 전에는 기다립니다 — 대기와 수집 중을 구분합니다', () => {
    expect(judgePoll(req({ status: 'pending' }), 12_400)).toEqual({ kind: 'waiting', phase: 'pending', elapsedSec: 12 })
    expect(judgePoll(req({ status: 'running' }), 20_000)).toEqual({ kind: 'waiting', phase: 'running', elapsedSec: 20 })
  })

  it('상한을 넘기면 시간 초과 — 아무도 안 집었으면 수집 PC 를 말합니다', () => {
    const v = judgePoll(req({ status: 'pending' }), SCAN_WAIT_MS)
    expect(v.kind).toBe('timeout')
    expect(v.kind === 'timeout' && v.reason).toContain('수집 PC')
  })

  it('수집 중에 상한을 넘기면 수집이 늦다고 말합니다', () => {
    const v = judgePoll(req({ status: 'running' }), SCAN_WAIT_MS + 1)
    expect(v.kind === 'timeout' && v.reason).toContain('끝나지 않았습니다')
  })

  it('시간은 화면이 기다리기 시작한 뒤로 잽니다 — 남이 오래전에 넣은 요청도 바로 끊지 않습니다', () => {
    // requested_at 은 20분 전이지만 우리가 기다린 것은 3초
    expect(judgePoll(req({ status: 'pending', requested_at: ago(20) }), 3_000).kind).toBe('waiting')
  })
})

describe('기다림의 상한', () => {
  it('약 3초 간격으로 2분 — 무한히 돌지 않게 횟수로 묶습니다', () => {
    expect(SCAN_POLL_MS).toBe(3_000)
    expect(SCAN_WAIT_MS).toBe(120_000)
    expect(pollAttempts()).toBe(41)
  })

  it('진행 문구는 단계를 구분합니다', () => {
    expect(progressText({ phase: 'pending', elapsedSec: 9 })).toContain('응답 대기 9초')
    expect(progressText({ phase: 'running', elapsedSec: 4 })).toContain('읽는 중 4초')
  })
})

describe('wantsFreshScan — 오늘 구간을 만들 때만 받습니다', () => {
  it('구간을 안 골랐으면(기본값) 받습니다', () => {
    expect(wantsFreshScan(null, '2026-11-23')).toBe(true)
  })
  it('오늘이 속한 구간을 골랐으면 받습니다', () => {
    // 2026-11-23 은 월요일 — 그날로 끝나는 구간
    expect(wantsFreshScan('2026-11-23', '2026-11-23')).toBe(true)
  })
  it('지난 구간이면 안 받습니다 — 오늘 스냅샷은 그 구간 밖입니다', () => {
    expect(wantsFreshScan('2026-11-16', '2026-11-23')).toBe(false)
  })
})

describe('표가 아직 없다는 오류 — 화면이 깨지지 않고 그 사실을 밝힙니다', () => {
  it('PostgREST 코드와 문구로 알아봅니다', () => {
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.desk_scan_requests' in the schema cache" })).toBe(true)
    expect(isMissingTable({ code: '42P01', message: 'relation does not exist' })).toBe(true)
    expect(isMissingTable({ message: "Could not find the table 'public.desk_scan_requests'" })).toBe(true)
  })
  it('권한 오류·중복은 표가 없는 것이 아닙니다', () => {
    expect(isMissingTable({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false)
    expect(isMissingTable({ code: '23505', message: 'duplicate key value' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
})

describe('shortDay', () => {
  it('MM/DD 로 줄입니다', () => {
    expect(shortDay('2026-11-17')).toBe('11/17')
    expect(shortDay(null)).toBe('?')
  })
})

describe('resolveWeek — 화면과 생성 버튼이 같은 구간을 고릅니다', () => {
  const days = ['2026-11-09', '2026-11-10', '2026-11-16', '2026-11-17']

  it('받기 전: 11/17 스냅샷 · 오늘 11/23(월) → 11/17~11/23 구간, 현재 11/17', () => {
    const r = resolveWeek('2026-11-17', days, null, '2026-11-23')
    expect(r.week.id).toBe('2026-11-23')
    expect(r.plan.current).toBe('2026-11-17')
    expect(r.plan.base).toBe('2026-11-16')
  })

  it('받은 뒤: 11/23 스냅샷이 현재가 되고 기준은 그대로입니다', () => {
    const r = resolveWeek('2026-11-23', days, null, '2026-11-23')
    expect(r.week.id).toBe('2026-11-23')
    expect(r.plan.current).toBe('2026-11-23')
    expect(r.plan.base).toBe('2026-11-16')
  })

  it('지난 구간을 고르면 그 구간의 스냅샷을 씁니다', () => {
    const r = resolveWeek('2026-11-23', days, '2026-11-16', '2026-11-23')
    expect(r.week.id).toBe('2026-11-16')
    expect(r.plan.current).toBe('2026-11-16')
  })
})
