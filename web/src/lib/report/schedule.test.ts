import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WORKDAYS,
  holidaySet,
  inProgressBySchedule,
  isWorkday,
  progressOf,
  scheduleWindow,
  workdaysBefore,
  workdaysBetween,
} from './schedule'
import { emptyDiff, groupWork, progressNote, type WorkDiff } from './weekly'
import { weekOf } from './week'
import type { DeskProject, DeskState, DeskWork } from './types'

/**
 * 2026-11-23(월) 실제 상황 — 11/20 desk 에 등록한 BRS HK 7건은 진행 기록이 비어 있고,
 * 넷은 시작일도 없습니다. 보고일 11/23 이 마감(11/24·11/27·12/4) 전이므로 전부
 * 진행 중으로 적고, 진척률은 작업일 기성고로 냅니다.
 */
const REF = '2026-11-23'
const NONE = holidaySet([])

describe('작업일 — 주말과 desk 휴일을 뺍니다', () => {
  it('토·일은 작업일이 아닙니다', () => {
    expect(isWorkday('2026-11-23', NONE)).toBe(true) // 월
    expect(isWorkday('2026-11-21', NONE)).toBe(false) // 토
    expect(isWorkday('2026-11-22', NONE)).toBe(false) // 일
  })

  it('desk 휴일(구간)을 뺍니다 — 추석 9/24~9/25', () => {
    const hol = holidaySet([{ date: '2026-09-24', until: '2026-09-25', name: '추석 연휴' }])
    expect(hol.has('2026-09-24') && hol.has('2026-09-25')).toBe(true)
    // 9/21(월) ~ 9/25(금) 다섯 날 중 둘이 휴일
    expect(workdaysBetween('2026-09-21', '2026-09-25', hol)).toBe(3)
  })

  it('하루짜리 휴일은 until 이 없어도 됩니다', () => {
    expect(holidaySet([{ date: '2026-10-09', name: '한글날' }]).has('2026-10-09')).toBe(true)
  })

  it('양끝을 포함해 셉니다 · 거꾸로면 0', () => {
    expect(workdaysBetween('2026-11-17', '2026-11-27', NONE)).toBe(9)
    expect(workdaysBetween('2026-11-28', '2026-11-27', NONE)).toBe(0)
  })

  it(`마감일 포함 ${DEFAULT_WORKDAYS}작업일 전 — 11/27(금) → 11/16(월), 12/4(금) → 11/23(월)`, () => {
    expect(workdaysBefore('2026-11-27', 10, NONE)).toBe('2026-11-16')
    expect(workdaysBefore('2026-12-04', 10, NONE)).toBe('2026-11-23')
  })

  it('마감이 주말이면 그 앞 작업일부터 셉니다', () => {
    // 11/28(토) 마감 → 11/27(금)부터 10일
    expect(workdaysBefore('2026-11-28', 10, NONE)).toBe('2026-11-16')
  })

  it('휴일이 끼면 그만큼 더 앞에서 시작합니다', () => {
    const hol = holidaySet([{ date: '2026-09-24', until: '2026-09-25', name: '추석' }])
    // 9/30(수) 마감 10작업일: 30·29·28 · (24·25 휴일) 23·22·21 · 18·17·16·15 → 9/15
    expect(workdaysBefore('2026-09-30', 10, hol)).toBe('2026-09-15')
    // 휴일이 없으면 9/17 부터입니다
    expect(workdaysBefore('2026-09-30', 10, NONE)).toBe('2026-09-17')
  })
})

