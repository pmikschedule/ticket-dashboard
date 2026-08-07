import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { StatusBadge } from '../components/Badge'
import {
  useConvertScanToTicket,
  useLinkCandidates,
  useLinkScanToTicket,
  useMarkReviewed,
  useScanOutcomeCounts,
  useScannedMails,
  useSystemLabels,
} from '../hooks/queries'
import { rankLinkCandidates } from '../lib/link'
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
  const link = useLinkScanToTicket()

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
            <option value="linked">후속 연결됨</option>
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
                    {selected.outcome === 'linked' ? '후속 메일로 티켓 ' : '티켓 '}
                    <Link
                      to={`/tickets/${selected.ticket_id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      #{selected.ticket_id}
                    </Link>
                    {selected.outcome === 'linked' ? ' 에 붙었습니다.' : ' 으로 등록됐습니다.'}
                  </p>
                ) : !isAdmin ? (
                  <p className="text-xs text-slate-500">
                    티켓 전환과 검토 확정은 관리자만 할 수 있습니다.
                  </p>
                ) : (
                  <ConvertPanel
                    scan={selected}
                    linking={link.isPending}
                    onLink={(ticketId, note) => {
                      if (!user) return
                      link.mutate(
                        { scan: selected, ticketId, userId: user.id, note },
                        { onSuccess: () => setSelected(null), onError: fail },
                      )
                    }}
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

/**
 * 판단 패널.
 *
 * 갈 곳은 셋뿐입니다 — 새 티켓, 기존 티켓의 후속, 접수 안 함. 예전에는 앞의
 * 둘이 구분되지 않아 후속 메일도 새 티켓이 됐고, 같은 사안이 두 건으로
 * 갈라졌습니다.
 *
 * 셋을 한 줄에 나란히 두는 대신 **먼저 고르게** 합니다. 각 갈래에 필요한
 * 입력이 다른데(새 티켓은 대분류, 후속은 티켓 검색) 그것을 다 펼쳐 두면
 * 무엇을 정해야 하는지가 안 보입니다.
 */
function ConvertPanel({
  scan,
  onConvert,
  onLink,
  onConfirmExclusion,
  linking,
}: {
  scan: ScannedMail
  onConvert: (workType: string) => void
  onLink: (ticketId: number, note: string) => void
  onConfirmExclusion: () => void
  linking: boolean
}) {
  const [choice, setChoice] = useState<'new' | 'follow' | 'skip' | null>(null)
  const [workType, setWorkType] = useState('maintenance')
  const isPending = scan.outcome === 'pending'

  const CHOICES = [
    {
      key: 'new' as const,
      label: '새 요청',
      hint: '티켓을 새로 만듭니다',
    },
    {
      key: 'follow' as const,
      label: '진행 중인 건의 후속',
      hint: '기존 티켓에 코멘트로 붙입니다',
    },
    {
      key: 'skip' as const,
      label: '접수 안 함',
      hint: '요청이 아닙니다',
    },
  ]

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">
        {isPending
          ? '자동 분류가 실패해 요청 여부를 판단하지 못했습니다. 원문을 보고 정하세요.'
          : 'LLM 이 요청이 아니라고 판단했습니다. 실제로 어느 쪽인지 정하세요.'}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {CHOICES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setChoice(item.key)}
            className={`rounded-md border p-2 text-left transition ${
              choice === item.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
            }`}
          >
            <span className="block text-sm font-medium">{item.label}</span>
            <span
              className={`block text-[11px] ${
                choice === item.key ? 'text-slate-300' : 'text-slate-400'
              }`}
            >
              {item.hint}
            </span>
          </button>
        ))}
      </div>

      {choice === 'new' && (
        <div className="space-y-2 rounded-md bg-slate-50 p-3">
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
              티켓 생성
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            <strong>Triage</strong> 상태로 들어갑니다. 같은 메일이 다음 스캔에서 다시 티켓이 되지는
            않습니다.
          </p>
        </div>
      )}

      {choice === 'follow' && <LinkPanel scan={scan} onLink={onLink} busy={linking} />}

      {choice === 'skip' && (
        <div className="space-y-2 rounded-md bg-slate-50 p-3">
          <button type="button" className="btn-secondary" onClick={onConfirmExclusion}>
            접수 안 함으로 확정
          </button>
          <p className="text-[11px] text-slate-400">
            티켓을 만들지 않습니다. 원문은 이 화면에 계속 남으므로 나중에 되살릴 수 있습니다.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * 후속으로 붙일 티켓 고르기.
 *
 * 검색어가 비어 있어도 최근 티켓을 보여 줍니다. 빈 목록에서 시작하면 무엇을
 * 쳐야 할지부터 생각해야 하고, 그러느니 '새 요청' 을 눌러 버립니다.
 * 같은 요청자의 안 끝난 건을 위로 올려 두는 것도 같은 이유입니다.
 */
function LinkPanel({
  scan,
  onLink,
  busy,
}: {
  scan: ScannedMail
  onLink: (ticketId: number, note: string) => void
  busy: boolean
}) {
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const { data: tickets = [], isLoading } = useLinkCandidates(term)

  const candidates = rankLinkCandidates(tickets, scan.sender_email).slice(0, 8)

  return (
    <div className="space-y-3 rounded-md bg-slate-50 p-3">
      <div>
        <label className="label" htmlFor="link-search">
          붙일 티켓
        </label>
        <input
          id="link-search"
          type="search"
          className="field"
          placeholder="티켓 번호(#42) 또는 제목·요청자"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value)
            setPicked(null)
          }}
        />
      </div>

      {isLoading && <p className="text-xs text-slate-400">찾는 중…</p>}

      {!isLoading && candidates.length === 0 && (
        <p className="text-xs text-slate-400">
          조건에 맞는 티켓이 없습니다. 번호를 알면 <code>#42</code> 처럼 입력하세요.
        </p>
      )}

      <ul className="max-h-56 space-y-1 overflow-auto">
        {candidates.map((ticket) => {
          const active = picked === ticket.id
          const sameReporter =
            (ticket.reporter_email || '').toLowerCase() ===
            (scan.sender_email || '').toLowerCase()
          return (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => setPicked(ticket.id)}
                className={`w-full rounded-md border p-2 text-left transition ${
                  active
                    ? 'border-slate-900 ring-1 ring-slate-900'
                    : 'border-slate-200 bg-white hover:border-slate-400'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-slate-500">#{ticket.id}</span>
                  {ticket.ticket_meta && <StatusBadge status={ticket.ticket_meta.status} />}
                  {sameReporter && (
                    <span
                      title="이 메일의 발신자가 이 티켓의 요청자입니다"
                      className="rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700"
                    >
                      같은 요청자
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-sm text-slate-800">
                  {ticket.subject}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div>
        <label className="label" htmlFor="link-note">
          덧붙일 메모 (선택)
        </label>
        <input
          id="link-note"
          className="field"
          placeholder="예: 요청자에게 전화로 재확인함"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <button
        type="button"
        className="btn-primary"
        disabled={picked === null || busy}
        onClick={() => picked !== null && onLink(picked, note)}
      >
        {busy ? '붙이는 중…' : picked === null ? '티켓을 고르세요' : `#${picked} 에 코멘트로 붙이기`}
      </button>

      <p className="text-[11px] text-slate-400">
        메일 제목·발신자·수신일시와 본문이 코멘트로 들어갑니다. 티켓은 새로 만들지 않습니다.
        <strong> 메일에 붙어 있던 파일은 함께 옮겨지지 않습니다</strong> — 필요하면 티켓 상세에서
        직접 올리세요.
      </p>
    </div>
  )
}
