import { describe, expect, it } from 'vitest'
import { fitRail, projectRails, railWidth, textWidth, type RailChip } from '../src/milestones.ts'
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

const MS = (...names: [string, boolean][]) => names.map(([name, done]) => ({ name, done }))

describe('레일 만들기', () => {
  const s = state({
    projects: [
      project({ key: 'a', title: 'A', milestones: MS(['설계', true], ['구현', false], ['배포', false]), due: '2026-08-31' }),
      project({ key: 'b', title: 'B', milestones: [] }),
      project({ key: 'c', title: 'C', milestones: MS(['분석', false]), hold: true }),
    ],
    work: [
      work({ id: '1', project: 'a', status: 'ing', due: '2026-08-20' }),
      work({ id: '2', project: 'a', status: 'todo', due: '2026-07-29' }),
      work({ id: '3', project: 'a', status: 'done', due: '2026-07-01' }),
    ],
  })

  it('마일스톤 없는 프로젝트는 그리지 않습니다', () => {
    expect(projectRails(s).map((r) => r.key)).toEqual(['a', 'c'])
  })

  it('보류 프로젝트는 맨 뒤로 갑니다 (desk 화면과 같은 순서)', () => {
    expect(projectRails(s).at(-1)!.hold).toBe(true)
  })

  it('첫 미완료가 현재 칩입니다', () => {
    const chips = projectRails(s)[0]!.chips
    expect(chips.map((c) => c.current)).toEqual([false, true, false])
  })

  it('현재 칩의 날짜는 미완료 업무의 가장 이른 마감입니다', () => {
    // 완료된 업무(7/1)는 세지 않습니다 — 이미 끝난 일의 마감은 앞으로의 일정이 아닙니다
    expect(projectRails(s)[0]!.chips[1]!.date).toBe('7/29')
  })

  it('미완료 업무에 마감이 없으면 날짜를 지어내지 않습니다', () => {
    const none = state({
      projects: [project({ key: 'a', milestones: MS(['구현', false]) })],
      work: [work({ id: '1', project: 'a', status: 'ing', due: null })],
    })
    expect(projectRails(none)[0]!.chips[0]!.date).toBeNull()
  })

  it('진행 개수와 목표일을 그대로 옮깁니다', () => {
    const r = projectRails(s)[0]!
    expect(r).toMatchObject({ done: 1, total: 3, due: '2026-08-31' })
  })

  it('전부 완료면 현재 칩이 없습니다', () => {
    const all = state({ projects: [project({ key: 'a', milestones: MS(['설계', true], ['배포', true]) })] })
    expect(projectRails(all)[0]!.chips.some((c) => c.current)).toBe(false)
  })
})

describe('레일 폭 맞추기', () => {
  const M = { padX: 0.07, gap: 0.11, sizes: [7.5, 7.0, 6.5, 6.0] } as const
  const chip = (name: string, done: boolean, current = false): RailChip => ({
    name,
    done,
    current,
    date: null,
  })

  it('한글이 라틴 문자보다 넓습니다', () => {
    expect(textWidth('가나다', 7)).toBeGreaterThan(textWidth('abc', 7))
  })

  it('들어가면 글자를 안 줄입니다', () => {
    const r = fitRail([chip('설계', true), chip('구현', false, true)], 8, M)
    expect(r.sz).toBe(7.5)
    expect(r.collapsed).toBe(0)
  })

  it('넘치면 글자부터 줄입니다', () => {
    const chips = Array.from({ length: 6 }, (_, i) => chip(`마일스톤이름${i}`, i < 2))
    const wide = railWidth(chips, 7.5, M)
    const r = fitRail(chips, wide - 0.3, M)
    expect(r.sz).toBeLessThan(7.5)
  })

  it('그래도 넘치면 완료분을 접습니다', () => {
    const chips = [
      chip('아주아주긴마일스톤이름하나', true),
      chip('아주아주긴마일스톤이름둘', true),
      chip('아주아주긴마일스톤이름셋', true),
      chip('현재단계', false, true),
      chip('다음단계', false),
    ]
    const r = fitRail(chips, 3.0, M)
    expect(r.collapsed).toBeGreaterThan(0)
    expect(r.chips[0]!.summary).toBe(true)
    expect(r.chips[0]!.name).toMatch(/^✓\d+$/)
  })

  it('현재 칩과 그 뒤는 절대 접지 않습니다', () => {
    // '어디까지 왔고 다음이 무엇인가' 가 이 장의 본문입니다
    const chips = [
      chip('완료하나', true),
      chip('완료둘', true),
      chip('현재단계', false, true),
      chip('다음단계', false),
    ]
    const r = fitRail(chips, 0.5, M)
    expect(r.chips.filter((c) => !c.summary).map((c) => c.name)).toEqual(['현재단계', '다음단계'])
  })

  it('완료가 하나뿐이면 접을 게 없어 그대로 둡니다', () => {
    const chips = [chip('완료', true), chip('현재', false, true)]
    const r = fitRail(chips, 0.3, M)
    expect(r.collapsed).toBe(0)
    expect(r.chips).toHaveLength(2)
  })
})
