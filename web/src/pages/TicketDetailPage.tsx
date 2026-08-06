import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  CategoryBadge,
  ClassifyErrorBadge,
  OverdueBadge,
  SeverityBadge,
  StatusBadge,
  SystemBadge,
  WorkTypeBadge,
} from '../components/Badge'
import ReplyPanel from '../components/ReplyPanel'
import { useAuth } from '../hooks/useAuth'
import {
  useAddComment,
  useAttachments,
  useComments,
  useDeleteComment,
  useDeleteTicket,
  useStatusHistory,
  useTicket,
  useUpdateMeta,
  useUpdateStatus,
  useSystemLabels,
  useSystems,
  useUpdateTicketFields,
  useUsers,
} from '../hooks/queries'
import { createAttachmentUrl } from '../lib/api'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  STATUS_LABELS,
  UNCLASSIFIED_SYSTEM,
  WORK_TYPES,
  WORK_TYPE_LABELS,
  type Status,
} from '../lib/constants'
import { formatBytes, formatDate, formatDateTime } from '../lib/format'
import { allowedTransitions, canAssign, canEditTicket, canDeleteComment, canDeleteTicket, isOverdue } from '../lib/workflow'

export default function TicketDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const ticketId = Number(params.id ?? 0)
  const { user, isAdmin } = useAuth()

  const { data: ticket, isLoading, error } = useTicket(ticketId)
  const { data: users = [] } = useUsers()
  const { data: systems = [] } = useSystems()
  const systemLabel = useSystemLabels()
  const { data: comments = [] } = useComments(ticketId)
  const { data: attachments = [] } = useAttachments(ticketId)
  const { data: history = [] } = useStatusHistory(ticketId)

  const updateStatus = useUpdateStatus()
  const updateMeta = useUpdateMeta()
  const updateFields = useUpdateTicketFields()
  const addComment = useAddComment()
  const deleteComment = useDeleteComment()
  const deleteTicket = useDeleteTicket()

  const [commentText, setCommentText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftSubject, setDraftSubject] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftDue, setDraftDue] = useState('')

  const userNames = useMemo(
    () => new Map(users.map((entry) => [entry.id, entry.name || entry.email])),
    [users],
  )

  if (isLoading) return <p className="text-sm text-slate-500">불러오는 중…</p>
  if (error || !ticket) {
    return (
      <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
        티켓을 불러오지 못했습니다: {error instanceof Error ? error.message : '없는 티켓입니다.'}
      </p>
    )
  }

  const meta = ticket.ticket_meta
  const editable = canEditTicket(user, meta)
  const overdue = isOverdue(ticket.due_date, meta?.status)
  const transitions = meta ? allowedTransitions(meta.status, isAdmin) : []

  function fail(err: unknown) {
    setActionError(err instanceof Error ? err.message : String(err))
  }

  function startEditing() {
    if (!ticket) return
    setDraftSubject(ticket.subject)
    setDraftDescription(ticket.description)
    setDraftDue(ticket.due_date ?? '')
    setEditing(true)
  }

  async function openAttachment(path: string) {
    try {
      window.open(await createAttachmentUrl(path), '_blank', 'noopener')
    } catch (err) {
      fail(err)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-slate-500 hover:underline">
          ← 보드
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-500">티켓 #{ticket.id}</span>
      </div>

      {actionError && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{actionError}</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── 본문 ─────────────────────────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          <section className="card p-5">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {meta && <WorkTypeBadge workType={meta.work_type} />}
              {meta && <SeverityBadge severity={meta.severity} />}
              {meta && <CategoryBadge category={meta.category} />}
              {meta && (
                <SystemBadge code={meta.system_type} label={systemLabel(meta.system_type)} />
              )}
              {overdue && <OverdueBadge />}
              {meta?.llm_error && <ClassifyErrorBadge error={meta.llm_error} />}
            </div>

            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="label" htmlFor="edit-subject">
                    제목
                  </label>
                  <input
                    id="edit-subject"
                    className="field"
                    value={draftSubject}
                    onChange={(event) => setDraftSubject(event.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="edit-due">
                    요청 기한
                  </label>
                  <input
                    id="edit-due"
                    type="date"
                    className="field"
                    value={draftDue}
                    onChange={(event) => setDraftDue(event.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="edit-description">
                    내용
                  </label>
                  <textarea
                    id="edit-description"
                    className="field min-h-[200px] font-mono text-xs"
                    value={draftDescription}
                    onChange={(event) => setDraftDescription(event.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() =>
                      updateFields.mutate(
                        {
                          ticketId: ticket.id,
                          patch: {
                            subject: draftSubject.trim() || ticket.subject,
                            description: draftDescription,
                            due_date: draftDue || null,
                          },
                        },
                        { onSuccess: () => setEditing(false), onError: fail },
                      )
                    }
                  >
                    저장
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <h1 className="flex-1 text-lg font-semibold text-slate-900">{ticket.subject}</h1>
                  {editable && (
                    <button type="button" className="btn-secondary shrink-0" onClick={startEditing}>
                      내용 보완
                    </button>
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-500">요청자</dt>
                    <dd className="text-slate-800">{ticket.reporter_name || '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">메일 주소</dt>
                    <dd className="truncate text-slate-800" title={ticket.reporter_email}>
                      {ticket.reporter_email}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">최초 접수일</dt>
                    <dd className="text-slate-800">{formatDateTime(ticket.received_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">요청 기한</dt>
                    <dd className={overdue ? 'font-medium text-rose-600' : 'text-slate-800'}>
                      {ticket.due_date ? formatDate(ticket.due_date) : '미지정'}
                    </dd>
                  </div>
                </dl>

                <h2 className="mt-5 text-xs font-semibold text-slate-600">원본 메일 내용</h2>
                <pre className="mt-1 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-800">
                  {ticket.description || '(본문 없음)'}
                </pre>
              </>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800">
              첨부파일 <span className="text-slate-400">({attachments.length})</span>
            </h2>
            {attachments.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">첨부파일이 없습니다.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center gap-2 py-2 text-sm">
                    <button
                      type="button"
                      className="flex-1 truncate text-left text-slate-800 hover:underline"
                      onClick={() => void openAttachment(attachment.file_url)}
                    >
                      {attachment.file_name}
                    </button>
                    <span className="shrink-0 text-xs tabular-nums text-slate-400">
                      {formatBytes(attachment.size_bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800">
              처리 내역 <span className="text-slate-400">({comments.length})</span>
            </h2>

            <ul className="mt-3 space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-md bg-slate-50 p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">
                      {comment.users?.name ?? '알 수 없음'}
                    </span>
                    <span>{formatDateTime(comment.created_at)}</span>
                    {canDeleteComment(user, comment.user_id) && (
                      <button
                        type="button"
                        className="ml-auto text-rose-600 hover:underline"
                        onClick={() =>
                          deleteComment.mutate(
                            { commentId: comment.id, ticketId: ticket.id },
                            { onError: fail },
                          )
                        }
                      >
                        삭제
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-800">{comment.content}</p>
                </li>
              ))}
              {comments.length === 0 && (
                <li className="text-sm text-slate-400">아직 작성된 내역이 없습니다.</li>
              )}
            </ul>

            <div className="mt-4">
              <textarea
                className="field min-h-[80px]"
                placeholder="처리 내용을 남기세요. 완료 회신 메일의 '처리 내역' 절에 그대로 들어갑니다."
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary mt-2"
                disabled={!commentText.trim() || !user}
                onClick={() => {
                  if (!user) return
                  addComment.mutate(
                    { ticketId: ticket.id, userId: user.id, content: commentText.trim() },
                    { onSuccess: () => setCommentText(''), onError: fail },
                  )
                }}
              >
                등록
              </button>
            </div>
          </section>
        </div>

        {/* ── 사이드바 ──────────────────────────────────────────────────── */}
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="text-sm font-semibold text-slate-800">상태</h2>
            <div className="mt-2">{meta && <StatusBadge status={meta.status} />}</div>

            {!editable ? (
              <p className="mt-3 text-xs text-slate-500">
                본인에게 할당된 티켓만 상태를 바꿀 수 있습니다.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {transitions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() =>
                      updateStatus.mutate(
                        { ticketId: ticket.id, status },
                        { onError: fail },
                      )
                    }
                  >
                    → {STATUS_LABELS[status as Status]}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-slate-800">분류</h2>

            <div>
              <label className="label" htmlFor="assignee">
                담당자
              </label>
              <select
                id="assignee"
                className="field"
                disabled={!canAssign(user)}
                value={meta?.assignee_id ?? ''}
                onChange={(event) =>
                  updateMeta.mutate(
                    { ticketId: ticket.id, patch: { assignee_id: event.target.value || null } },
                    { onError: fail },
                  )
                }
              >
                <option value="">미배정</option>
                {users.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name || entry.email}
                  </option>
                ))}
              </select>
              {!canAssign(user) && (
                <p className="mt-1 text-[11px] text-slate-400">배정은 관리자만 가능합니다.</p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="work-type">
                대분류
              </label>
              <select
                id="work-type"
                className="field"
                disabled={!editable}
                value={meta?.work_type ?? 'maintenance'}
                onChange={(event) =>
                  updateMeta.mutate(
                    { ticketId: ticket.id, patch: { work_type: event.target.value as never } },
                    { onError: fail },
                  )
                }
              >
                {WORK_TYPES.map((workType) => (
                  <option key={workType} value={workType}>
                    {WORK_TYPE_LABELS[workType]}
                  </option>
                ))}
              </select>
              {meta?.promoted_at && (
                <p className="mt-1 text-[11px] text-violet-700">
                  신규개발 승격: {formatDateTime(meta.promoted_at)}
                </p>
              )}
              <p className="mt-1 text-[11px] text-slate-400">
                공수 1주일 이상이면 신규개발로 올립니다. LLM 은 장애/유지보수만 판단합니다.
              </p>
            </div>

            {/* 계획 일정은 Gantt 의 입력값입니다. 신규개발일 때만 노출합니다. */}
            {meta?.work_type === 'development' && (
              <div className="rounded-md bg-violet-50/60 p-2">
                <p className="mb-2 text-[11px] font-medium text-violet-900">
                  계획 일정 (Gantt)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label" htmlFor="planned-start">
                      시작
                    </label>
                    <input
                      id="planned-start"
                      type="date"
                      className="field"
                      disabled={!editable}
                      defaultValue={ticket.planned_start_date ?? ''}
                      onChange={(event) =>
                        updateFields.mutate(
                          {
                            ticketId: ticket.id,
                            patch: { planned_start_date: event.target.value || null },
                          },
                          { onError: fail },
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="planned-end">
                      종료
                    </label>
                    <input
                      id="planned-end"
                      type="date"
                      className="field"
                      disabled={!editable}
                      defaultValue={ticket.planned_end_date ?? ''}
                      onChange={(event) =>
                        updateFields.mutate(
                          {
                            ticketId: ticket.id,
                            patch: { planned_end_date: event.target.value || null },
                          },
                          { onError: fail },
                        )
                      }
                    />
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-violet-800">
                  비워 두면 Gantt 에 접수일·기한으로 대신 그려집니다 (점선).
                </p>
              </div>
            )}

            <div>
              <label className="label" htmlFor="estimated-days">
                예상 공수 (사람일)
              </label>
              <input
                id="estimated-days"
                type="number"
                min={0}
                step={0.5}
                className="field"
                disabled={!editable}
                defaultValue={meta?.estimated_days ?? ''}
                onBlur={(event) => {
                  const raw = event.target.value.trim()
                  const next = raw === '' ? null : Number(raw)
                  if (next !== null && !Number.isFinite(next)) return
                  if (next === (meta?.estimated_days ?? null)) return
                  updateMeta.mutate(
                    { ticketId: ticket.id, patch: { estimated_days: next } },
                    { onError: fail },
                  )
                }}
              />
            </div>

            <div>
              <label className="label" htmlFor="severity">
                장애 등급
              </label>
              <select
                id="severity"
                className="field"
                disabled={!editable}
                value={meta?.severity ?? 'medium'}
                onChange={(event) =>
                  updateMeta.mutate(
                    { ticketId: ticket.id, patch: { severity: event.target.value as never } },
                    { onError: fail },
                  )
                }
              >
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {SEVERITY_LABELS[severity]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="category">
                요청 유형
              </label>
              <select
                id="category"
                className="field"
                disabled={!editable}
                value={meta?.category ?? 'error'}
                onChange={(event) =>
                  updateMeta.mutate(
                    { ticketId: ticket.id, patch: { category: event.target.value as never } },
                    { onError: fail },
                  )
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="system-type">
                대상 시스템
              </label>
              <select
                id="system-type"
                className="field"
                disabled={!editable}
                value={meta?.system_type ?? ''}
                onChange={(event) =>
                  updateMeta.mutate(
                    {
                      ticketId: ticket.id,
                      patch: { system_type: event.target.value || null },
                    },
                    { onError: fail },
                  )
                }
              >
                <option value="">{UNCLASSIFIED_SYSTEM}</option>
                {systems.map((system) => (
                  <option key={system.code} value={system.code}>
                    {system.name}
                  </option>
                ))}
                {/* 등록표에서 지워진 코드도 선택지로 남겨 값이 조용히 바뀌지 않게 합니다 */}
                {meta?.system_type && !systems.some((s) => s.code === meta.system_type) && (
                  <option value={meta.system_type}>{meta.system_type} (등록표에 없음)</option>
                )}
              </select>
              {systems.length === 0 && (
                <p className="mt-1 text-[11px] text-amber-600">
                  등록된 시스템이 없습니다. 설정 화면에서 먼저 등록하세요.
                </p>
              )}
            </div>

            {meta && (meta.llm_reason || meta.llm_error) && (
              <div className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600">
                <p className="font-medium text-slate-700">자동 분류 근거</p>
                {meta.llm_error ? (
                  <p className="mt-0.5 text-amber-700">분류 실패: {meta.llm_error}</p>
                ) : (
                  <p className="mt-0.5">
                    {meta.llm_reason}
                    {meta.llm_confidence !== null && (
                      <span className="ml-1 text-slate-400">
                        (확신도 {(meta.llm_confidence * 100).toFixed(0)}%)
                      </span>
                    )}
                  </p>
                )}
                {meta.llm_model && <p className="mt-0.5 text-slate-400">{meta.llm_model}</p>}
              </div>
            )}
          </section>

          <ReplyPanel ticket={ticket} comments={comments} onError={fail} />

          <section className="card p-4">
            <h2 className="text-sm font-semibold text-slate-800">상태 변경 이력</h2>
            <ol className="mt-2 space-y-1.5 text-xs">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-2">
                  <span className="text-slate-400">{formatDateTime(entry.changed_at)}</span>
                  <span className="text-slate-700">
                    {entry.from_status ? `${STATUS_LABELS[entry.from_status]} → ` : '접수 '}
                    {STATUS_LABELS[entry.to_status]}
                  </span>
                  {entry.changed_by && (
                    <span className="text-slate-400">
                      {userNames.get(entry.changed_by) ?? ''}
                    </span>
                  )}
                </li>
              ))}
              {history.length === 0 && <li className="text-slate-400">이력이 없습니다.</li>}
            </ol>
          </section>

          {canDeleteTicket(user) && (
            <button
              type="button"
              className="btn-danger w-full"
              onClick={() => {
                if (!window.confirm(`티켓 #${ticket.id} 을 삭제합니다. 되돌릴 수 없습니다.`)) return
                deleteTicket.mutate(ticket.id, {
                  onSuccess: () => navigate('/'),
                  onError: fail,
                })
              }}
            >
              티켓 삭제
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
