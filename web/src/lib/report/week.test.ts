import { describe, expect, it } from 'vitest'

import { currentWeek, rangeLabel, todayIso, weekForSnapshot } from './week'

/**
 * 스냅샷이 밀리면 보고서도 밀립니다. **밀렸다는 사실이 화면에 뜨는지**가
 * 여기서 지키려는 것입니다 — 조용히 지난 구간을 만들어 내면 서식도 건수도
 * 멀쩡해 보여서 아무도 못 알아챕니다.
 */
describe('weekForSnapshot — 만들 수 있는 구간과 만들어야 할 구간', () => {
  it('당일 스냅샷이면 최신입니다', () => {
    // 2026-08-21 은 금요일. 방금 끝난 구간은 8/11(화) ~ 8/17(월)
    const r = weekForSnapshot('2026-08-21', '2026-08-21')
    expect(r.target.id).toBe('2026-08-17')
    expect(r.buildable.id).toBe('2026-08-17')
    expect(r.fresh).toBe(true)
    expect(r.behindWeeks).toBe(0)
  })

  it('구간 마감일 당일 스냅샷도 그 구간을 덮습니다 — 월요일 저녁 스캔이 정상 운영입니다', () => {
    const r = weekForSnapshot('2026-08-17', '2026-08-18')
    expect(r.target.id).toBe('2026-08-17')
    expect(r.fresh).toBe(true)
  })

  it('여드레 밀린 스냅샷은 한 주 전 구간밖에 못 만듭니다', () => {
    const r = weekForSnapshot('2026-08-13', '2026-08-21')
    expect(r.target.id).toBe('2026-08-17')
    expect(r.buildable.id).toBe('2026-08-10')
    expect(r.fresh).toBe(false)
    expect(r.behindWeeks).toBe(1)
  })

  it('한 달 밀리면 네 주 밀립니다 — 주 수로 세야 "얼마나" 가 읽힙니다', () => {
    const r = weekForSnapshot('2026-07-20', '2026-08-21')
    expect(r.behindWeeks).toBe(4)
    expect(r.fresh).toBe(false)
  })

  it('구간 안에서 뜬 스냅샷은 아직 그 구간을 못 덮습니다', () => {
    // 8/13(목)은 8/11~8/17 구간의 한복판입니다. 그 구간은 아직 안 끝났습니다
    const r = weekForSnapshot('2026-08-13', '2026-08-13')
    expect(r.target.id).toBe('2026-08-10')
    expect(r.buildable.id).toBe('2026-08-10')
    expect(r.fresh).toBe(true)
    expect(r.behindWeeks).toBe(0)
  })

  it('앞선 스냅샷을 음수로 세지 않습니다', () => {
    const r = weekForSnapshot('2026-08-21', '2026-08-14')
    expect(r.behindWeeks).toBe(0)
    expect(r.fresh).toBe(true)
  })

  it('만드는 구간을 사람이 읽는 말로 내놓습니다', () => {
    const r = weekForSnapshot('2026-08-13', '2026-08-21')
    expect(rangeLabel(r.buildable)).toBe('8/4(화) ~ 8/10(월)')
    expect(rangeLabel(r.target)).toBe('8/11(화) ~ 8/17(월)')
  })

  it('오늘만으로 정하던 구간과 뜻이 같습니다', () => {
    expect(weekForSnapshot('2026-08-21', '2026-08-21').target).toEqual(currentWeek('2026-08-21'))
  })
})

describe('todayIso — 로컬 달력의 오늘', () => {
  it('UTC 로 바꾸지 않습니다 — 한국 아침에 어제가 나오면 구간이 한 주 밀립니다', () => {
    // 로컬 8/21 08:00. toISOString() 이면 UTC 로 8/20 이 됩니다 (KST 기준)
    expect(todayIso(new Date(2026, 7, 21, 8, 0, 0))).toBe('2026-08-21')
  })

  it('한 자리 월·일을 0 으로 채웁니다', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59, 0))).toBe('2026-01-05')
  })
})
