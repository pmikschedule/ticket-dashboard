import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  CategoryBadge,
  ClassifyErrorBadge,
  OverdueBadge,
  SeverityBadge,
  StatusBadge,
  SystemBadge,
  WorkTypeBadge,
} from '../components/Badge'
import Filters from '../components/Filters'
import { useSystemLabels, useTickets, useUsers } from '../hooks/queries'
import { formatDate, relativeDays } from '../lib/format'
import type { TicketFilters } from '../lib/types'
import { isOverdue } from '../lib/workflow'

/** 리스트 뷰. 칸반이 못 보여주는 밀도가 필요할 때 씁니다. */
export default function ListPage() {
  const systemLabel = useSystemLabels()
  const [filters, setFilters] = useState<TicketFilters>({})
  const { data: tickets = [], isLoading, error } = useTickets(filters)
  const { data: users = [] } = useUsers()

  const userNames = useMemo(
    () => new Map(users.map((entry) => [entry.id, entry.name || entry.email])),
    [users],
  )

  return (
    <div className="space-y-4">
      <Filters value={filters} onChange={setFilters} users={users} />

      {error && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          티켓을 불러오지 못했습니다: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">제목</th>
              <th className="px-3 py-2 font-medium">분류</th>
              <th className="px-3 py-2 font-medium">요청자</th>
              <th className="px-3 py-2 font-medium">담당자</th>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 font-medium">접수일</th>
              <th className="px-3 py-2 font-medium">기한</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  불러오는 중…
                </td>
              </tr>
            )}

            {!isLoading && tickets.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  조건에 맞는 티켓이 없습니다.
                </td>
              </tr>
            )}

            {tickets.map((ticket) => {
              const meta = ticket.ticket_meta
              const overdue = isOverdue(ticket.due_date, meta?.status)
              return (
                <tr key={ticket.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2 tabular-nums text-slate-400">{ticket.id}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/tickets/${ticket.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {ticket.subject}
                    </Link>
                    {meta?.llm_error && (
                      <span className="ml-2 align-middle">
                        <ClassifyErrorBadge error={meta.llm_error} />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {meta && <WorkTypeBadge workType={meta.work_type} />}
                      {meta && <SeverityBadge severity={meta.severity} />}
                      {meta && <CategoryBadge category={meta.category} />}
                      {meta && (
                        <SystemBadge code={meta.system_type} label={systemLabel(meta.system_type)} />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {ticket.reporter_name || ticket.reporter_email}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {meta?.assignee_id ? (
                      (userNames.get(meta.assignee_id) ?? '알 수 없음')
                    ) : (
                      <span className="text-amber-600">미배정</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{meta && <StatusBadge status={meta.status} />}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatDate(ticket.received_at)}
                    <span className="ml-1 text-xs text-slate-400">
                      ({relativeDays(ticket.received_at)})
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {ticket.due_date ? (
                      <span className={overdue ? 'font-medium text-rose-600' : 'text-slate-600'}>
                        {formatDate(ticket.due_date)}
                        {overdue && (
                          <span className="ml-1 align-middle">
                            <OverdueBadge />
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">미지정</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">{tickets.length}건</p>
    </div>
  )
}
