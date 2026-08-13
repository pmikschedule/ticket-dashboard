/**
 * 주간 구간 경계 검사 — **화요일 ~ 그다음 월요일**.
 *
 * 팀의 보고 주기가 화~월이라 ISO 주차(월~일)에서 옮겨 왔습니다. 경계를 한 칸
 * 틀리면 같은 업무가 두 주에 세어지거나 어느 주에도 안 들어갑니다. 그리고
 * 그 사실은 몇 주 뒤 합계가 안 맞을 때에야 드러납니다.
 */

import { describe, expect, it } from 'vitest'
import {
  currentWeek,
  inWeek,
  nextWeek,
  parseWeekLabel,
  previousWeek,
  rangeLabel,
  weekEnding,
  weekOf,
} from '../src/week.ts'

// 2026-08-04 화 / 08-10 월 / 08-11 화 / 08-13 목
describe('구간 잡기', () => {
  it('화요일에 시작해 다음 월요일에 끝납니다', () => {
    const w = weekOf('2026-08-04')
    expect(w.from).toBe('2026-08-04')
    expect(w.to).toBe('2026-08-10')
    expect(w.id).toBe('2026-08-10')
  })

  it('구간 안의 어느 날을 줘도 같은 구간이 나옵니다', () => {
    for (const d of ['2026-08-04', '2026-08-07', '2026-08-09', '2026-08-10']) {
      expect(weekOf(d).id).toBe('2026-08-10')
    }
  })

  it('월요일 다음날(화)은 다음 구간입니다', () => {
    expect(weekOf('2026-08-11').id).toBe('2026-08-17')
    expect(weekOf('2026-08-11').from).toBe('2026-08-11')
  })

  it('주말은 앞선 화요일의 구간에 들어갑니다', () => {
    // 8/8(토)·8/9(일)은 8/4 화요일에 시작한 주의 일부입니다
    expect(weekOf('2026-08-08').from).toBe('2026-08-04')
    expect(weekOf('2026-08-09').to).toBe('2026-08-10')
  })
})

describe('기본 구간 — 방금 끝난 주', () => {
  it('목요일에 뽑으면 그 주 월요일로 끝나는 구간입니다', () => {
    // "지난 화요일부터 금주 월요일까지"
    const w = currentWeek('2026-08-13')
    expect(w.from).toBe('2026-08-04')
    expect(w.to).toBe('2026-08-10')
  })

  it('월요일 당일에 뽑으면 그날로 끝나는 구간입니다', () => {
    expect(currentWeek('2026-08-10').to).toBe('2026-08-10')
  })

  it('화요일에 뽑으면 어제 끝난 구간입니다 — 시작하자마자인 주를 보고하지 않습니다', () => {
    expect(currentWeek('2026-08-11').to).toBe('2026-08-10')
  })

  it('일요일에 뽑아도 아직 안 끝난 주를 잡지 않습니다', () => {
    // 8/9(일)은 8/4~8/10 주의 한가운데. 방금 끝난 주는 그 앞입니다.
    expect(currentWeek('2026-08-09').to).toBe('2026-08-03')
  })
})

describe('지정과 이동', () => {
  it('끝나는 월요일로 지정합니다', () => {
    expect(parseWeekLabel('2026-08-10')!.from).toBe('2026-08-04')
  })

  it('월요일이 아니면 거부합니다', () => {
    // 어느 주를 뜻하는지 알 수 없으므로 되묻는 편이 낫습니다
    expect(parseWeekLabel('2026-08-13')).toBeNull()
    expect(weekEnding('2026-08-13')).toBeNull()
  })

  it('형식이 틀리면 null 입니다', () => {
    expect(parseWeekLabel('2026-W33')).toBeNull()
    expect(parseWeekLabel('')).toBeNull()
  })

  it('앞뒤 주로 7일씩 움직입니다', () => {
    const w = parseWeekLabel('2026-08-10')!
    expect(previousWeek(w).to).toBe('2026-08-03')
    expect(nextWeek(w).to).toBe('2026-08-17')
    expect(nextWeek(w).from).toBe('2026-08-11')
  })

  it('연말을 넘어가도 7일 간격이 유지됩니다', () => {
    const w = weekOf('2026-12-29') // 화
    expect(w.from).toBe('2026-12-29')
    expect(w.to).toBe('2027-01-04')
  })
})

describe('표기와 포함 판정', () => {
  it('요일을 붙여 보여 줍니다', () => {
    expect(rangeLabel(parseWeekLabel('2026-08-10')!)).toBe('8/4(화) ~ 8/10(월)')
  })

  it('경계 날짜가 안팎으로 정확합니다', () => {
    const w = parseWeekLabel('2026-08-10')!
    expect(inWeek('2026-08-04', w)).toBe(true)
    expect(inWeek('2026-08-10', w)).toBe(true)
    expect(inWeek('2026-08-03', w)).toBe(false)
    expect(inWeek('2026-08-11', w)).toBe(false)
    expect(inWeek(null, w)).toBe(false)
  })
})
