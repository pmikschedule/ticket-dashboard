import { describe, expect, it } from 'vitest'
import {
  buildWorkList,
  summarizeByOwner,
  typeLabel,
  ETC_TITLE,
  NO_OWNER,
} from '../src/worklist.ts'
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

const ASOF = '2026-08-11'

describe('묶기', () => {
  const s = state({
    projects: [project({ key: 'pa', title: 'A' }), project({ key: 'pb', title: 'B' })],
    work: [
      work({ id: '1', project: 'pa' }),
      work({ id: '2', project: 'pa' }),
      work({ id: '3', project: 'pb' }),
      work({ id: '4', project: null }),
      work({ id: '5', project: '없는키' }),
    ],
  })

  it('한 건도 빠뜨리지 않습니다', () => {
    const total = buildWorkList(s, ASOF).reduce((n, g) => n + g.rows.length, 0)
    expect(total).toBe(5)
  })

  it('프로젝트가 없거나 키가 깨진 업무는 기타로 갑니다', () => {
    const etc = buildWorkList(s, ASOF).find((g) => g.title === ETC_TITLE)!
    expect(etc.rows).toHaveLength(2)
  })

  it('기타는 항상 맨 뒤입니다', () => {
    expect(buildWorkList(s, ASOF).at(-1)!.title).toBe(ETC_TITLE)
  })

  it('업무가 없는 프로젝트도 남깁니다 (보고서와 다른 점)', () => {
    // pptx 는 빈 프로젝트를 지우지만 이건 전수 목록입니다.
    // "등록된 업무 0건" 도 알아야 하는 사실입니다.
    const s2 = state({ projects: [project({ key: 'pz', title: 'Z' })], work: [] })
    const g = buildWorkList(s2, ASOF).find((x) => x.title === 'Z')!
    expect(g.rows).toHaveLength(0)
    expect(g.owners).toEqual([])
  })

  it('마일스톤이 없으면 null 입니다 (0/0 이 아닙니다)', () => {
    const g = buildWorkList(s, ASOF).find((x) => x.title === 'A')!
    expect(g.milestones).toBeNull()
  })
})

describe('사람 붙이기', () => {
  it('담당자가 비면 이름을 지어내지 않고 미지정으로 둡니다', () => {
    const s = state({ work: [work({ owner: null }), work({ id: '2', owner: '  ' })] })
    const etc = buildWorkList(s, ASOF)[0]!
    expect(etc.rows.every((r) => r.owner === NO_OWNER)).toBe(true)
  })

  it('미지정은 사람 이름 사이에 섞이지 않고 맨 뒤에 옵니다', () => {
    const s = state({
      work: [work({ id: '1', owner: null }), work({ id: '2', owner: 'Jin' }), work({ id: '3', owner: 'Alexa' })],
    })
    expect(buildWorkList(s, ASOF)[0]!.owners).toEqual(['Alexa', 'Jin', NO_OWNER])
  })

  it('한 사람이 여러 프로젝트에 걸쳐 있어도 한 줄로 합칩니다', () => {
    const s = state({
      projects: [project({ key: 'pa', title: 'A' }), project({ key: 'pb', title: 'B' })],
      work: [
        work({ id: '1', owner: 'Jayce', project: 'pa' }),
        work({ id: '2', owner: 'Jayce', project: 'pb' }),
        work({ id: '3', owner: 'Jayce', project: null }),
      ],
    })
    const [jayce] = summarizeByOwner(buildWorkList(s, ASOF))
    expect(jayce!.total).toBe(3)
    expect(jayce!.projects).toEqual(['A', 'B', ETC_TITLE])
  })
})

describe('상태·지연', () => {
  it('마감일이 지난 미완료만 지연입니다', () => {
    const s = state({
      work: [
        work({ id: '1', status: 'todo', due: '2026-07-01' }),
        work({ id: '2', status: 'ing', due: '2026-09-01' }),
        work({ id: '3', status: 'todo', due: null }),
        work({ id: '4', status: 'done', due: '2026-07-01' }),
      ],
    })
    const rows = buildWorkList(s, ASOF)[0]!.rows
    expect(rows.filter((r) => r.late).map((r) => r.status)).toEqual(['대기'])
  })

  it('완료는 마감일이 지났어도 지연이 아닙니다', () => {
    const s = state({ work: [work({ status: 'done', due: '2026-01-01' })] })
    expect(buildWorkList(s, ASOF)[0]!.rows[0]!.late).toBe(false)
  })

  it('지연은 상태 건수와 별개 축입니다', () => {
    // 완료+진행중+대기 = 전체이고, 지연은 그중 일부에 붙는 표시입니다.
    const s = state({
      work: [
        work({ id: '1', status: 'todo', due: '2026-07-01' }),
        work({ id: '2', status: 'ing', due: '2026-07-01' }),
        work({ id: '3', status: 'done', completedOn: '2026-08-01' }),
      ],
    })
    const g = buildWorkList(s, ASOF)[0]!
    expect(g.counts.done + g.counts.ing + g.counts.todo).toBe(g.rows.length)
    expect(g.counts.late).toBe(2)
  })

  it('같은 사람 안에서 지연이 맨 위로 옵니다', () => {
    const s = state({
      work: [
        work({ id: '1', title: '완료', status: 'done', completedOn: '2026-08-01' }),
        work({ id: '2', title: '지연', status: 'ing', due: '2026-07-01' }),
      ],
    })
    expect(buildWorkList(s, ASOF)[0]!.rows.map((r) => r.title)).toEqual(['지연', '완료'])
  })
})

