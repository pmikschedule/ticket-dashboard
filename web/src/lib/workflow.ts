/**
 * 상태 전이와 권한 — 전부 순수 함수입니다.
 *
 * 화면에서 버튼을 숨기는 것은 편의일 뿐이고, 실제 차단은 DB 의 RLS 정책이 합니다
 * (supabase/schema.sql 11장). 두 곳의 규칙이 어긋나면 저장 시점에 실패하므로
 * 여기 규칙은 RLS 와 같은 내용을 담고 있어야 합니다.
 */

import { PIPELINE_STATUSES, STATUSES, type Status } from './constants'
import type { AppUser, TicketMeta } from './types'

/** 파이프라인에서의 위치. 보류는 파이프라인에 없으므로 -1 입니다. */
export function statusIndex(status: Status): number {
  return (PIPELINE_STATUSES as readonly string[]).indexOf(status)
}

/**
 * 이동 가능한 상태 목록.
 *
 * 관리자는 어디로든 점프할 수 있습니다 (오접수 티켓을 바로 완료 처리하는 등).
 * 팀원은 인접 단계로만 — 한 칸 전진 또는 한 칸 후퇴입니다.
 *
 * 보류(on_hold)는 파이프라인 밖의 옆길이라 규칙이 다릅니다.
 *
 *  · 들어갈 때  — 완료를 뺀 어느 단계에서든 갈 수 있습니다. 끝난 건은 보류할 게 없습니다.
 *  · 나올 때    — **보류 직전 단계로만** 돌아갑니다 (`holdFrom`).
 *                 아무 데로나 갈 수 있게 하면 보류를 한 번 거치는 것만으로
 *                 팀원이 단계를 건너뛸 수 있습니다. 그러면 인접 이동 규칙이
 *                 있으나 마나입니다.
 *
 * `holdFrom` 은 `ticket_meta.hold_from_status` 입니다 — 보류로 들어갈 때 DB
 * 트리거가 적어 둡니다. 값이 없는 옛 티켓은 관리자가 풀어야 합니다.
 */
export function allowedTransitions(
  current: Status,
  isAdmin: boolean,
  holdFrom?: Status | null,
): Status[] {
  if (isAdmin) return STATUSES.filter((s) => s !== current)

  if (current === 'on_hold') {
    return holdFrom && holdFrom !== 'on_hold' ? [holdFrom] : []
  }

  const index = statusIndex(current)
  const adjacent = PIPELINE_STATUSES.filter((_, i) => i === index - 1 || i === index + 1)
  return current === 'done' ? [...adjacent] : [...adjacent, 'on_hold']
}

export function canMoveTo(
  current: Status,
  next: Status,
  isAdmin: boolean,
  holdFrom?: Status | null,
): boolean {
  return allowedTransitions(current, isAdmin, holdFrom).includes(next)
}

/** 보류로 들어갈 때는 무엇을 기다리는지 적어야 합니다. 사유 없는 보류는 잊힙니다. */
export function requiresHoldReason(next: Status): boolean {
  return next === 'on_hold'
}

/**
 * 완료로 옮길 때는 종료 방식을 골라야 합니다.
 *
 * 자동 접수를 느슨하게 잡아 둔 이상 오접수가 들어옵니다. 그때 done 으로만
 * 닫으면 통계에서 처리 실적과 구분되지 않습니다.
 */
export function requiresResolution(next: Status): boolean {
  return next === 'done'
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
