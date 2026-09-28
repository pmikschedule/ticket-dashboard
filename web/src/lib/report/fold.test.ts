import { describe, expect, it } from 'vitest'

import { applyTaskMap } from './apply'
import { buildWeeklyReport } from './build'
import { STANDALONE_RULE, TABLE } from './layout'
import type { DeskProject, DeskState, DeskWork } from './types'
import { addDays, holidaysIn, parseWeekLabel, snapshotsFor, weekOf } from './week'
import {
  emptyDiff,
  foldGroups,
  groupWork,
  latestLog,
  selectPlans,
  tableHeight,
  type WeeklyChip,
  type WeeklyGroup,
  type WeeklyRow,
} from './weekly'

const BOX = { headerH: TABLE.groupH, ruleH: STANDALONE_RULE.h, rowH: TABLE.rowH }
const BUDGET = TABLE.bottom - TABLE.top

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

function project(key: string): DeskProject {
  return {
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
  }
}

function state(w: DeskWork[], projects: DeskProject[] = [], extra: Partial<DeskState> = {}): DeskState {
  return { updatedAt: '2026-09-22 11:42:15', work: w, projects, decisions: [], systems: [], people: [], ...extra }
}

function row(id: string, chip: WeeklyChip, over: Partial<WeeklyRow> = {}): WeeklyRow {
  return { id, title: id, owner: '김', detail: '', chip, progress: null, schedule: '(계획)', dueChangedFrom: null, ...over }
}

function group(key: string, rows: WeeklyRow[], standalone = false): WeeklyGroup {
  const n = (c: WeeklyChip) => rows.filter((r) => r.chip === c).length
  return {
    key,
    title: key,
    standalone,
    continued: false,
    owners: ['김'],
    counts: { done: n('done'), started: n('started'), ing: n('ing'), late: n('late'), added: n('new') },
    milestones: null,
    progress: null,
    rows,
  }
}

const many = (prefix: string, chip: WeeklyChip, n: number) =>
  Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, chip))

/** 행이 담은 업무 수 + 머리행 건수로만 남긴 수 = 원래 업무 수 */
function accounted(groups: WeeklyGroup[], hidden: number): number {
  return groups.flatMap((g) => g.rows).reduce((n, r) => n + (r.members ?? 1), 0) + hidden
}

