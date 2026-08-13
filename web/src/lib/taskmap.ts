/**
 * 태스크 맵 — desk 태스크를 **보고 항목**으로 바꾸는 규칙.
 *
 * 사람마다 태스크를 쪼개는 기준이 다릅니다. 한 사람은 하나의 일을 분석·설계·구현
 * 3건으로 등록하고 다른 사람은 1건으로 등록합니다. 그대로 보고서에 실으면 같은
 * 크기의 일이 3행과 1행으로 나오고, 한 장 예산이 등록 습관에 좌우됩니다.
 *
 * 규칙은 **한 종류**입니다 — 보고 항목 하나가 desk 태스크를 N개 가집니다.
 * 통합·프로젝트 재배정·명칭 변경·제외가 전부 이 한 구조의 조합입니다.
 * 축을 넷으로 나누면 규칙끼리 충돌하고 화면도 넷이 됩니다.
 *
 * 여기는 **순수 함수만** 둡니다. DB 접근은 `api.ts`, 화면은 `TaskMapPage`.
 * 같은 규칙이 `reporter/src/taskmap.ts` 에도 있습니다 — 보고서 생성이 이쪽으로
 * 옮겨 오면(4단계) 그쪽이 이 파일을 가져다 쓰고 사본은 없어집니다.
 */

/** desk `/api/state` 의 업무. 화면이 쓰는 것만 좁혀 옮겼습니다 */
export interface DeskWork {
  id: string
  title: string
  owner: string | null
  project: string | null
  /** desk 는 넷을 씁니다. 보류는 **파이프라인 단계가 아니라 옆길**입니다 */
  status: 'todo' | 'ing' | 'done' | 'hold'
  start: string | null
  due: string | null
  completedOn: string | null
  progress: number | null
  types: string[] | null
}

export interface DeskProject {
  key: string
  title: string
  milestones: { name: string; done: boolean }[] | null
  hold?: boolean
  due: string | null
}

export interface DeskState {
  updatedAt: string | null
  work: DeskWork[]
  projects: DeskProject[]
}

export interface TaskEntry {
  /** 우리가 만든 id. desk 의 work.id 와 달리 사람이 안 바꿉니다 */
  key: string
  /** 보고서 표기명. 없으면 첫 구성원의 제목 */
  title?: string
  /** 재배정. null 이면 독립 항목, 없으면(undefined) 구성원에게서 물려받습니다 */
  project?: string | null
  members: string[]
  note?: string
  /** 보고서에서 뺍니다. **각주에 건수가 남습니다** */
  hidden?: boolean
}

export interface TaskMap {
  version: number
  entries: TaskEntry[]
  /** 낙관적 잠금용. 저장할 때 이 값이 그대로인지 봅니다 */
  updatedAt: string | null
}

