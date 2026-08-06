/**
 * 완료 회신 초안 작성 — 순수 함수.
 *
 * agent/src/ticket_agent/summarize.py 와 **같은 결과**를 냅니다.
 * 평소에는 여기서 만든 초안이 발송 큐에 들어가고 에이전트는 그대로 보냅니다.
 * 관리자는 발송 요청 전에 화면에서 초안을 고칠 수 있습니다.
 */

import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS_KO,
  UNCLASSIFIED_SYSTEM,
  WORK_TYPE_LABELS,
  type Category,
  type Severity,
  type Status,
  type WorkType,
} from './constants'
import { formatDate, formatHours } from './format'
import type { Comment, Ticket, TicketMeta } from './types'

export function buildReplySubject(ticketSubject: string): string {
  const subject = (ticketSubject ?? '').trim() || '요청 처리 결과'
  return subject.toUpperCase().startsWith('RE:') ? subject : `RE: ${subject}`
}

export function leadTimeHours(receivedAt: string | null, completedAt: string | null): number | null {
  if (!receivedAt || !completedAt) return null
  const start = new Date(receivedAt).getTime()
  const end = new Date(completedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return (end - start) / 3_600_000
}

function label<K extends string>(map: Record<K, string>, key: K | null | undefined): string {
  return key && key in map ? map[key] : '-'
}

export function buildReplyBody(
  ticket: Pick<Ticket, 'subject' | 'reporter_name' | 'received_at'>,
  meta: Pick<
    TicketMeta,
    'work_type' | 'category' | 'severity' | 'system_type' | 'status' | 'completed_at'
  > | null,
  comments: Pick<Comment, 'content'>[] = [],
  signature = 'IT 운영팀 드림',
  /**
   * 시스템 표시명. 등록표(systems)에서 찾아 넘깁니다.
   * 주지 않으면 코드값을, 그것도 없으면 '미분류' 를 씁니다.
   */
  systemLabel?: string | null,
): string {
  const reporter = (ticket.reporter_name ?? '').trim()
  const greeting = reporter ? `${reporter}님, 안녕하세요.` : '안녕하세요.'
  const hours = leadTimeHours(ticket.received_at, meta?.completed_at ?? null)

  const lines: string[] = [
    greeting,
    '',
    '요청하신 건의 처리가 완료되어 결과를 안내드립니다.',
    '',
    '■ 요청 내용',
    `  · 제목      : ${ticket.subject || '-'}`,
    `  · 접수일    : ${formatDate(ticket.received_at)}`,
    `  · 유형      : ${label(WORK_TYPE_LABELS, meta?.work_type as WorkType)}` +
      ` / ${label(CATEGORY_LABELS, meta?.category as Category)}` +
      ` / ${label(SEVERITY_LABELS, meta?.severity as Severity)}`,
    `  · 대상 시스템: ${systemLabel || meta?.system_type || UNCLASSIFIED_SYSTEM}`,
    `  · 처리 상태  : ${label(STATUS_LABELS_KO, meta?.status as Status)}`,
    `  · 완료일    : ${formatDate(meta?.completed_at)} (소요 ${formatHours(hours)})`,
  ]

  // 코멘트가 하나도 없으면 절 자체를 넣지 않습니다 — 빈 제목만 남기지 않습니다.
  const body = comments
    .map((comment) => (comment.content ?? '').trim())
    .filter(Boolean)
    .map((content) => `  · ${content}`)

  if (body.length > 0) {
    lines.push('', '■ 처리 내역', ...body)
  }

  lines.push(
    '',
    '확인 후 추가로 필요한 사항이 있으시면 회신 부탁드립니다.',
    '감사합니다.',
    '',
    signature,
  )

  return lines.join('\n')
}
