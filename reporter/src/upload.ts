/**
 * 스냅샷을 대시보드(Supabase)로 올립니다.
 *
 * 이 도구가 대시보드에 쓰는 곳은 여기와 수집 요청 큐(`requests.ts`) 둘뿐입니다.
 * 나머지는 전부 읽기입니다.
 * desk 인증이 이 Mac 의 Chrome 쿠키라 수집이 여기를 벗어날 수 없고, 그래서
 * 결과만 올려 팀이 대시보드에서 보게 합니다 (`docs/PLAN-REPORT-INTEGRATION.md`).
 *
 * 쓰기는 관리자 계정으로만 통과합니다 — `schema.sql` 24.3 의 RLS 가 막습니다.
 * service_role 키는 여기서도 쓰지 않습니다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { makeSnapshot } from './desk.ts'
import type { DeskState, Snapshot } from './types.ts'

/** 표에 들어갈 모양. 순수 변환이라 테스트로 못박습니다 */
export interface SnapshotRow {
  day: string
  scanned_at: string
  source_at: string | null
  state: unknown
  counts: { work: number; projects: number; decisions: number }
}

/**
 * 스냅샷 → 행.
 *
 * **state 를 가공하지 않습니다.** 보고서 서식이 바뀌어도 과거 스냅샷에서 다시
 * 뽑을 수 있어야 합니다. `counts` 는 목록 화면이 본문(수백 KB) 없이 훑기 위한
 * 사본이고, 원본에서 다시 셀 수 있는 값이라 어긋날 걱정이 없습니다.
 */
export function snapshotRow(snap: Snapshot): SnapshotRow {
  return {
    day: snap.meta.scannedAt.slice(0, 10),
    scanned_at: snap.meta.scannedAt,
    source_at: snap.meta.sourceUpdatedAt,
    state: snap.state,
    counts: snap.meta.counts,
  }
}

export interface UploadResult {
  day: string
  /** 올린 state 의 대략 크기(KB). 로그로 보여 줘야 커진 것을 알아챕니다 */
  sizeKb: number
}

/**
 * 스냅샷 한 개를 올립니다. 같은 날짜가 있으면 덮어씁니다.
 *
 * 하루에 여러 번 스캔하면 마지막 것이 남습니다 — 로컬 파일과 같은 규칙입니다
 * (`desk.saveSnapshot` 도 날짜로 덮어씁니다). 둘이 다르면 어느 쪽이 진짜인지
 * 알 수 없게 됩니다.
 */
export async function uploadSnapshot(
  client: SupabaseClient,
  snap: Snapshot,
): Promise<UploadResult> {
  const row = snapshotRow(snap)
  const { error } = await client.from('desk_snapshots').upsert(row, { onConflict: 'day' })
  if (error) {
    throw new Error(`스냅샷 업로드 실패: ${error.message}`)
  }
  return { day: row.day, sizeKb: Math.round(JSON.stringify(row.state).length / 1024) }
}

/*
 * **태스크 맵 업로드는 여기 없습니다.**
 *
 * 있었고, 지웠습니다. 로컬 `config/taskmap.json` 을 대시보드로 덮어썼는데 편집이
 * 화면으로 옮겨 간 뒤로는 그 파일이 비어 있었습니다 — 스캔 한 번이면 화면에서
 * 만든 분류가 통째로 날아가는 상태였고, 낙관적 잠금도 우회했습니다.
 * 지금 방향은 한쪽뿐입니다: 대시보드가 원본이고 이 도구는 `dashboard.fetchTaskMap`
 * 으로 읽기만 합니다.
 */

/** 대시보드에 이미 올라간 날짜와 그 스캔 시각. 무엇이 빠졌거나 묵었는지 보고 채웁니다 */
export async function uploadedDays(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client.from('desk_snapshots').select('day, scanned_at')
  if (error) {
    throw new Error(`업로드 목록 조회 실패: ${error.message}`)
  }
  return new Map((data as { day: string; scanned_at: string }[]).map((r) => [r.day, r.scanned_at]))
}