export const STATUS_KO: Record<DeskWork['status'], string> = {
  done: '완료',
  ing: '진행중',
  todo: '대기',
  hold: '보류',
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

/**
 * **한 태스크는 최대 한 항목에만 속합니다.**
 *
 * 둘에 걸치면 건수가 두 번 세어지고, 보고서 합계가 desk 와 안 맞는데 원인을
 * 찾기가 아주 어렵습니다. 저장 전에 막지 않으면 그 상태가 DB 에 남아 매주
 * 재생산됩니다.
 */
export function validateTaskMap(entries: TaskEntry[]): string[] {
  const errors: string[] = []
  const keys = new Set<string>()
  const owner = new Map<string, string>()

  for (const e of entries) {
    if (!e.key.trim()) errors.push('key 가 빈 항목이 있습니다')
    else if (keys.has(e.key)) errors.push(`중복된 항목 key: ${e.key}`)
    keys.add(e.key)

    if (e.members.length === 0) errors.push(`구성 태스크가 없는 항목: ${e.title ?? e.key}`)

    for (const m of e.members) {
      const prev = owner.get(m)
      if (prev && prev !== e.key) {
        errors.push(`태스크 ${m} 가 항목 두 곳에 들어 있습니다 (${prev} · ${e.key})`)
      }
      owner.set(m, e.key)
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// 파생값
// ---------------------------------------------------------------------------

export function claimedIds(entries: TaskEntry[]): Set<string> {
  return new Set(entries.flatMap((e) => e.members))
}

/** 항목이 속한 프로젝트. 지정이 없으면 구성원에게서 물려받되, 서로 다르면 null */
export function entryProject(e: TaskEntry, byId: Map<string, DeskWork>): string | null {
  if (e.project !== undefined) return e.project
  const ps = [...new Set(e.members.map((id) => byId.get(id)?.project ?? null))]
  return ps.length === 1 ? ps[0]! : null
}

export function entryTitle(e: TaskEntry, byId: Map<string, DeskWork>): string {
  return e.title?.trim() || byId.get(e.members[0] ?? '')?.title || e.key
}

/** 구성원 중 완료 몇 개인지. `구성 2/3` 표기의 근거입니다 */
export function entryDone(e: TaskEntry, byId: Map<string, DeskWork>): number {
  return e.members.filter((id) => byId.get(id)?.status === 'done').length
}

/**
 * 항목의 기간 — **가장 이른 시작 ~ 가장 나중 종료**.
 *
 * 종료는 완료된 구성원이면 완료일, 아직이면 마감일입니다. 보고서 표의 '마감'
 * 과는 다른 값입니다 — 표는 지연을 감추지 않으려고 미완료 중 가장 이른 마감을
 * 쓰고, 여기는 '이 일이 언제 시작해 언제 끝나는가' 를 봅니다.
 */
export function entrySpan(
  e: TaskEntry,
  byId: Map<string, DeskWork>,
): { start: string | null; end: string | null; endIsActual: boolean } {
  const members = e.members.map((id) => byId.get(id)).filter((w): w is DeskWork => Boolean(w))
  const starts = members.map((w) => w.start).filter((v): v is string => Boolean(v)).sort()
  const ends = members
    .map((w) => w.completedOn ?? w.due)
    .filter((v): v is string => Boolean(v))
    .sort()
  const end = ends[ends.length - 1] ?? null
  return {
    start: starts[0] ?? null,
    end,
    endIsActual: end !== null && members.some((w) => w.status === 'done' && w.completedOn === end),
  }
}

/** 새 항목 key. 같은 이름이 이미 있으면 뒤에 번호를 붙입니다 */
export function newEntryKey(title: string, entries: TaskEntry[]): string {
  const base = `e-${(title || 'item').trim().replace(/\s+/g, '-').slice(0, 24)}`
  let key = base
  let n = 2
  while (entries.some((e) => e.key === key)) key = `${base}-${n++}`
  return key
}

/**
 * 항목을 만듭니다.
 *
 * **이미 다른 항목에 든 태스크는 받지 않습니다.** 한 태스크가 두 항목에 걸치면
 * 건수가 두 번 세어지고 저장이 거부됩니다. 여기서 막으면 화면이 잘못된 상태를
 * 아예 만들지 못합니다.
 */
export function addEntry(
  entries: TaskEntry[],
  ids: string[],
  opt: { title?: string; project?: string | null; hidden?: boolean } = {},
): TaskEntry[] {
  const claimed = claimedIds(entries)
  const fresh = ids.filter((id) => !claimed.has(id))
  if (fresh.length === 0) return entries

  const e: TaskEntry = { key: newEntryKey(opt.title ?? fresh[0]!, entries), members: fresh }
  if (opt.title) e.title = opt.title
  if (opt.project !== undefined) e.project = opt.project
  if (opt.hidden) e.hidden = true
  return [...entries, e]
}

/** 항목을 풀어 원래 태스크로 되돌립니다. 원본은 desk 에 그대로 있습니다 */
export function removeEntry(entries: TaskEntry[], key: string): TaskEntry[] {
  return entries.filter((e) => e.key !== key)
}

export function updateEntry(
  entries: TaskEntry[],
  key: string,
  patch: Partial<TaskEntry>,
): TaskEntry[] {
  return entries.map((e) => (e.key === key ? { ...e, ...patch } : e))
}

/**
 * 제외를 되돌립니다.
 *
 * 제외하려고만 만든 항목(구성원 하나, 이름·프로젝트·메모 없음)이면 통째로
 * 지웁니다. 이름이나 프로젝트를 손댄 항목이면 제외만 풀고 그 설정은 남깁니다.
 */
export function unhideEntry(entries: TaskEntry[], key: string): TaskEntry[] {
  const e = entries.find((x) => x.key === key)
  if (!e) return entries
  const bare = e.members.length === 1 && !e.title && e.project === undefined && !e.note
  if (bare) return removeEntry(entries, key)
  return entries.map((x) => (x.key === key ? { ...x, hidden: undefined } : x))
}

// ---------------------------------------------------------------------------
// 화면 묶음
// ---------------------------------------------------------------------------

export interface MapGroup {
  key: string | null
  title: string
  entries: TaskEntry[]
  /** 아직 어느 항목에도 안 속한 원본 태스크 */
  loose: DeskWork[]
}

/**
 * 프로젝트별로 묶습니다. 항목도 원본 태스크도 없는 프로젝트는 그리지 않습니다.
 *
 * **'항목 미지정' 은 '프로젝트 미지정' 이 아닙니다.** 프로젝트에 잘 붙어 있어도
 * 보고 항목을 안 만들었으면 `loose` 입니다 — 결함이 아니라 원본 그대로 한 줄씩
 * 나간다는 뜻입니다.
 */
export function groupForMap(state: DeskState, entries: TaskEntry[]): MapGroup[] {
  const byId = new Map(state.work.map((w) => [w.id, w]))
  const claimed = claimedIds(entries)
  const buckets: MapGroup[] = state.projects.map((p) => ({
    key: p.key,
    title: p.title,
    entries: [],
    loose: [],
  }))
  buckets.push({ key: null, title: '프로젝트 없음', entries: [], loose: [] })

  const find = (key: string | null) => buckets.find((b) => b.key === key) ?? buckets[buckets.length - 1]!

  for (const e of entries) find(entryProject(e, byId)).entries.push(e)
  for (const w of state.work) {
    if (!claimed.has(w.id)) find(w.project ?? null).loose.push(w)
  }

  return buckets.filter((b) => b.entries.length > 0 || b.loose.length > 0)
}
