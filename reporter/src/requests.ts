/**
 * desk 수집 요청 처리 — 화면의 '주간보고서 생성' 이 먼저 최신 현황을 받아 오게.
 *
 * 웹은 스캔을 직접 돌릴 수 없습니다. desk 인증이 이 Mac 의 Chrome 쿠키라서요.
 * 그래서 웹이 `desk_scan_requests` 에 요청을 넣고(schema.sql 25장), 이 Mac 의
 * 감시 작업(launchd `me.saebom.reporter.requests`, 30초마다)이 `npm run requests`
 * 로 집어 가 **`npm run scan` 과 같은 경로**로 스캔·업로드한 뒤 결과를 적습니다.
 * 회신 발송 큐·수동 등록 큐와 같은 모양입니다 — 웹이 넣고 다른 쪽이 집어 갑니다.
 *
 * 순서:
 *   1. 할 일이 있나 — **로그인 없이** 건수만 묻습니다 (`desk_scan_waiting`).
 *      없으면 여기서 끝납니다. 30초마다 로그인하면 하루 2,880개 세션이 쌓입니다
 *   2. 오래 멈춘 `running` 을 `failed` 로 정리합니다 (이 Mac 이 잠들었던 경우)
 *   3. `pending` 을 **한 번의 update 로 전부** `running` 으로 집습니다. 밀린 요청이
 *      여럿이어도 스캔은 한 번이면 됩니다 — 모두 '지금의 desk' 를 원합니다
 *   4. 스캔 (시간 상한) → 성공이면 `done` + 스냅샷 날짜, 아니면 `failed` + 이유
 *
 * IO 가 없는 판단은 전부 이 파일 위쪽의 순수 함수이고 테스트로 못박습니다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** 집어 간 뒤 이만큼 지나도 안 끝났으면 죽은 것으로 봅니다. 스캔 상한(3분)보다 넉넉히 */
export const STALE_RUNNING_MINUTES = 10

/** 스캔 한 번의 상한. 평소 5초 안팎이고, 화면은 2분까지만 기다립니다 */
export const SCAN_TIMEOUT_MS = 3 * 60_000

/** 같은 경고를 다시 찍는 간격. 30초마다 뜨는 작업이라 그대로 두면 로그가 묻힙니다 */
export const WARN_EVERY_MS = 60 * 60_000

/** 이유 문장의 최대 길이. 화면 한 줄에 읽혀야 합니다 */
const MAX_REASON = 300

// ---------------------------------------------------------------------------
// 순수 함수
// ---------------------------------------------------------------------------

/** `running` 이 이 시각보다 먼저 시작했으면 멈춘 것입니다 */
export function staleCutoff(now: Date, minutes = STALE_RUNNING_MINUTES): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString()
}

/**
 * 화면에 보일 실패 이유 — **비밀값을 지웁니다.**
 *
 * 이 문장은 `desk_scan_requests.error` 에 들어가 팀원 전원이 읽습니다. 지금 오류
 * 문구에는 쿠키·키가 안 들어가지만, 라이브러리가 요청 내용을 오류에 실어 오는
 * 날이 오면 그대로 퍼집니다. 그래서 토큰처럼 생긴 것은 무조건 가립니다:
 * JWT(`eyJ…`) · Supabase 키(`sb_publishable_…`·`sb_secret_…`) · `CF_Authorization=…` ·
 * `Bearer …` · 32자 넘는 영숫자 덩어리.
 */
