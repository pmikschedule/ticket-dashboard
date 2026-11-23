import { useState, type FormEvent } from 'react'

import { useAuth } from '../hooks/useAuth'
import {
  useAllSystems,
  useCreateIntakeRule,
  useCreateSystem,
  useDeleteIntakeRule,
  useDeleteSystem,
  useIntakeRules,
  useClearSecret,
  useSecretStatus,
  useSetSecret,
  useSettings,
  useUpdateIntakeRule,
  useUpdateSetting,
  useUpdateSystem,
} from '../hooks/queries'
import { GEMINI_KEY_SECRET, GEMINI_MODEL_SETTING } from '../lib/api'
import { RULE_KINDS, RULE_KIND_LABELS, type RuleKind } from '../lib/constants'
import {
  DESK_AUTH_SOURCE_LABELS,
  DESK_COOKIE_SECRET,
  daysLeft,
  parseDeskCookie,
  readDeskStatus,
  shortStamp,
} from '../lib/deskAuth'
import { formatDateTime } from '../lib/format'

/**
 * 설정 화면 (관리자 전용).
 *
 * 여기서 바꾸는 값은 **에이전트가 스캔할 때마다 다시 읽습니다.**
 * 에이전트를 재시작할 필요가 없습니다.
 */
export default function SettingsPage() {
  const { isAdmin } = useAuth()
  const [error, setError] = useState<string | null>(null)

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : String(err))
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h1 className="text-base font-semibold text-slate-900">설정</h1>
        <p className="mt-1 text-sm text-slate-500">
          여기서 바꾼 값은 에이전트가 다음 스캔에서 바로 반영합니다. 재시작이 필요 없습니다.
        </p>
        {!isAdmin && (
          <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
            읽기만 가능합니다. 변경은 관리자만 할 수 있습니다.
          </p>
        )}
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}

      <SystemConfigSection canEdit={isAdmin} onError={fail} />
      <DeskAuthSection canEdit={isAdmin} onError={fail} />
      <IntakeRulesSection canEdit={isAdmin} onError={fail} />
      <AmbiguousPolicySection canEdit={isAdmin} onError={fail} />
      <SystemsSection canEdit={isAdmin} onError={fail} />
    </div>
  )
}

// ── 시스템 설정 ─────────────────────────────────────────────────────────────

/**
 * 에이전트가 쓰는 자격증명·모델.
 *
 * **API 키는 넣을 수만 있고 꺼낼 수 없습니다.** `app_secrets` 표에는 RLS 정책이
 * 하나도 없어 웹에서는 select 자체가 막히고, 상태 조회 함수는 마지막 4글자만
 * 돌려줍니다. 값을 확인해야 한다면 확인하는 게 아니라 교체하는 것이 맞습니다.
 */
