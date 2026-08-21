import { describe, expect, it } from 'vitest'
import { daysBetween } from '../src/desk.ts'

/**
 * 스냅샷 나이는 곧 **보고서가 밀린 정도**입니다. 주간 보고서는 대시보드에 올라간
 * 최신 스냅샷의 날짜로 구간을 정하므로, 여기가 늙으면 화면은 멀쩡한 얼굴로
 * 지난 구간을 만들어 냅니다. `doctor` 가 그 사실을 찍기 위해 씁니다.
 */
describe('daysBetween', () => {
  it('같은 날은 0일입니다', () => {
    expect(daysBetween('2026-08-21', '2026-08-21')).toBe(0)
  })

  it('여드레를 여드레로 셉니다', () => {
    expect(daysBetween('2026-08-13', '2026-08-21')).toBe(8)
  })

  it('달을 넘어도 셉니다', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3)
  })

  it('서머타임이 있는 구간에서도 하루가 밀리지 않습니다 — UTC 로만 계산합니다', () => {
    // 로컬 타임존으로 파싱하면 23시간·25시간짜리 날이 생겨 반올림이 어긋납니다
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })

  it('시각이 붙어 있어도 날짜만 봅니다', () => {
    expect(daysBetween('2026-08-13T23:59:00Z', '2026-08-14T00:01:00Z')).toBe(1)
  })

  it('앞선 날짜는 음수입니다 — 0 으로 접지 않습니다 (부르는 쪽이 정합니다)', () => {
    expect(daysBetween('2026-08-21', '2026-08-14')).toBe(-7)
  })
})
