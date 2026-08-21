import { describe, expect, it } from 'vitest'

import { rangeLabel, todayIso, weekForSnapshot, weekOf } from './week'

/**
 * 스냅샷이 밀리면 보고서도 밀립니다. **밀렸다는 사실이 화면에 뜨는지**가
 * 여기서 지키려는 것입니다 — 조용히 지난 구간을 만들어 내면 서식도 건수도
 * 멀쩡해 보여서 아무도 못 알아챕니다.
 */
describe('weekForSnapshot — 오늘이 속한 구간을 만듭니다', () => {
  it('금요일에 만들면 그 주 구간입니다 — 지지난주가 아니라', () => {
    // 2026-08-21 은 금요일. 오늘이 속한 구간은 8/18(화) ~ 8/24(월)
    const r = weekForSnapshot('2026-08-21', '2026-08-21')
    expect(r.target.id).toBe('2026-08-24')
    expect(r.target.from).toBe('2026-08-18')
    expect(r.buildable.id).toBe('2026-08-24')
    expect(r.fresh).toBe(true)
    expect(r.behindWeeks).toBe(0)
  })

  it('월요일은 그날로 끝나는 구간에 속합니다', () => {
    const r = weekForSnapshot('2026-08-24', '2026-08-24')
    expect(r.target.id).toBe('2026-08-24')
    expect(r.fresh).toBe(true)
  })

  it('구간 시작 전 스냅샷으로는 그 구간을 못 만듭니다', () => {
    // 스냅샷 8/13 은 8/18 시작 구간을 담을 수 없습니다
    const r = weekForSnapshot('2026-08-13', '2026-08-21')
    expect(r.target.id).toBe('2026-08-24')
    expect(r.buildable.id).toBe('2026-08-17')
    expect(r.fresh).toBe(false)
    expect(r.behindWeeks).toBe(1)
  })

  it('구간 시작 당일 스냅샷이면 만들 수 있습니다', () => {
    const r = weekForSnapshot('2026-08-18', '2026-08-21')
    expect(r.buildable.id).toBe('2026-08-24')
    expect(r.fresh).toBe(true)
  })

  it('한 달 밀리면 다섯 주 밀립니다 — 주 수로 세야 "얼마나" 가 읽힙니다', () => {
    const r = weekForSnapshot('2026-07-20', '2026-08-21')
    expect(r.behindWeeks).toBe(5)
    expect(r.fresh).toBe(false)
  })

  it('앞선 스냅샷을 음수로 세지 않습니다', () => {
    const r = weekForSnapshot('2026-08-21', '2026-08-19')
    expect(r.behindWeeks).toBe(0)
    expect(r.fresh).toBe(true)
  })

  it('만드는 구간을 사람이 읽는 말로 내놓습니다', () => {
    const r = weekForSnapshot('2026-08-21', '2026-08-21')
    expect(rangeLabel(r.buildable)).toBe('8/18(화) ~ 8/24(월)')
  })

  it('밀렸을 때는 만들 구간과 만들어야 할 구간이 다릅니다', () => {
    const r = weekForSnapshot('2026-08-13', '2026-08-21')
    expect(rangeLabel(r.buildable)).toBe('8/11(화) ~ 8/17(월)')
    expect(rangeLabel(r.target)).toBe('8/18(화) ~ 8/24(월)')
  })

  it('오늘이 속한 구간은 weekOf 와 같습니다', () => {
    expect(weekForSnapshot('2026-08-21', '2026-08-21').target).toEqual(weekOf('2026-08-21'))
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