describe('foldGroups — 자르기 전에 묶습니다', () => {
  // 2026-09-28(추석 주, 직전 주 처리분 포함)의 실제 모양 — 카보너스·Mobile·회원가입·이벤트·개별
  const crowded = () => [
    group('a', [...many('al', 'late', 2), ...many('an', 'new', 1)]),
    group('b', [...many('bl', 'late', 1), ...many('bd', 'done', 4), ...many('bn', 'new', 3), ...many('bi', 'ing', 1)]),
    group('c', [...many('cl', 'late', 1), ...many('cd', 'done', 4)]),
    group('d', [...many('dl', 'late', 1), ...many('dd', 'done', 1)]),
    group('s', many('sl', 'late', 3), true),
  ]

  it('예산 안에 들어가고, 한 건도 소리 없이 빠지지 않습니다', () => {
    const groups = crowded()
    const total = groups.reduce((n, g) => n + g.rows.length, 0)
    const f = foldGroups(groups, BUDGET, BOX)
    expect(tableHeight(f.groups, BOX)).toBeLessThanOrEqual(BUDGET + 1e-9)
    expect(accounted(f.groups, f.hidden)).toBe(total)
  })

  it('지연은 머리행 건수로 숨기지 않습니다', () => {
    const f = foldGroups(crowded(), BUDGET, BOX)
    const lateShown = f.groups.flatMap((g) => g.rows).filter((r) => r.chip === 'late')
    expect(lateShown.reduce((n, r) => n + (r.members ?? 1), 0)).toBe(8)
  })

  it('독립 항목은 머리행이 없어 숨기지 않습니다 — 건수가 남을 자리가 없습니다', () => {
    const groups = [group('a', many('a', 'ing', 12)), group('s', many('s', 'ing', 3), true)]
    const f = foldGroups(groups, BUDGET, BOX)
    expect(f.groups[1]!.rows.reduce((n, r) => n + (r.members ?? 1), 0)).toBe(3)
  })

  it('업무 수가 적은 묶음부터 숨깁니다 — 이름이 안 보이게 되는 업무를 줄입니다', () => {
    // 2026-09-28 실측의 모양. 예전 순서(상태만 보고 신규부터)면 그 주에 새로 생긴
    // 3건이 머리행 숫자로만 남았습니다
    const f = foldGroups(crowded(), BUDGET, BOX)
    const b = f.groups.find((g) => g.key === 'b')!
    expect(b.rows.some((r) => r.chip === 'new')).toBe(true)
    // 한 건짜리 셋(카보너스 신규·Mobile 진행·이벤트 완료)만 머리행 숫자로 남습니다
    expect(f.hidden).toBe(3)
  })

  it('들어가면 건드리지 않습니다', () => {
    const groups = [group('a', many('a', 'done', 3))]
    const f = foldGroups(groups, BUDGET, BOX)
    expect(f.folded).toBe(0)
    expect(f.groups[0]!.rows).toHaveLength(3)
  })

  it('남는 자리가 있으면 지연부터 다시 폅니다', () => {
    // 지연 3 + 진행 12: 진행을 묶으면 자리가 남으니 지연은 한 건씩입니다
    const groups = [group('a', [...many('l', 'late', 3), ...many('i', 'ing', 12)])]
    const f = foldGroups(groups, BUDGET, BOX)
    expect(f.groups[0]!.rows.filter((r) => r.chip === 'late')).toHaveLength(3)
  })

  it('묶음 행은 날짜 폭과 대표 담당자를 적습니다', () => {
    const rows = [
      row('재가입 구현', 'done', { owner: 'Ji', date: '2026-09-16' }),
      row('카카오 가입', 'done', { owner: 'Ji', date: '2026-09-18' }),
      row('도메인 등록', 'done', { owner: 'Sloan', date: '2026-09-20' }),
    ]
    const f = foldGroups([group('m', [...rows, ...many('i', 'ing', 12)])], BUDGET, {
      ...BOX,
      cols: {
        title: { w: TABLE.cols.title.w, sz: TABLE.cols.title.sz, lines: 1 },
        detail: { w: TABLE.cols.detail.w, sz: TABLE.cols.detail.sz, lines: 2 },
      },
    })
    const done = f.groups[0]!.rows.find((r) => r.chip === 'done' && (r.members ?? 1) > 1)
    // 자리가 남아 완료가 다시 펴졌을 수도 있으니, 묶였을 때만 봅니다
    if (done) {
      expect(done.schedule).toBe('9/16~9/20 완료')
      expect(done.owner).toBe('Ji 외 1')
      expect(done.progress).toBe(100)
      expect(done.detail).toBe('3건 묶음')
    }
  })
})

describe('진행사항 — desk 진행 기록(`work.log`)의 가장 최근 것이 먼저입니다', () => {
  const WEEK = weekOf('2026-09-21')

  it('메모보다 날짜 붙은 진행 기록이 이깁니다', () => {
    const w = work({
      id: 'a',
      detail: { analysis: null, duration: null, improvements: null, testCases: [], checklist: [], notes: '8월부터 같은 메모' },
      log: [
        { at: '2026-09-14', body: '지속해서 코드리뷰 중' },
        { at: '2026-09-21', body: '코드리뷰 진행 중 (Sloan)' },
      ],
    })
    const rows = groupWork(state([w]), emptyDiff(), WEEK, '2026-09-21').flatMap((g) => g.rows)
    expect(rows[0]!.detail).toBe('코드리뷰 진행 중 (Sloan)')
  })

  it('스냅샷 시점보다 뒤 날짜의 기록은 건너뜁니다', () => {
    const w = work({ id: 'a', log: [{ at: '2026-09-10', body: '앞' }, { at: '2026-09-30', body: '뒤' }] })
    expect(latestLog(w, '2026-09-21')).toBe('앞')
  })

  it('형식이 다른 기록은 조용히 건너뜁니다', () => {
    const w = work({ id: 'a', log: [null, 'text', { at: '2026-09-01' }, { at: '2026-09-02', body: '  ' }] })
    expect(latestLog(w, '2026-09-21')).toBe('')
  })

  it('통합 항목은 구성원들의 기록을 물려받습니다 — 묶는 순간 진행이 사라지지 않게', () => {
    const s = state([
      work({ id: 'a', log: [{ at: '2026-09-02', body: '앞 구성원' }] }),
      work({ id: 'b', log: [{ at: '2026-09-15', body: '뒤 구성원' }] }),
    ])
    const merged = applyTaskMap(s, { entries: [{ key: 'e', members: ['a', 'b'] }] }).state.work[0]!
    expect(latestLog(merged, '2026-09-21')).toBe('뒤 구성원')
  })
})