function SystemConfigSection({
  canEdit,
  onError,
}: {
  canEdit: boolean
  onError: (err: unknown) => void
}) {
  const { data: secrets = [], isLoading, error: secretError } = useSecretStatus(canEdit)
  const { data: settings = [] } = useSettings()
  const setSecret = useSetSecret()
  const clearSecret = useClearSecret()
  const updateSetting = useUpdateSetting()

  const [draftKey, setDraftKey] = useState('')
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const gemini = secrets.find((entry) => entry.key === GEMINI_KEY_SECRET)
  const model = settings.find((entry) => entry.key === GEMINI_MODEL_SETTING)

  function submitKey(event: FormEvent) {
    event.preventDefault()
    const value = draftKey.trim()
    if (!value) return
    setSecret.mutate(
      { key: GEMINI_KEY_SECRET, value },
      {
        onError,
        onSuccess: () => {
          // 입력값을 즉시 지웁니다. 화면에 남겨 둘 이유가 없습니다.
          setDraftKey('')
          setEditing(false)
          setSaved('등록했습니다. 다음 스캔부터 이 키를 씁니다.')
        },
      },
    )
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-800">시스템 설정</h2>
      <p className="mt-1 text-xs text-slate-500">
        에이전트가 메일을 분류할 때 쓰는 값입니다. 바꾸면 다음 스캔부터 적용되고,
        Windows PC 에 붙을 필요가 없습니다.
      </p>

      {!canEdit ? (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
          API 키 설정은 관리자만 볼 수 있습니다.
        </p>
      ) : (
        <>
          {/* ── Gemini API 키 ── */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-800">Gemini API 키</h3>
              <a
                className="text-[11px] text-sky-700 hover:underline"
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                키 발급받기 ↗
              </a>
            </div>

            {secretError && (
              <p className="mt-2 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
                등록 상태를 읽지 못했습니다: {String(secretError)}
              </p>
            )}

            {isLoading && <p className="mt-2 text-xs text-slate-500">확인 중…</p>}

            {!isLoading && !editing && (
              <div className="mt-2">
                {gemini ? (
                  <div className="rounded-md bg-emerald-50 p-3">
                    <p className="text-xs font-medium text-emerald-900">
                      등록됨 · <span className="font-mono">{gemini.hint}</span>
                      <span className="ml-1 font-normal text-emerald-800">
                        ({gemini.length}자)
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-emerald-800">
                      {formatDateTime(gemini.updated_at)}
                      {gemini.updated_by && ` · ${gemini.updated_by}`}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md bg-amber-50 p-3">
                    <p className="text-xs font-medium text-amber-900">등록되지 않았습니다.</p>
                    <p className="mt-1 text-[11px] text-amber-800">
                      에이전트는 Windows PC 의 <code>agent/.env</code> 에 적힌
                      <code> GEMINI_API_KEY</code> 를 씁니다. 여기 등록하면 그쪽 대신
                      이 값을 씁니다.
                    </p>
                  </div>
                )}

                {saved && <p className="mt-2 text-[11px] text-emerald-700">{saved}</p>}

                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setSaved(null)
                      setEditing(true)
                    }}
                  >
                    {gemini ? '교체' : '등록'}
                  </button>
                  {gemini && (
                    <button
                      type="button"
                      className="btn-secondary text-xs text-rose-700"
                      disabled={clearSecret.isPending}
                      onClick={() => {
                        setSaved(null)
                        clearSecret.mutate(GEMINI_KEY_SECRET, {
                          onError,
                          onSuccess: () =>
                            setSaved('지웠습니다. 에이전트는 .env 의 값으로 돌아갑니다.'),
                        })
                      }}
                    >
                      지우기
                    </button>
                  )}
                </div>
              </div>
            )}

            {editing && (
              <form className="mt-2" onSubmit={submitKey}>
                <input
                  className="field font-mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  placeholder="AIza…"
                  value={draftKey}
                  onChange={(event) => setDraftKey(event.target.value)}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  저장한 뒤에는 <strong>다시 볼 수 없습니다</strong> — 마지막 4글자만 남습니다.
                  확인이 필요하면 새 키로 교체하세요.
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="submit"
                    className="btn-primary text-xs"
                    disabled={!draftKey.trim() || setSecret.isPending}
                  >
                    {setSecret.isPending ? '저장 중…' : '저장'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setDraftKey('')
                      setEditing(false)
                    }}
                  >
                    취소
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* ── 모델 ── */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <label className="label" htmlFor="gemini-model">
              Gemini 모델
            </label>
            <input
              id="gemini-model"
              className="field font-mono"
              defaultValue={model?.value ?? ''}
              placeholder="gemini-2.5-flash"
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value === (model?.value ?? '')) return
                setSaved(null)
                updateSetting.mutate(
                  { key: GEMINI_MODEL_SETTING, value },
                  { onError, onSuccess: () => setSaved('모델을 바꿨습니다.') },
                )
              }}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              {model?.description ??
                '비워 두면 에이전트가 .env 의 GEMINI_MODEL 을 씁니다.'}{' '}
              쓸 수 있는 모델은 Windows PC 에서 <code>ticket-agent doctor</code> 로 확인합니다.
            </p>
          </div>
        </>
      )}
    </section>
  )
}

// ── desk 인증 ────────────────────────────────────────────────────────────────

