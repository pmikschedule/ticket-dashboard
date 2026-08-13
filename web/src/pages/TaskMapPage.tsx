import { useMemo, useState } from 'react'

import { useAuth } from '../hooks/useAuth'
import { useLatestSnapshot, useSaveTaskMap, useSnapshotBefore, useTaskMap } from '../hooks/queries'
import { buildWeeklyReport } from '../lib/report/build'
import { downloadWeekly } from '../lib/report/render'
import { currentWeek, rangeLabel } from '../lib/report/week'
import { REPORT_SUBTITLE, REPORT_TEAM } from '../lib/constants'
import {
  addEntry,
  claimedIds,
  entryDone,
  entryProject,
  entrySpan,
  entryTitle,
  groupForMap,
  removeEntry,
  unhideEntry,
  updateEntry,
  validateTaskMap,
  STATUS_KO,
  type DeskState,
  type DeskWork,
  type TaskEntry,
} from '../lib/taskmap'
import { formatDate } from '../lib/format'

/**
 * 태스크 맵.
 *
 * desk 에 등록된 태스크를 **보고 항목**으로 다듬는 화면입니다. 사람마다 태스크를
 * 쪼개는 기준이 달라서, 그대로 보고서에 실으면 같은 크기의 일이 3행과 1행으로
 * 나옵니다. 여기서 정한 규칙이 매주 같게 적용돼야 보고서 포맷이 안 흔들립니다.
 *
 * **'항목 미지정' 은 '프로젝트 미지정' 이 아닙니다.** 프로젝트에 잘 붙어 있어도
 * 보고 항목을 안 만들었으면 미지정이고, 그건 결함이 아니라 **원본 그대로 한 줄씩
 * 나간다**는 뜻입니다. 여러 건을 한 줄로 합치거나 이름·프로젝트를 바꾸고 싶을
 * 때만 항목을 만듭니다.
 *
 * 쓰기는 관리자만 됩니다. 버튼을 가리는 것은 편의일 뿐이고 실제 차단은 RLS 입니다.
 */
