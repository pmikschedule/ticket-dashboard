import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { useLeadTimes, useUsers } from '../hooks/queries'
import { SERIES_HUE, CHART_INK } from '../lib/constants'
import { formatDate } from '../lib/format'
import { buildGantt, PROGRESS_LEGEND, summarizeGantt } from '../lib/gantt'

/**
 * 신규개발 일정 (Gantt).
 *
 * 장애·유지보수는 대체로 며칠 안에 끝나 타임라인에서 선 하나로 뭉갭니다.
 * 그쪽은 주간 현황과 통계로 보고, 여기는 공수가 큰 건만 올립니다.
 */
export default function GanttPage() {
  const { data: leadTimes = [], isLoading } = useLeadTimes()
  const { data: users = [] } = useUsers()

  const model = useMemo(() => {
    const names = new Map(users.map((user) => [user.id, user.name || user.email]))
    return buildGantt(leadTimes, { userName: (id) => (id ? names.get(id) : undefined) })
  }, [leadTimes, users])

  const summary = useMemo(() => summarizeGantt(model), [model])

  if (isLoading) return <p className="text-sm text-slate-500">불러오는 중…</p>

  if (summary.total === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-slate-500">신규개발로 분류된 건이 없습니다.</p>
        <p className="mt-2 text-xs text-slate-400">
          티켓 상세에서 대분류를 <strong>신규개발</strong>로 올리면 여기에 나타납니다.
          공수 1주일 이상이 기준이고, 판단은 관리자가 합니다.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h1 className="text-base font-semibold text-slate-900">신규개발 일정</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          전체 {summary.total}건 · 일정 있음 {summary.dated}건 · 완료 {summary.done}건
          {summary.held > 0 && (
            <span className="ml-1 font-medium text-amber-700">· 보류 {summary.held}건</span>
          )}
          {summary.overdue > 0 && (
            <span className="ml-1 font-medium text-rose-700">· 기한 초과 {summary.overdue}건</span>
          )}
        </p>
      </div>

      {model.scale && (
        <section className="card overflow-x-auto p-4">
          <div className="min-w-[900px]">
            {/* 축 — 월 구분 */}
            <div className="relative mb-2 ml-[280px] h-5 border-b border-slate-200">
              {model.scale.months.map((month) => (
                <span
                  key={month.label}
                  className="absolute top-0 text-[11px] text-slate-500"
                  style={
                    // 오른쪽 끝에 붙는 라벨은 left 로 두면 잘립니다.
                    month.offsetPercent > 92
                      ? { right: `${100 - month.offsetPercent}%` }
                      : { left: `${month.offsetPercent}%` }
                  }
                >
                  {month.label}
                </span>
              ))}
            </div>

            <div className="space-y-1.5">
              {model.bars.map((bar) => (
                <div key={bar.ticketId} className="flex items-center gap-2">
                  {/* 왼쪽 라벨 */}
                  <div className="w-[272px] shrink-0">
                    <Link
                      to={`/tickets/${bar.ticketId}`}
                      className="line-clamp-1 text-sm font-medium text-slate-900 hover:underline"
                      title={bar.subject}
                    >
                      {bar.subject}
                    </Link>
                    <p className="text-[11px] text-slate-500">
                      {bar.assignee} · {bar.statusLabel}
                      {bar.estimatedDays !== null && ` · ${bar.estimatedDays}일`}
                    </p>
                  </div>

                  {/* 막대 */}
                  <div
                    className="relative h-8 flex-1 rounded"
                    style={{ backgroundColor: '#f1f5f9' }}
                  >
                    {/* 월 구분선 */}
                    {model.scale!.months.map((month) => (
                      <span
                        key={month.label}
                        className="absolute inset-y-0 w-px"
                        style={{
                          left: `${month.offsetPercent}%`,
                          backgroundColor: CHART_INK.gridline,
                        }}
                        aria-hidden
                      />
                    ))}

                    {/* 오늘 */}
                    {model.scale!.todayPercent !== null && (
                      <span
                        className="absolute inset-y-0 z-10 w-0.5 bg-rose-500"
                        style={{ left: `${model.scale!.todayPercent}%` }}
                        aria-hidden
                      />
                    )}

                    <span
                      className={`absolute inset-y-1 flex items-center overflow-hidden rounded ${
                        bar.inferred ? 'border border-dashed border-slate-500' : ''
                      }`}
                      style={{
                        left: `${bar.offsetPercent}%`,
                        width: `${bar.widthPercent}%`,
                        backgroundColor: bar.held
                          ? '#fde68a'
                          : bar.inferred
                            ? '#cbd5e1'
                            : '#cde2fb',
                      }}
                      title={
                        `${formatDate(bar.start.toISOString())} ~ ${formatDate(bar.end.toISOString())}` +
                        (bar.inferred ? ' (계획 미입력 — 접수일·기한으로 표시)' : '') +
                        (bar.progress === null ? ' · 보류 중 (진척 알 수 없음)' : ` · 진척 ${bar.progress}%`)
                      }
                    >
                      {/* 진척 — 상태에서 유도한 값. 보류 중이면 채우지 않습니다 */}
                      {bar.progress !== null && (
                        <span
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${bar.progress}%`,
                            backgroundColor: bar.overdue ? '#c0392b' : SERIES_HUE,
                          }}
                        />
                      )}
                      <span
                        className={`relative z-10 px-2 text-[11px] font-medium ${
                          bar.progress === null ? 'text-amber-900' : 'text-white'
                        }`}
                      >
                        {bar.progress === null
                          ? 'On Hold'
                          : bar.progress > 20
                            ? `${bar.progress}%`
                            : ''}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 범례 — 진척률이 어디서 나온 값인지 밝힙니다 */}
      <section className="card p-4">
        <h2 className="text-sm font-semibold text-slate-800">진척률은 상태에서 유도한 값입니다</h2>
        <p className="mt-1 text-xs text-slate-500">
          따로 입력받는 값이 아니라 티켓 상태를 환산한 것입니다. 실제 작업량과 다를 수 있습니다.
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {PROGRESS_LEGEND.map((entry) => (
            <li key={entry.status}>
              {entry.label} <span className="text-slate-400">{entry.progress}%</span>
            </li>
          ))}
        </ul>

        {/* 빨강이 두 가지 뜻으로 쓰이므로 밝혀 둡니다. */}
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded" style={{ backgroundColor: SERIES_HUE }} aria-hidden />
            진행한 만큼
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded bg-[#c0392b]" aria-hidden />
            기한 초과 (종료일이 지났는데 완료 아님)
          </li>
          <li className="flex items-center gap-1.5">
            <span
              className="h-3 w-5 rounded border border-dashed border-slate-500 bg-slate-300"
              aria-hidden
            />
            계획 미입력 — 접수일·기한으로 표시
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded bg-[#fde68a]" aria-hidden />
            보류 중 — 진척을 알 수 없어 비워 둡니다
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3.5 w-0.5 bg-rose-500" aria-hidden />
            오늘
          </li>
        </ul>

        {summary.inferred > 0 && (
          <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
            {summary.inferred}건은 계획 일정이 입력되지 않아 <strong>접수일·기한</strong>으로
            그렸습니다 (점선 테두리). 티켓 상세에서 계획 시작·종료일을 넣으면 실제 계획으로
            바뀝니다.
          </p>
        )}
      </section>

      {/* 일정을 알 수 없는 건 — 지어내지 않고 따로 보여줍니다 */}
      {model.undated.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold text-slate-800">
            일정 미정 <span className="text-slate-400">({model.undated.length})</span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            시작·종료를 알 수 없어 타임라인에 올리지 않았습니다. 없는 일정을 임의로 채우면
            보는 사람이 실제 계획으로 오해합니다.
          </p>
          <ul className="mt-2 divide-y divide-slate-100">
            {model.undated.map((entry) => (
              <li key={entry.ticketId} className="flex items-center gap-2 py-2 text-sm">
                <Link
                  to={`/tickets/${entry.ticketId}`}
                  className="flex-1 truncate font-medium text-slate-900 hover:underline"
                >
                  {entry.subject}
                </Link>
                <span className="shrink-0 text-xs text-slate-500">{entry.assignee}</span>
                <span className="shrink-0 text-xs text-slate-400">{entry.statusLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
