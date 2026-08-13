import { describe, expect, it } from 'vitest'
import { suggest, titleStem } from '../src/suggest.ts'
import { emptyTaskMap, type TaskMap } from '../src/taskmap.ts'
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

function state(work: DeskWork[], projects: DeskProject[] = []): DeskState {
  return { updatedAt: null, work, projects, decisions: [], systems: [], people: [] }
}

const P = (key: string): DeskProject => ({
  key,
  title: key,
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
})

describe('제목 접두어', () => {
  it('성격 꼬리를 뗍니다', () => {
    expect(titleStem('카보너스 관리자 서비스 분석 및 기획')).toBe('카보너스 관리자 서비스')
    expect(titleStem('카보너스 관리자 서비스 구현')).toBe('카보너스 관리자 서비스')
    expect(titleStem('결제 시스템 운영서버 배포 (재개)')).toBe('결제 시스템 운영서버')
  })

  it('꼬리를 떼고 남은 게 너무 짧으면 접두어로 안 씁니다', () => {
    // '구현' 한 단어짜리 제목들이 전부 한 묶음으로 뭉치는 것을 막습니다
    expect(titleStem('구현')).toBe('')
    expect(titleStem('배포')).toBe('')
  })
})

describe('추천', () => {
  it('한 프로젝트 안에서 성격만 나뉜 것을 찾습니다', () => {
    const s = state(
      [
        work({ id: 'a', title: 'FABB 보너스 설계', project: 'p1', types: ['design'] }),
        work({ id: 'b', title: 'FABB 보너스 구현', project: 'p1', types: ['feature'] }),
      ],
      [P('p1')],
    )
    const [r] = suggest(s, emptyTaskMap())
    expect(r!.memberIds).toEqual(['a', 'b'])
    expect(r!.project).toBe('p1')
    expect(r!.title).toBe('FABB 보너스')
    expect(r!.reason).toContain('성격만 나뉘어')
  })

  it('프로젝트가 없는 묶음도 찾되 프로젝트를 지어내지 않습니다', () => {
    const s = state([
      work({ id: 'a', title: 'PG사 화면 기획' }),
      work({ id: 'b', title: 'PG사 화면 기획 리뷰' }),
    ])
    const [r] = suggest(s, emptyTaskMap())
    expect(r!.project).toBeNull()
    expect(r!.reason).toContain('프로젝트가 없습니다')
  })

  it('프로젝트가 둘 이상 섞이면 어느 쪽인지 정하지 않습니다', () => {
    const s = state(
      [
        work({ id: 'a', title: '결제 연동 설계', project: 'p1' }),
        work({ id: 'b', title: '결제 연동 구현', project: 'p2' }),
      ],
      [P('p1'), P('p2')],
    )
    expect(suggest(s, emptyTaskMap())[0]!.project).toBeNull()
  })

  it('이미 분류한 태스크는 다시 추천하지 않습니다', () => {
    // 매주 같은 제안이 뜨면 사람이 추천 영역 자체를 안 보게 됩니다.
    const s = state([
      work({ id: 'a', title: 'FABB 보너스 설계' }),
      work({ id: 'b', title: 'FABB 보너스 구현' }),
    ])
    const map: TaskMap = { ...emptyTaskMap(), entries: [{ key: 'e', members: ['a', 'b'] }] }
    expect(suggest(s, map)).toEqual([])
  })

  it('한 건짜리는 추천하지 않습니다', () => {
    const s = state([work({ id: 'a', title: 'FABB 보너스 설계' })])
    expect(suggest(s, emptyTaskMap())).toEqual([])
  })

  it('건수가 많은 묶음이 위로 옵니다', () => {
    const s = state([
      work({ id: 'a', title: '가나다 설계' }),
      work({ id: 'b', title: '가나다 구현' }),
      work({ id: 'c', title: '라마바 분석' }),
      work({ id: 'd', title: '라마바 설계' }),
      work({ id: 'e', title: '라마바 구현' }),
    ])
    expect(suggest(s, emptyTaskMap())[0]!.memberIds).toHaveLength(3)
  })
})
