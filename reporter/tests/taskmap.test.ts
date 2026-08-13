import { describe, expect, it } from 'vitest'
import {
  applyTaskMap,
  emptyTaskMap,
  entrySpan,
  mapFootnotes,
  mergedLabel,
  validateTaskMap,
  type TaskMap,
} from '../src/taskmap.ts'
import type { DeskState, DeskWork } from '../src/types.ts'

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

function state(work: DeskWork[]): DeskState {
  return { updatedAt: null, work, projects: [], decisions: [], systems: [], people: [] }
}

function map(entries: TaskMap['entries']): TaskMap {
  return { ...emptyTaskMap(), entries }
}

const THREE = [
  work({ id: 'a', title: '카보너스 분석', status: 'done', completedOn: '2026-08-01', due: '2026-07-30', types: ['plan'] }),
  work({ id: 'b', title: '카보너스 설계', status: 'ing', due: '2026-08-20', types: ['design'] }),
  work({ id: 'c', title: '카보너스 구현', status: 'todo', due: '2026-09-01', types: ['feature'] }),
]

describe('검증', () => {
  it('한 태스크가 두 항목에 걸치면 막습니다', () => {
    // 걸치면 건수가 두 번 세어지고, 보고서 합계가 desk 와 안 맞는데
    // 원인을 찾기가 아주 어렵습니다.
    const bad = map([
      { key: 'e1', members: ['a', 'b'] },
      { key: 'e2', members: ['b'] },
    ])
    expect(validateTaskMap(bad).join(' ')).toContain('두 곳에')
  })

  it('구성원이 없는 항목과 중복 key 를 막습니다', () => {
    expect(validateTaskMap(map([{ key: 'e1', members: [] }])).join(' ')).toContain('구성 태스크가 없는')
    const dup = map([{ key: 'e1', members: ['a'] }, { key: 'e1', members: ['b'] }])
    expect(validateTaskMap(dup).join(' ')).toContain('중복된 항목 key')
  })

  it('올바른 맵은 통과합니다', () => {
    expect(validateTaskMap(map([{ key: 'e1', members: ['a', 'b'] }]))).toEqual([])
  })
})

