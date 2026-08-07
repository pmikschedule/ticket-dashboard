import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import {
  useConvertScanToTicket,
  useMarkReviewed,
  useScanOutcomeCounts,
  useScannedMails,
  useSystemLabels,
} from '../hooks/queries'
import {
  SCAN_OUTCOMES,
  SCAN_OUTCOME_LABELS,
  WORK_TYPES,
  WORK_TYPE_LABELS,
} from '../lib/constants'
import { formatDateTime, relativeDays } from '../lib/format'
import type { ScannedMail } from '../lib/types'

/**
 * 메일 스크리닝.
 *
 * 에이전트가 스캔한 메일을 **전부** 보여줍니다 — 티켓이 된 것과 걸러진 것 모두.
 * 이 화면이 없으면 LLM 이 잘못 걸러낸 메일은 어디에도 흔적이 남지 않아
 * 아무도 오판을 알 수 없습니다.
 *
 * 기본 필터가 '판단 대기' 인 이유: 분류에 실패한 메일은 티켓이 되지 않고 여기
 * 쌓입니다. 이 화면을 안 보면 그대로 묻히므로, 열자마자 그것부터 보여줍니다.
 * '제외됨' 은 LLM 이 판단을 끝낸 건이라 급하지 않습니다.
 */
export default function ScreeningPage() {
  const { user, isAdmin } = useAuth()
  const systemLabel = useSystemLabels()

  const [outcome, setOutcome] = useState<string>('pending')
  const [unreviewedOnly, setUnreviewedOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ScannedMail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filters = { outcome, unreviewedOnly, search }
  const { data: mails = [], isLoading } = useScannedMails(filters)
  const { data: outcomeCounts } = useScanOutcomeCounts()
  const markReviewed = useMarkReviewed()
  const convert = useConvertScanToTicket()

  // 지금 필터 밖에 쌓여 있는 것들. 목록이 비었을 때만 씁니다.
  const elsewhere = SCAN_OUTCOMES.filter((key) => key !== outcome)
    .map((key) => ({ key, label: SCAN_OUTCOME_LABELS[key], count: outcomeCounts?.[key] ?? 0 }))
    .filter((entry) => entry.count > 0)

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err))
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h1 className="text-base font-semibold text-slate-900">메일 스크리닝</h1>
        <p className="mt-1 text-sm text-slate-500">
          에이전트가 읽은 메일 전부입니다. <strong>판단 대기</strong>는 자동 분류가 실패해
          접수 여부를 사람이 정해야 하는 건이고, <strong>제외됨</strong>은 LLM 이 요청이
          아니라고 판단한 건입니다. 둘 다 여기서 티켓으로 되살릴 수 있습니다.
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
            <option value="pending">판단 대기</option>
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

          {/*
            "없습니다" 로 끝내면 안 됩니다. 필터가 걸려 있어 안 보이는 것과
            정말 아무것도 없는 것은 다른 사실인데, 화면은 똑같이 비어 보입니다.
            에이전트가 메일을 읽었는데 여기가 비면 수집이 실패한 줄 압니다.
            그래서 다른 칸에 몇 건 있는지 같이 보여 줍니다.
          */}
          {!isLoading && mails.length === 0 && (
            <div className="card space-y-2 p-6 text-center text-sm text-slate-500">
              <p>
                {outcome === 'pending'
                  ? '자동 분류가 실패한 메일이 없습니다.'
                  : unreviewedOnly
                    ? '검토할 메일이 없습니다.'
                    : '조건에 맞는 메일이 없습니다.'}
              </p>
              {elsewhere.length > 0 ? (
                <p className="text-xs text-slate-400">
                  다른 칸에 있습니다 —{' '}
                  {elsewhere.map(({ key, label, count }, index) => (
                    <span key={key}>
                      {index > 0 && ' · '}
                      <button
                        type="button"
                        className="underline hover:text-slate-700"
                        onClick={() => {
                          setOutcome(key)
                          setUnreviewedOnly(false)
                        }}
                      >
                        {label} {count}건
                      </button>
                    </span>
                  ))}
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  에이전트가 읽은 메일이 아직 하나도 없습니다.
                </p>
              )}
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
                        : mail.outcome === 'pending'
                          ? 'bg-amber-100 text-amber-800'
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
                        {
                          id: selected.id,
                          userId: user.id,
                          // 판단 대기를 접수 안 하기로 정했으면 그건 이제
                          // '아직 모름' 이 아니라 '걸렀음' 입니다.
                          outcome: selected.outcome === 'pending' ? 'excluded' : undefined,
                        },
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
  const isPending = scan.outcome === 'pending'

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        {isPending
          ? '자동 분류가 실패해 요청 여부를 판단하지 못했습니다. 원문을 보고 접수할지 정하세요.'
          : 'LLM 이 요청이 아니라고 판단했습니다. 실제로는 요청이라면 티켓으로 되살리세요.'}
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
          {isPending ? '접수 (티켓 생성)' : '티켓으로 전환'}
        </button>
        <button type="button" className="btn-secondary" onClick={onConfirmExclusion}>
          {isPending ? '접수 안 함' : '판정이 맞음 (검토 완료)'}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        전환하면 <strong>Triage</strong> 상태로 들어갑니다. 같은 메일이 다음 스캔에서 다시
        티켓이 되지는 않습니다 (메일 ID {scan.message_id} 기준).
        {isPending && ' 접수하지 않아도 원문은 이 화면에 계속 남습니다.'}
      </p>
    </div>
  )
}
