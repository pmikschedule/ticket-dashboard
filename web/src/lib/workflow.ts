/**
 * 상태 전이와 권한 — 전부 순수 함수입니다.
 *
 * 화면에서 버튼을 숨기는 것은 편의일 뿐이고, 실제 차단은 DB 의 RLS 정책이 합니다
 * (supabase/schema.sql 11장). 두 곳의 규칙이 어긋나면 저장 시점에 실패하므로
 * 여기 규칙은 RLS 와 같은 내용을 담고 있어야 합니다.
 */

import { STATUSES, type Status } from './constants'
import type { AppUser, TicketMeta } from './types'

export function statusIndex(status: Status): number {
  return STATUSES.indexOf(status)
}

/**
 * 이동 가능한 상태 목록.
 *
 * 관리자는 어디로든 점프할 수 있습니다 (오접수 티켓을 바로 완료 처리하는 등).
 * 팀원은 인접 단계로만 — 한 칸 전진 또는 한 칸 후퇴입니다.
 */
export function allowedTransitions(current: Status, isAdmin: boolean): Status[] {
  if (isAdmin) return STATUSES.filter((s) => s !== current)

  const index = statusIndex(current)
  return STATUSES.filter((_, i) => i === index - 1 || i === index + 1)
}

export function canMoveTo(current: Status, next: Status, isAdmin: boolean): boolean {
  return allowedTransitions(current, isAdmin).includes(next)
}

export function isAdmin(user: AppUser | null | undefined): boolean {
  return !!user && user.role === 'admin' && user.is_active
}

/** 티켓을 수정할 수 있는가 — 관리자이거나, 나에게 할당된 티켓. */
export function canEditTicket(user: AppUser | null | undefined, meta: TicketMeta | null): boolean {
  if (!user || !user.is_active) return false
  if (user.role === 'admin') return true
  return !!meta && meta.assignee_id === user.id
}

/** 담당자 배정은 관리자만 (기획서 3.2). */
export function canAssign(user: AppUser | null | undefined): boolean {
  return isAdmin(user)
}

/** 회신 발송 요청은 관리자만 — 되돌릴 수 없는 동작입니다. */
export function canRequestSend(user: AppUser | null | undefined): boolean {
  return isAdmin(user)
}

export function canDeleteTicket(user: AppUser | null | undefined): boolean {
  return isAdmin(user)
}

/** 코멘트는 본인 것만 수정·삭제. 관리자는 삭제만 추가로 가능합니다. */
export function canDeleteComment(
  user: AppUser | null | undefined,
  commentUserId: string | null,
): boolean {
  if (!user || !user.is_active) return false
  return user.role === 'admin' || user.id === commentUserId
}

/** 완료 상태여야 회신을 보낼 수 있습니다 (기획서 2-5). */
export function canSendReply(user: AppUser | null | undefined, meta: TicketMeta | null): boolean {
  return canRequestSend(user) && meta?.status === 'done'
}

/** 마감일이 지났는가. 완료된 티켓은 지연으로 보지 않습니다. */
export function isOverdue(
  dueDate: string | null,
  status: Status | undefined,
  today: Date = new Date(),
): boolean {
  if (!dueDate || status === 'done') return false
  const due = new Date(`${dueDate}T23:59:59`)
  return Number.isFinite(due.getTime()) && due.getTime() < today.getTime()
}
