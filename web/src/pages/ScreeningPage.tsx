import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import {
  useConvertScanToTicket,
  useMarkReviewed,
  useScannedMails,
  useSystemLabels,
} from '../hooks/queries'
import { SCAN_OUTCOME_LABELS, WORK_TYPES, WORK_TYPE_LABELS } from '../lib/constants'
import { formatDateTime, relativeDays } from '../lib/format'
import type { ScannedMail } from '../lib/types'

/**
 * 메일 스크리닝.
 *
 * 에이전트가 스캔한 메일을 **전부** 보여줍니다 — 티켓이 된 것과 걸러진 것 모두.
 * 이 화면이 없으면 LLM 이 잘못 걸러낸 메일은 어디에도 흔적이 남지 않아
 * 아무도 오판을 알 수 없습니다.
 *
 * 기본 필터가 '제외됨 · 미검토' 인 이유: 검토가 필요한 건이 정확히 그것이기 때문입니다.
 */
export default function ScreeningPage() {
  const { user, isAdmin } = useAuth()
  const systemLabel = useSystemLabels()

  const [outcome, setOutcome] = useState<string>('excluded')
  const [unreviewedOnly, setUnreviewedOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ScannedMail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filters = { outcome, unreviewedOnly, search }
  const { data: mails = [], isLoading } = useScannedMails(filters)
  const markReviewed = useMarkReviewed()
  const convert = useConvertScanToTicket()

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err))
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h1 className="text-base font-semibold text-slate-900">메일 스크리닝</h1>
        <p className="mt-1 text-sm text-slate-500">
          에이전트가 읽은 메일 전부입니다. LLM 이 잘못 걸러낸 건을 여기서 티켓으로 되살릴 수
          있습니다.
        </p>
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <div className="card flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-[180px] flex-1">
          <label className="label" htmlFor="scan-search">
            검색
          </label>
          <input
            id="scan-search"
            type="search"
            className="field"
            placeholder="제목 또는 발신자"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="scan-outcome">
            처리 결과
          </label>
          <select
            id="scan-outcome"
            className="field"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          >
            <option value="excluded">제외됨</option>
            <option value="ticketed">티켓 생성됨</option>
            <option value="all">전체</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={unreviewedOnly}
            onChange={(event) => setUnreviewedOnly(event.target.checked)}
          />
          미검토만
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* 목록 */}
        <div className="space-y-2 lg:col-span-2">
          {isLoading && <p className="text-sm text-slate-500">불러오는 중…</p>}

          {!isLoading && mails.length === 0 && (
            <div className="card p-6 text-center text-sm text-slate-500">
              {unreviewedOnly
                ? '검토할 메일이 없습니다. 모두 확인하셨습니다.'
                : '조건에 맞는 메일이 없습니다.'}
            </div>
          )}

          {mails.map((mail) => {
            const active = selected?.id === mail.id
            const lowConfidence = (mail.llm_confidence ?? 1) < 0.7
            return (
              <button
                key={mail.id}
                type="button"
                onClick={() => setSelected(mail)}
                className={`card w-full space-y-1.5 p-3 text-left transition hover:border-slate-400 ${
                  active ? 'border-slate-900 ring-1 ring-slate-900' : ''
                }`}
              >
                <div className="flex flex-wrap items-center gap-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      mail.outcome === 'ticketed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {SCAN_OUTCOME_LABELS[mail.outcome]}
                  </span>
                  {mail.reviewed_at === null && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                      미검토
                    </span>
                  )}
                  {lowConfidence && mail.llm_confidence !== null && (
                    <span
                      title="LLM 확신도가 낮습니다. 우선 확인하세요."
                      className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700"
                    >
                      확신도 {(mail.llm_confidence * 100).toFixed(0)}%
                    </span>
                  )}
                  {mail.llm_error && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      ⚠ 판정 실패
                    </span>
                  )}
                </div>

                <p className="line-clamp-2 text-sm font-medium text-slate-900">
                  {mail.subject || '(제목 없음)'}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {mail.sender_name || mail.sender_email} ·{' '}
                  {relativeDays(mail.received_at ?? mail.scanned_at)}
                </p>
              </button>
            )
          })}
        </div>

        {/* 상세 */}
        <div className="lg:col-span-3">
          {selected === null ? (
            <div className="card p-8 text-center text-sm text-slate-400">
              왼쪽에서 메일을 선택하면 원문과 판정 근거가 여기 보입니다.
            </div>
          ) : (
            <div className="card space-y-4 p-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {selected.subject || '(제목 없음)'}
                </h2>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div>
                    <dt className="text-slate-500">발신자</dt>
                    <dd className="truncate text-slate-800">
                      {selected.sender_name || '-'} ({selected.sender_email})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">수신일시</dt>
                    <dd className="text-slate-800">{formatDateTime(selected.received_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">스캔 시각</dt>
                    <dd className="text-slate-800">{formatDateTime(selected.scanned_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">폴더</dt>
                    <dd className="truncate text-slate-800">{selected.folder || '-'}</dd>
                  </div>
                </dl>
              </div>

              {/* 판정 근거 — 왜 이렇게 판단했는지 */}
              <div className="rounded-md bg-slate-50 p-3">
                <h3 className="text-xs font-semibold text-slate-700">자동 판정</h3>
                {selected.llm_error ? (
                  <p className="mt-1 text-xs text-amber-700">판정 실패: {selected.llm_error}</p>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-slate-700">
                      요청 메일{selected.llm_is_request ? '로 판정' : '이 아니라고 판정'}
                      {selected.llm_confidence !== null && (
                        <span className="ml-1 text-slate-400">
                          (확신도 {(selected.llm_confidence * 100).toFixed(0)}%)
                        </span>
                      )}
                    </p>
                    {selected.llm_reason && (
                      <p className="mt-1 text-xs text-slate-600">근거: {selected.llm_reason}</p>
                    )}
                    {selected.llm_is_request && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        추출값: {selected.llm_category ?? '-'} / {selected.llm_severity ?? '-'} /{' '}
                        {systemLabel(selected.llm_system) ?? '미분류'}
                      </p>
                    )}
                  </>
                )}
                {selected.llm_model && (
                  <p className="mt-1 text-[11px] text-slate-400">{selected.llm_model}</p>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-700">원문</h3>
                <pre className="mt-1 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-800">
                  {selected.body || '(본문 없음)'}
                </pre>
              </div>

              {/* 처리 */}
              <div className="border-t border-slate-100 pt-4">
                {selected.ticket_id ? (
                  <p className="text-sm text-slate-600">
                    티켓{' '}
                    <Link
                      to={`/tickets/${selected.ticket_id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      #{selected.ticket_id}
                    </Link>{' '}
                    으로 등록됐습니다.
                  </p>
                ) : !isAdmin ? (
                  <p className="text-xs text-slate-500">
                    티켓 전환과 검토 확정은 관리자만 할 수 있습니다.
                  </p>
                ) : (
                  <ConvertPanel
                    scan={selected}
                    onConvert={(workType) => {
                      if (!user) return
                      convert.mutate(
                        { scan: selected, userId: user.id, overrides: { workType } },
                        {
                          onSuccess: () => setSelected(null),
                          onError: fail,
                        },
                      )
                    }}
                    onConfirmExclusion={() => {
                      if (!user) return
                      markReviewed.mutate(
                        { id: selected.id, userId: user.id },
                        { onSuccess: () => setSelected(null), onError: fail },
                      )
                    }}
                  />
                )}

                {selected.reviewed_at && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    검토 완료: {formatDateTime(selected.reviewed_at)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ConvertPanel({
  scan,
  onConvert,
  onConfirmExclusion,
}: {
  scan: ScannedMail
  onConvert: (workType: string) => void
  onConfirmExclusion: () => void
}) {
  const [workType, setWorkType] = useState('maintenance')

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        LLM 이 요청이 아니라고 판단했습니다. 실제로는 요청이라면 티켓으로 되살리세요.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <label className="label" htmlFor="convert-work-type">
            대분류
          </label>
          <select
            id="convert-work-type"
            className="field"
            value={workType}
            onChange={(event) => setWorkType(event.target.value)}
          >
            {WORK_TYPES.filter((w) => w !== 'development').map((w) => (
              <option key={w} value={w}>
                {WORK_TYPE_LABELS[w]}
              </option>
            ))}
          </select>
        </div>

        <button type="button" className="btn-primary" onClick={() => onConvert(workType)}>
          티켓으로 전환
        </button>
        <button type="button" className="btn-secondary" onClick={onConfirmExclusion}>
          판정이 맞음 (검토 완료)
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        전환하면 <strong>Triage</strong> 상태로 들어갑니다. 같은 메일이 다음 스캔에서 다시
        티켓이 되지는 않습니다 (메일 ID {scan.message_id} 기준).
      </p>
    </div>
  )
}
