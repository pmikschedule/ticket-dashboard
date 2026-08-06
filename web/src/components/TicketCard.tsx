import { Link } from 'react-router-dom'

import { formatDate, relativeDays } from '../lib/format'
import type { TicketWithMeta } from '../lib/types'
import { isOverdue } from '../lib/workflow'
import {
  CategoryBadge,
  ClassifyErrorBadge,
  OverdueBadge,
  SeverityBadge,
  SystemBadge,
} from './Badge'

interface Props {
  ticket: TicketWithMeta
  assigneeName?: string | null
  draggable?: boolean
  onDragStart?: (ticketId: number) => void
}

/**
 * 칸반 카드. 기획서 3.2 가 요구한 항목을 전부 보여줍니다:
 * 제목 · 요청자명 · 장애 등급 · 시스템 구분 · 최초 접수일 · 요청 기한.
 */
export default function TicketCard({ ticket, assigneeName, draggable, onDragStart }: Props) {
  const meta = ticket.ticket_meta
  const overdue = isOverdue(ticket.due_date, meta?.status)

  return (
    <Link
      to={`/tickets/${ticket.id}`}
      draggable={draggable}
      onDragStart={() => onDragStart?.(ticket.id)}
      className="card block space-y-2 p-3 transition hover:border-slate-400 hover:shadow"
    >
      <div className="flex flex-wrap items-center gap-1">
        {meta && <SeverityBadge severity={meta.severity} />}
        {meta && <CategoryBadge category={meta.category} />}
        {meta && <SystemBadge systemType={meta.system_type} />}
        {overdue && <OverdueBadge />}
        {meta?.llm_error && <ClassifyErrorBadge error={meta.llm_error} />}
      </div>

      <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">
        {ticket.subject}
      </p>

      <dl className="space-y-0.5 text-[11px] text-slate-500">
        <div className="flex justify-between gap-2">
          <dt>요청자</dt>
          <dd className="truncate text-right text-slate-700">
            {ticket.reporter_name || ticket.reporter_email}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>접수일</dt>
          <dd className="text-right">
            {formatDate(ticket.received_at)}
            <span className="ml-1 text-slate-400">({relativeDays(ticket.received_at)})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>요청 기한</dt>
          <dd className={`text-right ${overdue ? 'font-semibold text-rose-600' : ''}`}>
            {ticket.due_date ? formatDate(ticket.due_date) : '미지정'}
          </dd>
        </div>
      </dl>

      <div className="border-t border-slate-100 pt-2 text-[11px]">
        {assigneeName ? (
          <span className="text-slate-600">담당 {assigneeName}</span>
        ) : (
          <span className="text-amber-600">담당자 미배정</span>
        )}
        <span className="float-right text-slate-400">#{ticket.id}</span>
      </div>
    </Link>
  )
}
