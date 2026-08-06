import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'
import { useManualIntakes, useQueueManualIntake } from '../hooks/queries'
import { formatDateTime, relativeDays } from '../lib/format'
import { INTAKE_CHANNELS, INTAKE_CHANNEL_LABELS, type IntakeChannel } from '../lib/types'

/**
 * 수동 등록.
 *
 * 메일로 오지 않은 요청(구두·전화·메신저)을 여기서 넣습니다.
 * 필드를 하나하나 채우는 대신 **들은 내용을 그대로 붙여넣으면**
 * 시스템이 성격을 판단해 티켓으로 만듭니다.
 *
 * 분류는 에이전트가 합니다. LLM API 키가 브라우저에 있으면 안 되기 때문입니다.
 * 그래서 등록 직후가 아니라 잠시 뒤에 티켓이 뜹니다.
 */
export default function NewTicketPage() {
  const { user } = useAuth()
  const queueIntake = useQueueManualIntake()
  const { data: recent = [] } = useManualIntakes()

  const [rawText, setRawText] = useState('')
  const [channel, setChannel] = useState<IntakeChannel>('verbal')
  const [subject, setSubject] = useState('')
  const [reporterName, setReporterName] = useState('')
  const [reporterEmail, setReporterEmail] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [queuedId, setQueuedId] = useState<number | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!user || !rawText.trim()) return
    setError(null)

    queueIntake.mutate(
      {
        rawText: rawText.trim(),
        subject,
        reporterName,
        reporterEmail,
        channel,
        note,
        requestedBy: user.id,
      },
      {
        onSuccess: (id) => {
          setQueuedId(id)
          setRawText('')
          setSubject('')
          setReporterName('')
          setReporterEmail('')
          setNote('')
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="card p-5">
          <h1 className="text-base font-semibold text-slate-900">요청 직접 등록</h1>
          <p className="mt-1 text-sm text-slate-500">
            구두·전화로 받은 요청을 여기 적으면 시스템이 성격을 판단해 티켓으로 만듭니다.
            등급이나 시스템을 직접 고르지 않아도 됩니다.
          </p>
        </div>

        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

        {queuedId !== null && (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            등록 요청을 접수했습니다 (#{queuedId}). 에이전트가 분류를 마치면 아래 목록의 상태가
            바뀌고 티켓 번호가 뜹니다. 보통 30초 안쪽입니다.
          </p>
        )}

        <form onSubmit={submit} className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="raw-text">
              요청 내용 <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="raw-text"
              required
              className="field min-h-[220px]"
              placeholder={
                '들은 내용을 그대로 적으세요. 정리하지 않아도 됩니다.\n\n' +
                '예)\n회계팀 김영희 대리 전화. 오늘 아침부터 ERP 전표 승인 화면에서\n' +
                '저장 버튼을 누르면 오류가 나고 저장이 안 된다고 함.\n' +
                '회계팀 전원 같은 증상이고 월 마감이 오늘까지라 급하다고 함.'
              }
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              적힌 내용만으로 판단합니다. 언제·누가·무엇이 안 되는지가 있으면 분류가 정확해집니다.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="w-40">
              <label className="label" htmlFor="channel">
                받은 경로
              </label>
              <select
                id="channel"
                className="field"
                value={channel}
                onChange={(event) => setChannel(event.target.value as IntakeChannel)}
              >
                {INTAKE_CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {INTAKE_CHANNEL_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-40">
              <label className="label" htmlFor="reporter-name">
                요청자 (선택)
              </label>
              <input
                id="reporter-name"
                className="field"
                placeholder="김영희"
                value={reporterName}
                onChange={(event) => setReporterName(event.target.value)}
              />
            </div>

            <div className="min-w-[200px] flex-1">
              <label className="label" htmlFor="reporter-email">
                요청자 메일 (선택)
              </label>
              <input
                id="reporter-email"
                type="email"
                className="field"
                placeholder="kim@example.co.kr"
                value={reporterEmail}
                onChange={(event) => setReporterEmail(event.target.value)}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                완료 회신을 보내려면 필요합니다. 모르면 비워 두세요.
              </p>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="subject">
              제목 (선택)
            </label>
            <input
              id="subject"
              className="field"
              placeholder="비워 두면 내용을 보고 자동으로 만듭니다"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="note">
              등록자 메모 (선택)
            </label>
            <input
              id="note"
              className="field"
              placeholder="티켓 본문에는 들어가지 않습니다"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={!rawText.trim() || queueIntake.isPending}
          >
            {queueIntake.isPending ? '등록 중…' : '등록'}
          </button>
        </form>
      </div>

      {/* 처리 상태 — 등록하고 끝이 아니라 결과를 볼 수 있어야 합니다 */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-800">최근 등록</h2>

        {recent.length === 0 && (
          <p className="card p-4 text-sm text-slate-400">아직 등록한 요청이 없습니다.</p>
        )}

        {recent.map((row) => (
          <div key={row.id} className="card space-y-1 p-3 text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 font-medium ${
                  row.status === 'done'
                    ? 'bg-emerald-50 text-emerald-700'
                    : row.status === 'failed'
                      ? 'bg-rose-50 text-rose-700'
                      : 'bg-amber-50 text-amber-800'
                }`}
              >
                {row.status === 'done'
                  ? '티켓 생성됨'
                  : row.status === 'failed'
                    ? '실패'
                    : '분류 대기'}
              </span>
              <span className="text-slate-400">{relativeDays(row.requested_at)}</span>
              <span className="ml-auto text-slate-400">
                {INTAKE_CHANNEL_LABELS[row.channel] ?? row.channel}
              </span>
            </div>

            <p className="line-clamp-2 text-slate-700">
              {row.subject || row.raw_text.slice(0, 80)}
            </p>

            {row.ticket_id && (
              <Link
                to={`/tickets/${row.ticket_id}`}
                className="inline-block font-medium text-slate-900 hover:underline"
              >
                티켓 #{row.ticket_id} 열기
              </Link>
            )}

            {row.status === 'queued' && (
              <p className="text-slate-400">
                에이전트가 가져가면 처리됩니다. 에이전트 PC 가 꺼져 있으면 대기 상태로 남습니다.
              </p>
            )}

            {row.error && <p className="text-rose-700">{row.error}</p>}

            {row.processed_at && (
              <p className="text-slate-400">처리: {formatDateTime(row.processed_at)}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
