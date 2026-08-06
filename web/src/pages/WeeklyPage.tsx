import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { useLeadTimes, useSystemLabels, useUsers } from '../hooks/queries'
import {
  buildWeeklyRows,
  downloadWeeklyExcel,
  summarizeWeekly,
  weekRange,
  WEEKLY_COLUMNS,
} from '../lib/weekly'

/**
 * 주간 현황 — 팀 전체가 공유하는 작업별 목록.
 *
 * 화면에서 그대로 보고, 필요하면 엑셀로 내려받습니다.
 * 신규개발은 제외합니다 — 상시 업무의 진척을 공유하는 화면이고,
 * 신규개발은 일정 관리가 따로 필요합니다.
 */
export default function WeeklyPage() {
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: leadTimes = [], isLoading } = useLeadTimes()
  const { data: users = [] } = useUsers()
  const systemLabel = useSystemLabels()

  const range = useMemo(() => weekRange(new Date(), offset), [offset])

  const rows = useMemo(() => {
    const names = new Map(users.map((user) => [user.id, user.name || user.email]))
    return buildWeeklyRows(leadTimes, range, {
      systemLabel,
      userName: (id) => (id ? names.get(id) : undefined),
    })
  }, [leadTimes, range, users, systemLabel])

  const summary = useMemo(() => summarizeWeekly(rows), [rows])

  async function download() {
    setBusy(true)
    setError(null)
    try {
      await downloadWeeklyExcel(rows, range, summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-slate-900">유지보수 주간 현황</h1>
          <p className="mt-0.5 text-sm text-slate-500">{range.label}</p>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setOffset((value) => value + 1)}
          >
            ← 이전 주
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 1))}
          >
            다음 주 →
          </button>
          {offset !== 0 && (
            <button type="button" className="btn-secondary" onClick={() => setOffset(0)}>
              이번 주
            </button>
          )}
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={busy || rows.length === 0}
          onClick={() => void download()}
        >
          {busy ? '만드는 중…' : '엑셀 내려받기'}
        </button>
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: '금주 완료', value: summary.completed, tone: 'text-emerald-700' },
          { label: '금주 접수', value: summary.received, tone: 'text-slate-900' },
          { label: '진행 중', value: summary.ongoing, tone: 'text-slate-900' },
          {
            label: '보류',
            value: summary.onHold,
            tone: summary.onHold > 0 ? 'text-amber-700' : 'text-slate-400',
          },
          {
            label: '기한 초과',
            value: summary.overdue,
            tone: summary.overdue > 0 ? 'text-rose-700' : 'text-slate-400',
          },
        ].map((tile) => (
          <div key={tile.label} className="card p-4">
            <p className="text-xs font-medium text-slate-500">{tile.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${tile.tone}`}>{tile.value}건</p>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
              {WEEKLY_COLUMNS.map((column) => (
                <th key={column.key} className="px-2 py-2 font-medium">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={WEEKLY_COLUMNS.length} className="px-3 py-6 text-center text-slate-500">
                  불러오는 중…
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={WEEKLY_COLUMNS.length} className="px-3 py-6 text-center text-slate-500">
                  이 주에 해당하는 작업이 없습니다.
                </td>
              </tr>
            )}

            {rows.map((row) => (
              <tr key={row.ticketId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-2 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      row.bucket === '금주 완료'
                        ? 'bg-emerald-50 text-emerald-700'
                        : row.bucket === '금주 접수'
                          ? 'bg-sky-50 text-sky-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {row.bucket}
                  </span>
                </td>
                <td className="px-2 py-2 tabular-nums text-slate-400">{row.ticketId}</td>
                <td className="px-2 py-2 text-slate-700">{row.workType}</td>
                <td className="px-2 py-2 text-slate-600">{row.category}</td>
                <td className="px-2 py-2 text-slate-600">{row.severity}</td>
                <td className="px-2 py-2 text-slate-600">{row.system}</td>
                <td className="px-2 py-2">
                  <Link
                    to={`/tickets/${row.ticketId}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {row.subject}
                  </Link>
                </td>
                <td className="px-2 py-2 text-slate-600">{row.assignee}</td>
                <td className="px-2 py-2 text-slate-600">{row.status}</td>
                <td className="px-2 py-2 text-slate-500">{row.receivedAt}</td>
                <td className="px-2 py-2 text-slate-500">{row.dueDate || '-'}</td>
                <td className="px-2 py-2">
                  {row.overdue && (
                    <span className="font-semibold text-rose-700">{row.overdue}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-slate-500">{row.completedAt || '-'}</td>
                <td className="px-2 py-2 text-slate-500">{row.leadTime || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        {rows.length}건 · 신규개발은 제외했습니다 (일정 관리가 따로 필요한 건이라 주간 현황에
        섞지 않습니다).
      </p>
    </div>
  )
}
