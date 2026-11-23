/**
 * 주간보고서를 만들기 직전에 desk 최신 현황을 받아 오는 판단 — 순수 함수.
 *
 * 스냅샷은 정기 수집(월 18:00 · 화 09:00)에만 떴습니다. 그 사이에 desk 를
 * 고치면 보고서에 안 실렸습니다 (11/20 등록한 BRS HK 신규 7건이 11/23 보고서에서
 * 빠졌습니다). 브라우저는 desk 를 못 읽습니다 — Cloudflare Access 쿠키가 브라우저
 * 밖으로 안 나옵니다. 그래서 화면은 `desk_scan_requests` 에 요청을 넣고, 사내 PC 의
 * **에이전트**가 10초마다 집어 가 스캔·업로드한 뒤, 화면이 끝나길 기다렸다가
 * 보고서를 만듭니다 (schema.sql 25장 · docs/DESIGN.md 14장). 에이전트는 관리자가
 * 설정 화면에 붙여 넣은 desk 쿠키로 읽습니다 (`deskAuth.ts`).
 *
 * **실패하면 조용히 옛 스냅샷으로 만들지 않습니다.** 서식도 건수도 멀쩡해 보여서
 * 아무도 못 알아챕니다. 이유와 마지막 스냅샷 날짜를 밝히고, 사람이 '기존 수집본
 * 으로 생성' 을 눌러야 만듭니다.
 */

import { weekOf } from './report/week'
import type { ScanRequestRow } from './types'

/** 이만큼 안에 끝난 수집이 있으면 다시 요청하지 않고 그 결과를 씁니다 */
export const SCAN_FRESH_MINUTES = 3

/** 상태를 다시 보는 간격 */
export const SCAN_POLL_MS = 3_000

/** 최대 대기. 에이전트가 10초마다 보고 스캔이 5초 안팎이라 넉넉합니다 */
export const SCAN_WAIT_MS = 120_000

/**
 * 집어 간 뒤 이만큼 지나도 안 끝난 요청은 죽은 것입니다 — 기다리지 않고 새로
 * 요청합니다. 에이전트 `DESK_STALE_RUNNING_MINUTES` · reporter `STALE_RUNNING_MINUTES` 와
 * 같은 값이어야 합니다 (contracts/desk/constants.json).
 */
export const SCAN_STALE_MINUTES = 10

export type ScanPlan =
  /** 방금 끝난 수집이 있습니다. 기다리지 않습니다 */
  | { kind: 'reuse'; request: ScanRequestRow }
  /** 누가 이미 요청해 둔 것이 대기·진행 중입니다. 같이 기다립니다 */
  | { kind: 'wait'; request: ScanRequestRow }
  /** 새로 요청합니다 */
  | { kind: 'request' }

function ms(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : Number.NaN
}

/**
 * 요청할지, 이미 있는 것을 기다릴지, 방금 끝난 것을 쓸지.
 *
 * **열린 요청이 먼저입니다.** 감시 작업은 요청을 들어온 순서로 처리하므로, 열린
 * 요청은 끝난 어떤 수집보다 늦게 들어온 것입니다 — 누군가 그 뒤에 desk 를 고쳤을
 * 수 있습니다. 멈춘 `running`(10분 넘게)은 기다리지 않습니다. 에이전트가 곧
 * 실패로 닫을 것이고, 기다리면 2분 뒤 시간 초과만 남습니다.
 *
 * 방금 끝난 수집을 다시 쓰는 창은 짧게 둡니다. 보고서를 만들기 직전에 desk 를
 * 고친 사람의 수정이 빠지면 이 기능을 만든 이유가 없어집니다.
 */
export function planScan(rows: ScanRequestRow[], now: number, freshMinutes = SCAN_FRESH_MINUTES): ScanPlan {
  const newest = [...rows].sort((a, b) => ms(b.requested_at) - ms(a.requested_at))

  const open = newest.find(
    (r) =>
      r.status === 'pending' ||
      (r.status === 'running' && !(now - ms(r.started_at) > SCAN_STALE_MINUTES * 60_000)),
  )
  if (open) return { kind: 'wait', request: open }

  const fresh = newest
    .filter((r) => r.status === 'done' && now - ms(r.finished_at) <= freshMinutes * 60_000)
    .sort((a, b) => ms(b.finished_at) - ms(a.finished_at))[0]
  if (fresh) return { kind: 'reuse', request: fresh }

  return { kind: 'request' }
}