describe('일정 칸 — 끝난 일은 언제 끝났는가', () => {
  it('완료 행은 완료일을 적습니다 (desk Weekly Report 와 같은 꼴)', () => {
    const w = work({ id: 'a', status: 'done', due: '2026-09-15', completedOn: '2026-09-18' })
    const rows = groupWork(state([w]), emptyDiff(), weekOf('2026-09-21'), '2026-09-21').flatMap((g) => g.rows)
    expect(rows[0]!.schedule).toBe('9/18 완료')
  })

  it('완료 행의 마감이 바뀌었어도 3장 일정 변경은 마감일로 적습니다', () => {
    const before = state([work({ id: 'a', status: 'ing', due: '2026-09-15' })])
    const after = state([work({ id: 'a', status: 'done', due: '2026-09-18', completedOn: '2026-09-18' })])
    const { model } = buildWeeklyReport({
      state: after,
      day: '2026-09-21',
      base: before,
      baseDay: '2026-09-14',
      entries: [],
      tickets: [],
      weekId: '2026-09-21',
      subtitle: 'SW',
    })
    expect(model.changes[0]).toEqual({ label: 'a', body: '일정 9/15 → 9/18 · 김' })
  })
})

describe('차주 계획 — 금주 마감 중 아직 안 온 것도 싣습니다', () => {
  it('스냅샷과 차주 사이 마감이 사라지지 않습니다 (9/21 스냅샷 · 9/22~9/28 마감 9건이 빠졌습니다)', () => {
    const s = state([
      work({ id: 'x', title: '금주 마감', due: '2026-09-25' }),
      work({ id: 'y', title: '차주 마감', due: '2026-10-02' }),
    ])
    const { items } = selectPlans(s, weekOf('2026-09-29'), '2026-09-21', 10)
    expect(items).toEqual(['금주 마감 (9/25 · 김)', '차주 마감 (10/2 · 김)'])
  })
})

describe('금주 처리 없음 — 비교 기준을 한 주씩 앞당깁니다', () => {
  // 추석 주. 9/14 → 9/21 사이에 두 건이 끝났고 9/21 → 9/28 사이에는 아무것도 안 끝났습니다
  const p = [project('p')]
  const s914 = state([work({ id: 'a', project: 'p' }), work({ id: 'b', project: 'p' }), work({ id: 'c', project: 'p' })], p)
  const s921 = state(
    [
      work({ id: 'a', project: 'p', status: 'done', completedOn: '2026-09-16' }),
      work({ id: 'b', project: 'p', status: 'done', completedOn: '2026-09-18' }),
      work({ id: 'c', project: 'p' }),
    ],
    p,
  )
  const s928 = {
    ...s921,
    work: [...s921.work, work({ id: 'd', project: 'p', title: '연휴 뒤 새 일' })],
    holidays: [{ date: '2026-09-24', until: '2026-09-25', name: '추석 연휴' }],
  }
  const build = (earlier: { day: string; state: DeskState }[]) =>
    buildWeeklyReport({
      state: s928,
      day: '2026-09-28',
      base: s921,
      baseDay: '2026-09-21',
      earlier,
      reportedOn: '2026-09-28',
      entries: [],
      tickets: [],
      weekId: '2026-09-28',
      subtitle: 'SW',
    }).model

  it('직전 주 처리분을 담고, 담았다는 사실과 까닭을 남깁니다', () => {
    const m = build([{ day: '2026-09-14', state: s914 }])
    expect(m.baseline).toBe('2026-09-14')
    expect(m.summary.done).toBe(2)
    expect(m.widened).toEqual({ from: '2026-09-15', range: '9/15(화) ~ 9/28(월)', reason: '추석 연휴(9/24~9/25)' })
    // 금주에 새로 생긴 일도 그대로 남습니다
    expect(m.pages.flat().flatMap((g) => g.rows).some((r) => r.title === '연휴 뒤 새 일')).toBe(true)
  })

  it('금주에 끝난 일이 있으면 당기지 않습니다', () => {
    const m = buildWeeklyReport({
      state: s921,
      day: '2026-09-21',
      base: s914,
      baseDay: '2026-09-14',
      earlier: [{ day: '2026-09-01', state: s914 }],
      entries: [],
      tickets: [],
      weekId: '2026-09-21',
      subtitle: 'SW',
    }).model
    expect(m.widened).toBeNull()
    expect(m.baseline).toBe('2026-09-14')
  })

  it('당겨도 완료가 없으면 원래 기준으로 둡니다 — 없는 것을 합쳐 봐야 표만 흐려집니다', () => {
    const m = build([{ day: '2026-09-14', state: s921 }])
    expect(m.widened).toBeNull()
    expect(m.baseline).toBe('2026-09-21')
  })

  it('앞선 스냅샷을 안 주면 당기지 않습니다', () => {
    expect(build([]).widened).toBeNull()
  })

  it('휴일이 없으면 까닭을 지어내지 않습니다', () => {
    const m = buildWeeklyReport({
      state: { ...s928, holidays: [] },
      day: '2026-09-28',
      base: s921,
      baseDay: '2026-09-21',
      earlier: [{ day: '2026-09-14', state: s914 }],
      entries: [],
      tickets: [],
      weekId: '2026-09-28',
      subtitle: 'SW',
    }).model
    expect(m.widened?.reason).toBeNull()
  })
})