/**
 * 주간보고서용 desk 수집에 쓰는 `CF_Authorization` 쿠키 (docs/DESIGN.md 14장).
 *
 * Gemini 키와 같은 길입니다 — **넣을 수만 있고 꺼낼 수 없습니다** (`set_app_secret`).
 * 에이전트가 1분마다 다시 읽어, 바뀌었으면 출처·만료일을 `app_settings` 에 적고
 * 이 카드와 상단 배너가 그것을 보여 줍니다. 그래서 아래 '에이전트가 쓰는 인증' 은
 * 붙여 넣은 값이 아니라 **에이전트가 실제로 쓰는 값**입니다.
 */
function DeskAuthSection({
  canEdit,
  onError,
}: {
  canEdit: boolean
  onError: (err: unknown) => void
}) {
  const { data: secrets = [], isLoading, error: secretError } = useSecretStatus(canEdit)
  const { data: settings = [], refetch, isFetching } = useSettings()
  const setSecret = useSetSecret()
  const clearSecret = useClearSecret()

  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const cookie = secrets.find((entry) => entry.key === DESK_COOKIE_SECRET)
  const status = readDeskStatus(settings)
  const now = Date.now()
  const parsed = draft.trim() ? parseDeskCookie(draft) : null
  const draftExpired = parsed?.ok === true && parsed.expiresAt.getTime() <= now

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!parsed?.ok || draftExpired) return
    const expiresAt = parsed.expiresAt
    setSecret.mutate(
      // 정리한 값(eyJ…)만 넣습니다. `CF_Authorization=` 이나 헤더 통째로 붙여 넣어도 됩니다
      { key: DESK_COOKIE_SECRET, value: parsed.token },
      {
        onError,
        onSuccess: () => {
          setDraft('')
          setEditing(false)
          setSaved(
            `등록했습니다 — 이 쿠키는 ${shortStamp(expiresAt)} 에 만료됩니다. ` +
              '에이전트가 1분 안에 읽어 반영하고, 직전 수집이 실패였으면 바로 한 번 다시 받습니다.',
          )
        },
      },
    )
  }

  const expires = status.expiresAt ? new Date(status.expiresAt) : null
  const left = expires ? daysLeft(expires, now) : null

  return (
    <section id="desk-auth" className="card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">desk 인증 — 주간보고서 수집</h2>
        <button
          type="button"
          className="text-[11px] text-sky-700 hover:underline disabled:opacity-40"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {isFetching ? '읽는 중…' : '상태 새로고침'}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        사내 PC 의 에이전트가 이 쿠키로 desk 를 읽어 스냅샷을 올립니다 — 정기 수집(월 18:00 · 화
        09:00)과 주간보고서 생성 직전 수집. desk 는 Cloudflare Access 로그인(메일 인증) 뒤에 있어,
        사람이 로그인해 받은 쿠키를 한 달에 한 번쯤 새로 넣어야 합니다.
      </p>

      {/* ── 에이전트가 알려 준 상태 — 팀원도 봅니다 ── */}
      <div className="mt-3 space-y-1.5 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
        {status.source === null ? (
          <p>
            에이전트가 아직 상태를 적지 않았습니다. 사내 PC 의 에이전트를 0.5.0 으로 바꾸고 실행하면
            여기에 나타납니다.
          </p>
        ) : (
          <p>
            <span className="text-slate-500">에이전트가 쓰는 인증 · </span>
            <b>{DESK_AUTH_SOURCE_LABELS[status.source]}</b>
            {expires && left !== null && (
              <span className={left <= 7 ? 'ml-1 font-medium text-rose-700' : 'ml-1'}>
                · 만료 {formatDateTime(status.expiresAt)}{' '}
                {expires.getTime() <= now ? '(만료됨)' : `(${left}일 남음)`}
              </span>
            )}
          </p>
        )}
        {status.lastScanAt && (
          <p>
            <span className="text-slate-500">마지막 수집 · </span>
            {formatDateTime(status.lastScanAt)} ·{' '}
            <b className={status.lastScanOk ? 'text-emerald-700' : 'text-rose-700'}>
              {status.lastScanOk ? '성공' : '실패'}
            </b>
            {status.lastScanNote && <span className="text-slate-600"> — {status.lastScanNote}</span>}
          </p>
        )}
      </div>

      {!canEdit ? (
        <p className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
          쿠키 등록은 관리자만 할 수 있습니다. 만료가 가까우면 관리자에게 알려 주세요.
        </p>
      ) : (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold text-slate-800">CF_Authorization 쿠키</h3>

          {secretError && (
            <p className="mt-2 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
              등록 상태를 읽지 못했습니다: {String(secretError)}
            </p>
          )}
          {isLoading && <p className="mt-2 text-xs text-slate-500">확인 중…</p>}

          {!isLoading && !editing && (
            <div className="mt-2">
              {cookie ? (
                <div className="rounded-md bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-900">
                    등록됨 · <span className="font-mono">{cookie.hint}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-800">
                    {formatDateTime(cookie.updated_at)}
                    {cookie.updated_by && ` · ${cookie.updated_by}`}
                  </p>
                </div>
              ) : (
                <div className="rounded-md bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-900">등록되지 않았습니다.</p>
                  <p className="mt-1 text-[11px] text-amber-800">
                    에이전트는 사내 PC 의 <code>.env</code> 에 적힌 <code>DESK_CF_AUTHORIZATION</code>{' '}
                    이 있으면 그것을 씁니다. 여기 등록하면 그쪽 대신 이 값을 씁니다.
                  </p>
                </div>
              )}

              {saved && <p className="mt-2 text-[11px] text-emerald-700">{saved}</p>}

              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    setSaved(null)
                    setEditing(true)
                  }}
                >
                  {cookie ? '새 쿠키로 교체' : '등록'}
                </button>
                {cookie && (
                  <button
                    type="button"
                    className="btn-secondary text-xs text-rose-700"
                    disabled={clearSecret.isPending}
                    onClick={() => {
                      setSaved(null)
                      clearSecret.mutate(DESK_COOKIE_SECRET, {
                        onError,
                        onSuccess: () => setSaved('지웠습니다. 에이전트는 .env 의 값으로 돌아갑니다 (없으면 수집이 멈춥니다).'),
                      })
                    }}
                  >
                    지우기
                  </button>
                )}
              </div>
            </div>
          )}

          {editing && (
            <form className="mt-2" onSubmit={submit}>
              <p className="mb-1.5 text-[11px] leading-relaxed text-slate-600">
                desk 에 로그인한 브라우저에서 <b>F12 → Application(애플리케이션) → Cookies →
                desk 주소 → <code>CF_Authorization</code></b> 의 값(Value)을 복사해 붙여 넣으세요.
              </p>
              <input
                className="field font-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                placeholder="eyJ…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              {parsed && (
                <p
                  className={`mt-1 text-[11px] ${
                    parsed.ok && !draftExpired ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {parsed.ok
                    ? draftExpired
                      ? `이미 ${shortStamp(parsed.expiresAt)} 에 만료된 쿠키입니다 — desk 에 다시 로그인한 뒤 복사하세요`
                      : `만료 ${shortStamp(parsed.expiresAt)} (${daysLeft(parsed.expiresAt, now)}일 남음)`
                    : parsed.message}
                </p>
              )}
              <p className="mt-1 text-[11px] text-slate-500">
                저장한 뒤에는 <strong>다시 볼 수 없습니다</strong> — 마지막 4글자만 남습니다.
              </p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="submit"
                  className="btn-primary text-xs"
                  disabled={!parsed?.ok || draftExpired || setSecret.isPending}
                >
                  {setSecret.isPending ? '저장 중…' : '저장'}
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    setDraft('')
                    setEditing(false)
                  }}
                >
                  취소
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  )
}

// ── 접수 판정 기준 ───────────────────────────────────────────────────────────

function IntakeRulesSection({
  canEdit,
  onError,
}: {
  canEdit: boolean
  onError: (err: unknown) => void
}) {
  const { data: rules = [], isLoading } = useIntakeRules()
  const createRule = useCreateIntakeRule()
  const updateRule = useUpdateIntakeRule()
  const deleteRule = useDeleteIntakeRule()

  const [draft, setDraft] = useState<Record<RuleKind, string>>({ include: '', exclude: '' })

  function add(kind: RuleKind, event: FormEvent) {
    event.preventDefault()
    const content = draft[kind].trim()
    if (!content) return
    createRule.mutate(
      { kind, content, sortOrder: (rules.filter((r) => r.kind === kind).length + 1) * 10 },
      { onSuccess: () => setDraft((d) => ({ ...d, [kind]: '' })), onError },
    )
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-800">접수 판정 기준</h2>
      <p className="mt-1 text-xs text-slate-500">
        메일이 요청인지 아닌지를 LLM 이 판단할 때 쓰는 기준입니다. 조직마다 &apos;요청&apos; 의
        범위가 다르므로 여기서 직접 정합니다.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500">불러오는 중…</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {RULE_KINDS.map((kind) => {
            const items = rules.filter((rule) => rule.kind === kind)
            return (
              <div key={kind}>
                <h3
                  className={`text-xs font-semibold ${
                    kind === 'include' ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  {RULE_KIND_LABELS[kind]}
                  <span className="ml-1 font-normal text-slate-400">({items.length})</span>
                </h3>

                <ul className="mt-2 space-y-1.5">
                  {items.map((rule) => (
                    <li
                      key={rule.id}
                      className={`flex items-start gap-2 rounded-md p-2 text-sm ${
                        rule.is_active ? 'bg-slate-50' : 'bg-slate-50/50 text-slate-400 line-through'
                      }`}
                    >
                      <span className="flex-1">{rule.content}</span>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1.5 text-[11px]">
                          <button
                            type="button"
                            className="text-slate-500 hover:underline"
                            onClick={() =>
                              updateRule.mutate(
                                { id: rule.id, patch: { is_active: !rule.is_active } },
                                { onError },
                              )
                            }
                          >
                            {rule.is_active ? '중지' : '사용'}
                          </button>
                          <button
                            type="button"
                            className="text-rose-600 hover:underline"
                            onClick={() => {
                              if (!window.confirm(`기준을 삭제합니다:\n${rule.content}`)) return
                              deleteRule.mutate(rule.id, { onError })
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                  {items.length === 0 && (
                    <li className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                      기준이 하나도 없습니다. 이 상태면 에이전트가 코드에 내장된 기본 기준을
                      씁니다 — 근거 없이 판정하지 않기 위한 안전장치입니다.
                    </li>
                  )}
                </ul>

                {canEdit && (
                  <form onSubmit={(event) => add(kind, event)} className="mt-2 flex gap-2">
                    <input
                      className="field flex-1"
                      placeholder={
                        kind === 'include' ? '예: 데이터 정정 요청' : '예: 사내 공지 메일'
                      }
                      value={draft[kind]}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, [kind]: event.target.value }))
                      }
                    />
                    <button type="submit" className="btn-secondary shrink-0">
                      추가
                    </button>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── 애매할 때의 편향 ─────────────────────────────────────────────────────────

function AmbiguousPolicySection({
  canEdit,
  onError,
}: {
  canEdit: boolean
  onError: (err: unknown) => void
}) {
  const { data: settings = [] } = useSettings()
  const updateSetting = useUpdateSetting()
  const policy = settings.find((s) => s.key === 'intake_ambiguous_policy')
  const value = policy?.value ?? 'include'

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-800">판단이 애매할 때</h2>
      <p className="mt-1 text-xs text-slate-500">
        기준 어디에도 딱 맞지 않는 메일을 어떻게 할지 정합니다.
      </p>

      <div className="mt-3 space-y-2">
        {[
          {
            key: 'include',
            title: '접수한다 (권장)',
            note: '메일은 놓치면 복구되지 않지만, 잘못 접수된 티켓은 지우면 됩니다.',
          },
          {
            key: 'exclude',
            title: '제외한다',
            note: '확실한 요청만 접수합니다. 검토 화면에서 놓친 건을 직접 찾아야 합니다.',
          },
        ].map((option) => (
          <label
            key={option.key}
            className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
              value === option.key ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
            } ${canEdit ? '' : 'cursor-not-allowed opacity-60'}`}
          >
            <input
              type="radio"
              name="ambiguous-policy"
              className="mt-0.5"
              disabled={!canEdit}
              checked={value === option.key}
              onChange={() =>
                updateSetting.mutate(
                  { key: 'intake_ambiguous_policy', value: option.key },
                  { onError },
                )
              }
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">{option.title}</span>
              <span className="block text-xs text-slate-500">{option.note}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}

// ── 시스템 종류 ──────────────────────────────────────────────────────────────

function SystemsSection({
  canEdit,
  onError,
}: {
  canEdit: boolean
  onError: (err: unknown) => void
}) {
  const { data: systems = [], isLoading } = useAllSystems()
  const createSystem = useCreateSystem()
  const updateSystem = useUpdateSystem()
  const deleteSystem = useDeleteSystem()

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  function add(event: FormEvent) {
    event.preventDefault()
    if (!code.trim() || !name.trim()) return
    createSystem.mutate(
      { code, name, description, sortOrder: (systems.length + 1) * 10 },
      {
        onSuccess: () => {
          setCode('')
          setName('')
          setDescription('')
        },
        onError,
      },
    )
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-slate-800">시스템 종류</h2>
      <p className="mt-1 text-xs text-slate-500">
        티켓의 대상 시스템 목록입니다. 설명을 적어 두면 LLM 이 그 설명을 근거로 분류합니다.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-slate-500">불러오는 중…</p>
      ) : systems.length === 0 ? (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
          등록된 시스템이 없습니다. 등록하기 전까지 모든 티켓이 &apos;미분류&apos; 로 들어옵니다.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-600">
                <th className="py-2 pr-3 font-medium">코드</th>
                <th className="py-2 pr-3 font-medium">표시명</th>
                <th className="py-2 pr-3 font-medium">LLM 판단 기준</th>
                <th className="py-2 pr-3 font-medium">사용</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {systems.map((system) => (
                <tr key={system.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3">
                    <code className="rounded bg-slate-100 px-1 text-xs">{system.code}</code>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="field py-1"
                      disabled={!canEdit}
                      defaultValue={system.name}
                      onBlur={(event) => {
                        const next = event.target.value.trim()
                        if (!next || next === system.name) return
                        updateSystem.mutate({ id: system.id, patch: { name: next } }, { onError })
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="field py-1"
                      placeholder="예: 회계·인사·재고 기간계"
                      disabled={!canEdit}
                      defaultValue={system.description ?? ''}
                      onBlur={(event) => {
                        const next = event.target.value.trim()
                        if (next === (system.description ?? '')) return
                        updateSystem.mutate(
                          { id: system.id, patch: { description: next || null } },
                          { onError },
                        )
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={system.is_active}
                      onChange={(event) =>
                        updateSystem.mutate(
                          { id: system.id, patch: { is_active: event.target.checked } },
                          { onError },
                        )
                      }
                    />
                  </td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <button
                        type="button"
                        className="text-[11px] text-rose-600 hover:underline"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `'${system.name}' 을 삭제합니다.\n\n` +
                                '이미 이 시스템으로 분류된 티켓은 사라지지 않고 ' +
                                "'미분류' 로 표시됩니다.",
                            )
                          )
                            return
                          deleteSystem.mutate(system.id, { onError })
                        }}
                      >
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && (
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <div className="w-32">
            <label className="label" htmlFor="new-system-code">
              코드
            </label>
            <input
              id="new-system-code"
              className="field"
              placeholder="erp"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <div className="w-40">
            <label className="label" htmlFor="new-system-name">
              표시명
            </label>
            <input
              id="new-system-name"
              className="field"
              placeholder="ERP"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="label" htmlFor="new-system-desc">
              LLM 판단 기준 (선택)
            </label>
            <input
              id="new-system-desc"
              className="field"
              placeholder="회계·인사·재고 등 기간계"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary">
            추가
          </button>
        </form>
      )}

      <p className="mt-3 text-[11px] text-slate-400">
        코드는 LLM 이 고르는 값이라 영문 소문자·숫자·밑줄을 권합니다. 한 번 정하면 바꾸지 않는
        편이 좋습니다 — 과거 티켓은 코드로 저장돼 있습니다.
      </p>
    </section>
  )
}

/** 마지막 갱신 시각 표시용 (설정 화면 하단에서 씀) */
export function SettingUpdatedAt({ value }: { value: string }) {
  return <span className="text-[11px] text-slate-400">{formatDateTime(value)}</span>
}
