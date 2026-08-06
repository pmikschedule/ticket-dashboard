import { useState, type FormEvent } from 'react'

import { useAuth } from '../hooks/useAuth'
import {
  useAllSystems,
  useCreateIntakeRule,
  useCreateSystem,
  useDeleteIntakeRule,
  useDeleteSystem,
  useIntakeRules,
  useSettings,
  useUpdateIntakeRule,
  useUpdateSetting,
  useUpdateSystem,
} from '../hooks/queries'
import { RULE_KINDS, RULE_KIND_LABELS, type RuleKind } from '../lib/constants'
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

      <IntakeRulesSection canEdit={isAdmin} onError={fail} />
      <AmbiguousPolicySection canEdit={isAdmin} onError={fail} />
      <SystemsSection canEdit={isAdmin} onError={fail} />
    </div>
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
