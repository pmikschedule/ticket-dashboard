import { describe, expect, it } from 'vitest'

import { opsDeltaLabel, summarizeOps, type ReportTicket } from './ops'
import { weekOf } from './week'

// 8/4(화) ~ 8/10(월)
const WEEK = weekOf('2026-08-05')

function ticket(over: Partial<ReportTicket> = {}): ReportTicket {
  return {
    id: 1,
    title: '요청',
    receivedAt: '2026-08-05',
    workType: 'maintenance',
    category: 'improve',
    severity: 'medium',
    status: 'in_progress',
    system: null,
    ...over,
  }
}

describe('주간 운영 현황', () => {
  it('그 주에 접수된 것만 셉니다', () => {
    const list = [
      ticket({ id: 1, receivedAt: '2026-08-04' }),
      ticket({ id: 2, receivedAt: '2026-08-10' }),
      ticket({ id: 3, receivedAt: '2026-08-03' }),
      ticket({ id: 4, receivedAt: '2026-08-11' }),
    ]
    expect(summarizeOps(list, WEEK).total).toBe(2)
  })

  it('대분류와 중분류를 따로 셉니다', () => {
    // 둘은 다른 축입니다 — 유지보수이면서 개선일 수 있습니다.
    const list = [
      ticket({ id: 1, workType: 'incident', category: 'error' }),
      ticket({ id: 2, workType: 'maintenance', category: 'improve' }),
      ticket({ id: 3, workType: 'development', category: 'new' }),
    ]
    const ops = summarizeOps(list, WEEK)
    expect(ops.byWorkType).toEqual({ incident: 1, maintenance: 1, development: 1 })
    expect(ops.byCategory).toEqual({ error: 1, improve: 1, fix: 0, new: 1 })
  })

  it('6단계를 완료·진행·대기 셋으로 접습니다', () => {
    const list = [
      ticket({ id: 1, status: 'intake' }),
      ticket({ id: 2, status: 'triage' }),
      ticket({ id: 3, status: 'in_progress' }),
      ticket({ id: 4, status: 'testing' }),
      ticket({ id: 5, status: 'deploy' }),
      ticket({ id: 6, status: 'done' }),
    ]
    expect(summarizeOps(list, WEEK).progress).toEqual({ waiting: 2, doing: 3, done: 1 })
  })

  it('등급 모수는 장애뿐입니다', () => {
    // 유지보수 티켓에도 등급 컬럼은 있습니다(DB 기본값 medium). 그것까지 세면
    // '보통 장애' 가 유지보수 건수만큼 부풀어 오릅니다.
    const list = [
      ticket({ id: 1, workType: 'incident', severity: 'critical', title: '결제 중단' }),
      ticket({ id: 2, workType: 'maintenance', severity: 'medium' }),
    ]
    const ops = summarizeOps(list, WEEK)
    expect(ops.severity).toEqual({ critical: 1, major: 0, normal: 0 })
    expect(ops.criticalTitles).toEqual(['결제 중단'])
  })

  it('매우심각 목록에 시스템을 붙입니다', () => {
    const list = [ticket({ workType: 'incident', severity: 'critical', title: '오류', system: 'BRS' })]
    expect(summarizeOps(list, WEEK).criticalTitles).toEqual(['오류 (BRS)'])
  })
})

describe('전주 대비', () => {
  it('전주 건수를 셉니다', () => {
    const list = [
      ticket({ id: 1, receivedAt: '2026-07-29' }), // 전주(7/28~8/3)
      ticket({ id: 2, receivedAt: '2026-08-05' }),
      ticket({ id: 3, receivedAt: '2026-08-06' }),
    ]
    const ops = summarizeOps(list, WEEK)
    expect(ops.prevTotal).toBe(1)
    expect(opsDeltaLabel(ops)).toBe('전주 1건 대비 ▲1')
  })

  it('집계 시작 이전이면 null 입니다 — 0 으로 채우지 않습니다', () => {
    // "전주 0건 대비 ▲12" 는 그 주에 갑자기 몰린 것처럼 읽힙니다.
    const list = [ticket({ receivedAt: '2026-08-05' })]
    const ops = summarizeOps(list, WEEK)
    expect(ops.prevTotal).toBeNull()
    expect(opsDeltaLabel(ops)).toContain('집계 시작 전')
  })

  it('전주가 실제로 0건이면 0 입니다', () => {
    const list = [
      ticket({ id: 1, receivedAt: '2026-07-20' }), // 전전주
      ticket({ id: 2, receivedAt: '2026-08-05' }),
    ]
    const ops = summarizeOps(list, WEEK)
    expect(ops.prevTotal).toBe(0)
    expect(opsDeltaLabel(ops)).toBe('전주 0건 대비 ▲1')
  })

  it('같으면 △0', () => {
    const list = [ticket({ id: 1, receivedAt: '2026-07-29' }), ticket({ id: 2, receivedAt: '2026-08-05' })]
    expect(opsDeltaLabel(summarizeOps(list, WEEK))).toBe('전주 1건 대비 △0')
  })
})
