import { describe, expect, it } from 'vitest'
import {
  buildWeekly,
  diffProgress,
  diffWork,
  fitRows,
  groupWork,
  lateAsOf,
  stalled,
  STANDALONE_TITLE,
  type WeeklyGroup,
} from '../src/weekly.ts'
import { nextWeek, weekOf } from '../src/week.ts'
import type { DeskProject, DeskState, DeskWork } from '../src/types.ts'

function work(over: Partial<DeskWork> = {}): DeskWork {
  return {
    id: 'w1',
    owner: 'Ji',
    title: '업무',
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

const WEEK = weekOf('2026-08-12') // 8/11(화) ~ 8/17(월)
const TABLE = { budget: 3.2, headerH: 0.2, ruleH: 0.16, rowH: 0.26 }

function opts(over: Record<string, unknown> = {}) {
  return {
    week: WEEK,
    nextWeek: nextWeek(WEEK),
    author: 'Steven',
    reportedOn: '2026-08-14',
    subtitle: 'WEB',
    team: 'Team',
    baseline: '2026-08-07',
    history: [],
    table: TABLE,
    maxProgress: 8,
    maxChanges: 3,
    ...over,
  } as Parameters<typeof buildWeekly>[2]
}

describe('주간 diff (기획서 6.4)', () => {
  const before = state({
    work: [
      work({ id: 'a', status: 'ing' }),
      work({ id: 'b', status: 'todo' }),
      work({ id: 'c', due: '2026-08-20' }),
      work({ id: 'd', due: null }),
    ],
  })
  const after = state({
    work: [
      work({ id: 'a', status: 'done', completedOn: '2026-08-12' }),
      work({ id: 'b', status: 'ing' }),
      work({ id: 'c', due: '2026-08-27' }),
      work({ id: 'd', due: '2026-08-25' }),
      work({ id: 'e' }),
    ],
  })

  it('완료·착수·신규·일정변경·일정확정을 가려냅니다', () => {
    const d = diffWork(before, after)
    expect([...d.done]).toEqual(['a'])
    expect([...d.started]).toEqual(['b'])
    expect([...d.added]).toEqual(['e'])
    expect(d.dueChangedFrom.get('c')).toBe('2026-08-20')
    expect([...d.dueFixed]).toEqual(['d'])
  })

  it('비교 대상이 없으면 전부 신규로 잡지 않습니다', () => {
    // 모르는 것과 새로 생긴 것은 다른 사실입니다.
    // 빈 스냅샷으로 취급하면 첫 보고서가 '신규 38건' 이 됩니다.
    const d = diffWork(null, after)
    expect(d.added.size).toBe(0)
    expect(d.done.size).toBe(0)
  })
})

describe('지연 기준일', () => {
  it('아직 오지 않은 마감을 지연으로 만들지 않습니다', () => {
    // 수요일에 만든 보고서에서 금요일 마감이 빨갛게 뜨면 안 됩니다.
    expect(lateAsOf(WEEK, '2026-08-12')).toBe('2026-08-12')
  })

  it('지난 주차를 뒤늦게 뽑으면 그 주 기준입니다', () => {
    expect(lateAsOf(WEEK, '2026-09-01')).toBe('2026-08-17')
  })

  it('기준일 이후 마감은 진행중으로 남습니다', () => {
    const s = state({ work: [work({ id: 'x', status: 'ing', due: '2026-08-15' })] })
    const m = buildWeekly(null, s, opts({ reportedOn: '2026-08-12' }))
    expect(m.groups[0]!.rows[0]!.chip).toBe('ing')
  })
})

describe('프로젝트 → 하위 태스크', () => {
  const s = state({
    projects: [project({ key: 'pa', title: 'A', milestones: [{ name: 'm', done: true }] })],
    work: [
      work({ id: '1', project: 'pa', status: 'ing' }),
      work({ id: '2', project: null, status: 'ing' }),
      work({ id: '3', project: null, status: 'ing' }),
    ],
  })

  it('프로젝트 없는 업무를 가짜 프로젝트로 묶지 않습니다', () => {
    const g = groupWork(s, diffWork(null, s), WEEK, '2026-08-14')
    const loose = g.find((x) => x.standalone)!
    expect(loose.title).toBe(STANDALONE_TITLE)
    expect(loose.rows).toHaveLength(2)
    // 묶음이 아니므로 진척율·마일스톤이 없습니다
    expect(loose.progress).toBeNull()
    expect(loose.milestones).toBeNull()
  })

  it('독립 항목은 항상 맨 뒤입니다', () => {
    const g = groupWork(s, diffWork(null, s), WEEK, '2026-08-14')
    expect(g.at(-1)!.standalone).toBe(true)
  })

  it('프로젝트 묶음에는 마일스톤 진척율이 붙습니다', () => {
    const g = groupWork(s, diffWork(null, s), WEEK, '2026-08-14')
    expect(g[0]!.progress).toBe(100)
  })

  it('담당자를 업무마다 그대로 답니다', () => {
    const s2 = state({ work: [work({ id: '1', owner: 'Jayce' }), work({ id: '2', owner: null })] })
    const rows = groupWork(s2, diffWork(null, s2), WEEK, '2026-08-14')[0]!.rows
    expect(rows.map((r) => r.owner).sort()).toEqual(['Jayce', '—'])
  })
})

describe('보고 대상', () => {
  it('그 주에 완료된 것만 완료로 잡습니다', () => {
    const s = state({
      work: [
        work({ id: '1', title: '금주완료', status: 'done', completedOn: '2026-08-12' }),
        work({ id: '2', title: '지난주완료', status: 'done', completedOn: '2026-08-05' }),
      ],
    })
    const titles = groupWork(s, diffWork(null, s), WEEK, '2026-08-14')[0]!.rows.map((r) => r.title)
    expect(titles).toEqual(['금주완료'])
  })

  it('완료일이 비어 있어도 금주에 done 이 됐으면 싣습니다', () => {
    // desk 의 완료일은 사람이 적는 값이라 비는 일이 있습니다. 그걸 기준으로
    // 삼으면 이번 주에 실제로 끝난 일이 어느 보고서에도 안 나옵니다.
    const before = state({ work: [work({ id: 'x', status: 'ing' })] })
    const after = state({ work: [work({ id: 'x', status: 'done', completedOn: null })] })
    const m = buildWeekly(before, after, opts())
    expect(m.summary.done).toBe(1)
    expect(m.groups[0]!.rows[0]!.chip).toBe('done')
  })

  it('지난주에 이미 완료된 건은 다시 싣지 않습니다', () => {
    // 완료일이 이번 주로 적혀 있어도 전이는 지난주에 끝났습니다.
    const done = work({ id: 'x', status: 'done', completedOn: '2026-08-12' })
    const m = buildWeekly(state({ work: [done] }), state({ work: [done] }), opts())
    expect(m.summary.done).toBe(0)
  })

  it('비교 대상이 없는 첫 주차에는 완료일로 판정합니다', () => {
    const s = state({ work: [work({ id: 'x', status: 'done', completedOn: '2026-08-12' })] })
    expect(buildWeekly(null, s, opts({ baseline: null })).summary.done).toBe(1)
  })

  it('금주 신규는 아직 대기라도 싣습니다', () => {
    // 이번 주의 변화이기 때문입니다.
    const before = state({ work: [] })
    const after = state({ work: [work({ id: 'n', status: 'todo', due: null })] })
    const g = groupWork(after, diffWork(before, after), WEEK, '2026-08-14')
    expect(g[0]!.rows[0]!.chip).toBe('new')
  })

  it('손 안 댄 대기는 빠집니다', () => {
    const s = state({ work: [work({ status: 'todo', due: null })] })
    expect(groupWork(s, diffWork(null, s), WEEK, '2026-08-14')).toHaveLength(0)
  })
})

describe('보류', () => {
  const s = state({
    projects: [project({ key: 'pa', title: '결제 시스템 구축' })],
    work: [
      work({ id: 'h', title: '정산 리포트', status: 'hold', owner: 'Jacqueline', project: 'pa' }),
      work({ id: 'i', title: '굴러가는 일', status: 'ing' }),
    ],
  })

  it('표에서 뺍니다 — 진행중에 섞지 않습니다', () => {
    const m = buildWeekly(null, s, opts())
    const titles = m.groups.flatMap((g) => g.rows).map((r) => r.title)
    expect(titles).toEqual(['굴러가는 일'])
    expect(m.summary.ing).toBe(1)
  })

  it('대신 3장 이슈 절에 올립니다 — 멈춰 있다는 사실은 남습니다', () => {
    const m = buildWeekly(null, s, opts())
    const held = m.changes.find((c) => c.label === '정산 리포트')!
    expect(held.body).toContain('보류')
    expect(held.body).toContain('Jacqueline')
    expect(held.body).toContain('결제 시스템 구축')
  })

  it('표에서 뺐다는 사실을 각주에 적습니다', () => {
    expect(buildWeekly(null, s, opts()).footnotes.join(' ')).toContain('보류 1건은 표에서 빼고')
  })

  it('보류가 없으면 각주도 안 답니다', () => {
    const none = state({ work: [work({ id: 'i', status: 'ing' })] })
    expect(buildWeekly(null, none, opts()).footnotes.join(' ')).not.toContain('보류')
  })
})

describe('주간 진척', () => {
  const before = state({
    projects: [
      project({ key: 'pa', title: 'A', milestones: [{ name: '1', done: true }, { name: '2', done: false }] }),
    ],
  })
  const after = state({
    projects: [
      project({ key: 'pa', title: 'A', milestones: [{ name: '1', done: true }, { name: '2', done: true }] }),
    ],
  })

  it('마일스톤 증가분을 냅니다', () => {
    const [row] = diffProgress(before, after)
    expect(row).toMatchObject({ before: 50, after: 100, delta: 1 })
  })

  it('비교 대상이 없으면 증가분이 null 입니다 (0 이 아닙니다)', () => {
    const [row] = diffProgress(null, after)
    expect(row!.before).toBeNull()
    expect(row!.delta).toBeNull()
  })

  it('마일스톤이 없는 프로젝트는 아예 안 그립니다', () => {
    const s = state({ projects: [project({ key: 'pz', milestones: [] })] })
    expect(diffProgress(null, s)).toHaveLength(0)
  })

  it('업무를 끝내도 마일스톤이 그대로면 진척은 그대로입니다', () => {
    const b = state({ projects: after.projects, work: [work({ id: '1', project: 'pa', status: 'ing' })] })
    const a = state({
      projects: after.projects,
      work: [work({ id: '1', project: 'pa', status: 'done', completedOn: '2026-08-12' })],
    })
    expect(diffProgress(b, a)[0]!.delta).toBe(0)
  })
})

describe('정체', () => {
  const ing = (id: string) => work({ id, status: 'ing', due: '2026-09-01' })

  it('스냅샷이 3주치 미만이면 판정하지 않습니다', () => {
    const now = state({ work: [ing('a')] })
    expect(stalled([state({ work: [ing('a')] })], now)).toEqual([])
  })

  it('3주 연속 그대로면 정체입니다', () => {
    const now = state({ work: [ing('a')] })
    const hist = [state({ work: [ing('a')] }), state({ work: [ing('a')] })]
    expect(stalled(hist, now)).toHaveLength(1)
  })

  it('중간에 일정이 바뀌었으면 정체가 아닙니다', () => {
    const now = state({ work: [ing('a')] })
    const hist = [
      state({ work: [work({ id: 'a', status: 'ing', due: '2026-08-01' })] }),
      state({ work: [ing('a')] }),
    ]
    expect(stalled(hist, now)).toEqual([])
  })
})

describe('지면 맞추기', () => {
  const g = (key: string, n: number, standalone = false): WeeklyGroup => ({
    key,
    title: key,
    standalone,
    owners: [],
    counts: { done: 0, started: 0, ing: n, late: 0, added: 0 },
    milestones: null,
    progress: null,
    rows: Array.from({ length: n }, (_, i) => ({
      id: `${key}-${i}`,
      title: `${key}-${i}`,
      owner: '—',
      detail: '',
      chip: 'ing' as const,
      progress: null,
      schedule: '(계획)',
      dueChangedFrom: null,
    })),
  })

  it('머리행과 구분선 높이가 다른 것을 반영합니다', () => {
    // 행 수로 세면 구분선(0.16)이 머리행(0.20)과 같은 값을 먹습니다.
    const r = fitRows([g('A', 5), g('개별', 5, true)], TABLE)
    const rows = r.reduce((n, x) => n + x.rows.length, 0)
    expect(0.2 + 0.16 + rows * 0.26).toBeLessThanOrEqual(3.2 + 1e-9)
    expect(rows).toBe(10)
  })

  it('독립 항목이 굶지 않게 라운드로빈으로 나눕니다', () => {
    const r = fitRows([g('A', 20), g('개별', 20, true)], TABLE)
    expect(r[1]!.rows.length).toBeGreaterThan(0)
  })

  it('행이 하나도 못 들어간 독립 항목은 구분선만 남기지 않습니다', () => {
    const tight = { budget: 0.36, headerH: 0.2, ruleH: 0.16, rowH: 0.26 }
    const r = fitRows([g('A', 3), g('개별', 3, true)], tight)
    expect(r.some((x) => x.standalone)).toBe(false)
  })
})

describe('모델 조립', () => {
  const s = state({
    projects: [project({ key: 'pa', title: 'A', milestones: [{ name: 'm', done: false }] })],
    work: [
      work({ id: '1', project: 'pa', status: 'ing' }),
      work({ id: '2', project: 'pa', status: 'todo', due: '2026-08-01' }),
    ],
  })

  it('비교 대상이 없으면 그 사실을 각주에 남깁니다', () => {
    const m = buildWeekly(null, s, opts({ baseline: null }))
    expect(m.baseline).toBeNull()
    expect(m.footnotes.join(' ')).toContain('기준 주차')
  })

  it('정체를 못 재는 주에는 그 사실도 적습니다', () => {
    const m = buildWeekly(null, s, opts())
    expect(m.footnotes.join(' ')).toContain('정체(3주 연속 무변화)')
  })

  it('요약 건수는 표에 잘리기 전 전체입니다', () => {
    const many = state({
      projects: s.projects,
      work: Array.from({ length: 40 }, (_, i) => work({ id: `w${i}`, project: 'pa', status: 'ing' })),
    })
    const m = buildWeekly(null, many, opts())
    const shown = m.groups.reduce((n, g2) => n + g2.rows.length, 0)
    expect(m.summary.ing).toBe(40)
    expect(shown).toBeLessThan(40)
    expect(m.footnotes.join(' ')).toContain('업무 40건 중')
  })

  it('금주 일정 변경만 3장에 올립니다', () => {
    const before = state({ projects: s.projects, work: [work({ id: '1', project: 'pa', due: '2026-07-13' })] })
    const after = state({ projects: s.projects, work: [work({ id: '1', project: 'pa', due: '2026-08-06' })] })
    const m = buildWeekly(before, after, opts())
    expect(m.groups[0]!.rows[0]!.schedule).toBe('7/13 → 8/6')
    expect(m.changes[0]!.body).toContain('7/13 → 8/6')
  })

  it('3장에서 잘린 변화 건수를 각주로 드러냅니다', () => {
    // 조용히 자르면 지연 8건짜리 주가 3건짜리로 보입니다.
    const many = state({
      work: Array.from({ length: 8 }, (_, i) =>
        work({ id: `l${i}`, title: `지연${i}`, status: 'ing', due: '2026-07-01' }),
      ),
    })
    const m = buildWeekly(null, many, opts())
    expect(m.changes).toHaveLength(3)
    expect(m.footnotes.join(' ')).toContain('변화·지연 8건 중 3건 표기')
  })

  it('2장에서 잘린 프로젝트 수도 적습니다', () => {
    const many = state({
      projects: Array.from({ length: 10 }, (_, i) =>
        project({ key: `p${i}`, title: `P${i}`, milestones: [{ name: 'm', done: false }] }),
      ),
    })
    const m = buildWeekly(null, many, opts())
    expect(m.progress).toHaveLength(8)
    expect(m.footnotes.join(' ')).toContain('진척 프로젝트 10개 중 8개 표기')
  })

  it('차주 마감인 미완료만 계획에 담습니다', () => {
    const s2 = state({
      work: [
        work({ id: '1', title: '차주', status: 'ing', due: '2026-08-19' }),
        work({ id: '2', title: '금주', status: 'ing', due: '2026-08-14' }),
        work({ id: '3', title: '차주완료', status: 'done', due: '2026-08-19' }),
      ],
    })
    expect(buildWeekly(null, s2, opts()).plans).toEqual(['차주 (8/19 · Ji)'])
  })
})
