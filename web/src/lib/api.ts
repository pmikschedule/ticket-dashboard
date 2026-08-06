/**
 * 데이터 접근 계층.
 *
 * **컴포넌트는 supabase 클라이언트를 직접 import 하지 않습니다.** 전부 이 파일을 경유합니다.
 * 쿼리가 화면에 흩어지면 RLS 위반이 어디서 났는지 추적할 수 없습니다.
 */

import type { Resolution } from './constants'
import { ATTACHMENT_BUCKET, supabase } from './supabase'
import type {
  AppSetting,
  AppUser,
  AttachmentRow,
  Comment,
  LeadTimeRow,
  OutboundEmailRow,
  IntakeRule,
  ManualIntakeRow,
  ScannedMail,
  StatusHistoryRow,
  SystemRow,
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
  if (filters.workType && filters.workType !== 'all') {
    query = query.eq('ticket_meta.work_type', filters.workType)
  }
  if (filters.severity && filters.severity !== 'all') {
    query = query.eq('ticket_meta.severity', filters.severity)
  }
  if (filters.systemType === 'unclassified') {
    query = query.is('ticket_meta.system_type', null)
  } else if (filters.systemType && filters.systemType !== 'all') {
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

/**
 * 상태 변경.
 *
 * 보류 사유와 종료 방식은 상태와 **같은 요청**으로 보냅니다. 따로 보내면
 * 사유 없는 보류나 종료 방식 없는 완료가 잠깐 존재하고, 그 사이에 다른 사람이
 * 보면 사실과 다릅니다. 되돌리기(done→다른 상태)는 DB 트리거가 정리합니다.
 */
export async function updateTicketStatus(
  ticketId: number,
  status: string,
  extra: { resolution?: Resolution | null; hold_reason?: string | null } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { status, ...extra }
  const { error } = await supabase.from('ticket_meta').update(patch).eq('ticket_id', ticketId)
  if (error) throw new Error(error.message)
}

export async function updateTicketMeta(
  ticketId: number,
  patch: Partial<
    Pick<
      TicketMeta,
      'work_type' | 'category' | 'severity' | 'system_type' | 'assignee_id' | 'estimated_days'
    >
  >,
): Promise<void> {
  const { error } = await supabase.from('ticket_meta').update(patch).eq('ticket_id', ticketId)
  if (error) throw new Error(error.message)
}

/** 관리자 수동 내용 보완 (기획서 3.2). */
export async function updateTicketFields(
  ticketId: number,
  patch: {
    subject?: string
    description?: string
    due_date?: string | null
    planned_start_date?: string | null
    planned_end_date?: string | null
  },
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

// ── 시스템 종류 등록표 ───────────────────────────────────────────────────────

/** 활성 시스템만. 분류 선택지와 차트 축에 씁니다. */
export async function fetchSystems(): Promise<SystemRow[]> {
  return unwrap(
    await supabase
      .from('systems')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .order('code'),
  ) as SystemRow[]
}

/** 비활성 포함 전부. 설정 화면에서만 씁니다. */
export async function fetchAllSystems(): Promise<SystemRow[]> {
  return unwrap(
    await supabase.from('systems').select('*').order('sort_order').order('code'),
  ) as SystemRow[]
}

export async function createSystem(input: {
  code: string
  name: string
  description?: string | null
  sortOrder?: number
}): Promise<void> {
  const { error } = await supabase.from('systems').insert({
    code: input.code.trim().toLowerCase(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    sort_order: input.sortOrder ?? 0,
  })
  if (error) {
    if (error.message.includes('duplicate') || error.code === '23505') {
      throw new Error(`이미 등록된 코드입니다: ${input.code}`)
    }
    throw new Error(error.message)
  }
}

export async function updateSystem(
  id: number,
  patch: Partial<Pick<SystemRow, 'name' | 'description' | 'sort_order' | 'is_active'>>,
): Promise<void> {
  const { error } = await supabase.from('systems').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * 시스템 삭제.
 *
 * 과거 티켓의 system_type 은 외래키가 아니라 그대로 남고, 화면에서는 미분류로 보입니다.
 * 이력을 지우지 않기 위한 의도된 동작입니다.
 */
export async function deleteSystem(id: number): Promise<void> {
  const { error } = await supabase.from('systems').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── 접수 판정 기준 ───────────────────────────────────────────────────────────

export async function fetchIntakeRules(): Promise<IntakeRule[]> {
  return unwrap(
    await supabase.from('intake_rules').select('*').order('kind').order('sort_order'),
  ) as IntakeRule[]
}

export async function createIntakeRule(input: {
  kind: 'include' | 'exclude'
  content: string
  sortOrder?: number
}): Promise<void> {
  const { error } = await supabase.from('intake_rules').insert({
    kind: input.kind,
    content: input.content.trim(),
    sort_order: input.sortOrder ?? 0,
  })
  if (error) {
    if (error.code === '23505') throw new Error('같은 내용의 기준이 이미 있습니다.')
    throw new Error(error.message)
  }
}

export async function updateIntakeRule(
  id: number,
  patch: Partial<Pick<IntakeRule, 'content' | 'sort_order' | 'is_active'>>,
): Promise<void> {
  const { error } = await supabase.from('intake_rules').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteIntakeRule(id: number): Promise<void> {
  const { error } = await supabase.from('intake_rules').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── 일반 설정 ────────────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<AppSetting[]> {
  return unwrap(await supabase.from('app_settings').select('*').order('key')) as AppSetting[]
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const { error } = await supabase.from('app_settings').update({ value }).eq('key', key)
  if (error) throw new Error(error.message)
}

// ── 비밀값 (API 키) ──────────────────────────────────────────────────────────

/**
 * 화면에서 등록하는 비밀값의 이름.
 * 에이전트의 `secrets.py` 와 **같은 값**이어야 합니다.
 */
export const GEMINI_KEY_SECRET = 'gemini_api_key'
export const GEMINI_MODEL_SETTING = 'gemini_model'

export interface SecretStatus {
  key: string
  is_set: boolean
  /** 마지막 4글자만 남긴 형태. 값 자체는 서버가 절대 돌려주지 않습니다 */
  hint: string
  length: number
  updated_at: string
  updated_by: string | null
}

/**
 * 등록 상태만 읽습니다. **값은 읽을 수 없습니다.**
 *
 * `app_secrets` 표에는 RLS 정책이 하나도 없어서 anon/authenticated 로는
 * select 자체가 막힙니다. 여기 rpc 는 security definer 함수라 표에 닿지만,
 * 마스킹한 힌트만 돌려줍니다. 한 번 넣은 키는 화면으로 다시 꺼낼 수 없습니다.
 */
export async function fetchSecretStatus(): Promise<SecretStatus[]> {
  const { data, error } = await supabase.rpc('app_secret_status')
  if (error) throw new Error(error.message)
  return (data ?? []) as SecretStatus[]
}

export async function setSecret(key: string, value: string): Promise<void> {
  const { error } = await supabase.rpc('set_app_secret', { p_key: key, p_value: value })
  if (error) throw new Error(error.message)
}

export async function clearSecret(key: string): Promise<void> {
  const { error } = await supabase.rpc('clear_app_secret', { p_key: key })
  if (error) throw new Error(error.message)
}

// ── 메일 스크리닝 ────────────────────────────────────────────────────────────

export interface ScanFilters {
  /** 'all' | 'ticketed' | 'excluded' */
  outcome?: string
  /** true 면 사람이 아직 보지 않은 것만 */
  unreviewedOnly?: boolean
  search?: string
}

export async function fetchScannedMails(filters: ScanFilters = {}): Promise<ScannedMail[]> {
  let query = supabase
    .from('scanned_mails')
    .select('*')
    .order('scanned_at', { ascending: false })
    .limit(200)

  if (filters.outcome && filters.outcome !== 'all') {
    query = query.eq('outcome', filters.outcome)
  }
  if (filters.unreviewedOnly) {
    query = query.is('reviewed_at', null)
  }
  if (filters.search?.trim()) {
    const term = filters.search.trim().replace(/[%,]/g, '')
    query = query.or(`subject.ilike.%${term}%,sender_email.ilike.%${term}%`)
  }

  return unwrap(await query) as ScannedMail[]
}

/** 검토 완료 표시 — LLM 판정이 맞았다고 확인하는 것입니다. */
export async function markScanReviewed(
  id: number,
  userId: string,
  note?: string,
): Promise<void> {
  const { error } = await supabase
    .from('scanned_mails')
    .update({
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: note?.trim() || null,
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * 오판 구제 — 걸러진 메일을 티켓으로 전환합니다.
 *
 * 원문을 그대로 티켓 본문으로 옮기고, 분류는 LLM 이 남긴 값을 기본으로 씁니다.
 * `source_message_id` 를 그대로 넣어 다음 스캔에서 다시 티켓이 되지 않게 합니다.
 */
export async function convertScanToTicket(
  scan: ScannedMail,
  userId: string,
  overrides: {
    workType?: string
    category?: string
    severity?: string
    systemType?: string | null
  } = {},
): Promise<number> {
  const ticket = unwrap(
    await supabase
      .from('tickets')
      .insert({
        subject: scan.subject || '(제목 없음)',
        description: scan.body || '',
        body_html: scan.body_html,
        reporter_email: scan.sender_email || 'unknown@unknown',
        reporter_name: scan.sender_name,
        received_at: scan.received_at ?? scan.scanned_at,
        source_message_id: scan.message_id,
        source_folder: scan.folder,
        created_by: userId,
      })
      .select('id')
      .single(),
  ) as { id: number }

  const { error: metaError } = await supabase.from('ticket_meta').insert({
    ticket_id: ticket.id,
    work_type: overrides.workType ?? 'maintenance',
    category: overrides.category ?? scan.llm_category ?? 'error',
    severity: overrides.severity ?? scan.llm_severity ?? 'medium',
    system_type: overrides.systemType ?? scan.llm_system ?? null,
    // 사람이 구제한 건이므로 바로 Triage 로 보냅니다.
    status: 'triage',
  })
  if (metaError) {
    await supabase.from('tickets').delete().eq('id', ticket.id)
    throw new Error(`분류 정보 저장에 실패해 되돌렸습니다: ${metaError.message}`)
  }

  const { error: scanError } = await supabase
    .from('scanned_mails')
    .update({
      outcome: 'ticketed',
      ticket_id: ticket.id,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', scan.id)
  if (scanError) throw new Error(scanError.message)

  return ticket.id
}

// ── 수동 등록 ────────────────────────────────────────────────────────────────

/**
 * 수동 등록 요청.
 *
 * 웹은 **큐에 넣기만** 합니다. 분류는 에이전트가 합니다 —
 * LLM API 키가 브라우저에 있으면 안 되기 때문입니다.
 * 등록 후 티켓이 뜨기까지 에이전트 폴링 주기(기본 30초)만큼 걸립니다.
 */
export async function queueManualIntake(input: {
  rawText: string
  subject?: string
  reporterEmail?: string
  reporterName?: string
  receivedAt?: string
  channel: string
  note?: string
  requestedBy: string
}): Promise<number> {
  const row = unwrap(
    await supabase
      .from('manual_intake')
      .insert({
        raw_text: input.rawText,
        subject: input.subject?.trim() || null,
        reporter_email: input.reporterEmail?.trim() || null,
        reporter_name: input.reporterName?.trim() || null,
        received_at: input.receivedAt || new Date().toISOString(),
        channel: input.channel,
        note: input.note?.trim() || null,
        requested_by: input.requestedBy,
      })
      .select('id')
      .single(),
  ) as { id: number }
  return row.id
}

/** 내가 넣은 요청의 처리 상태. 등록 후 결과를 확인할 수 있어야 합니다. */
export async function fetchManualIntakes(limit = 20): Promise<ManualIntakeRow[]> {
  return unwrap(
    await supabase
      .from('manual_intake')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(limit),
  ) as ManualIntakeRow[]
}
