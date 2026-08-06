/**
 * 데이터 접근 계층.
 *
 * **컴포넌트는 supabase 클라이언트를 직접 import 하지 않습니다.** 전부 이 파일을 경유합니다.
 * 쿼리가 화면에 흩어지면 RLS 위반이 어디서 났는지 추적할 수 없습니다.
 */

import { ATTACHMENT_BUCKET, supabase } from './supabase'
import type {
  AppUser,
  AttachmentRow,
  Comment,
  LeadTimeRow,
  OutboundEmailRow,
  StatusHistoryRow,
  TicketFilters,
  TicketMeta,
  TicketWithMeta,
} from './types'

/**
 * 목록용 select.
 *
 * `!inner` 가 중요합니다. 임베디드 컬럼(`ticket_meta.status`)에 건 필터는
 * 기본 조인에서 **부모 행을 걸러내지 않고** ticket_meta 만 null 로 만듭니다.
 * 그러면 "진행 중만 보기" 를 눌러도 전체 티켓이 빈 카드로 남습니다.
 * inner 조인이면 필터가 부모까지 전파됩니다.
 */
const TICKET_LIST_SELECT = '*, ticket_meta!inner(*)'

/** 단건 조회는 outer 로 둡니다 — meta 가 없는 티켓도 열어서 원인을 봐야 합니다. */
const TICKET_ONE_SELECT = '*, ticket_meta(*)'

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error('데이터가 비어 있습니다.')
  return result.data
}

/** ticket_meta 는 1:1 이지만 PostgREST 가 배열로 줄 때가 있습니다. */
function normalizeMeta(row: Record<string, unknown>): TicketWithMeta {
  const meta = row.ticket_meta
  return {
    ...(row as unknown as TicketWithMeta),
    ticket_meta: Array.isArray(meta) ? ((meta[0] as TicketMeta) ?? null) : ((meta as TicketMeta) ?? null),
  }
}

// ── 인증 / 사용자 ────────────────────────────────────────────────────────────

/**
 * 로그인.
 *
 * Supabase 가 돌려주는 원문 오류는 원인을 짐작하기 어렵습니다
 * ("Failed to fetch" 만 보고 .env 를 의심하기는 어렵습니다).
 * 실제로 자주 밟는 세 경우를 무엇을 고쳐야 하는지로 바꿔 줍니다.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) return

  const message = error.message ?? ''

  if (/failed to fetch|network|load failed/i.test(message)) {
    throw new Error(
      'Supabase 에 연결하지 못했습니다. web/.env 의 VITE_SUPABASE_URL 이 ' +
        '실제 프로젝트 주소인지 확인하세요 (Supabase → Settings → Data API).',
    )
  }
  if (/invalid login credentials/i.test(message)) {
    throw new Error(
      '이메일 또는 비밀번호가 맞지 않습니다. ' +
        '이 시스템에는 기본 계정이 없고, 관리자가 Supabase 대시보드 → Authentication → Users ' +
        '에서 계정을 직접 만듭니다 (docs/SETUP.md 4장).',
    )
  }
  if (/email not confirmed/i.test(message)) {
    throw new Error(
      "계정이 확인되지 않은 상태입니다. Supabase 에서 계정을 만들 때 " +
        "'Auto Confirm User' 를 체크해야 로그인됩니다. 해당 계정을 지우고 다시 만드세요.",
    )
  }
  throw new Error(message)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}

export async function getSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

export async function fetchCurrentUser(): Promise<AppUser | null> {
  const userId = await getSessionUserId()
  if (!userId) return null

  const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as AppUser) ?? null
}

export async function fetchUsers(): Promise<AppUser[]> {
  return unwrap(
    await supabase.from('users').select('*').eq('is_active', true).order('name'),
  ) as AppUser[]
}

export async function updateUserRole(userId: string, role: 'admin' | 'member'): Promise<void> {
  const { error } = await supabase.from('users').update({ role }).eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function updateOwnName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from('users').update({ name }).eq('id', userId)
  if (error) throw new Error(error.message)
}

// ── 티켓 ─────────────────────────────────────────────────────────────────────

export async function fetchTickets(filters: TicketFilters = {}): Promise<TicketWithMeta[]> {
  let query = supabase
    .from('tickets')
    .select(TICKET_LIST_SELECT)
    .order('received_at', { ascending: false })

  if (filters.status && filters.status !== 'all') {
    query = query.eq('ticket_meta.status', filters.status)
  }
  if (filters.severity && filters.severity !== 'all') {
    query = query.eq('ticket_meta.severity', filters.severity)
  }
  if (filters.systemType && filters.systemType !== 'all') {
    query = query.eq('ticket_meta.system_type', filters.systemType)
  }
  if (filters.assigneeId === 'unassigned') {
    query = query.is('ticket_meta.assignee_id', null)
  } else if (filters.assigneeId && filters.assigneeId !== 'all') {
    query = query.eq('ticket_meta.assignee_id', filters.assigneeId)
  }
  if (filters.search?.trim()) {
    const term = filters.search.trim().replace(/[%,]/g, '')
    query = query.or(`subject.ilike.%${term}%,reporter_email.ilike.%${term}%`)
  }

  const rows = unwrap(await query) as Record<string, unknown>[]
  return rows.map(normalizeMeta)
}

export async function fetchTicket(ticketId: number): Promise<TicketWithMeta> {
  const row = unwrap(
    await supabase.from('tickets').select(TICKET_ONE_SELECT).eq('id', ticketId).single(),
  ) as Record<string, unknown>
  return normalizeMeta(row)
}

export async function updateTicketStatus(ticketId: number, status: string): Promise<void> {
  const { error } = await supabase.from('ticket_meta').update({ status }).eq('ticket_id', ticketId)
  if (error) throw new Error(error.message)
}

export async function updateTicketMeta(
  ticketId: number,
  patch: Partial<Pick<TicketMeta, 'category' | 'severity' | 'system_type' | 'assignee_id'>>,
): Promise<void> {
  const { error } = await supabase.from('ticket_meta').update(patch).eq('ticket_id', ticketId)
  if (error) throw new Error(error.message)
}

/** 관리자 수동 내용 보완 (기획서 3.2). */
export async function updateTicketFields(
  ticketId: number,
  patch: { subject?: string; description?: string; due_date?: string | null },
): Promise<void> {
  const { error } = await supabase.from('tickets').update(patch).eq('id', ticketId)
  if (error) throw new Error(error.message)
}

