/**
 * 스냅샷·태스크 맵을 대시보드(Supabase)로 올립니다.
 *
 * **이 도구가 대시보드에 쓰는 유일한 곳입니다.** 나머지는 전부 읽기입니다.
 * desk 인증이 이 Mac 의 Chrome 쿠키라 수집이 여기를 벗어날 수 없고, 그래서
 * 결과만 올려 팀이 대시보드에서 보게 합니다 (`docs/PLAN-REPORT-INTEGRATION.md`).
 *
 * 쓰기는 관리자 계정으로만 통과합니다 — `schema.sql` 24.3 의 RLS 가 막습니다.
 * service_role 키는 여기서도 쓰지 않습니다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Snapshot } from './types.ts'
import type { TaskMap } from './taskmap.ts'

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

/**
 * 태스크 맵을 올립니다. 행은 `id = 1` 하나뿐입니다.
 *
 * **덮어쓰기입니다.** 지금은 로컬 파일이 원본이고 대시보드가 사본입니다.
 * 3단계에서 화면이 편집을 맡으면 방향이 뒤집히므로, 그때 이 함수는 사라지거나
 * '내려받기' 로 바뀝니다 — 양쪽에서 고칠 수 있는 상태를 오래 두면 안 됩니다.
 */
export async function uploadTaskMap(client: SupabaseClient, map: TaskMap): Promise<number> {
  const { error } = await client
    .from('task_map')
    .update({ version: map.version, entries: map.entries, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) {
    throw new Error(`태스크 맵 업로드 실패: ${error.message}`)
  }
  return map.entries.length
}

/** 대시보드에 이미 올라간 날짜들. 무엇이 빠졌는지 보고 채웁니다 */
export async function uploadedDays(client: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await client.from('desk_snapshots').select('day')
  if (error) {
    throw new Error(`업로드 목록 조회 실패: ${error.message}`)
  }
  return new Set((data as { day: string }[]).map((r) => r.day))
}
