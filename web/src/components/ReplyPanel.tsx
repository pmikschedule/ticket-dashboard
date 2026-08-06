import { useEffect, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import { useCancelReply, useOutboundEmails, useQueueReply } from '../hooks/queries'
import { formatDateTime } from '../lib/format'
import { buildReplyBody, buildReplySubject } from '../lib/reply'
import type { Comment, TicketWithMeta } from '../lib/types'
import { canSendReply } from '../lib/workflow'

interface Props {
  ticket: TicketWithMeta
  comments: Comment[]
  onError: (error: unknown) => void
}

const QUEUE_STATUS_LABEL: Record<string, string> = {
  queued: '발송 대기 (에이전트가 가져갑니다)',
  sent: '에이전트가 처리함',
  failed: '발송 실패',
  cancelled: '취소됨',
}

/**
 * 완료 회신 발송 요청 (기획서 2-5).
 *
 * 웹은 **큐에 넣기만** 합니다. 실제 발송은 아웃룩이 설치된 관리자 PC 의 에이전트가 합니다.
 * 기본 설정에서 에이전트는 메일 창을 띄우고 사람이 확인 후 보냅니다 (기획서 5-4).
 */
export default function ReplyPanel({ ticket, comments, onError }: Props) {
  const { user } = useAuth()
  const { data: queue = [] } = useOutboundEmails(ticket.id)
  const queueReply = useQueueReply()
  const cancelReply = useCancelReply()

  const meta = ticket.ticket_meta
  const allowed = canSendReply(user, meta)

  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [cc, setCc] = useState('')

  // 초안은 티켓·코멘트가 바뀔 때마다 다시 만듭니다.
  // 관리자가 손댄 뒤에는 덮어쓰지 않도록 패널이 닫혀 있을 때만 갱신합니다.
  useEffect(() => {
    if (open) return
    setSubject(buildReplySubject(ticket.subject))
    setBody(buildReplyBody(ticket, meta, comments))
  }, [open, ticket, meta, comments])

  const pending = queue.find((entry) => entry.status === 'queued')

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold text-slate-800">완료 회신</h2>

      {!allowed && (
        <p className="mt-2 text-xs text-slate-500">
          {meta?.status === 'done'
            ? '회신 발송 요청은 관리자만 할 수 있습니다.'
            : '티켓을 완료 처리한 뒤에 회신을 보낼 수 있습니다.'}
        </p>
      )}

      {queue.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-xs">
          {queue.map((entry) => (
            <li key={entry.id} className="rounded-md bg-slate-50 p-2">
              <div className="flex items-center gap-2">
                <span
                  className={
                    entry.status === 'failed'
                      ? 'font-medium text-rose-700'
                      : entry.status === 'sent'
                        ? 'font-medium text-emerald-700'
                        : 'font-medium text-slate-700'
                  }
                >
                  {QUEUE_STATUS_LABEL[entry.status] ?? entry.status}
                </span>
                {entry.status === 'queued' && allowed && (
                  <button
                    type="button"
                    className="ml-auto text-rose-600 hover:underline"
                    onClick={() =>
                      cancelReply.mutate({ emailId: entry.id, ticketId: ticket.id }, { onError })
                    }
                  >
                    취소
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-slate-500">
                {formatDateTime(entry.sent_at ?? entry.requested_at)} · 시도 {entry.attempts}회
              </p>
              {entry.error && <p className="mt-0.5 text-slate-600">{entry.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {allowed && !pending && (
        <>
          {!open ? (
            <button type="button" className="btn-primary mt-3 w-full" onClick={() => setOpen(true)}>
              회신 초안 작성
            </button>
          ) : (
            <div className="mt-3 space-y-2">
              <div>
                <label className="label" htmlFor="reply-to">
                  받는 사람
                </label>
                <input id="reply-to" className="field" value={ticket.reporter_email} readOnly />
              </div>
              <div>
                <label className="label" htmlFor="reply-cc">
                  참조 (쉼표로 구분, 선택)
                </label>
                <input
                  id="reply-cc"
                  className="field"
                  value={cc}
                  onChange={(event) => setCc(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="reply-subject">
                  제목
                </label>
                <input
                  id="reply-subject"
                  className="field"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="reply-body">
                  본문
                </label>
                <textarea
                  id="reply-body"
                  className="field min-h-[240px] font-mono text-xs"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>

              <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
                발송 요청을 하면 관리자 PC 의 에이전트가 이 내용을 아웃룩으로 가져갑니다. 기본
                설정에서는 메일 창이 뜨고, 사람이 확인한 뒤 보내야 실제로 발송됩니다.
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={!subject.trim() || !body.trim() || !user}
                  onClick={() => {
                    if (!user) return
                    queueReply.mutate(
                      {
                        ticketId: ticket.id,
                        requestedBy: user.id,
                        toEmail: ticket.reporter_email,
                        ccEmails: cc.trim() || null,
                        subject: subject.trim(),
                        body,
                      },
                      { onSuccess: () => setOpen(false), onError },
                    )
                  }}
                >
                  발송 요청
                </button>
                <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                  취소
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