export async function deleteTicket(ticketId: number): Promise<void> {
  const { error } = await supabase.from('tickets').delete().eq('id', ticketId)
  if (error) throw new Error(error.message)
}

// ── 코멘트 ───────────────────────────────────────────────────────────────────

export async function fetchComments(ticketId: number): Promise<Comment[]> {
  return unwrap(
    await supabase
      .from('comments')
      .select('*, users(id, name)')
      .eq('ticket_id', ticketId)
      .order('created_at'),
  ) as Comment[]
}

export async function addComment(ticketId: number, userId: string, content: string): Promise<void> {
  const { error } = await supabase
    .from('comments')
    .insert({ ticket_id: ticketId, user_id: userId, content })
  if (error) throw new Error(error.message)
}

export async function deleteComment(commentId: number): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', commentId)
  if (error) throw new Error(error.message)
}

// ── 첨부 ─────────────────────────────────────────────────────────────────────

export async function fetchAttachments(ticketId: number): Promise<AttachmentRow[]> {
  return unwrap(
    await supabase.from('attachments').select('*').eq('ticket_id', ticketId).order('created_at'),
  ) as AttachmentRow[]
}

/** 비공개 버킷이라 서명 URL 로만 내려받습니다 (유효 60초). */
export async function createAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60)
  if (error) throw new Error(error.message)
  if (!data?.signedUrl) throw new Error('다운로드 링크를 만들지 못했습니다.')
  return data.signedUrl
}

// ── 이력 / 통계 ──────────────────────────────────────────────────────────────

export async function fetchStatusHistory(ticketId: number): Promise<StatusHistoryRow[]> {
  return unwrap(
    await supabase
      .from('ticket_status_history')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('changed_at'),
  ) as StatusHistoryRow[]
}

export async function fetchLeadTimes(): Promise<LeadTimeRow[]> {
  return unwrap(
    await supabase.from('ticket_lead_times').select('*').order('received_at', { ascending: false }),
  ) as LeadTimeRow[]
}

// ── 발송 큐 ──────────────────────────────────────────────────────────────────

export async function fetchOutboundEmails(ticketId: number): Promise<OutboundEmailRow[]> {
  return unwrap(
    await supabase
      .from('outbound_emails')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('requested_at', { ascending: false }),
  ) as OutboundEmailRow[]
}

export async function queueReply(input: {
  ticketId: number
  requestedBy: string
  toEmail: string
  ccEmails?: string | null
  subject: string
  body: string
}): Promise<void> {
  const { error } = await supabase.from('outbound_emails').insert({
    ticket_id: input.ticketId,
    requested_by: input.requestedBy,
    to_email: input.toEmail,
    cc_emails: input.ccEmails || null,
    subject: input.subject,
    body: input.body,
  })
  if (error) {
    // 부분 유니크 인덱스(uq_outbound_one_queued_per_ticket)에 걸린 경우
    if (error.message.includes('uq_outbound_one_queued_per_ticket')) {
      throw new Error('이 티켓에는 이미 발송 대기 중인 회신이 있습니다. 먼저 처리하거나 취소하세요.')
    }
    throw new Error(error.message)
  }
}

export async function cancelQueuedReply(emailId: number): Promise<void> {
  const { error } = await supabase
    .from('outbound_emails')
    .update({ status: 'cancelled' })
    .eq('id', emailId)
  if (error) throw new Error(error.message)
}
