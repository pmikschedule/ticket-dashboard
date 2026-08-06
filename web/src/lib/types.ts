import type { Category, Role, Severity, Status, SystemType } from './constants'

export interface AppUser {
  id: string
  email: string
  name: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface TicketMeta {
  ticket_id: number
  category: Category
  severity: Severity
  system_type: SystemType
  status: Status
  assignee_id: string | null
  llm_model: string | null
  llm_confidence: number | null
  llm_reason: string | null
  /** 분류에 실패한 이유. 값이 있으면 화면에 배지로 드러냅니다 — 숨기면 아무도 모릅니다. */
  llm_error: string | null
  completed_at: string | null
  updated_at: string
}

export interface Ticket {
  id: number
  subject: string
  description: string
  body_html: string | null
  reporter_email: string
  reporter_name: string | null
  /** 메일 수신일시. 화면의 "최초 접수일"은 created_at 이 아니라 이 값입니다. */
  received_at: string
  due_date: string | null
  source_message_id: string | null
  source_folder: string | null
  created_at: string
  updated_at: string
}

/** 목록·칸반에서 쓰는 조인 결과. */
export interface TicketWithMeta extends Ticket {
  ticket_meta: TicketMeta | null
  assignee?: Pick<AppUser, 'id' | 'name'> | null
}

export interface Comment {
  id: number
  ticket_id: number
  user_id: string | null
  content: string
  created_at: string
  users?: Pick<AppUser, 'id' | 'name'> | null
}

export interface AttachmentRow {
  id: number
  ticket_id: number
  file_name: string
  file_url: string
  content_type: string | null
  size_bytes: number | null
  created_at: string
}

export interface StatusHistoryRow {
  id: number
  ticket_id: number
  from_status: Status | null
  to_status: Status
  changed_by: string | null
  changed_at: string
}

export interface OutboundEmailRow {
  id: number
  ticket_id: number
  to_email: string
  cc_emails: string | null
  subject: string
  body: string
  status: 'queued' | 'sent' | 'failed' | 'cancelled'
  requested_by: string | null
  requested_at: string
  sent_at: string | null
  attempts: number
  error: string | null
}

export interface LeadTimeRow {
  ticket_id: number
  subject: string
  received_at: string
  status: Status
  severity: Severity
  system_type: SystemType
  category: Category
  assignee_id: string | null
  completed_at: string | null
  lead_time_hours: number | null
}

export interface TicketFilters {
  status?: Status | 'all'
  severity?: Severity | 'all'
  systemType?: SystemType | 'all'
  assigneeId?: string | 'all' | 'unassigned'
  search?: string
}