describe('보고일과 지연 기준일은 다릅니다', () => {
  it('보고일은 만든 날, 지연은 스냅샷 날로 잽니다', () => {
    const m = buildWeeklyReport({
      state: state([work({ id: 'a', due: '2026-09-18' }), work({ id: 'b', due: '2026-09-25' })]),
      day: '2026-09-21',
      base: null,
      baseDay: null,
      reportedOn: '2026-09-28',
      entries: [],
      tickets: [],
      weekId: '2026-09-21',
      subtitle: 'SW',
    }).model
    expect(m.reportedOn).toBe('2026-09-28')
    expect(m.asOf).toBe('2026-09-21')
    const chips = Object.fromEntries(m.pages.flat().flatMap((g) => g.rows).map((r) => [r.id, r.chip]))
    expect(chips).toEqual({ a: 'late', b: 'ing' })
  })
})

describe('snapshotsFor — 구간마다 그 구간을 닫는 스냅샷', () => {
  const DAYS = ['2026-09-01', '2026-09-14', '2026-09-15', '2026-09-21', '2026-09-28']

  it('그 구간 안 마지막 스냅샷과, 구간 시작 전 마지막 스냅샷', () => {
    const plan = snapshotsFor(DAYS, parseWeekLabel('2026-09-28')!)
    expect(plan).toEqual({ current: '2026-09-28', base: '2026-09-21', earlier: ['2026-09-14', '2026-09-01'] })
  })

  it('구간 안에 스냅샷이 없으면 만들 수 없습니다 — 앞 스냅샷을 자기와 비교하게 됩니다', () => {
    // 2026-09-28 오전의 실제 상황: 최신이 9/21 인데 9/22~9/28 을 만들었더니 기준도 9/21
    const plan = snapshotsFor(['2026-09-14', '2026-09-15', '2026-09-21'], parseWeekLabel('2026-09-28')!)
    expect(plan.current).toBeNull()
  })

  it('지난 구간은 그 구간의 스냅샷으로 만듭니다 — 최신으로 만들면 뒤에 끝난 일이 섞입니다', () => {
    const plan = snapshotsFor(DAYS, parseWeekLabel('2026-09-21')!)
    expect(plan.current).toBe('2026-09-21')
    expect(plan.base).toBe('2026-09-14')
  })

  it('기준은 늘 현재보다 앞입니다', () => {
    for (const id of ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']) {
      const plan = snapshotsFor(DAYS, parseWeekLabel(id)!)
      if (plan.current && plan.base) expect(plan.base < plan.current).toBe(true)
    }
  })

  it('스캔을 거른 주가 있으면 같은 스냅샷을 두 번 내놓지 않습니다', () => {
    const plan = snapshotsFor(['2026-09-01', '2026-09-21', '2026-09-28'], parseWeekLabel('2026-09-28')!)
    expect(plan.earlier).toEqual(['2026-09-01'])
  })
})

describe('날짜 도우미', () => {
  it('addDays 는 달을 넘깁니다', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('holidaysIn 은 구간에 걸친 휴일만', () => {
    const h = [
      { date: '2026-09-24', until: '2026-09-25', name: '추석 연휴' },
      { date: '2026-10-09', name: '한글날' },
    ]
    expect(holidaysIn(h, weekOf('2026-09-28'))).toBe('추석 연휴(9/24~9/25)')
    expect(holidaysIn(h, weekOf('2026-10-12'))).toBe('한글날(10/9)')
    expect(holidaysIn(h, weekOf('2026-09-21'))).toBe('')
  })
})
