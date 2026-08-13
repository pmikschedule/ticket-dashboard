/**
 * desk 수집 — `/api/state` 를 읽어 스냅샷으로 보존합니다.
 *
 * **원본 JSON 을 가공하지 않고 통째로 저장합니다.** 보고서 서식이 나중에 바뀌어도
 * 과거 스냅샷에서 다시 뽑을 수 있어야 하기 때문입니다. 수집 시점에 요약해 버리면
 * 그 순간 정보가 사라지고 되돌릴 방법이 없습니다.
 *
 * desk 는 **현재 상태만** 보관합니다. 오늘 안 떠 놓으면 오늘의 상태는 영영
 * 복원되지 않습니다 — 이 도구의 존재 이유가 보고서 생성보다 스냅샷 축적에
 * 있는 이유입니다.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DeskState, Snapshot } from './types.ts'

export interface FetchResult {
  state: DeskState
  email: string | null
  tier: string | null
}

/**
 * Cloudflare Access 는 인증에 실패하면 **302 로 로그인 페이지를 돌려줍니다.**
 * 200 이 아닌 것을 오류로 처리하지 않으면 로그인 HTML 을 JSON 으로 파싱하려다
 * 엉뚱한 곳에서 터집니다. redirect 를 따라가지 않고 상태 코드로 판정합니다.
 */
export async function fetchState(deskUrl: string, cookie: string): Promise<FetchResult> {
  const res = await fetch(`${deskUrl.replace(/\/$/, '')}/api/state`, {
    headers: { Cookie: `CF_Authorization=${cookie}` },
    redirect: 'manual',
  })

  if (res.status === 302 || res.status === 301) {
    throw new Error(
      'Cloudflare Access 가 로그인으로 돌려보냈습니다 — 쿠키가 만료됐습니다. ' +
        'Chrome 으로 desk 에 다시 로그인한 뒤 실행하세요.',
    )
  }
  if (!res.ok) {
    throw new Error(`desk 응답이 HTTP ${res.status} 입니다`)
  }

  const body = (await res.json()) as { state?: DeskState; email?: string; tier?: string }
  if (!body.state || !Array.isArray(body.state.work)) {
    throw new Error('desk 응답에 state.work 가 없습니다 — API 형식이 바뀌었을 수 있습니다')
  }

  return { state: body.state, email: body.email ?? null, tier: body.tier ?? null }
}

export function makeSnapshot(state: DeskState, scannedAt: Date): Snapshot {
  const yearMonth = scannedAt.toISOString().slice(0, 7)
  return {
    meta: {
      scannedAt: scannedAt.toISOString(),
      yearMonth,
      sourceUpdatedAt: state.updatedAt ?? null,
      counts: {
        work: state.work.length,
        projects: state.projects?.length ?? 0,
        decisions: state.decisions?.length ?? 0,
      },
    },
    state,
  }
}

/** 파일명은 스캔 날짜입니다. 하루에 여러 번 돌리면 그날 것을 덮어씁니다 */
export function saveSnapshot(dir: string, snap: Snapshot): string {
  mkdirSync(dir, { recursive: true })
  const day = snap.meta.scannedAt.slice(0, 10)
  const path = join(dir, `${day}.json`)
  writeFileSync(path, JSON.stringify(snap, null, 2), 'utf8')
  return path
}

export function listSnapshots(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
}

export function readSnapshot(dir: string, file: string): Snapshot {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as Snapshot
}

/** 가장 최근 스냅샷. 없으면 null */
export function latestSnapshot(dir: string): Snapshot | null {
  const files = listSnapshots(dir)
  const last = files[files.length - 1]
  return last ? readSnapshot(dir, last) : null
}

/**
 * 그 날(포함) 이전의 스냅샷 중 **가장 늦은 것**. 없으면 null.
 *
 * 주간 diff 의 기준입니다. "지난주 월요일 스냅샷" 을 정확히 요구하지 않는 이유는
 * 스캔을 한 주 걸렀을 수 있기 때문입니다 — 그때는 2주 전 것과 비교하고, 며칠자
 * 스냅샷을 썼는지 보고서에 적습니다. 없는 주를 0 으로 메우지 않습니다.
 */
export function snapshotBefore(dir: string, day: string): Snapshot | null {
  const files = listSnapshots(dir).filter((f) => f.slice(0, 10) < day)
  const prev = files[files.length - 1]
  return prev ? readSnapshot(dir, prev) : null
}

/**
 * 그 날(포함) **이후 처음 뜬** 스냅샷. 없으면 null.
 *
 * 주간 보고의 '현재 상태' 는 구간이 끝난 뒤 처음 뜬 스냅샷이 가장 가깝습니다.
 * 늘 최신 스냅샷을 쓰면, 2주 전 주간보고를 뒤늦게 뽑을 때 그때가 아니라
 * **오늘 상태**로 그 주를 보고하게 됩니다.
 */
export function snapshotAfter(dir: string, day: string): Snapshot | null {
  const hit = listSnapshots(dir).find((f) => f.slice(0, 10) >= day)
  return hit ? readSnapshot(dir, hit) : null
}

/** 그 날 이전의 스냅샷들을 오래된 것부터. 정체(3주 연속) 판정에 씁니다 */
export function snapshotsBefore(dir: string, day: string, count: number): Snapshot[] {
  return listSnapshots(dir)
    .filter((f) => f.slice(0, 10) < day)
    .slice(-count)
    .map((f) => readSnapshot(dir, f))
}

/**
 * 그 달의 **직전** 스냅샷에서 업무별 마감일을 뽑습니다.
 * 일정이 바뀐 건을 `7/13 → 8/6` 으로 보여 주기 위한 재료입니다.
 *
 * 스냅샷이 하나뿐인 첫 실행에서는 빈 Map 이 나오고, 일정 칸에는 현재 마감일만
 * 찍힙니다. 없는 변경 이력을 지어내지 않습니다.
 */
export function previousDueDates(dir: string, beforeDay: string): Map<string, string | null> {
  const files = listSnapshots(dir).filter((f) => f.slice(0, 10) < beforeDay)
  const prev = files[files.length - 1]
  if (!prev) return new Map()
  const snap = readSnapshot(dir, prev)
  return new Map(snap.state.work.map((w) => [w.id, w.due]))
}
