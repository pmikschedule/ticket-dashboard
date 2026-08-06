import type { Category, Role, RuleKind, ScanOutcome, Severity, Status, SystemCode, WorkType } from './constants'

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
  /** 대분류. 신규개발 승격은 관리자만 합니다 */
  work_type: WorkType
  category: Category
  severity: Severity
  /** 등록표(systems)의 code. null 이면 미분류 */
  system_type: SystemCode | null
  status: Status
  assignee_id: string | null
  /** 공수(사람일). 신규개발 승격 판단과 Gantt 의 입력값 */
  estimated_days: number | null
  /** 신규개발로 승격된 시점 */
  promoted_at: string | null
  promoted_by: string | null
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
  planned_start_date: string | null
  planned_end_date: string | null
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
  due_date: string | null
  planned_start_date: string | null
  planned_end_date: string | null
  status: Status
  work_type: WorkType
  severity: Severity
  system_type: SystemCode | null
  category: Category
  assignee_id: string | null
  estimated_days: number | null
  promoted_at: string | null
  completed_at: string | null
  /** 착수 시각 — 상태가 처음 in_progress 로 바뀐 때 */
  started_at: string | null
  /** 접수 → 착수. 대응까지 걸린 대기 시간 (MTTA) */
  wait_hours: number | null
  /** 착수 → 완료. 팀이 실제로 고친 시간 (MTTR) */
  repair_hours: number | null
  /** 접수 → 완료. 요청자가 겪은 전체 시간 */
  lead_time_hours: number | null
}

/** 시스템 종류 등록표 (설정 화면에서 관리) */
export interface SystemRow {
  id: number
  code: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

/** 접수 판정 기준 */
export interface IntakeRule {
  id: number
  kind: RuleKind
  content: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

export interface AppSetting {
  key: string
  value: string | null
  description: string | null
  updated_at: string
}

/** 스캔한 메일 — 티켓이 되지 않은 것도 포함 */
export interface ScannedMail {
  id: number
  message_id: string
  subject: string
  body: string
  body_html: string | null
  sender_email: string
  sender_name: string | null
  received_at: string | null
  folder: string | null
  scanned_at: string
  llm_is_request: boolean | null
  llm_category: Category | null
  llm_severity: Severity | null
  llm_system: SystemCode | null
  llm_confidence: number | null
  llm_reason: string | null
  llm_error: string | null
  llm_model: string | null
  outcome: ScanOutcome
  ticket_id: number | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
}

export interface TicketFilters {
  status?: Status | 'all'
  workType?: WorkType | 'all'
  severity?: Severity | 'all'
  systemType?: SystemCode | 'all' | 'unclassified'
  assigneeId?: string | 'all' | 'unassigned'
  search?: string
}
