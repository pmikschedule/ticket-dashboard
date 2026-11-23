import { describe, expect, it } from 'vitest'
import {
  STALE_RUNNING_MINUTES,
  WARN_EVERY_MS,
  isMissingObject,
  readableError,
  shouldWarn,
  staleCutoff,
  withTimeout,
} from '../src/requests.ts'
import { SCAN_REQUEST_STATUSES } from '../src/types.ts'

describe('수집 요청 — 상태 코드값', () => {
  it('schema.sql 25장 check 제약 · web constants 와 같은 네 값입니다', () => {
    // 여기가 틀리면 저장이 check 제약에 걸려 요청이 running 에 멈춥니다
    expect([...SCAN_REQUEST_STATUSES]).toEqual(['pending', 'running', 'done', 'failed'])
  })
})

describe('멈춘 요청 판정', () => {
  it(`집어 간 지 ${STALE_RUNNING_MINUTES}분 전이 경계입니다`, () => {
    const now = new Date('2026-11-23T02:30:00.000Z')
    expect(staleCutoff(now)).toBe('2026-11-23T02:20:00.000Z')
  })

  it('분을 바꿀 수 있습니다', () => {
    expect(staleCutoff(new Date('2026-11-23T02:30:00.000Z'), 1)).toBe('2026-11-23T02:29:00.000Z')
  })
})

describe('실패 이유 — 팀원 전원이 읽으므로 비밀값을 지웁니다', () => {
  it('사람이 읽을 문장은 그대로 둡니다', () => {
    const msg = '쿠키가 2026-11-25 12:44 에 만료됐습니다. Chrome 으로 desk 에 다시 로그인하세요.'
    expect(readableError(new Error(msg))).toBe(msg)
  })

  it('JWT 를 가립니다', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl'
    const out = readableError(new Error(`요청 실패 token=${jwt}`))
    expect(out).not.toContain('eyJ')
    expect(out).toContain('•••')
  })

  it('CF_Authorization 쿠키 값을 가립니다', () => {
    const out = readableError(new Error('Cookie: CF_Authorization=abc.def.ghi; path=/'))
    expect(out).toContain('CF_Authorization=•••')
    expect(out).not.toContain('abc.def.ghi')
  })

  it('Supabase 키를 가립니다', () => {
    const out = readableError(new Error('key sb_secret_AbCdEf123 and sb_publishable_Xyz'))
    expect(out).not.toMatch(/sb_secret_[A-Za-z0-9]/)
    expect(out).not.toMatch(/sb_publishable_[A-Za-z0-9]/)
  })

  it('Bearer 와 긴 토큰 덩어리를 가립니다', () => {
    const long = 'a'.repeat(40)
    const out = readableError(new Error(`Authorization: Bearer xyz123 / ${long}`))
    expect(out).not.toContain('xyz123')
    expect(out).not.toContain(long)
  })

  it('긴 문장은 화면 한 줄로 자릅니다', () => {
    const out = readableError(new Error('가'.repeat(500)))
    expect(out.length).toBeLessThanOrEqual(300)
    expect(out.endsWith('…')).toBe(true)
  })

  it('Error 가 아니어도, 비어 있어도 문장을 돌려줍니다', () => {
    expect(readableError('문자열 오류')).toBe('문자열 오류')
    expect(readableError(new Error(''))).toBe('이유가 기록되지 않은 오류')
    expect(readableError(undefined)).toBe('이유가 기록되지 않은 오류')
  })
})

describe('경고 간격 — 30초마다 같은 실패를 찍지 않습니다', () => {
  const t0 = 1_000_000
  it('처음이면 찍습니다', () => {
    expect(shouldWarn(null, 'x', t0)).toBe(true)
  })
  it('같은 내용이 한 시간 안에 또 나면 안 찍습니다', () => {
    expect(shouldWarn({ at: t0, msg: 'x' }, 'x', t0 + 30_000)).toBe(false)
  })
  it('한 시간이 지나면 다시 찍습니다', () => {
    expect(shouldWarn({ at: t0, msg: 'x' }, 'x', t0 + WARN_EVERY_MS)).toBe(true)
  })
  it('내용이 바뀌면 바로 찍습니다', () => {
    expect(shouldWarn({ at: t0, msg: 'x' }, 'y', t0 + 30_000)).toBe(true)
  })
})

describe('표가 아직 없다는 오류', () => {
  it('PostgREST·Postgres 코드로 알아봅니다', () => {
    expect(isMissingObject({ code: 'PGRST202', message: '' })).toBe(true)
    expect(isMissingObject({ code: 'PGRST205', message: '' })).toBe(true)
    expect(isMissingObject({ code: '42P01', message: '' })).toBe(true)
  })
  it('문구로도 알아봅니다', () => {
    expect(isMissingObject({ message: 'Could not find the function public.desk_scan_waiting(p_stale_minutes) in the schema cache' })).toBe(true)
  })
  it('권한 오류는 표가 없는 것이 아닙니다', () => {
    expect(isMissingObject({ code: '42501', message: 'permission denied for table desk_scan_requests' })).toBe(false)
    expect(isMissingObject(null)).toBe(false)
  })
})

describe('시간 상한', () => {
  it('제때 끝나면 값을 그대로 돌려줍니다', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, '늦음')).resolves.toBe(7)
  })
  it('넘으면 이유를 붙여 거절합니다', async () => {
    const never = new Promise<number>(() => {})
    await expect(withTimeout(never, 10, '수집이 끝나지 않았습니다')).rejects.toThrow('수집이 끝나지 않았습니다')
  })
})