describe('통합', () => {
  const applied = applyTaskMap(
    state(THREE),
    map([{ key: 'e-carbonus', title: '카보너스 관리자시스템 구축', members: ['a', 'b', 'c'] }]),
  )
  const merged = applied.state.work[0]!

  it('세 태스크가 한 항목이 됩니다', () => {
    expect(applied.state.work).toHaveLength(1)
    expect(merged.title).toBe('카보너스 관리자시스템 구축')
    expect(merged.id).toBe('e-carbonus')
  })

  it('일부만 끝났으면 완료가 아닙니다', () => {
    // 3건 중 1건만 끝났는데 완료로 뜨면 그 보고서는 거짓입니다.
    expect(merged.status).toBe('ing')
    expect(merged.completedOn).toBeNull()
  })

  it('합산 진척율은 완료 구성원 ÷ 전체입니다', () => {
    expect(merged.progress).toBe(33)
    expect(mergedLabel(merged)).toBe('구성 1/3')
  })

  it('전부 끝나야 완료입니다', () => {
    const done = THREE.map((w) => ({ ...w, status: 'done' as const, completedOn: '2026-08-05' }))
    const r = applyTaskMap(state(done), map([{ key: 'e', members: ['a', 'b', 'c'] }]))
    expect(r.state.work[0]!.status).toBe('done')
    expect(r.state.work[0]!.progress).toBe(100)
  })

  it('마감은 남은 것 중 가장 이른 날입니다 — 지연을 감추지 않습니다', () => {
    // 최대 마감일을 쓰면 8/4 에 지난 마감이 8/20 에 가려져 지연이 사라집니다.
    const late = [
      work({ id: 'a', status: 'todo', due: '2026-08-04' }),
      work({ id: 'b', status: 'ing', due: '2026-08-20' }),
    ]
    const r = applyTaskMap(state(late), map([{ key: 'e', members: ['a', 'b'] }]))
    expect(r.state.work[0]!.due).toBe('2026-08-04')
  })

  it('유형은 합집합, 시작은 가장 이른 날입니다', () => {
    expect(merged.types.sort()).toEqual(['design', 'feature', 'plan'])
    const withStart = THREE.map((w, i) => ({ ...w, start: i === 2 ? '2026-07-01' : '2026-08-01' }))
    const r = applyTaskMap(state(withStart), map([{ key: 'e', members: ['a', 'b', 'c'] }]))
    expect(r.state.work[0]!.start).toBe('2026-07-01')
  })

  it('담당자가 여럿이면 대표 + 외 N', () => {
    const two = [work({ id: 'a', owner: 'Alexa' }), work({ id: 'b', owner: 'Jin' })]
    const r = applyTaskMap(state(two), map([{ key: 'e', members: ['a', 'b'] }]))
    expect(r.state.work[0]!.owner).toBe('Alexa 외 1')
  })

  it('구성원이 전부 보류일 때만 항목이 보류입니다', () => {
    const allHold = [work({ id: 'a', status: 'hold' }), work({ id: 'b', status: 'hold' })]
    expect(applyTaskMap(state(allHold), map([{ key: 'e', members: ['a', 'b'] }])).state.work[0]!.status).toBe('hold')

    // 하나라도 굴러가면 그 일은 굴러갑니다
    const some = [work({ id: 'a', status: 'hold' }), work({ id: 'b', status: 'ing' })]
    expect(applyTaskMap(state(some), map([{ key: 'e', members: ['a', 'b'] }])).state.work[0]!.status).toBe('ing')
  })

  it('구성원 프로젝트가 다르면 임의로 고르지 않습니다', () => {
    const mixed = [work({ id: 'a', project: 'p1' }), work({ id: 'b', project: 'p2' })]
    const r = applyTaskMap(state(mixed), map([{ key: 'e', members: ['a', 'b'] }]))
    expect(r.state.work[0]!.project).toBeNull()
  })

  it('구성원 프로젝트가 같으면 물려받습니다', () => {
    const same = [work({ id: 'a', project: 'p1' }), work({ id: 'b', project: 'p1' })]
    const r = applyTaskMap(state(same), map([{ key: 'e', members: ['a', 'b'] }]))
    expect(r.state.work[0]!.project).toBe('p1')
  })
})

describe('항목 기간 (목록 화면)', () => {
  it('가장 이른 시작 ~ 가장 나중 종료입니다', () => {
    const ms = [
      work({ id: 'a', status: 'done', start: '2026-07-29', completedOn: '2026-08-01' }),
      work({ id: 'b', status: 'ing', start: '2026-08-05', due: '2026-08-20' }),
      work({ id: 'c', status: 'todo', start: null, due: '2026-08-11' }),
    ]
    expect(entrySpan(ms)).toMatchObject({ start: '2026-07-29', end: '2026-08-20', endIsActual: false })
  })

  it('가장 나중 날짜가 완료일이면 실제 종료로 표시합니다', () => {
    const ms = [
      work({ id: 'a', status: 'done', completedOn: '2026-08-07' }),
      work({ id: 'b', status: 'done', completedOn: '2026-08-03' }),
    ]
    expect(entrySpan(ms)).toMatchObject({ end: '2026-08-07', endIsActual: true, progress: 100 })
  })

  it('아직 안 끝난 구성원의 마감일이 더 늦으면 예정입니다', () => {
    const ms = [
      work({ id: 'a', status: 'done', completedOn: '2026-08-07' }),
      work({ id: 'b', status: 'ing', due: '2026-08-20' }),
    ]
    expect(entrySpan(ms)).toMatchObject({ end: '2026-08-20', endIsActual: false, progress: 50 })
  })

  it('날짜가 하나도 없으면 null 입니다 (0 이나 오늘로 채우지 않습니다)', () => {
    expect(entrySpan([work({ id: 'a' })])).toMatchObject({ start: null, end: null })
  })

  it('보고서 표의 마감과 다른 값입니다', () => {
    // 표는 지연을 감추지 않으려고 '미완료 중 가장 이른 마감' 을 쓰고,
    // 목록은 '이 일이 언제 끝나는가' 를 보려고 가장 나중 날짜를 씁니다.
    const ms = [
      work({ id: 'a', status: 'todo', due: '2026-08-04' }),
      work({ id: 'b', status: 'ing', due: '2026-08-20' }),
    ]
    const applied = applyTaskMap(state(ms), map([{ key: 'e', members: ['a', 'b'] }]))
    expect(applied.state.work[0]!.due).toBe('2026-08-04')
    expect(entrySpan(ms).end).toBe('2026-08-20')
  })
})