describe('일정 창과 기성고 — 11/23 BRS HK 7건', () => {
  it('부분지급 처리 · 프로세스 트래커(HK): 입력 시작 11/17 · 마감 11/27 → 남은 4 / 9 → 56%', () => {
    const w = scheduleWindow({ start: '2026-11-17', due: '2026-11-27' }, REF, NONE)
    expect(w).toMatchObject({ kind: 'within', source: 'input', start: '2026-11-17', total: 9, remaining: 4, percent: 56 })
  })

  it('환율 처리: 입력 시작 11/17 · 마감 11/24 → 남은 1 / 6 → 83%', () => {
    const w = scheduleWindow({ start: '2026-11-17', due: '2026-11-24' }, REF, NONE)
    expect(w).toMatchObject({ kind: 'within', total: 6, remaining: 1, percent: 83 })
  })

  it('뱅크코드 DB화: 시작 없음 · 마감 11/27 → 11/16 부터 10일 · 남은 4 → 60%', () => {
    const w = scheduleWindow({ start: null, due: '2026-11-27' }, REF, NONE)
    expect(w).toMatchObject({ kind: 'within', source: 'estimated', start: '2026-11-16', total: 10, remaining: 4, percent: 60 })
  })

  it('전체 플로우 체크 ×3: 시작 없음 · 마감 12/4 → 11/23 부터 · 남은 9 → 10%', () => {
    const w = scheduleWindow({ start: null, due: '2026-12-04' }, REF, NONE)
    expect(w).toMatchObject({ kind: 'within', source: 'estimated', start: '2026-11-23', remaining: 9, percent: 10 })
  })
})

describe('일정 창 — 경계', () => {
  it('마감이 없으면 판단하지 않습니다 (상태는 desk 그대로, 진척률 없음)', () => {
    expect(scheduleWindow({ start: '2026-11-17', due: null }, REF, NONE)).toEqual({ kind: 'none', reason: 'no-due' })
  })

  it('입력한 시작이 마감보다 늦으면 계산하지 않습니다 — 입력값을 추정으로 덮지 않습니다', () => {
    expect(scheduleWindow({ start: '2026-12-10', due: '2026-12-04' }, REF, NONE)).toEqual({
      kind: 'none',
      reason: 'start-after-due',
    })
  })

  it('시작 전이면 before — 진척률은 0% 가 아니라 없음', () => {
    const w = scheduleWindow({ start: '2026-11-25', due: '2026-12-04' }, REF, NONE)
    expect(w.kind).toBe('before')
    expect(w.kind !== 'none' && w.percent).toBeNull()
  })

  it('마감이 지났으면 after — 계산하면 100% 지만 끝나지 않은 일이라 없음', () => {
    const w = scheduleWindow({ start: '2026-11-10', due: '2026-11-20' }, REF, NONE)
    expect(w.kind).toBe('after')
    expect(w.kind !== 'none' && w.percent).toBeNull()
  })

  it('마감 당일은 창 안 · 100%', () => {
    const w = scheduleWindow({ start: '2026-11-17', due: REF }, REF, NONE)
    expect(w).toMatchObject({ kind: 'within', remaining: 0, percent: 100 })
  })

  it('시작 당일이 주말이면 지난 작업일이 없어 0%', () => {
    // 11/21(토) 시작 · 11/27(금) 마감 · 기준일 11/21
    const w = scheduleWindow({ start: '2026-11-21', due: '2026-11-27' }, '2026-11-21', NONE)
    expect(w).toMatchObject({ kind: 'within', total: 5, remaining: 5, percent: 0 })
  })

  it('입력 시작일이 등록일보다 먼저입니다', () => {
    const w = scheduleWindow({ start: '2026-11-17', due: '2026-11-27' }, REF, NONE, '2026-11-20')
    expect(w).toMatchObject({ source: 'input', start: '2026-11-17' })
  })

  it('시작일이 없으면 등록일부터 셉니다 — 11/20 등록 · 11/27 마감 → 남은 4 / 6 → 33%', () => {
    const w = scheduleWindow({ start: null, due: '2026-11-27' }, REF, NONE, '2026-11-20')
    expect(w).toMatchObject({ source: 'registered', start: '2026-11-20', total: 6, remaining: 4, percent: 33 })
  })

  it('등록일이 마감보다 늦으면 버리고 10작업일 추정으로 갑니다', () => {
    const w = scheduleWindow({ start: null, due: '2026-11-27' }, REF, NONE, '2026-11-30')
    expect(w).toMatchObject({ source: 'estimated', start: '2026-11-16' })
  })

  it('등록일~마감 사이에 작업일이 없어도(주말) 10작업일 추정으로 갑니다', () => {
    const w = scheduleWindow({ start: null, due: '2026-11-22' }, '2026-11-21', NONE, '2026-11-21')
    expect(w).toMatchObject({ source: 'estimated' })
  })
})

