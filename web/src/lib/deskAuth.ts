/**
 * desk 인증 — 설정 화면에 붙여 넣는 쿠키와, 에이전트가 알려 주는 상태. 순수 함수.
 *
 * desk 는 Cloudflare Access(메일 OTP) 뒤에 있습니다. 아이디·비밀번호 로그인이 없고,
 * 브라우저로 로그인해 받은 `CF_Authorization` 쿠키(JWT, 한 달쯤)로 읽습니다.
 * 관리자가 그 쿠키를 설정 화면에 붙여 넣으면 `app_secrets` 에 들어가고(값은 다시
 * 못 꺼냅니다), 사내 PC 의 에이전트가 그것으로 desk 를 읽어 스냅샷을 올립니다
 * (docs/DESIGN.md 14장).
 *
 * 에이전트는 비밀이 아닌 것 — 인증 출처·쿠키 만료일·마지막 수집 결과 — 만
 * `app_settings` 에 적습니다. 화면은 그것으로 **만료 7일 전부터 배너**를 띄웁니다.
 * 만료를 놓쳐 수집이 11~12일씩 빈 적이 두 번 있습니다.
 *
 * 이름·값은 저장소 루트 `contracts/desk/constants.json` 과 같아야 합니다 — 에이전트
 * (`constants.py`)도 같은 파일로 테스트합니다.
 */

/** 쿠키를 넣는 비밀값 이름. 에이전트 `DESK_COOKIE_SECRET` 과 같습니다 */
export const DESK_COOKIE_SECRET = 'desk_cf_authorization'

/** 에이전트가 적는 상태 (app_settings). 화면은 읽기만 합니다 */
export const DESK_SETTING = {
  authSource: 'desk_auth_source',
  cookieExpiresAt: 'desk_cookie_expires_at',
  lastScanAt: 'desk_last_scan_at',
  lastScanOk: 'desk_last_scan_ok',
  lastScanNote: 'desk_last_scan_note',
} as const

export const DESK_AUTH_SOURCES = ['service_token', 'settings', 'env', 'none'] as const
export type DeskAuthSource = (typeof DESK_AUTH_SOURCES)[number]

export const DESK_AUTH_SOURCE_LABELS: Record<DeskAuthSource, string> = {
  service_token: 'Service Token',
  settings: '설정 화면의 쿠키',
  env: '에이전트 .env 의 쿠키',
  none: '없음',
}

/** 만료를 이 일수 전부터 알립니다 (에이전트 doctor 와 같은 값) */
export const DESK_EXPIRY_WARN_DAYS = 7

// ── 붙여 넣은 쿠키 ───────────────────────────────────────────────────────────

/**
 * 붙여 넣은 쿠키를 값만 남깁니다.
 *
 * 개발자 도구에서 복사하면 값만 오기도 하고 `CF_Authorization=…` 이나 쿠키 헤더
 * 통째로 오기도 합니다. 앞뒤 공백·줄바꿈·따옴표·세미콜론도 딸려 옵니다.
 * 에이전트 `desk.normalize_cookie` 와 같은 규칙입니다 (contracts/desk/cookies.json).
 */
export function normalizeCookie(raw: string | null | undefined): string {
  let text = (raw ?? '').trim()
  const hit = /(?:^|[;\s])CF_Authorization=([^;\s]*)/i.exec(text)
  if (hit) text = hit[1] ?? ''
  text = text.trim().replace(/^;+|;+$/g, '').trim()
  if (text.length >= 2 && text[0] === text[text.length - 1] && (text[0] === '"' || text[0] === "'")) {
    text = text.slice(1, -1).trim()
  }
  return text
}

export type CookieErrorKind = 'empty' | 'not_jwt' | 'no_exp'

export type CookieParse =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; token: string; kind: CookieErrorKind; message: string }

function base64UrlJson(part: string): unknown {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4)
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

/**
 * 붙여 넣은 값 → 저장할 값과 만료 시각. **서명은 검증하지 않습니다** — 만료일을
 * 미리 보여 주고 엉뚱한 값을 막으려는 것뿐이고, 진짜인지는 desk 가 판정합니다.
 */
