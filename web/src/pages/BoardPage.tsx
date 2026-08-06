import { useMemo, useState } from 'react'

import Filters from '../components/Filters'
import TicketCard from '../components/TicketCard'
import { useAuth } from '../hooks/useAuth'
import { useTickets, useUpdateStatus, useUsers } from '../hooks/queries'
import { STATUSES, STATUS_ACCENT, STATUS_LABELS, type Status } from '../lib/constants'
import type { TicketFilters, TicketWithMeta } from '../lib/types'
import {
  canEditTicket,
  canMoveTo,
  requiresHoldReason,
  requiresResolution,
} from '../lib/workflow'

/** 칸반 보드 (기획서 3.2). 열은 상태 파이프라인 6단계 그대로입니다. */
export default function BoardPage() {
  const { user, isAdmin } = useAuth()
  const [filters, setFilters] = useState<TicketFilters>({})
  const [dragging, setDragging] = useState<TicketWithMeta | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const { data: tickets = [], isLoading, error } = useTickets(filters)
  const { data: users = [] } = useUsers()
  const updateStatus = useUpdateStatus()

  const userNames = useMemo(
    () => new Map(users.map((entry) => [entry.id, entry.name || entry.email])),
    [users],
  )

  const columns = useMemo(() => {
    const map = new Map<Status, TicketWithMeta[]>(STATUSES.map((status) => [status, []]))
    for (const ticket of tickets) {
      const status = ticket.ticket_meta?.status
      if (status && map.has(status)) map.get(status)!.push(ticket)
    }
    return map
  }, [tickets])

  function handleDrop(target: Status) {
    const ticket = dragging
    setDragging(null)
    if (!ticket) return

    const current = ticket.ticket_meta?.status
    if (!current || current === target) return

    if (!canEditTicket(user, ticket.ticket_meta)) {
      setMoveError('본인에게 할당된 티켓만 옮길 수 있습니다.')
      return
    }
    if (!canMoveTo(current, target, isAdmin, ticket.ticket_meta?.hold_from_status)) {
      setMoveError(
        current === 'on_hold'
          ? '보류는 직전 단계로만 풀 수 있습니다. 티켓을 열어 확인하세요.'
          : `${STATUS_LABELS[current]} → ${STATUS_LABELS[target]} 로는 바로 옮길 수 없습니다. ` +
            '팀원은 인접 단계로만 이동할 수 있습니다.',
      )
      return
    }

    // 보류와 완료는 값을 하나 더 받아야 합니다 — 보류 사유, 종료 방식.
    // 끌어서 옮기면 그걸 물어볼 자리가 없어서 사유 없는 보류와 종료 방식 없는
    // 완료가 쌓입니다. 여기서는 막고 상세 화면으로 보냅니다.
    if (requiresHoldReason(target) || requiresResolution(target)) {
      setMoveError(
        target === 'on_hold'
          ? '보류로 옮기려면 무엇을 기다리는지 적어야 합니다. 티켓을 열어 주세요.'
          : '완료로 옮기려면 종료 방식을 골라야 합니다. 티켓을 열어 주세요.',
      )
      return
    }

    setMoveError(null)
    updateStatus.mutate(
      { ticketId: ticket.id, status: target },
      { onError: (err) => setMoveError(err instanceof Error ? err.message : String(err)) },
    )
  }

  return (
    <div className="space-y-4">
      <Filters value={filters} onChange={setFilters} users={users} showStatus={false} />

      {moveError && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{moveError}</p>
      )}
      {error && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          티켓을 불러오지 못했습니다: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STATUSES.map((status) => {
            const items = columns.get(status) ?? []
            return (
              <section
                key={status}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop(status)}
                className="flex min-h-[120px] flex-col rounded-lg bg-slate-100/70 p-2"
              >
                <header className="mb-2 flex items-center gap-1.5 px-1">
                  <span className={`h-2 w-2 rounded-full ${STATUS_ACCENT[status]}`} aria-hidden />
                  <h2 className="text-xs font-semibold text-slate-700">{STATUS_LABELS[status]}</h2>
                  <span className="ml-auto text-xs tabular-nums text-slate-500">
                    {items.length}
                  </span>
                </header>

                <div className="space-y-2">
                  {items.map((ticket) => (
                    <TicketCard
                      key={ticket.id}
                      ticket={ticket}
                      assigneeName={
                        ticket.ticket_meta?.assignee_id
                          ? userNames.get(ticket.ticket_meta.assignee_id)
                          : null
                      }
                      draggable
                      onDragStart={() => setDragging(ticket)}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="px-1 py-4 text-center text-[11px] text-slate-400">비어 있음</p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