describe('진척율', () => {
  it('프로젝트 진척율은 마일스톤 기준입니다', () => {
    const s = state({
      projects: [
        project({
          key: 'pa',
          title: 'A',
          milestones: [
            { name: 'm1', done: true },
            { name: 'm2', done: true },
            { name: 'm3', done: false },
            { name: 'm4', done: false },
          ],
        }),
      ],
      work: [work({ project: 'pa' })],
    })
    expect(buildWorkList(s, ASOF)[0]!.progress).toBe(50)
  })

  it('업무 건수로 프로젝트 진척율을 지어내지 않습니다', () => {
    // 4건 중 2건 완료가 '프로젝트 50%' 라는 뜻은 아닙니다.
    const s = state({
      projects: [project({ key: 'pa', title: 'A', milestones: [] })],
      work: [
        work({ id: '1', project: 'pa', status: 'done', completedOn: '2026-08-01' }),
        work({ id: '2', project: 'pa', status: 'ing' }),
      ],
    })
    const g = buildWorkList(s, ASOF)[0]!
    expect(g.progress).toBeNull()
    expect(g.milestones).toBeNull()
  })

  it('기타는 프로젝트가 아니므로 진척율이 없습니다', () => {
    const s = state({ work: [work({ project: null })] })
    expect(buildWorkList(s, ASOF)[0]!.progress).toBeNull()
  })

  it('완료 업무는 100%, 값이 없는 미완료는 빈 칸입니다', () => {
    const s = state({
      work: [
        work({ id: '1', status: 'done', completedOn: '2026-08-01' }),
        work({ id: '2', status: 'ing', progress: null }),
      ],
    })
    const rows = buildWorkList(s, ASOF)[0]!.rows
    expect(rows.find((r) => r.status === '완료')!.progress).toBe(100)
    expect(rows.find((r) => r.status === '진행중')!.progress).toBeNull()
  })

  it('desk 에 값이 있으면 그대로 씁니다', () => {
    const s = state({ work: [work({ status: 'ing', progress: 40 })] })
    expect(buildWorkList(s, ASOF)[0]!.rows[0]!.progress).toBe(40)
  })

  it('미완료 업무 행에 소속 프로젝트 진척율을 대신 찍지 않습니다', () => {
    // 프로젝트 수치가 업무 수치처럼 읽힙니다 — pptx 에서 한 번 겪은 문제입니다.
    const s = state({
      projects: [project({ key: 'pa', title: 'A', milestones: [{ name: 'm', done: true }] })],
      work: [work({ project: 'pa', status: 'ing' })],
    })
    const g = buildWorkList(s, ASOF)[0]!
    expect(g.progress).toBe(100)
    expect(g.rows[0]!.progress).toBeNull()
  })

  it('완료율은 완료 ÷ 전체이고 업무가 있는 사람만 계산합니다', () => {
    const s = state({
      work: [
        work({ id: '1', owner: 'Jin', status: 'done', completedOn: '2026-08-01' }),
        work({ id: '2', owner: 'Jin', status: 'ing' }),
        work({ id: '3', owner: 'Jin', status: 'todo' }),
        work({ id: '4', owner: 'Sloan', status: 'ing' }),
      ],
    })
    const owners = summarizeByOwner(buildWorkList(s, ASOF))
    expect(owners.find((o) => o.owner === 'Jin')!.doneRate).toBe(33)
    expect(owners.find((o) => o.owner === 'Sloan')!.doneRate).toBe(0)
  })
})

describe('본문', () => {
  it('진행 내용이 없으면 제목을 베끼지 않고 비웁니다', () => {
    const s = state({ work: [work({ detail: null, assessment: null })] })
    expect(buildWorkList(s, ASOF)[0]!.rows[0]!.detail).toBe('')
  })

  it('모르는 유형은 원문 그대로 둡니다', () => {
    expect(typeLabel(['analysis', 'plan'])).toBe('분석·기획')
    expect(typeLabel(['newtype'])).toBe('newtype')
    expect(typeLabel(null)).toBe('')
  })
})
