/**
 * 티켓 대시보드(Supabase)에서 티켓을 읽습니다.
 *
 * **Publishable(anon) 키로 로그인해서 읽습니다.** service_role 키는 쓰지 않습니다 —
 * 그 키는 에이전트 PC 의 `.env` 한 곳에만 있어야 하고, 이 도구는 RLS 가 허용하는
 * 범위만 보면 충분합니다. 읽기 전용이므로 쓰기 경로가 아예 없습니다.
 *
 * **대분류 3종(장애·유지보수·신규개발)을 전부 가져옵니다.** 한때 여기서
 * `work_type='incident'` 로 걸러 장애만 받았는데, 그러면 유지보수 건수를
 * 보고서에 넣을 방법이 아예 없습니다 — 없는 데이터는 아래 계층에서 만들 수
 * 없습니다. 대분류 구분은 `aggregate.ts` 가 합니다.
 *
 * 대분류는 `ticket_meta.work_type` 이지 `category` 가 아닙니다 — 대분류가
 * 유지보수인 것과 중분류가 개선인 것은 다른 축입니다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { WORK_TYPES, type TicketRow, type WorkType } from './types.ts'

export interface DashboardAuth {
  url: string
  anonKey: string
  email: string
  password: string
}

export async function signIn(auth: DashboardAuth): Promise<SupabaseClient> {
  if (!auth.url || !auth.anonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY 가 비어 있습니다 (.env 확인)')
  }
  if (!auth.email || !auth.password) {
    throw new Error('SUPABASE_EMAIL / SUPABASE_PASSWORD 가 비어 있습니다 (.env 확인)')
  }

  const client = createClient(auth.url, auth.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await client.auth.signInWithPassword({
    email: auth.email,
    password: auth.password,
  })
  if (error) {
    throw new Error(`대시보드 로그인 실패: ${error.message}`)
  }
  return client
}

interface Row {
  id: number
  subject: string
  received_at: string
  ticket_meta: {
    severity: TicketRow['severity']
    system_type: string | null
    resolution: string | null
    work_type: string | null
  } | null
}

/** 모르는 대분류는 null 로 둡니다. 임의로 유지보수에 넣으면 건수가 조용히 틀립니다 */
function toWorkType(v: string | null | undefined): WorkType | null {
  return (WORK_TYPES as readonly string[]).includes(v ?? '') ? (v as WorkType) : null
}

/**
 * 티켓 전부를 받아 옵니다.
 *
 * 월별 추이를 그리려면 그 달만이 아니라 **가동 이후 전 구간**이 필요합니다.
 * 티켓 수가 수천 건대라 한 번에 받아도 무리가 없고, 페이지네이션을 넣으면
 * 경계에서 조용히 빠지는 건이 생깁니다.
 *
 * `ticket_meta` 는 tickets 와 1:1 이라 `!inner` 로 붙여도 빠지는 건이 없습니다.
 */
export async function fetchTickets(client: SupabaseClient): Promise<TicketRow[]> {
  const { data, error } = await client
    .from('tickets')
    .select('id, subject, received_at, ticket_meta!inner(severity, system_type, resolution, work_type)')
    .order('received_at', { ascending: true })

  if (error) {
    throw new Error(`티켓 조회 실패: ${error.message}`)
  }

  return (data as unknown as Row[]).map((r) => ({
    id: String(r.id),
    title: r.subject,
    receivedAt: (r.received_at ?? '').slice(0, 10),
    workType: toWorkType(r.ticket_meta?.work_type),
    severity: r.ticket_meta?.severity ?? null,
    system: r.ticket_meta?.system_type ?? null,
    resolution: r.ticket_meta?.resolution ?? null,
  }))
}