export function readableError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '')
  const masked = raw
    .replace(/CF_Authorization=[^\s;,'"]+/gi, 'CF_Authorization=•••')
    .replace(/Bearer\s+[^\s'"]+/gi, 'Bearer •••')
    .replace(/eyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, '•••')
    .replace(/sb_(publishable|secret)_[\w-]+/g, 'sb_$1_•••')
    .replace(/[A-Za-z0-9_-]{33,}/g, '•••')
    .replace(/\s+/g, ' ')
    .trim()
  const text = masked || '이유가 기록되지 않은 오류'
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text
}

export interface WarnStamp {
  at: number
  msg: string
}

/**
 * 경고를 찍을 차례인가 — 처음이거나, 내용이 바뀌었거나, 한 시간이 지났으면.
 *
 * 표를 아직 안 만들었거나 Mac 이 오프라인이면 30초마다 같은 실패가 납니다.
 * 매번 찍으면 하루 2,880줄이고, 그 사이에 진짜 처리 기록이 묻힙니다.
 * 안 찍으면 왜 화면이 기다리기만 하는지 아무도 모릅니다.
 */
export function shouldWarn(prev: WarnStamp | null, msg: string, now: number, every = WARN_EVERY_MS): boolean {
  if (!prev) return true
  if (prev.msg !== msg) return true
  return now - prev.at >= every
}

/** 표·함수가 아직 DB 에 없다는 오류인가 (schema.sql 25장 미적용) */
export function isMissingObject(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'PGRST202' || err.code === 'PGRST205' || err.code === '42P01' || err.code === '42883') return true
  return /Could not find the (table|function)|does not exist/i.test(err.message ?? '')
}

/**
 * 상한을 겁니다. 넘으면 이유를 붙여 거절합니다.
 *
 * 밑의 작업을 멈추지는 못합니다 (fetch·키체인). 그래서 부르는 쪽은 결과를 적은 뒤
 * **프로세스를 끝내야** 합니다 — 안 그러면 매달린 작업 때문에 launchd 가 다음
 * 감시를 못 띄웁니다.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), ms)
  })
  return Promise.race([p, limit]).finally(() => clearTimeout(timer))
}

// ---------------------------------------------------------------------------
// DB — 큐를 읽고 씁니다
// ---------------------------------------------------------------------------

export interface Waiting {
  pending: number
  stale: number
}

/** 할 일이 있는가. **로그인 없는(anon) 클라이언트로** 부릅니다 */
export async function waiting(client: SupabaseClient, staleMinutes = STALE_RUNNING_MINUTES): Promise<Waiting> {
  const { data, error } = await client.rpc('desk_scan_waiting', { p_stale_minutes: staleMinutes })
  if (error) {
    if (isMissingObject(error)) {
      throw new Error(
        '수집 요청 표가 DB 에 없습니다 — Supabase SQL Editor 에서 supabase/schema.sql 을 다시 실행하세요 (25장)',
      )
    }
    throw new Error(`수집 요청 확인 실패: ${error.message}`)
  }
  const row = (Array.isArray(data) ? data[0] : data) as Partial<Waiting> | undefined
  return { pending: Number(row?.pending ?? 0), stale: Number(row?.stale ?? 0) }
}

/** 오래 멈춘 `running` 을 실패로 정리합니다. 정리한 건수를 돌려줍니다 */
export async function failStale(client: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await client
    .from('desk_scan_requests')
    .update({
      status: 'failed',
      finished_at: now.toISOString(),
      error:
        `수집이 ${STALE_RUNNING_MINUTES}분 넘게 끝나지 않아 중단된 것으로 봅니다 — ` +
        '수집 PC 가 도중에 잠들었거나 꺼졌을 수 있습니다',
    })
    .eq('status', 'running')
    .lt('started_at', staleCutoff(now))
    .select('id')
  if (error) throw new Error(`멈춘 요청 정리 실패: ${error.message}`)
  return (data ?? []).length
}

/**
 * 대기 요청을 **한 번의 update 로** 집습니다.
 *
 * `where status = 'pending'` 이 조건이라, 같은 순간 다른 프로세스가 집었으면
 * Postgres 가 행을 다시 확인해 0건이 돌아옵니다. 한 요청이 두 번 처리되지 않습니다.
 */
export async function claimPending(client: SupabaseClient, now: Date): Promise<number[]> {
  const { data, error } = await client
    .from('desk_scan_requests')
    .update({ status: 'running', started_at: now.toISOString() })
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(`요청 집기 실패: ${error.message}`)
  return ((data ?? []) as { id: number }[]).map((r) => r.id).sort((a, b) => a - b)
}

export type Finish = { ok: true; day: string } | { ok: false; error: string }

/** 집은 요청들에 결과를 적습니다. 실패 이유는 `readableError` 를 거친 것이어야 합니다 */
export async function finish(client: SupabaseClient, ids: number[], result: Finish, now = new Date()): Promise<void> {
  if (ids.length === 0) return
  const patch = result.ok
    ? { status: 'done', finished_at: now.toISOString(), snapshot_day: result.day, error: null }
    : { status: 'failed', finished_at: now.toISOString(), error: result.error }
  const { error } = await client.from('desk_scan_requests').update(patch).in('id', ids)
  if (error) throw new Error(`요청 결과 기록 실패: ${error.message}`)
}
