import { describe, expect, it } from 'vitest'

import {
  addEntry,
  claimedIds,
  entryDone,
  entryProject,
  entrySpan,
  entryTitle,
  groupForMap,
  newEntryKey,
  removeEntry,
  unhideEntry,
  validateTaskMap,
  type DeskProject,
  type DeskState,
  type DeskWork,
  type TaskEntry,
} from './taskmap'

function work(over: Partial<DeskWork> = {}): DeskWork {
  return {
    id: 'w1',
    title: '업무',
    owner: 'Ji',
    project: null,
    system: null,
    parent: null,
    status: 'ing',
    start: null,
    due: null,
    completedOn: null,
    progress: null,
    types: [],
    detail: null,
    assessment: null,
    log: [],
    ...over,
  }
}

function project(over: Partial<DeskProject> = {}): DeskProject {
  return {
    key: 'p1',
    title: '프로젝트',
    codename: null,
    parent: null,
    system: null,
    systems: null,
    overview: null,
    memo: null,
    assessment: null,
    current: null,
    policy: null,
    milestones: null,
    participants: null,
    start: null,
    due: null,
    ...over,
  }
}

function state(over: Partial<DeskState> = {}): DeskState {
  return { updatedAt: null, work: [], projects: [], decisions: [], systems: [], people: [], ...over }
}

const byId = (works: DeskWork[]) => new Map(works.map((w) => [w.id, w]))

describe('검증', () => {
  it('한 태스크가 두 항목에 걸치면 막습니다', () => {
    // 걸치면 건수가 두 번 세어지고, 합계가 desk 와 안 맞는데 원인을 못 찾습니다.
    const errors = validateTaskMap([
      { key: 'e1', members: ['a', 'b'] },
      { key: 'e2', members: ['b'] },
    ])
    expect(errors.join(' ')).toContain('두 곳에')
  })

  it('빈 항목과 중복 key 를 막습니다', () => {
    expect(validateTaskMap([{ key: 'e1', members: [] }]).join(' ')).toContain('구성 태스크가 없는')
    expect(
      validateTaskMap([
        { key: 'e1', members: ['a'] },
        { key: 'e1', members: ['b'] },
      ]).join(' '),
    ).toContain('중복된 항목 key')
  })

  it('올바른 맵은 통과합니다', () => {
    expect(validateTaskMap([{ key: 'e1', members: ['a', 'b'] }])).toEqual([])
  })
})

describe('항목 만들기', () => {
  it('이미 다른 항목에 든 태스크는 받지 않습니다', () => {
    // 화면이 잘못된 상태를 아예 만들지 못하게 여기서 막습니다.
    const entries: TaskEntry[] = [{ key: 'e1', members: ['a'] }]
    expect(addEntry(entries, ['a'])).toBe(entries)
    expect(addEntry(entries, ['a', 'b'])[1]!.members).toEqual(['b'])
  })

  it('key 가 겹치면 번호를 붙입니다', () => {
    const entries: TaskEntry[] = [{ key: 'e-설계', members: ['a'] }]
    expect(newEntryKey('설계', entries)).toBe('e-설계-2')
  })

  it('제외는 숨김 항목 하나입니다 — 별도 목록을 두지 않습니다', () => {
    const r = addEntry([], ['a'], { hidden: true })
    expect(r[0]).toMatchObject({ members: ['a'], hidden: true })
  })
})

describe('제외 되돌리기', () => {
  it('제외하려고만 만든 항목이면 통째로 지웁니다', () => {
    const entries = addEntry([], ['a'], { hidden: true })
    expect(unhideEntry(entries, entries[0]!.key)).toEqual([])
  })

  it('이름을 손댄 항목이면 제외만 풉니다', () => {
    const entries: TaskEntry[] = [{ key: 'e1', members: ['a'], title: '보고용 이름', hidden: true }]
    const r = unhideEntry(entries, 'e1')
    expect(r).toHaveLength(1)
    expect(r[0]!.hidden).toBeUndefined()
    expect(r[0]!.title).toBe('보고용 이름')
  })
})

