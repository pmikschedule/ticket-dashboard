/**
 * desk 수집 계약 — 저장소 루트 `contracts/desk/*.json`.
 *
 * desk 수집은 이 도구에서 에이전트(사내 윈도우 PC)로 옮겨 갔습니다. 같은 파일을
 * 에이전트(pytest)·웹(vitest)도 읽습니다. 여기서 통과하고 그쪽에서도 통과하면 두
 * 구현이 **같은 행**을 올리고 같은 날을 덮어씁니다. 이 도구는 비상 수집용으로 남아
 * 있으므로 규칙이 갈라지면 안 됩니다. 자료는 전부 가상입니다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { daysLeft, jwtExpiry } from '../src/cookie.ts'
import { fetchState, makeSnapshot } from '../src/desk.ts'
import { SCAN_TIMEOUT_MS, STALE_RUNNING_MINUTES, readableError } from '../src/requests.ts'
import { SCAN_REQUEST_STATUSES } from '../src/types.ts'
import type { DeskState } from '../src/types.ts'
import { snapshotRow, toUpload } from '../src/upload.ts'

// cookie.ts 는 Chrome 쿠키 DB 를 읽으려고 `node:sqlite` 를 불러옵니다. vite 가 그 내장
// 모듈을 못 찾으므로 빈 것으로 바꿉니다 — 여기서 쓰는 것은 jwtExpiry·daysLeft 뿐입니다.
vi.mock('node:sqlite', () => ({ DatabaseSync: class {} }))

const DIR = join(import.meta.dirname, '..', '..', 'contracts', 'desk')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (name: string): any => JSON.parse(readFileSync(join(DIR, name), 'utf8'))

describe('계약 — 큐 상수 (constants.json)', () => {
  const c = load('constants.json')
  it('상태 네 값 · 멈춤 10분 · 스캔 상한 3분', () => {
    expect([...SCAN_REQUEST_STATUSES]).toEqual(c.request_statuses)
    expect(STALE_RUNNING_MINUTES).toBe(c.stale_running_minutes)
    expect(SCAN_TIMEOUT_MS / 1000).toBe(c.scan_timeout_seconds)
  })
})

describe('계약 — 스냅샷 → 행 (snapshot_rows.json)', () => {
  for (const c of load('snapshot_rows.json').cases) {
    it(c.name, () => {
      const row = snapshotRow(makeSnapshot(c.response.state as DeskState, new Date(c.scanned_at)))
      expect(row).toEqual(c.expected_row)
      expect(Object.keys(row).sort()).toEqual(['counts', 'day', 'scanned_at', 'source_at', 'state'])
    })
  }
})

describe('계약 — 올릴 것 (to_upload.json)', () => {
  for (const c of load('to_upload.json').cases) {
    it(c.name, () => {
      expect(toUpload(c.local, new Map(Object.entries(c.remote as Record<string, string>)))).toEqual(c.expected)
    })
  }
})

describe('계약 — 실패 이유 가리기 (readable_error.json)', () => {
  for (const c of load('readable_error.json').cases) {
    it(c.name, () => {
      expect(readableError(new Error(c.input))).toBe(c.expected)
      expect(readableError(c.input)).toBe(c.expected)
    })
  }
})

describe('계약 — 쿠키 만료 (cookies.json)', () => {
  for (const c of load('cookies.json').cases) {
    it(c.name, () => {
      // 이 도구는 Chrome 에서 꺼낸 값(정리된 값)만 받습니다 — 붙여넣기 정리는 화면·에이전트 몫
      if (c.error) expect(() => jwtExpiry(c.normalized)).toThrow()
      else expect(jwtExpiry(c.normalized).toISOString()).toBe(c.expires_at)
    })
  }
})

describe('계약 — 남은 일수 (days_left.json)', () => {
  for (const c of load('days_left.json').cases) {
    it(c.name, () => {
      expect(daysLeft(new Date(c.expires_at), new Date(c.now))).toBe(c.days)
    })
  }
})

describe('계약 — desk 응답 판정 (fetch_responses.json)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 이 도구의 오류 문장 → 계약의 갈래. 문장은 구현마다 다르고 갈래는 같아야 합니다 */
  function kindOf(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e)
    if (m.includes('만료')) return 'auth_expired'
    if (m.includes('HTTP')) return 'http_error'
    return 'bad_body'
  }

  for (const c of load('fetch_responses.json').cases) {
    it(c.name, async () => {
      const seen: RequestInit[] = []
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        seen.push(init)
        return new Response(c.body === '' ? null : c.body, { status: c.status })
      })
      let kind = 'ok'
      try {
        const r = await fetchState('https://desk.example.invalid/', 'fake.token.value')
        expect(r.state.work.length).toBe(c.work)
        expect(r.email).toBe(c.email)
      } catch (e) {
        kind = kindOf(e)
      }
      expect(kind).toBe(c.kind)
      expect(seen[0]?.redirect).toBe('manual')
    })
  }
})