describe('재배정 · 개명', () => {
  it('구성원이 하나면 이름과 프로젝트만 바꿉니다', () => {
    const r = applyTaskMap(
      state([work({ id: 'a', title: '원래 이름', project: null, due: '2026-08-09' })]),
      map([{ key: 'e', title: '보고용 이름', project: 'brs-hk', members: ['a'] }]),
    )
    const w = r.state.work[0]!
    expect(w.title).toBe('보고용 이름')
    expect(w.project).toBe('brs-hk')
    // 통합이 아니므로 합산 진척율 꼬리표가 붙지 않습니다
    expect(mergedLabel(w)).toBeNull()
    expect(w.due).toBe('2026-08-09')
  })

  it('프로젝트를 안 적으면 원래 값을 유지합니다', () => {
    const r = applyTaskMap(
      state([work({ id: 'a', project: 'p1' })]),
      map([{ key: 'e', title: '이름만', members: ['a'] }]),
    )
    expect(r.state.work[0]!.project).toBe('p1')
  })
})

describe('원본 보존과 미분류', () => {
  it('맵에 없는 태스크는 그대로 남습니다', () => {
    const r = applyTaskMap(state(THREE), map([{ key: 'e', members: ['a'] }]))
    expect(r.state.work).toHaveLength(3)
    expect(r.issues.unmapped).toBe(2)
  })

  it('원본 state 를 고치지 않습니다', () => {
    const s = state(THREE)
    applyTaskMap(s, map([{ key: 'e', members: ['a', 'b', 'c'] }]))
    expect(s.work).toHaveLength(3)
    expect(s.work[0]!.title).toBe('카보너스 분석')
  })

  it('빈 맵이면 아무것도 안 바뀝니다', () => {
    const r = applyTaskMap(state(THREE), emptyTaskMap())
    expect(r.state.work).toHaveLength(3)
    expect(r.issues.unmapped).toBe(3)
  })
})

describe('끊어진 참조 · 제외', () => {
  it('없는 태스크를 가리키면 조용히 지우지 않고 알립니다', () => {
    const r = applyTaskMap(state([work({ id: 'a' })]), map([{ key: 'e', members: ['a', '없는id'] }]))
    expect(r.issues.broken).toEqual(['없는id'])
    expect(r.state.work).toHaveLength(1)
  })

  it('구성원이 하나도 안 남은 항목을 드러냅니다', () => {
    const r = applyTaskMap(state([work({ id: 'a' })]), map([{ key: 'e', members: ['사라짐'] }]))
    expect(r.issues.emptied).toEqual(['e'])
  })

  it('제외한 항목은 빠지되 건수가 남습니다', () => {
    const r = applyTaskMap(state(THREE), map([{ key: 'e', members: ['a'], hidden: true }]))
    expect(r.state.work.map((w) => w.id)).toEqual(['b', 'c'])
    expect(r.issues.hidden).toBe(1)
    expect(mapFootnotes(r.issues, true).join(' ')).toContain('수동 제외 1건')
  })
})

describe('각주', () => {
  it('맵을 아직 안 쓰는 동안에는 미분류를 각주로 내지 않습니다', () => {
    const issues = { unmapped: 38, hidden: 0, broken: [], emptied: [] }
    expect(mapFootnotes(issues, false)).toEqual([])
    expect(mapFootnotes(issues, true).join(' ')).toContain('항목 미지정 38건')
  })

  it('끊어진 참조는 맵 사용 여부와 무관하게 알립니다', () => {
    const issues = { unmapped: 0, hidden: 0, broken: ['x'], emptied: [] }
    expect(mapFootnotes(issues, false).join(' ')).toContain('맵핑 끊김 1건')
  })
})
