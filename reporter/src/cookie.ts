/**
 * macOS Chrome 에서 `CF_Authorization` 쿠키를 꺼냅니다.
 *
 * desk 는 Cloudflare Access 뒤에 있고 Service Token 이 발급돼 있지 않습니다
 * (`/api/state` 가 302 로 넘기는 JWT 의 `service_token_status: false` 로 확인).
 * 그래서 **브라우저 로그인으로 발급된 쿠키를 재사용**합니다.
 *
 * 쿠키 값은 Chrome 이 AES-128-CBC 로 암호화해 SQLite 에 넣어 두고, 키는
 * 키체인의 "Chrome Safe Storage" 비밀번호에서 PBKDF2 로 유도합니다.
 * 최초 1회 macOS 가 키체인 접근을 묻습니다.
 *
 * **Chrome 이 켜져 있어도 됩니다** — DB 를 임시 폴더로 복사한 뒤 읽습니다.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_DIR = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')

/** Chrome 이 macOS 에서 고정으로 쓰는 값들 */
const SALT = 'saltysalt'
const ITERATIONS = 1003
const KEY_LEN = 16
const IV = Buffer.alloc(16, ' ')

export interface CookieHit {
  profile: string
  value: string
  /** JWT `exp` 를 파싱한 만료 시각 */
  expiresAt: Date
}

function safeStorageKey(): Buffer {
  let pw: string
  try {
    pw = execFileSync(
      'security',
      ['find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome'],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    throw new Error(
      '키체인에서 "Chrome Safe Storage" 를 읽지 못했습니다. ' +
        '접근을 거부했거나 Chrome 이 설치돼 있지 않습니다. ' +
        '.env 의 CF_AUTHORIZATION 에 쿠키를 직접 넣어 우회할 수 있습니다.',
    )
  }
  return pbkdf2Sync(pw, SALT, ITERATIONS, KEY_LEN, 'sha1')
}

function decrypt(encrypted: Buffer, key: Buffer): string {
  // v10 / v11 접두사를 떼고 복호화합니다
  const body = encrypted.subarray(3)
  const d = createDecipheriv('aes-128-cbc', key, IV)
  d.setAutoPadding(false)
  let out = Buffer.concat([d.update(body), d.final()])

  // PKCS#7 패딩 제거
  const pad = out[out.length - 1] ?? 0
  if (pad >= 1 && pad <= 16) out = out.subarray(0, out.length - pad)

  // 최신 Chrome 은 평문 앞에 도메인 SHA256(32바이트)을 붙입니다.
  // JWT 는 항상 'ey' 로 시작하므로 그것으로 가릅니다.
  const s = out.toString('utf8')
  if (s.startsWith('ey')) return s
  return out.subarray(32).toString('utf8')
}

/** JWT 페이로드의 `exp`. 사람이 달력에 만료를 적어 둘 필요가 없습니다 */
export function jwtExpiry(jwt: string): Date {
  const part = jwt.split('.')[1]
  if (!part) throw new Error('CF_Authorization 이 JWT 형식이 아닙니다')
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  const payload = JSON.parse(json) as { exp?: number }
  if (!payload.exp) throw new Error('JWT 에 exp 가 없습니다')
  return new Date(payload.exp * 1000)
}

/**
 * 프로필 전체를 훑어 해당 호스트의 쿠키를 찾습니다.
 *
 * 프로필이 20개가 넘는 경우가 흔하고 어느 프로필로 로그인했는지 사람이 기억하지
 * 못합니다. 그래서 지정이 없으면 전부 뒤지고, 여러 개면 **만료가 가장 늦은** 것을
 * 고릅니다.
 */
export function findCookie(host: string, preferProfile = ''): CookieHit {
  if (!existsSync(CHROME_DIR)) {
    throw new Error(`Chrome 프로필 폴더가 없습니다: ${CHROME_DIR}`)
  }

  const profiles = readdirSync(CHROME_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CHROME_DIR, d.name, 'Cookies')))
    .map((d) => d.name)
    .filter((n) => !preferProfile || n === preferProfile)

  if (profiles.length === 0) {
    throw new Error(
      preferProfile
        ? `프로필 '${preferProfile}' 에 Cookies 파일이 없습니다`
        : 'Cookies 파일을 가진 Chrome 프로필이 없습니다',
    )
  }

  const key = safeStorageKey()
  const tmp = mkdtempSync(join(tmpdir(), 'reporter-ck-'))
  const hits: CookieHit[] = []

  try {
    for (const profile of profiles) {
      const copy = join(tmp, `${profile.replace(/\W+/g, '_')}.db`)
      try {
        copyFileSync(join(CHROME_DIR, profile, 'Cookies'), copy)
      } catch {
        continue
      }
      let db: DatabaseSync | undefined
      try {
        db = new DatabaseSync(copy, { readOnly: true })
        const rows = db
          .prepare(
            'select encrypted_value from cookies where host_key = ? and name = ?',
          )
          .all(host, 'CF_Authorization') as { encrypted_value: Uint8Array }[]
        for (const r of rows) {
          try {
            const value = decrypt(Buffer.from(r.encrypted_value), key)
            hits.push({ profile, value, expiresAt: jwtExpiry(value) })
          } catch {
            // 이 프로필의 쿠키는 못 읽습니다. 다른 프로필이 있을 수 있으므로 계속합니다.
          }
        }
      } catch {
        continue
      } finally {
        db?.close()
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  if (hits.length === 0) {
    throw new Error(
      `${host} 의 CF_Authorization 쿠키를 어느 프로필에서도 찾지 못했습니다. ` +
        'Chrome 으로 desk 에 한 번 로그인한 뒤 다시 실행하세요.',
    )
  }

  hits.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())
  return hits[0]!
}

/**
 * 실제로 쓸 쿠키를 고릅니다. 수동 값(`CF_AUTHORIZATION`)이 있으면 그것이 이깁니다 —
 * 자동 추출이 깨졌을 때 사람이 즉시 우회할 수 있어야 합니다.
 */
export function resolveCookie(
  host: string,
  manual: string,
  preferProfile: string,
): CookieHit {
  if (manual) {
    return { profile: '(수동 지정)', value: manual, expiresAt: jwtExpiry(manual) }
  }
  return findCookie(host, preferProfile)
}

/** 만료까지 남은 일수. 음수면 이미 만료 */
export function daysLeft(expiresAt: Date, now = new Date()): number {
  return Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000)
}