export function parseDeskCookie(raw: string | null | undefined): CookieParse {
  const token = normalizeCookie(raw)
  if (!token) return { ok: false, token, kind: 'empty', message: '쿠키 값이 비어 있습니다' }
  const part = token.split('.')[1]
  const notJwt: CookieParse = {
    ok: false,
    token,
    kind: 'not_jwt',
    message: 'JWT 형식이 아닙니다 — CF_Authorization 쿠키의 값(eyJ… 로 시작)을 복사했는지 확인하세요',
  }
  if (!part) return notJwt
  let payload: unknown
  try {
    payload = base64UrlJson(part)
  } catch {
    return notJwt
  }
  const exp = payload && typeof payload === 'object' ? (payload as { exp?: unknown }).exp : undefined
  if (typeof exp !== 'number' || !(exp > 0)) {
    return { ok: false, token, kind: 'no_exp', message: '쿠키(JWT)에 만료 시각(exp)이 없습니다' }
  }
  return { ok: true, token, expiresAt: new Date(exp * 1000) }
}

/** 만료까지 남은 일수 — 내림. 음수면 이미 만료 (reporter `daysLeft` 와 같습니다) */
export function daysLeft(expiresAt: Date | number, now: number): number {
  const t = typeof expiresAt === 'number' ? expiresAt : expiresAt.getTime()
  return Math.floor((t - now) / 86_400_000)
}

/** `11/25 12:44` — 화면 시각(한국)으로 */
export function shortStamp(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── 에이전트가 알려 주는 상태 ────────────────────────────────────────────────

export interface DeskAgentStatus {
  /** null = 에이전트가 아직 한 번도 안 적었습니다 (0.5.0 이전이거나 꺼져 있음) */
  source: DeskAuthSource | null
  expiresAt: string | null
  lastScanAt: string | null
  /** null = 아직 수집한 적이 없습니다 */
  lastScanOk: boolean | null
  lastScanNote: string | null
}

/** app_settings 행들 → 상태. 빈 문자열은 '없음' 입니다 */
export function readDeskStatus(settings: { key: string; value: string | null }[]): DeskAgentStatus {
  const get = (key: string) => {
    const v = settings.find((s) => s.key === key)?.value?.trim()
    return v ? v : null
  }
  const source = get(DESK_SETTING.authSource)
  const ok = get(DESK_SETTING.lastScanOk)
  return {
    source: (DESK_AUTH_SOURCES as readonly string[]).includes(source ?? '') ? (source as DeskAuthSource) : null,
    expiresAt: get(DESK_SETTING.cookieExpiresAt),
    lastScanAt: get(DESK_SETTING.lastScanAt),
    lastScanOk: ok === 'true' ? true : ok === 'false' ? false : null,
    lastScanNote: get(DESK_SETTING.lastScanNote),
  }
}

export type DeskNotice = { level: 'warn' | 'error'; text: string } | null

/**
 * 화면 위 배너 — 만료 7일 전부터, 만료됐거나 인증이 없으면 계속.
 *
 * **에이전트가 아직 아무것도 안 적었으면 띄우지 않습니다.** 0.5.0 이전이거나 desk
 * 수집을 꺼 둔 상태라, 배너가 뜨면 고칠 수 없는 경고가 됩니다. Service Token 은
 * 만료가 없으므로 띄우지 않습니다.
 */
export function deskAuthNotice(status: DeskAgentStatus, now: number): DeskNotice {
  if (!status.source || status.source === 'service_token') return null
  if (status.source === 'none') {
    return {
      level: 'error',
      text: 'desk 인증이 없습니다 — 주간보고서용 desk 수집(정기·생성 직전)이 멈춰 있습니다.',
    }
  }
  if (!status.expiresAt) return null
  const exp = Date.parse(status.expiresAt)
  if (Number.isNaN(exp)) return null
  if (exp <= now) {
    return {
      level: 'error',
      text: `desk 쿠키가 ${shortStamp(new Date(exp))} 에 만료됐습니다 — 주간보고서용 desk 수집(정기·생성 직전)이 멈춰 있습니다.`,
    }
  }
  const left = daysLeft(exp, now)
  if (left > DESK_EXPIRY_WARN_DAYS) return null
  const when = left < 1 ? '하루 안에' : `${left}일 뒤`
  return {
    level: 'warn',
    text: `desk 쿠키가 ${when}(${shortStamp(new Date(exp))}) 만료됩니다 — 만료되면 주간보고서용 desk 수집이 멈춥니다.`,
  }
}
