import { describe, expect, it } from 'vitest'

import { buildWeeklyReport } from './build'
import { emptyDiff, groupWork, selectPlans } from './weekly'
import { weekOf } from './week'
import type { DeskProject, DeskState, DeskWork } from './types'

// desk 최종 갱신이 8/28(금), 보고가 8/31(월) 인 실제 상황을 그대로 씁니다.
const AS_OF = '2026-08-31'
/** 8/25(화) ~ 8/31(월) */
const WEEK = weekOf(AS_OF)
/** 9/1(화) ~ 9/7(월) */
const NEXT = weekOf('2026-09-01')

function work(over: Partial<DeskWork> & { id: string }): DeskWork {
  return {
    owner: '김',
    title: over.id,
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

function project(over: Partial<DeskProject> & { key: string }): DeskProject {
  return {
    title: over.key,
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

function state(work: DeskWork[], projects: DeskProject[] = []): DeskState {
  return { updatedAt: '2026-08-28 15:19:53', work, projects, decisions: [], systems: [], people: [] }
}

describe('차주 계획 — 살아 있는 미완료', () => {
  it('마감이 지난 미완료를 먼저 싣고 지연이라고 밝힙니다', () => {
    const s = state([
      work({ id: 'a', title: '차주 마감', due: '2026-09-03' }),
      work({ id: 'b', title: '마감 지남', due: '2026-08-26' }),
    ])
    const { items } = selectPlans(s, NEXT, AS_OF, 10)
    expect(items).toEqual(['마감 지남 (8/26 지연 · 김)', '차주 마감 (9/3 · 김)'])
  })

  it('밀린 것끼리는 오래 밀린 순입니다', () => {
    const s = state([
      work({ id: 'a', title: '덜 밀림', due: '2026-08-28' }),
      work({ id: 'b', title: '더 밀림', due: '2026-08-20' }),
    ])
    expect(selectPlans(s, NEXT, AS_OF, 10).items).toEqual([
      '더 밀림 (8/20 지연 · 김)',
      '덜 밀림 (8/28 지연 · 김)',
    ])
  })

  it('마감이 없는 미완료는 넣지 않습니다 — 차주에 하겠다고 적을 근거가 없습니다', () => {
    const s = state([work({ id: 'a', title: '언제 할지 미정', due: null })])
    expect(selectPlans(s, NEXT, AS_OF, 10)).toEqual({ items: [], total: 0 })
  })

  it('보류는 넣지 않습니다 — 3장 이슈로 갑니다', () => {
    const s = state([work({ id: 'a', title: '보류 건', status: 'hold', due: '2026-08-26' })])
    expect(selectPlans(s, NEXT, AS_OF, 10)).toEqual({ items: [], total: 0 })
  })

  it('완료는 넣지 않습니다', () => {
    const s = state([work({ id: 'a', title: '끝난 것', status: 'done', due: '2026-08-26' })])
    expect(selectPlans(s, NEXT, AS_OF, 10)).toEqual({ items: [], total: 0 })
  })

  it('차주 다음의 마감은 넣지 않습니다 — 아직 차주 계획이 아닙니다', () => {
    const s = state([work({ id: 'a', title: '먼 마감', due: '2026-09-11' })])
    expect(selectPlans(s, NEXT, AS_OF, 10)).toEqual({ items: [], total: 0 })
  })

  it('자른 뒤에도 전체 건수를 그대로 돌려줍니다 — 각주가 몇 건 중 몇 건인지 적습니다', () => {
    const s = state([
      work({ id: 'a', due: '2026-08-20' }),
      work({ id: 'b', due: '2026-08-21' }),
      work({ id: 'c', due: '2026-09-02' }),
    ])
    const { items, total } = selectPlans(s, NEXT, AS_OF, 2)
    expect(items).toHaveLength(2)
    expect(total).toBe(3)
  })

  it('자리를 지연과 차주 마감에 반씩 나눕니다 — 밀린 일만 나열되지 않게', () => {
    const s = state([
      work({ id: 'l1', title: '밀림1', due: '2026-08-20' }),
      work({ id: 'l2', title: '밀림2', due: '2026-08-21' }),
      work({ id: 'l3', title: '밀림3', due: '2026-08-22' }),
      work({ id: 'u1', title: '차주1', due: '2026-09-02' }),
      work({ id: 'u2', title: '차주2', due: '2026-09-03' }),
    ])
    const { items, total } = selectPlans(s, NEXT, AS_OF, 4)
    expect(items).toEqual([
      '밀림1 (8/20 지연 · 김)',
      '밀림2 (8/21 지연 · 김)',
      '차주1 (9/2 · 김)',
      '차주2 (9/3 · 김)',
    ])
    expect(total).toBe(5)
  })

  it('한쪽이 모자라면 남은 자리를 다른 쪽이 채웁니다', () => {
    const s = state([
      work({ id: 'l1', title: '밀림1', due: '2026-08-20' }),
      work({ id: 'u1', title: '차주1', due: '2026-09-02' }),
      work({ id: 'u2', title: '차주2', due: '2026-09-03' }),
      work({ id: 'u3', title: '차주3', due: '2026-09-04' }),
    ])
    expect(selectPlans(s, NEXT, AS_OF, 4).items).toHaveLength(4)
  })

  it('자리가 홀수면 지연 쪽이 한 줄 더 가집니다', () => {
    const s = state([
      work({ id: 'l1', title: '밀림1', due: '2026-08-20' }),
      work({ id: 'l2', title: '밀림2', due: '2026-08-21' }),
      work({ id: 'u1', title: '차주1', due: '2026-09-02' }),
      work({ id: 'u2', title: '차주2', due: '2026-09-03' }),
    ])
    expect(selectPlans(s, NEXT, AS_OF, 3).items).toEqual([
      '밀림1 (8/20 지연 · 김)',
      '밀림2 (8/21 지연 · 김)',
      '차주1 (9/2 · 김)',
    ])
  })

  it('담당자가 없으면 이름 칸을 비웁니다', () => {
    const s = state([work({ id: 'a', title: '주인 없음', owner: null, due: '2026-09-02' })])
    expect(selectPlans(s, NEXT, AS_OF, 10).items).toEqual(['주인 없음 (9/2)'])
  })
})

describe('진행 내용 칸 — desk 가 글을 둔 자리를 순서대로 훑습니다', () => {
  const detailOf = (w: DeskWork, projects: DeskProject[] = []) =>
    groupWork(state([w], projects), emptyDiff(), WEEK, AS_OF).flatMap((g) => g.rows)[0]?.detail

  it('업무 메모가 있으면 그것을 씁니다', () => {
    const w = work({
      id: 'a',
      project: 'p',
      detail: { analysis: '분석', duration: null, improvements: null, testCases: [], checklist: [], notes: '메모' },
    })
    expect(detailOf(w, [project({ key: 'p', current: '프로젝트 상황' })])).toBe('메모')
  })

  it('메모가 없으면 분석 내용으로 떨어집니다', () => {
    const w = work({
      id: 'a',
      project: 'p',
      detail: { analysis: '분석', duration: null, improvements: null, testCases: [], checklist: [], notes: null },
    })
    expect(detailOf(w, [project({ key: 'p', current: '프로젝트 상황' })])).toBe('분석')
  })

  it('업무에 아무 글이 없으면 프로젝트의 현재 상황을 씁니다 — desk 화면과 같은 문구입니다', () => {
    const w = work({ id: 'a', project: 'p' })
    expect(detailOf(w, [project({ key: 'p', current: '구현 진행 중' })])).toBe('구현 진행 중')
  })

  it('빈 문자열은 글이 있는 것으로 치지 않습니다', () => {
    const w = work({
      id: 'a',
      project: 'p',
      detail: { analysis: '', duration: null, improvements: null, testCases: [], checklist: [], notes: '  ' },
    })
    expect(detailOf(w, [project({ key: 'p', current: '구현 진행 중' })])).toBe('구현 진행 중')
  })

  it('넷 다 없으면 비웁니다 — 없는 글을 지어내지 않습니다', () => {
    expect(detailOf(work({ id: 'a', project: 'p' }), [project({ key: 'p' })])).toBe('')
  })

  it('프로젝트가 없는 독립 업무도 빈칸으로 둡니다', () => {
    expect(detailOf(work({ id: 'a' }))).toBe('')
  })

  it('빌려 온 문구는 묶음의 첫 행에만 남깁니다 — 같은 줄이 반복되지 않게', () => {
    const p = [project({ key: 'p', current: '구현 진행 중' })]
    const s = state(
      [
        work({ id: 'a', title: '가', project: 'p' }),
        work({ id: 'b', title: '나', project: 'p' }),
        work({ id: 'c', title: '다', project: 'p' }),
      ],
      p,
    )
    const rows = groupWork(s, emptyDiff(), WEEK, AS_OF).flatMap((g) => g.rows)
    expect(rows.map((r) => r.detail)).toEqual(['구현 진행 중', '', ''])
  })

  it('업무 자신의 글은 반복돼도 지우지 않습니다 — 그 업무의 사실입니다', () => {
    const note = (t: string) => ({
      analysis: null,
      duration: null,
      improvements: null,
      testCases: [],
      checklist: [],
      notes: t,
    })
    const s = state(
      [
        work({ id: 'a', title: '가', project: 'p', detail: note('내 메모') }),
        work({ id: 'b', title: '나', project: 'p', detail: note('내 메모') }),
      ],
      [project({ key: 'p', current: '구현 진행 중' })],
    )
    const rows = groupWork(s, emptyDiff(), WEEK, AS_OF).flatMap((g) => g.rows)
    expect(rows.map((r) => r.detail)).toEqual(['내 메모', '내 메모'])
  })
})

describe('보고서 조립까지 — 나눈 자리가 살아남습니다', () => {
  it('한 장짜리 보고서에도 지연과 차주 마감이 같이 실립니다', () => {
    // 자리를 알기 전에 앞에서부터 자르면 네 줄이 전부 지연으로 찹니다.
    const s = state([
      work({ id: 'l1', title: '밀림1', due: '2026-08-20' }),
      work({ id: 'l2', title: '밀림2', due: '2026-08-21' }),
      work({ id: 'l3', title: '밀림3', due: '2026-08-22' }),
      work({ id: 'l4', title: '밀림4', due: '2026-08-23' }),
      work({ id: 'l5', title: '밀림5', due: '2026-08-24' }),
      work({ id: 'u1', title: '차주1', due: '2026-09-02' }),
      work({ id: 'u2', title: '차주2', due: '2026-09-03' }),
    ])
    const { model } = buildWeeklyReport({
      state: s,
      day: AS_OF,
      base: null,
      baseDay: null,
      entries: [],
      tickets: [],
      weekId: '2026-08-31',
      subtitle: 'SW Development Team',
    })
    expect(model.plans.filter((p) => p.includes('지연'))).toHaveLength(2)
    expect(model.plans.filter((p) => !p.includes('지연'))).toHaveLength(2)
    expect(model.footnotes).toContain('차주 계획 7건 중 4건 표기')
  })

  it('머리글이 desk 최종 갱신일을 그대로 옮깁니다', () => {
    const { model } = buildWeeklyReport({
      state: state([work({ id: 'a' })]),
      day: AS_OF,
      base: null,
      baseDay: null,
      entries: [],
      tickets: [],
      weekId: '2026-08-31',
      subtitle: 'SW Development Team',
    })
    expect(model.deskUpdatedAt).toBe('8/28')
    expect(model.reportedOn).toBe(AS_OF)
  })

  it('desk 갱신 시각을 모르면 비웁니다 — 보고일로 메우지 않습니다', () => {
    const s = { ...state([work({ id: 'a' })]), updatedAt: null }
    const { model } = buildWeeklyReport({
      state: s,
      day: AS_OF,
      base: null,
      baseDay: null,
      entries: [],
      tickets: [],
      weekId: '2026-08-31',
      subtitle: 'SW Development Team',
    })
    expect(model.deskUpdatedAt).toBeNull()
  })
})