describe('파생값', () => {
  const works = [
    work({ id: 'a', project: 'p1', status: 'done', start: '2026-07-29', completedOn: '2026-08-01' }),
    work({ id: 'b', project: 'p1', status: 'ing', start: '2026-08-05', due: '2026-08-20' }),
  ]

  it('구성원 프로젝트가 같으면 물려받고, 다르면 정하지 않습니다', () => {
    const map = byId(works)
    expect(entryProject({ key: 'e', members: ['a', 'b'] }, map)).toBe('p1')

    const mixed = byId([work({ id: 'a', project: 'p1' }), work({ id: 'b', project: 'p2' })])
    expect(entryProject({ key: 'e', members: ['a', 'b'] }, mixed)).toBeNull()
  })

  it('표기명을 안 정했으면 첫 구성원의 제목입니다', () => {
    const map = byId([work({ id: 'a', title: '원래 이름' })])
    expect(entryTitle({ key: 'e', members: ['a'] }, map)).toBe('원래 이름')
    expect(entryTitle({ key: 'e', members: ['a'], title: '바꾼 이름' }, map)).toBe('바꾼 이름')
  })

  it('기간은 가장 이른 시작 ~ 가장 나중 종료입니다', () => {
    const span = entrySpan({ key: 'e', members: ['a', 'b'] }, byId(works))
    expect(span).toMatchObject({ start: '2026-07-29', end: '2026-08-20', endIsActual: false })
  })

  it('가장 나중 날짜가 완료일이면 실제 종료입니다', () => {
    const done = [
      work({ id: 'a', status: 'done', completedOn: '2026-08-07' }),
      work({ id: 'b', status: 'done', completedOn: '2026-08-03' }),
    ]
    expect(entrySpan({ key: 'e', members: ['a', 'b'] }, byId(done)).endIsActual).toBe(true)
  })

  it('구성 완료 개수를 셉니다', () => {
    expect(entryDone({ key: 'e', members: ['a', 'b'] }, byId(works))).toBe(1)
  })
})

describe('화면 묶음', () => {
  const s = state({
    projects: [project({ key: 'p1', title: 'A' }), project({ key: 'p2', title: 'B' })],
    work: [
      work({ id: '1', project: 'p1' }),
      work({ id: '2', project: 'p1' }),
      work({ id: '3', project: null }),
    ],
  })

  it('항목도 태스크도 없는 프로젝트는 그리지 않습니다', () => {
    expect(groupForMap(s, []).map((g) => g.title)).toEqual(['A', '프로젝트 없음'])
  })

  it('항목을 만들면 그만큼 미지정에서 빠집니다', () => {
    // '항목 미지정' 은 '프로젝트 미지정' 이 아닙니다 — 프로젝트에 붙어 있어도
    // 항목을 안 만들었으면 미지정입니다.
    const entries = addEntry([], ['1', '2'])
    const g = groupForMap(s, entries).find((x) => x.key === 'p1')!
    expect(g.entries).toHaveLength(1)
    expect(g.loose).toHaveLength(0)
    expect(claimedIds(entries).size).toBe(2)
  })

  it('항목이 지정한 프로젝트를 따라갑니다', () => {
    const entries: TaskEntry[] = [{ key: 'e', members: ['3'], project: 'p2' }]
    expect(groupForMap(s, entries).find((x) => x.key === 'p2')!.entries).toHaveLength(1)
  })

  it('항목을 풀면 태스크가 미지정으로 돌아옵니다', () => {
    const entries = addEntry([], ['1'])
    const back = removeEntry(entries, entries[0]!.key)
    expect(groupForMap(s, back).find((x) => x.key === 'p1')!.loose).toHaveLength(2)
  })
})