describe('진척률 — 사용자 입력값은 계산이 덮지 않습니다', () => {
  const within = scheduleWindow({ start: null, due: '2026-11-27' }, REF, NONE)
  const after = scheduleWindow({ start: '2026-11-10', due: '2026-11-20' }, REF, NONE)
  const before = scheduleWindow({ start: '2026-11-25', due: '2026-12-04' }, REF, NONE)

  it('완료는 100%', () => {
    expect(progressOf({ progress: null }, true, within)).toEqual({ value: 100, estimated: false })
  })

  it('입력 30% 는 마감이 지났어도 30%', () => {
    expect(progressOf({ progress: 30 }, false, after)).toEqual({ value: 30, estimated: false })
  })

  it('입력 30% 는 일정 추정(60%)을 이깁니다', () => {
    expect(progressOf({ progress: 30 }, false, within)).toEqual({ value: 30, estimated: false })
  })

  it('입력 0% 도 값입니다 — 비어 있는 것과 다릅니다', () => {
    expect(progressOf({ progress: 0 }, false, within)).toEqual({ value: 0, estimated: false })
  })

  it('입력이 비었고 창 안이면 추정', () => {
    expect(progressOf({ progress: null }, false, within)).toEqual({ value: 60, estimated: true })
  })

  it('입력이 비었고 시작 전·마감 뒤·마감 없음이면 비웁니다', () => {
    expect(progressOf({ progress: null }, false, before).value).toBeNull()
    expect(progressOf({ progress: null }, false, after).value).toBeNull()
    expect(progressOf({ progress: null }, false, { kind: 'none', reason: 'no-due' }).value).toBeNull()
  })
})