export type PollVerdict =
  | { kind: 'done'; day: string | null }
  | { kind: 'failed'; reason: string }
  | { kind: 'waiting'; phase: 'pending' | 'running'; elapsedSec: number }
  | { kind: 'timeout'; reason: string }

/**
 * 기다리는 요청의 지금 상태 → 화면이 할 일.
 *
 * `waitedMs` 는 **화면이 기다리기 시작한 뒤** 흐른 시간입니다. 요청 시각을 기준으로
 * 하면 남이 오래전에 넣어 둔 요청을 기다릴 때 첫 확인에서 바로 시간 초과가 납니다.
 */
export function judgePoll(row: ScanRequestRow | null, waitedMs: number, limitMs = SCAN_WAIT_MS): PollVerdict {
  if (!row) return { kind: 'failed', reason: '수집 요청이 사라졌습니다 — 관리자가 지웠을 수 있습니다' }
  if (row.status === 'done') return { kind: 'done', day: row.snapshot_day }
  if (row.status === 'failed') {
    return { kind: 'failed', reason: row.error?.trim() || '에이전트가 이유를 적지 않았습니다' }
  }
  const minutes = Math.round(limitMs / 60_000)
  if (waitedMs >= limitMs) {
    return {
      kind: 'timeout',
      reason:
        row.status === 'pending'
          ? `에이전트가 ${minutes}분 안에 요청을 받지 않았습니다 — 사내 PC 의 에이전트 창이 닫혀 있거나 ` +
            'PC 가 잠들었거나, 에이전트가 0.5.0 보다 옛 버전입니다'
          : `수집이 ${minutes}분 안에 끝나지 않았습니다 — 에이전트에서 desk 응답이 늦습니다`,
    }
  }
  return { kind: 'waiting', phase: row.status, elapsedSec: Math.floor(waitedMs / 1000) }
}

/** 진행 표시 문구 */
export function progressText(v: { phase: 'pending' | 'running'; elapsedSec: number }): string {
  return v.phase === 'pending'
    ? `desk 최신 현황 수집 중… 에이전트 응답 대기 ${v.elapsedSec}초`
    : `desk 최신 현황 수집 중… 에이전트가 읽는 중 ${v.elapsedSec}초`
}

/** 상한까지 몇 번 확인하는가. 무한히 돌지 않게 횟수로 묶습니다 */
export function pollAttempts(limitMs = SCAN_WAIT_MS, everyMs = SCAN_POLL_MS): number {
  return Math.ceil(limitMs / everyMs) + 1
}

/**
 * 이번 생성에 최신 수집이 필요한가.
 *
 * **오늘이 속한 구간을 만들 때만** 받습니다. 지난 구간을 고른 경우 오늘 스냅샷은
 * 그 구간 밖이라 보고서에 안 쓰입니다 — 에이전트를 시켜 2분을 기다릴 이유가 없습니다.
 * 구간을 안 골랐으면(기본값) 오늘 구간입니다. 스냅샷이 밀려 화면이 지난 구간을
 * 보여 주고 있어도, 받고 나면 오늘 구간이 됩니다.
 */
export function wantsFreshScan(weekPick: string | null, today: string): boolean {
  return weekPick === null || weekPick === weekOf(today).id
}

/** 수집 요청 표가 아직 DB 에 없다는 오류인가 (schema.sql 25장 미적용) */
export function isMissingTable(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false
  if (err.code === 'PGRST205' || err.code === 'PGRST202' || err.code === '42P01') return true
  return /Could not find the (table|function)|does not exist/i.test(err.message ?? '')
}

/** `2026-11-17` → `11/17` */
export function shortDay(iso: string | null | undefined): string {
  if (!iso) return '?'
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${m}/${d}`
}