export default function TaskMapPage() {
  const { user, isAdmin } = useAuth()
  const snapshot = useLatestSnapshot()
  const taskMap = useTaskMap()
  const save = useSaveTaskMap()

  const [draft, setDraft] = useState<TaskEntry[] | null>(null)
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const state = (snapshot.data?.state ?? null) as DeskState | null
  const saved = (taskMap.data?.entries ?? []) as TaskEntry[]
  const entries = draft ?? saved
  const dirty = draft !== null

  const byId = useMemo(
    () => new Map((state?.work ?? []).map((w) => [w.id, w])),
    [state],
  )
  const groups = useMemo(
    () => (state ? groupForMap(state, entries) : []),
    [state, entries],
  )
  const errors = useMemo(() => validateTaskMap(entries), [entries])

  // 보고 구간은 **방금 끝난 화~월**입니다. 기준일은 스냅샷 날짜 — 오늘 날짜를
  // 쓰면 오래된 스냅샷으로 최신 주를 만들어 빈 보고서가 나옵니다.
  const week = snapshot.data ? currentWeek(snapshot.data.day) : null
  const base = useSnapshotBefore(week?.from ?? null)
  const unmapped = (state?.work.length ?? 0) - claimedIds(entries).size

  function edit(next: TaskEntry[]) {
    setDraft(next)
  }

  function togglePick(id: string) {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  function makeEntry(opt: { hidden?: boolean } = {}) {
    if (picked.size === 0) return
    let next = entries
    if (opt.hidden) {
      // 여러 건을 뺄 때도 **한 항목으로 묶지 않습니다.** 나중에 한 건씩 되살릴 수
      // 있어야 합니다.
      for (const id of picked) next = addEntry(next, [id], { hidden: true })
    } else {
      next = addEntry(next, [...picked])
      setSelected(next[next.length - 1]?.key ?? null)
    }
    edit(next)
    setPicked(new Set())
  }

  /**
   * pptx 는 **브라우저에서** 만들어 바로 내려받습니다. 서버가 없으므로 업무
   * 내용이 어디로도 전송되지 않습니다.
   *
   * 저장하지 않은 편집도 그대로 반영합니다 — 미리 보고 고칠 수 있어야 합니다.
   */
  async function onBuild() {
    if (!state || !snapshot.data || !week) return
    setBuilding(true)
    setBuildError(null)
    try {
      const out = buildWeeklyReport({
        state,
        day: snapshot.data.day,
        base: (base.data?.state ?? null) as DeskState | null,
        baseDay: base.data?.day ?? null,
        entries,
        author: user?.name ?? '',
        subtitle: REPORT_SUBTITLE,
        team: REPORT_TEAM,
      })
      await downloadWeekly(out.model, out.nextLabel, out.fileName)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  async function onSave() {
    if (!user) return
    await save.mutateAsync({
      entries,
      version: taskMap.data?.version ?? 1,
      expectedUpdatedAt: taskMap.data?.updated_at ?? null,
      updatedBy: user.id,
    })
    setDraft(null)
  }

  if (snapshot.isLoading || taskMap.isLoading) {
    return <p className="text-sm text-slate-500">불러오는 중…</p>
  }

  if (!state) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-lg font-bold mb-2">태스크 맵</h1>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="mb-2 font-medium text-slate-800">아직 올라온 desk 스냅샷이 없습니다.</p>
          <p>
            desk 인증이 특정 PC 의 브라우저 쿠키라 수집이 그 PC 를 벗어날 수 없습니다.
            그 PC 에서 <code className="rounded bg-white px-1">cd reporter &amp;&amp; npm run scan</code>{' '}
            을 한 번 돌리면 여기에 나타납니다.
          </p>
        </div>
      </div>
    )
  }

  const selectedEntry = entries.find((e) => e.key === selected) ?? null

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">태스크 맵</h1>
        <span className="text-xs text-slate-500">
          desk 스냅샷 {snapshot.data && formatDate(snapshot.data.day)} · 업무 {state.work.length}건
        </span>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200">
          항목 미지정 {unmapped}건
        </span>
        <div className="flex-1" />
        {week && (
          <button
            type="button"
            disabled={building || base.isLoading}
            onClick={() => void onBuild()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
            title={`${rangeLabel(week)} 구간으로 만듭니다`}
          >
            {building ? '만드는 중…' : '주간보고서 생성'}
          </button>
        )}
        {dirty && (
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            되돌리기
          </button>
        )}
        <button
          type="button"
          disabled={!dirty || !isAdmin || errors.length > 0 || save.isPending}
          onClick={() => void onSave()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {save.isPending ? '저장 중…' : '저장'}
        </button>
      </header>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
        <b className="text-slate-800">항목 미지정</b> = 보고 항목을 아직 안 만든 태스크입니다.{' '}
        <b className="text-slate-800">프로젝트 소속과는 상관없습니다</b> — 프로젝트에 붙어 있어도
        항목을 안 만들었으면 여기에 셉니다. 보고서에는 <b className="text-slate-800">원본 그대로 한
        줄씩</b> 나가므로 그냥 둬도 됩니다. 여러 건을 한 줄로 합치거나 이름·프로젝트를 바꾸고 싶을
        때만 항목을 만듭니다.
      </p>

      {!isAdmin && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          보기 전용입니다. 태스크 맵은 팀 전체 보고서의 모양을 정하는 규칙이라 관리자만 고칩니다.
        </p>
      )}

      {errors.length > 0 && (
        <ul className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {buildError && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
          보고서 생성 실패 — {buildError}
        </p>
      )}

      {dirty && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
          저장하지 않은 편집이 있습니다. 지금 만드는 보고서에는 **화면의 내용이 그대로** 들어갑니다.
        </p>
      )}

      {save.isError && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
          {(save.error as Error).message}
        </p>
      )}

      {picked.size > 0 && isAdmin && (
        <div className="sticky top-2 z-10 flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white shadow">
          <span>{picked.size}건 선택</span>
          <div className="flex-1" />
          <button type="button" onClick={() => makeEntry()} className="rounded bg-white/15 px-2 py-1">
            {picked.size > 1 ? '한 항목으로 묶기' : '항목 만들기'}
          </button>
          <button
            type="button"
            onClick={() => makeEntry({ hidden: true })}
            className="rounded bg-white/15 px-2 py-1"
          >
            보고서에서 제외
          </button>
          <button type="button" onClick={() => setPicked(new Set())} className="px-2 py-1 text-white/70">
            해제
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key ?? '__none__'} className="rounded-lg border border-slate-200">
              <h2 className="rounded-t-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-800">
                {g.title}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  보고 항목 {g.entries.length} · 항목 미지정 {g.loose.length}
                </span>
              </h2>

              <div className="divide-y divide-slate-100">
                {g.entries.map((e) => (
                  <EntryRow
                    key={e.key}
                    entry={e}
                    byId={byId}
                    selected={selected === e.key}
                    editable={isAdmin}
                    onSelect={() => setSelected(e.key)}
                    onUnhide={() => edit(unhideEntry(entries, e.key))}
                  />
                ))}
                {g.loose.map((w) => (
                  <LooseRow
                    key={w.id}
                    work={w}
                    checked={picked.has(w.id)}
                    editable={isAdmin}
                    onToggle={() => togglePick(w.id)}
                    onExclude={() => edit(addEntry(entries, [w.id], { hidden: true }))}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="lg:sticky lg:top-2 lg:self-start">
          {selectedEntry ? (
            <EntryEditor
              entry={selectedEntry}
              state={state}
              byId={byId}
              editable={isAdmin}
              onChange={(patch) => edit(updateEntry(entries, selectedEntry.key, patch))}
              onDropMember={(id) => {
                const rest = selectedEntry.members.filter((m) => m !== id)
                edit(
                  rest.length === 0
                    ? removeEntry(entries, selectedEntry.key)
                    : updateEntry(entries, selectedEntry.key, { members: rest }),
                )
                if (rest.length === 0) setSelected(null)
              }}
              onSplit={() => {
                edit(removeEntry(entries, selectedEntry.key))
                setSelected(null)
              }}
            />
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              왼쪽에서 <b>항목</b>을 누르면 여기서 이름·프로젝트·진행내용을 고칠 수 있습니다.
              <br />
              <br />
              항목을 안 만든 태스크는 체크해서 묶거나 제외합니다. 한 건만 묶어도 됩니다 — 이름만
              바꾸거나 프로젝트만 옮길 때 그렇게 합니다.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}

function dayCell(iso: string | null, actual: boolean) {
  if (!iso) return <span className="text-slate-300">—</span>
  return (
    <span className={actual ? 'text-slate-700' : 'text-slate-400'}>
      {actual ? '' : '~'}
      {iso.slice(5)}
    </span>
  )
}

function EntryRow({
  entry,
  byId,
  selected,
  editable,
  onSelect,
  onUnhide,
}: {
  entry: TaskEntry
  byId: Map<string, DeskWork>
  selected: boolean
  editable: boolean
  onSelect: () => void
  onUnhide: () => void
}) {
  const done = entryDone(entry, byId)
  const span = entrySpan(entry, byId)
  const missing = entry.members.filter((id) => !byId.has(id))

  return (
    <div className={`px-3 py-1.5 ${entry.hidden ? 'opacity-50' : ''} ${selected ? 'bg-sky-50' : ''}`}>
      <div className="flex items-center gap-2 text-sm">
        <button type="button" onClick={onSelect} className="flex-1 text-left font-medium">
          {entryTitle(entry, byId)}
        </button>
        <span className="w-32 whitespace-nowrap text-right text-xs tabular-nums">
          {dayCell(span.start, true)} <span className="text-slate-300">→</span>{' '}
          {dayCell(span.end, span.endIsActual)}
        </span>
        {entry.members.length > 1 && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
            구성 {done}/{entry.members.length}
          </span>
        )}
        {missing.length > 0 && (
          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700">
            끊김 {missing.length}
          </span>
        )}
        {entry.hidden && (
          <>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">제외</span>
            {editable && (
              <button
                type="button"
                onClick={onUnhide}
                className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] hover:bg-white"
              >
                되돌리기
              </button>
            )}
          </>
        )}
      </div>
      {(entry.members.length > 1 || entry.title) && (
        <ul className="mt-0.5 pl-3 text-xs text-slate-500">
          {entry.members.map((id) => (
            <li key={id}>└ {byId.get(id)?.title ?? <span className="text-rose-600">없어진 태스크: {id}</span>}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LooseRow({
  work,
  checked,
  editable,
  onToggle,
  onExclude,
}: {
  work: DeskWork
  checked: boolean
  editable: boolean
  onToggle: () => void
  onExclude: () => void
}) {
  const end = work.completedOn ?? work.due
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={!editable} />
      <span className="flex-1">{work.title}</span>
      <span className="w-16 text-xs text-slate-500">{work.owner || '—'}</span>
      <span className="w-32 whitespace-nowrap text-right text-xs tabular-nums">
        {dayCell(work.start, true)} <span className="text-slate-300">→</span>{' '}
        {dayCell(end, Boolean(work.completedOn))}
      </span>
      <span className="w-12 text-center text-[11px] text-slate-600">{STATUS_KO[work.status]}</span>
      {editable && (
        <button
          type="button"
          onClick={(ev) => {
            ev.preventDefault()
            onExclude()
          }}
          className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:border-rose-300 hover:text-rose-600"
        >
          제외
        </button>
      )}
    </label>
  )
}

function EntryEditor({
  entry,
  state,
  byId,
  editable,
  onChange,
  onDropMember,
  onSplit,
}: {
  entry: TaskEntry
  state: DeskState
  byId: Map<string, DeskWork>
  editable: boolean
  onChange: (patch: Partial<TaskEntry>) => void
  onDropMember: (id: string) => void
  onSplit: () => void
}) {
  const project = entryProject(entry, byId)

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
      <label className="block text-xs text-slate-500">표기명</label>
      <input
        value={entry.title ?? ''}
        disabled={!editable}
        placeholder={entryTitle(entry, byId)}
        onChange={(e) => onChange({ title: e.target.value.trim() || undefined })}
        className="w-full rounded border border-slate-200 px-2 py-1"
      />

      <label className="block text-xs text-slate-500">프로젝트</label>
      <select
        value={entry.project === undefined ? '__inherit__' : (entry.project ?? '')}
        disabled={!editable}
        onChange={(e) =>
          onChange({
            project: e.target.value === '__inherit__' ? undefined : e.target.value || null,
          })
        }
        className="w-full rounded border border-slate-200 px-2 py-1"
      >
        <option value="__inherit__">구성원에게서 물려받기{project ? ` (${project})` : ''}</option>
        <option value="">없음 (독립 항목)</option>
        {state.projects.map((p) => (
          <option key={p.key} value={p.key}>
            {p.title}
          </option>
        ))}
      </select>

      <label className="block text-xs text-slate-500">주요 진행 내용</label>
      <textarea
        value={entry.note ?? ''}
        disabled={!editable}
        placeholder="desk 에 기록이 없을 때만 채웁니다"
        onChange={(e) => onChange({ note: e.target.value.trim() || undefined })}
        className="h-16 w-full rounded border border-slate-200 px-2 py-1"
      />

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={entry.hidden === true}
          disabled={!editable}
          onChange={(e) => onChange({ hidden: e.target.checked || undefined })}
        />
        보고서에서 제외
      </label>
      <p className="text-[11px] text-slate-500">
        제외해도 <b>각주에 건수가 남습니다</b>. 한 일을 안 한 것처럼 만들지 않기 위해서입니다.
      </p>

      <label className="block text-xs text-slate-500">구성 태스크 {entry.members.length}건</label>
      <ul className="space-y-0.5 text-xs text-slate-600">
        {entry.members.map((id) => (
          <li key={id} className="flex items-center gap-1">
            <span className="flex-1">{byId.get(id)?.title ?? id}</span>
            {editable && (
              <button
                type="button"
                onClick={() => onDropMember(id)}
                className="rounded border border-slate-200 px-1 hover:bg-slate-50"
              >
                빼기
              </button>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <button
          type="button"
          onClick={onSplit}
          className="w-full rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
        >
          항목 분리 (원래 태스크로)
        </button>
      )}
      <p className="text-[11px] text-slate-500">
        분리·삭제해도 원본 태스크는 desk 에 그대로 있습니다. 항목 미지정으로 돌아갑니다.
      </p>
    </div>
  )
}
