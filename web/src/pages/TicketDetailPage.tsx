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
  useOriginalMail,
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
  countsAsWork,
  RESOLUTIONS,
  RESOLUTION_HINTS,
  RESOLUTION_LABELS,
  RESOLUTION_LABELS_KO,
  STATUS_LABELS,
  UNSPECIFIED_RESOLUTION,
  type Resolution,
  UNCLASSIFIED_SYSTEM,
  WORK_TYPES,
  WORK_TYPE_LABELS,
  type Status,
} from '../lib/constants'
import { formatBytes, formatDate, formatDateTime } from '../lib/format'
import { isMailComment } from '../lib/link'
import {
  allowedTransitions,
  canAssign,
  canEditTicket,
  canDeleteComment,
  canDeleteTicket,
  isOverdue,
  requiresHoldReason,
  requiresResolution,
} from '../lib/workflow'

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
  const { data: originalMail } = useOriginalMail(ticketId)
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
  const [draftReporterName, setDraftReporterName] = useState('')
  const [draftReporterEmail, setDraftReporterEmail] = useState('')
  // 기본은 접힘. 평소에 볼 것은 정리된 티켓이고, 원본은 대조가 필요할 때만
  // 펼칩니다. 처음부터 펼쳐 두면 긴 메일 원문이 화면을 다 차지합니다.
  const [showOriginal, setShowOriginal] = useState(false)
  // 보류·완료는 값을 하나 더 받아야 해서 버튼 한 번으로 끝내지 않습니다.
  const [pendingStatus, setPendingStatus] = useState<Status | null>(null)
  const [holdReason, setHoldReason] = useState('')
  const [resolution, setResolution] = useState<Resolution | ''>('')

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
  const transitions = meta
    ? allowedTransitions(meta.status, isAdmin, meta.hold_from_status)
    : []

  function fail(err: unknown) {
    setActionError(err instanceof Error ? err.message : String(err))
  }

  function startEditing() {
    if (!ticket) return
    setDraftSubject(ticket.subject)
    setDraftDescription(ticket.description)
    setDraftDue(ticket.due_date ?? '')
    setDraftReporterName(ticket.reporter_name ?? '')
    setDraftReporterEmail(ticket.reporter_email)
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="label" htmlFor="edit-reporter-name">
                      요청자
                    </label>
                    <input
                      id="edit-reporter-name"
                      className="field"
                      placeholder="예: 홍길동 과장"
                      value={draftReporterName}
                      onChange={(event) => setDraftReporterName(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="edit-reporter-email">
                      요청자 메일
                    </label>
                    <input
                      id="edit-reporter-email"
                      type="email"
                      className="field"
                      value={draftReporterEmail}
                      onChange={(event) => setDraftReporterEmail(event.target.value)}
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
                </div>
                {/*
                  완료 회신이 여기 적힌 주소로 갑니다. 대리 발송을 실제 요청자로
                  고치는 것이 이 칸의 쓸모인데, 잘못 고치면 엉뚱한 사람에게
                  메일이 나갑니다. 되돌릴 수 없으므로 미리 말해 둡니다.
                */}
                <p className="text-[11px] text-slate-400">
                  완료 회신은 위 <strong>요청자 메일</strong> 주소로 발송됩니다. 원본 메일의
                  발신자는 아래 '원본 메일' 칸에 그대로 남습니다.
                </p>
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
                            reporter_name: draftReporterName.trim() || null,
                            // 빈 값으로 저장하면 회신할 곳이 없어집니다.
                            // 안 적었으면 고치지 않은 것으로 봅니다.
                            reporter_email:
                              draftReporterEmail.trim() || ticket.reporter_email,
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

                <h2 className="mt-5 text-xs font-semibold text-slate-600">내용</h2>
                <pre className="mt-1 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-800">
                  {ticket.description || '(본문 없음)'}
                </pre>
              </>
            )}
          </section>

          {/*
            증적. 담당자가 제목·요청자·내용을 고칠 수 있게 되면서 "무엇을 받았는가"
            와 "무엇으로 정리했는가" 가 갈라졌습니다. 원본이 안 남으면 나중에
            "그렇게 요청한 적 없다" 는 말이 나왔을 때 댈 근거가 없습니다.

            이 칸은 에이전트가 적재한 scanned_mails 스냅숏이고 화면에서 못 고칩니다
            (RLS 상 update 는 관리자만, 그나마 검토 표시용입니다).
          */}
          {originalMail && (
            <section className="card p-5">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left"
                onClick={() => setShowOriginal((open) => !open)}
              >
                <h2 className="text-sm font-semibold text-slate-800">원본 메일 (증적)</h2>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                  수정 불가
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {showOriginal ? '접기' : '펼치기'}
                </span>
              </button>

              {showOriginal && (
                <div className="mt-3 space-y-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-slate-500">발신자</dt>
                      <dd className="truncate text-slate-800" title={originalMail.sender_email}>
                        {originalMail.sender_name || originalMail.sender_email}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">수신일시</dt>
                      <dd className="text-slate-800">
                        {formatDateTime(originalMail.received_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">폴더</dt>
                      <dd className="truncate text-slate-800">{originalMail.folder || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">스캔 시각</dt>
                      <dd className="text-slate-800">{formatDateTime(originalMail.scanned_at)}</dd>
                    </div>
                  </dl>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-600">받은 제목</h3>
                    <p className="mt-1 rounded-md bg-slate-50 p-2 text-sm text-slate-800">
                      {originalMail.subject || '(제목 없음)'}
                    </p>
                    {originalMail.subject !== ticket.subject && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        티켓 제목이 원본과 다릅니다 — 담당자가 정리한 것입니다.
                      </p>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-600">받은 본문</h3>
                    <pre className="mt-1 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-800">
                      {originalMail.body || '(본문 없음)'}
                    </pre>
                  </div>
                </div>
              )}
            </section>
          )}

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

            {/*
              뺀 파일을 밝힙니다. 판정이 틀릴 수 있는데 — 요청자가 붙인 파일을
              서명 이미지로 잘못 볼 수 있습니다 — 그 사실이 어디에도 안 남으면
              요청자가 다시 보내 줄 때까지 아무도 모릅니다.
            */}
            {ticket.skipped_inline_attachments &&
              ticket.skipped_inline_attachments.length > 0 && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  본문에 딸려 있어 제외한 이미지 {ticket.skipped_inline_attachments.length}개:{' '}
                  <span className="text-slate-600">
                    {ticket.skipped_inline_attachments.join(', ')}
                  </span>
                  <br />
                  <span className="text-slate-400">
                    서명 로고·명함으로 판단한 것입니다. 필요한 파일이었다면 요청자에게 다시
                    요청하세요 — 내용은 저장하지 않습니다.
                  </span>
                </p>
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
                    {/*
                      메일에서 온 코멘트는 그 사람이 쓴 글이 아니라 옮겨 담은
                      것입니다. 구분이 없으면 담당자가 요청자 말투로 쓴 것처럼
                      읽히고, 나중에 누가 무엇을 말했는지가 흐려집니다.
                    */}
                    {isMailComment(comment.content) && (
                      <span
                        title="스크리닝에서 후속 메일을 붙인 것입니다"
                        className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                      >
                        메일
                      </span>
                    )}
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

            {/* 지금 보류 중이라면 무엇을 기다리는지부터 보여줍니다 */}
            {meta?.status === 'on_hold' && (
              <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                <p className="font-medium">
                  보류 중
                  {meta.hold_from_status && (
                    <span className="font-normal">
                      {' '}
                      — 풀면 {STATUS_LABELS[meta.hold_from_status]} 로 돌아갑니다
                    </span>
                  )}
                </p>
                <p className="mt-0.5">{meta.hold_reason || '사유가 적혀 있지 않습니다.'}</p>
              </div>
            )}

            {/* 완료된 건은 어떻게 끝났는지가 상태만큼 중요합니다 */}
            {meta?.status === 'done' && (
              <p className="mt-2 text-xs text-slate-600">
                종료 방식:{' '}
                {meta.resolution ? (
                  <span className="font-medium text-slate-900">
                    {RESOLUTION_LABELS[meta.resolution]}
                  </span>
                ) : (
                  <span className="text-slate-400">{UNSPECIFIED_RESOLUTION}</span>
                )}
              </p>
            )}

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
                    onClick={() => setPendingStatus(status)}
                  >
                    → {STATUS_LABELS[status as Status]}
                  </button>
                ))}
                {transitions.length === 0 && (
                  <p className="text-xs text-slate-500">
                    보류를 풀 자리를 알 수 없습니다 (옛 티켓). 관리자가 상태를 옮겨야 합니다.
                  </p>
                )}
              </div>
            )}

            {/* 보류·완료는 값을 하나 더 받고 나서 옮깁니다 */}
            {pendingStatus && (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-800">
                  → {STATUS_LABELS[pendingStatus]}
                </p>

                {requiresHoldReason(pendingStatus) && (
                  <div className="mt-2">
                    <label className="label" htmlFor="hold-reason">
                      무엇을 기다립니까?
                    </label>
                    <textarea
                      id="hold-reason"
                      className="field"
                      rows={2}
                      autoFocus
                      placeholder="예) 요청자에게 재현 화면 요청함 — 회신 대기"
                      value={holdReason}
                      onChange={(event) => setHoldReason(event.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      사유 없는 보류는 왜 멈췄는지 아무도 모르게 됩니다. 보류 시간은
                      MTTA·MTTR 에서 빠집니다.
                    </p>
                  </div>
                )}

                {requiresResolution(pendingStatus) && (
                  <div className="mt-2">
                    <label className="label" htmlFor="resolution">
                      어떻게 끝났습니까?
                    </label>
                    <select
                      id="resolution"
                      className="field"
                      autoFocus
                      value={resolution}
                      onChange={(event) => setResolution(event.target.value as Resolution)}
                    >
                      <option value="">고르세요</option>
                      {RESOLUTIONS.map((value) => (
                        <option key={value} value={value}>
                          {RESOLUTION_LABELS[value]} — {RESOLUTION_LABELS_KO[value]}
                        </option>
                      ))}
                    </select>
                    {resolution && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {RESOLUTION_HINTS[resolution as Resolution]}
                        {!countsAsWork(resolution as Resolution) &&
                          ' 이 건은 처리 실적·MTTR 모수에서 빠집니다.'}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex gap-1.5">
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={
                      updateStatus.isPending ||
                      (requiresHoldReason(pendingStatus) && !holdReason.trim()) ||
                      (requiresResolution(pendingStatus) && !resolution)
                    }
                    onClick={() =>
                      updateStatus.mutate(
                        {
                          ticketId: ticket.id,
                          status: pendingStatus,
                          ...(requiresHoldReason(pendingStatus)
                            ? { hold_reason: holdReason.trim() }
                            : {}),
                          ...(requiresResolution(pendingStatus)
                            ? { resolution: resolution as Resolution }
                            : {}),
                        },
                        {
                          onError: fail,
                          onSuccess: () => {
                            setPendingStatus(null)
                            setHoldReason('')
                            setResolution('')
                          },
                        },
                      )
                    }
                  >
                    {updateStatus.isPending ? '옮기는 중…' : '옮기기'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setPendingStatus(null)}
                  >
                    취소
                  </button>
                </div>
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
