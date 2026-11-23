import { describe, expect, it } from 'vitest'

import constants from '../../../contracts/desk/constants.json'
import cookies from '../../../contracts/desk/cookies.json'
import daysLeftCases from '../../../contracts/desk/days_left.json'
import { SCAN_REQUEST_STATUSES } from './constants'
import {
  DESK_AUTH_SOURCES,
  DESK_COOKIE_SECRET,
  DESK_EXPIRY_WARN_DAYS,
  DESK_SETTING,
  daysLeft,
  deskAuthNotice,
  normalizeCookie,
  parseDeskCookie,
  readDeskStatus,
  type DeskAgentStatus,
} from './deskAuth'
import { SCAN_STALE_MINUTES } from './deskScan'

/*
 * 저장소 루트 contracts/desk 를 에이전트(pytest)·reporter(vitest)도 함께 읽습니다.
 * 여기가 틀리면 화면이 에이전트가 적은 값을 못 읽거나, 에이전트가 화면이 넣은 쿠키를
 * 못 찾습니다 — 둘 다 오류 없이 조용히 '없음' 이 됩니다.
 */

describe('계약 — 이름과 값 (contracts/desk/constants.json)', () => {
  it('수집 요청 상태 · 멈춤 판정', () => {
    expect([...SCAN_REQUEST_STATUSES]).toEqual(constants.request_statuses)
    expect(SCAN_STALE_MINUTES).toBe(constants.stale_running_minutes)
  })

  it('쿠키 비밀값 이름 · 상태 설정 이름 · 출처', () => {
    expect(DESK_COOKIE_SECRET).toBe(constants.secret_keys.cookie)
    expect({
      auth_source: DESK_SETTING.authSource,
      cookie_expires_at: DESK_SETTING.cookieExpiresAt,
      last_scan_at: DESK_SETTING.lastScanAt,
      last_scan_ok: DESK_SETTING.lastScanOk,
      last_scan_note: DESK_SETTING.lastScanNote,
    }).toEqual(constants.setting_keys)
    expect([...DESK_AUTH_SOURCES]).toEqual(constants.auth_sources)
    expect(DESK_EXPIRY_WARN_DAYS).toBe(constants.expiry_warn_days)
  })
})

describe('붙여 넣은 쿠키 (contracts/desk/cookies.json)', () => {
  for (const c of cookies.cases) {
    it(c.name, () => {
      expect(normalizeCookie(c.raw)).toBe(c.normalized)
      const r = parseDeskCookie(c.raw)
      if (c.error) {
        expect(r.ok).toBe(false)
        expect(!r.ok && r.kind).toBe(c.error)
        expect(!r.ok && r.message.length > 0).toBe(true)
      } else {
        expect(r.ok && r.expiresAt.toISOString()).toBe(c.expires_at)
        expect(r.token).toBe(c.normalized)
      }
    })
  }
})

describe('남은 일수 (contracts/desk/days_left.json)', () => {
  for (const c of daysLeftCases.cases) {
    it(c.name, () => {
      expect(daysLeft(new Date(c.expires_at), Date.parse(c.now))).toBe(c.days)
    })
  }
})

describe('에이전트가 적은 상태 읽기', () => {
  it('빈 문자열은 없음입니다 — 스키마가 미리 만든 빈 행', () => {
    const s = readDeskStatus([
      { key: DESK_SETTING.authSource, value: '' },
      { key: DESK_SETTING.cookieExpiresAt, value: '' },
      { key: DESK_SETTING.lastScanOk, value: '' },
    ])
    expect(s).toEqual({ source: null, expiresAt: null, lastScanAt: null, lastScanOk: null, lastScanNote: null })
  })

  it('값이 있으면 그대로', () => {
    const s = readDeskStatus([
      { key: DESK_SETTING.authSource, value: 'settings' },
      { key: DESK_SETTING.cookieExpiresAt, value: '2026-11-25T03:44:00.000Z' },
      { key: DESK_SETTING.lastScanAt, value: '2026-11-23T09:00:00.000Z' },
      { key: DESK_SETTING.lastScanOk, value: 'false' },
      { key: DESK_SETTING.lastScanNote, value: 'desk 인증 만료 (정기)' },
      { key: 'gemini_model', value: 'x' },
    ])
    expect(s.source).toBe('settings')
    expect(s.lastScanOk).toBe(false)
    expect(s.lastScanNote).toBe('desk 인증 만료 (정기)')
  })

  it('모르는 출처 값은 없음으로 — 지어내지 않습니다', () => {
    expect(readDeskStatus([{ key: DESK_SETTING.authSource, value: 'magic' }]).source).toBeNull()
  })
})

describe('만료 배너', () => {
  const NOW = Date.parse('2026-11-23T03:00:00.000Z') // 11/23 12:00 KST
  const status = (over: Partial<DeskAgentStatus>): DeskAgentStatus => ({
    source: 'settings',
    expiresAt: '2026-12-25T03:44:00.000Z',
    lastScanAt: null,
    lastScanOk: null,
    lastScanNote: null,
    ...over,
  })

  it('넉넉하면 안 띄웁니다', () => {
    expect(deskAuthNotice(status({}), NOW)).toBeNull()
  })

  it(`${DESK_EXPIRY_WARN_DAYS}일 전부터 경고 — 날짜를 밝힙니다`, () => {
    const n = deskAuthNotice(status({ expiresAt: '2026-11-25T03:44:00.000Z' }), NOW)
    expect(n?.level).toBe('warn')
    expect(n?.text).toContain('2일 뒤')
    expect(n?.text).toContain('11/25 12:44')
  })

  it('8일 남았으면 아직 안 띄웁니다', () => {
    expect(deskAuthNotice(status({ expiresAt: '2026-12-01T04:00:00.000Z' }), NOW)).toBeNull()
  })

  it('하루가 안 남았으면 그렇게 말합니다', () => {
    expect(deskAuthNotice(status({ expiresAt: '2026-11-23T05:00:00.000Z' }), NOW)?.text).toContain('하루 안에')
  })

  it('만료됐으면 오류 — 수집이 멈췄다고 말합니다', () => {
    const n = deskAuthNotice(status({ expiresAt: '2026-11-20T00:00:00.000Z' }), NOW)
    expect(n?.level).toBe('error')
    expect(n?.text).toContain('만료됐습니다')
  })

  it('인증이 없으면 오류', () => {
    expect(deskAuthNotice(status({ source: 'none', expiresAt: null }), NOW)?.level).toBe('error')
  })

  it('에이전트가 아직 아무것도 안 적었으면 안 띄웁니다 — 고칠 수 없는 경고가 됩니다', () => {
    expect(deskAuthNotice(status({ source: null, expiresAt: '2026-11-20T00:00:00.000Z' }), NOW)).toBeNull()
  })

  it('Service Token 은 만료가 없습니다', () => {
    expect(deskAuthNotice(status({ source: 'service_token', expiresAt: null }), NOW)).toBeNull()
  })
})