describe('진행 판정 — 시작일 ≤ 보고일 ≤ 마감일', () => {
  const within = scheduleWindow({ start: null, due: '2026-11-27' }, REF, NONE)
  it('대기여도 창 안이면 진행', () => {
    expect(inProgressBySchedule({ status: 'todo' }, within)).toBe(true)
  })
  it('완료·보류는 바꾸지 않습니다', () => {
    expect(inProgressBySchedule({ status: 'done' }, within)).toBe(false)
    expect(inProgressBySchedule({ status: 'hold' }, within)).toBe(false)
  })
  it('마감 없음은 desk 상태 그대로', () => {
    expect(inProgressBySchedule({ status: 'todo' }, { kind: 'none', reason: 'no-due' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 주간 표에서 — 칩 · 진척율 칸 · 진행사항 칸
// ---------------------------------------------------------------------------

function work(over: Partial<DeskWork> & { id: string }): DeskWork {
  return {
    owner: 'Jayce',
    title: over.id,
    project: 'brs-hk',
    system: null,
    parent: null,
    status: 'todo',
    start: null,
    due: null,
    completedOn: null,
    progress: null,
    types: [],
    detail: {} as DeskWork['detail'],
    assessment: null,
    log: [],
    ...over,
  }
}

const BRS: DeskProject = {
  key: 'brs-hk',
  title: '글로벌 BRS — 홍콩',
  codename: null,
  parent: null,
  system: null,
  systems: null,
  overview: null,
  memo: null,
  assessment: null,
  current: '구현 진행 중 · 배포 병행',
  policy: null,
  milestones: null,
  participants: null,
  start: null,
  due: null,
}

function state(list: DeskWork[]): DeskState {
  return { updatedAt: '2026-11-20 14:28:34', work: list, projects: [BRS], decisions: [], systems: [], people: [] }
}

const WEEK = weekOf(REF) // 11/17(화) ~ 11/23(월)

function rows(list: DeskWork[], d: WorkDiff = emptyDiff(), asOf = REF, ref = REF) {
  return groupWork(state(list), d, WEEK, asOf, true, ref).flatMap((g) => g.rows)
}

describe('주간 표 — 일정 창 안의 일', () => {
  it('대기·기록 없음·시작 없음이어도 표에 싣고 진행중 · 약 60%', () => {
    const [r] = rows([work({ id: 'w-brshk-bankcode-db', due: '2026-11-27' })])
    expect(r).toMatchObject({ chip: 'ing', progress: 60, estimated: true, detail: '진행 중 · 진척률 약 60%' })
  })

  it('이번 주에 새로 생긴 일도 창 안이면 신규가 아니라 진행중입니다', () => {
    const d = emptyDiff()
    d.added.add('w-brshk-flowtest-jin')
    const [r] = rows([work({ id: 'w-brshk-flowtest-jin', due: '2026-12-04' })], d)
    expect(r).toMatchObject({ chip: 'ing', progress: 10 })
  })

  it('창 밖(마감 없음)의 새 일은 그대로 신규입니다', () => {
    const d = emptyDiff()
    d.added.add('x')
    const [r] = rows([work({ id: 'x', due: null })], d)
    expect(r?.chip).toBe('new')
    expect(r?.progress).toBeNull()
  })

  it('시작 전인 대기 업무는 여전히 표에 안 싣습니다 — 손도 안 댄 백로그입니다', () => {
    expect(rows([work({ id: 'later', start: '2026-11-30', due: '2026-12-11' })])).toHaveLength(0)
  })

  it('입력 진척률이 있으면 약 없이 그 값', () => {
    const [r] = rows([work({ id: 'p', status: 'ing', start: '2026-11-17', due: '2026-11-27', progress: 30 })])
    expect(r).toMatchObject({ chip: 'ing', progress: 30, detail: '진행 중 · 진척률 30%' })
    expect(r?.estimated).toBeUndefined()
  })

  it('마감이 지난 일은 지연이 먼저 · 입력 진척률은 그대로', () => {
    const [r] = rows([work({ id: 'late', status: 'ing', start: '2026-11-10', due: '2026-11-20', progress: 30 })])
    expect(r).toMatchObject({ chip: 'late', progress: 30, detail: '지연 · 진척률 30%' })
  })

  it('마감이 지났고 입력이 없으면 진척률을 비웁니다 (100% 로 찍지 않습니다)', () => {
    const [r] = rows([work({ id: 'late2', status: 'ing', start: '2026-11-10', due: '2026-11-20' })])
    expect(r).toMatchObject({ chip: 'late', progress: null })
  })

  it('진행 기록이 있으면 기록이 먼저 — 메모는 칸에 들어갈 때만 덧붙입니다', () => {
    const [r] = rows([
      work({ id: 'log', status: 'ing', start: '2026-11-17', due: '2026-11-27', log: [{ at: '2026-11-21', body: '환율 API 연동' }] }),
    ])
    expect(r?.detail).toBe('환율 API 연동')
    expect(r?.appendNote).toBe('진행 중 · 진척률 약 56%')
  })

  it('옛 수집본(11/17)으로 11/23 에 만들면 그 사이 마감(11/20)은 지연도 진행 창도 아닙니다', () => {
    // 지연은 스냅샷 날(asOf) 기준, 진행 창은 보고일(ref) 기준 — 둘이 어긋나는 자리
    const [r] = rows([work({ id: 'gap', status: 'ing', start: '2026-11-10', due: '2026-11-20' })], emptyDiff(), '2026-11-17', REF)
    expect(r?.chip).toBe('ing')
    expect(r?.progress).toBeNull()
  })
})

describe('progressNote', () => {
  it('완료·진척률 없음은 빈 문자열', () => {
    expect(progressNote('done', { value: 100, estimated: false })).toBe('')
    expect(progressNote('ing', { value: null, estimated: false })).toBe('')
  })
})

describe('묶음 행 — 진척 메모는 범위로 모읍니다', () => {
  it('진행 기록 없는 BRS HK 7건이 한 행으로 묶이면 진행사항은 진척률 약 10~83%', async () => {
    const { foldGroups } = await import('./weekly')
    const list = [
      work({ id: 'a', status: 'ing', start: '2026-11-17', due: '2026-11-24' }),
      work({ id: 'b', start: null, due: '2026-11-27' }),
      work({ id: 'c', start: null, due: '2026-12-04' }),
    ]
    const groups = groupWork(state(list), emptyDiff(), WEEK, REF, true, REF)
    const g = groups[0]!
    expect(g.rows.map((r) => r.progress)).toEqual([83, 60, 10])
    // 머리행 + 한 행만 들어가는 높이 — 세 건이 한 행으로 묶입니다
    const folded = foldGroups([g], 0.2 + 0.26, { headerH: 0.2, ruleH: 0, rowH: 0.26 })
    const row = folded.groups[0]!.rows.find((r) => (r.members ?? 1) > 1)
    expect(row?.detail).toBe('진척률 약 10~83%')
  })
})