/**
 * 올려야 할 로컬 스냅샷 — 대시보드에 **없거나, 있어도 로컬이 더 늦게 뜬** 것.
 *
 * 한때 없는 날짜만 올렸습니다. 그런데 스냅샷은 하루 한 개(날짜가 키)라 같은 날
 * 두 번째 스캔은 로컬 파일만 덮어쓰고 대시보드에는 **아침 것이 그대로 남았습니다.**
 * 2026-09-14 는 대시보드에 11:59 것(desk 원본 9/11)이, 로컬에 18:00 것(원본 9/14)이
 * 있었고, 9/28 은 오전 수동 스캔 때문에 그날 18:00 정기 스캔이 올라가지 않을
 * 참이었습니다 — 보고 당일 desk 에 적은 진행이 주간보고서에 안 실리는 경로입니다.
 * `uploadSnapshot` 의 "하루에 여러 번 스캔하면 마지막 것이 남습니다" 가 이제 참입니다.
 *
 * 시각은 문자열이 아니라 시점으로 비교합니다 (`Z` 와 `+00:00` 이 섞여 옵니다).
 */
export function toUpload(
  local: { file: string; scannedAt: string }[],
  remote: Map<string, string>,
): string[] {
  return local
    .filter(({ file, scannedAt }) => {
      const up = remote.get(file.slice(0, 10))
      if (!up) return true
      return Date.parse(scannedAt) > Date.parse(up)
    })
    .map((l) => l.file)
}

/*
 * ---------------------------------------------------------------------------
 * 내려받기 — 대시보드 → 이 Mac (2026-11-23 부터)
 *
 * desk 수집이 사내 PC 의 에이전트로 옮겨 가서 이 Mac 은 더 이상 desk 를 읽지
 * 않습니다. 그런데 월간보고·업무 목록은 **로컬 스냅샷**(`latestSnapshot`·
 * `previousDueDates`)을 읽습니다. 그대로 두면 Mac 의 마지막 스캔(11/25) 것으로
 * 매달 조용히 만들어집니다 — 서식도 건수도 멀쩡해 보여서 아무도 못 알아챕니다.
 * 그래서 만들기 전에 대시보드 것을 내려받아 로컬을 채웁니다.
 * 이제는 **대시보드가 원본이고 로컬이 사본**입니다 (`toUpload` 의 반대 방향).
 * ---------------------------------------------------------------------------
 */

/**
 * 내려받을 날짜 — 로컬에 **없거나, 있어도 대시보드 것이 더 늦게 뜬** 것.
 *
 * `toUpload` 와 같은 규칙을 거꾸로 씁니다. 하루 한 개(날짜가 키)라 같은 날
 * 에이전트가 다시 수집하면 대시보드 것이 더 늦습니다. 시각은 시점으로 비교합니다
 * (`Z` 와 `+00:00` 이 섞여 옵니다).
 */
export function toPull(
  local: { file: string; scannedAt: string }[],
  remote: Map<string, string>,
): string[] {
  const mine = new Map(local.map((l) => [l.file.slice(0, 10), l.scannedAt]))
  return [...remote.entries()]
    .filter(([day, scannedAt]) => {
      const have = mine.get(day)
      if (!have) return true
      return Date.parse(scannedAt) > Date.parse(have)
    })
    .map(([day]) => day)
    .sort()
}

/**
 * 행 → 스냅샷. `snapshotRow` 의 반대입니다.
 *
 * `makeSnapshot` 을 그대로 거칩니다 — 건수는 state 에서 다시 세고, 원본 시각은
 * state 의 `updatedAt` 그대로 둡니다. 표의 `source_at` 은 Postgres 가 시간대를 붙여
 * 돌려주므로(`2026-11-20T14:28:34+00:00`) 그것을 쓰면 로컬 파일과 모양이 달라집니다.
 * 스캔 시각은 밀리초+Z 로 맞춥니다 (`contracts/desk` 의 규칙).
 */
export function snapshotFromRow(row: { scanned_at: string; state: unknown }): Snapshot {
  const at = new Date(row.scanned_at)
  if (Number.isNaN(at.getTime())) {
    throw new Error(`스냅샷 시각을 읽을 수 없습니다: ${row.scanned_at}`)
  }
  const state = row.state as DeskState | null
  if (!state || !Array.isArray(state.work)) {
    throw new Error(`스냅샷 본문에 업무 목록이 없습니다 (${row.scanned_at})`)
  }
  return makeSnapshot(state, at)
}

/** 그 날의 스냅샷 한 개를 내려받습니다. 본문(수백 KB)은 필요한 날짜만 받습니다 */
export async function downloadSnapshot(client: SupabaseClient, day: string): Promise<Snapshot> {
  const { data, error } = await client
    .from('desk_snapshots')
    .select('scanned_at, state')
    .eq('day', day)
    .single()
  if (error) {
    throw new Error(`스냅샷 내려받기 실패 (${day}): ${error.message}`)
  }
  return snapshotFromRow(data as { scanned_at: string; state: unknown })
}
