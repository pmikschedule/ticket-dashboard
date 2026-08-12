import { describe, expect, it } from 'vitest'

import {
  daysSince,
  formatBytes,
  formatHours,
  fromDateTimeInput,
  initials,
  relativeDays,
  toDateTimeInput,
} from './format'

describe('formatHours', () => {
  it('1시간 미만은 분', () => expect(formatHours(0.5)).toBe('30분'))
  it('하루 미만은 시간', () => expect(formatHours(5)).toBe('5.0시간'))
  it('하루 이상은 일', () => expect(formatHours(48)).toBe('2.0일'))
  it('null 은 대시', () => expect(formatHours(null)).toBe('-'))
  it('음수는 대시', () => expect(formatHours(-3)).toBe('-'))
  it('NaN 은 대시', () => expect(formatHours(Number.NaN)).toBe('-'))
})

describe('formatBytes', () => {
  it('1KB 미만', () => expect(formatBytes(512)).toBe('512 B'))
  it('KB', () => expect(formatBytes(2048)).toBe('2.0 KB'))
  it('MB', () => expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB'))
  it('null', () => expect(formatBytes(null)).toBe('-'))
})

describe('daysSince / relativeDays', () => {
  const today = new Date('2026-08-10T12:00:00Z')

  it('오늘', () => expect(relativeDays('2026-08-10T01:00:00Z', today)).toBe('오늘'))
  it('어제', () => expect(relativeDays('2026-08-09T01:00:00Z', today)).toBe('어제'))
  it('며칠 전', () => expect(relativeDays('2026-08-05T01:00:00Z', today)).toBe('5일 전'))
  it('미래 날짜는 0일로 눌러 담습니다', () => {
    expect(daysSince('2026-09-01T00:00:00Z', today)).toBe(0)
  })
  it('null', () => expect(relativeDays(null, today)).toBe('-'))
  it('깨진 값', () => expect(daysSince('어제', today)).toBeNull())
})

describe('toDateTimeInput / fromDateTimeInput', () => {
  // 테스트가 도는 시간대를 모르므로 '왕복하면 같은 시각' 으로 검증합니다.
  // 두 함수 중 한쪽만 로컬/UTC 를 잘못 다루면 여기서 어긋납니다.
  it('왕복하면 같은 시각 (분 단위)', () => {
    const iso = '2026-08-05T09:34:00.000Z'
    expect(fromDateTimeInput(toDateTimeInput(iso))).toBe(iso)
  })

  it('입력 칸 모양은 분까지, 초·Z 는 없습니다', () => {
    expect(toDateTimeInput('2026-08-05T09:34:56.000Z')).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    )
  })

  it('초는 버립니다 — 칸이 분 단위입니다', () => {
    expect(fromDateTimeInput(toDateTimeInput('2026-08-05T09:34:56.000Z'))).toBe(
      '2026-08-05T09:34:00.000Z',
    )
  })

  it('빈 값·깨진 값', () => {
    expect(toDateTimeInput(null)).toBe('')
    expect(toDateTimeInput('어제')).toBe('')
    expect(fromDateTimeInput('')).toBeNull()
    expect(fromDateTimeInput('   ')).toBeNull()
    expect(fromDateTimeInput('2026-13-99T99:99')).toBeNull()
  })
})

describe('initials', () => {
  it('두 글자', () => expect(initials('김영희')).toBe('김영'))
  it('빈 값', () => expect(initials('')).toBe('?'))
  it('null', () => expect(initials(null)).toBe('?'))
})
