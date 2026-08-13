import { describe, expect, it } from 'vitest'
import {
  buildReport,
  classifyWork,
  countBySeverity,
  countByWorkType,
  deltaLabel,
  fitGroups,
  focusLine,
  lastDayOfMonth,
  incidentsOf,
  monthWindow,
  monthlySeries,
  previousMonthTotal,
  projectProgress,
  rowProgress,
  scheduleLabel,
  selectPlans,
  selectWorkGroups,
  selectWorkRows,
  severityBucket,
  shortDate,
  UNGROUPED_TITLE,
} from '../src/aggregate.ts'
import type {
  DeskProject,
  DeskState,
  DeskWork,
  TicketRow,
  WorkGroup,
} from '../src/types.ts'

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

function incident(over: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 't1',
    title: '장애',
    receivedAt: '2026-08-03',
    workType: 'incident',
    severity: 'critical',
    system: null,
    resolution: null,
    ...over,
  }
}

/** 유지보수 티켓. 등급은 DB 기본값처럼 채워 둡니다 — 그래도 등급 칸에 안 세야 합니다 */
function maintenance(over: Partial<TicketRow> = {}): TicketRow {
  return incident({ title: '유지보수', workType: 'maintenance', severity: 'medium', ...over })
}

describe('기간', () => {
  it('윤년 2월을 29일로 셉니다', () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29)
    expect(lastDayOfMonth(2026, 2)).toBe(28)
  })

  it('월 경계가 타임존에 흔들리지 않습니다', () => {
    expect(monthWindow(2026, 8)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(monthWindow(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('앞자리 0 을 뗀 날짜를 만듭니다', () => {
    expect(shortDate('2026-08-07')).toBe('8/7')
    expect(shortDate(null)).toBeNull()
  })
})

describe('업무 판정 (기획서 6.1)', () => {
  it('완료는 마감일과 무관합니다', () => {
    expect(classifyWork(work({ status: 'done', due: '2026-01-01' }), '2026-08-31')).toBe('done')
  })

  it('마감일이 지났으면 지연입니다', () => {
    expect(classifyWork(work({ due: '2026-07-01' }), '2026-08-31')).toBe('late')
  })

  it('마감일이 없으면 지연으로 몰지 않습니다', () => {
    // desk 실측 38건 중 17건이 마감일 없음이었습니다.
    // 이것들이 지연으로 뜨면 지연 표시 자체가 무의미해집니다.
    expect(classifyWork(work({ due: null }), '2026-08-31')).toBe('ing')
  })
})

describe('일정 표기', () => {
  it('마감일이 없으면 (계획)', () => {
    expect(scheduleLabel(work({ due: null }))).toBe('(계획)')
  })

  it('변경이 없으면 현재 마감일만', () => {
    expect(scheduleLabel(work({ due: '2026-08-06' }), '2026-08-06')).toBe('8/6')
  })

  it('바뀌었으면 이전 → 현재', () => {
    expect(scheduleLabel(work({ due: '2026-08-06' }), '2026-07-13')).toBe('7/13 → 8/6')
  })

  it('이전 스냅샷이 없으면 변경을 지어내지 않습니다', () => {
    expect(scheduleLabel(work({ due: '2026-08-06' }), undefined)).toBe('8/6')
  })
})

describe('진척율', () => {
  it('마일스톤 비율을 반올림합니다', () => {
    expect(projectProgress(project({ milestones: [{ name: 'a', done: true }, { name: 'b', done: false }] }))).toBe(50)
  })

  it('마일스톤이 없으면 null 입니다 (0 이 아닙니다)', () => {
    expect(projectProgress(project({ milestones: [] }))).toBeNull()
    expect(projectProgress(undefined)).toBeNull()
  })

  it('완료는 100%', () => {
    expect(rowProgress(work({ status: 'done' }), 'done')).toBe(100)
  })

  it('미완료 업무 행은 진척율을 비웁니다', () => {
    // work.progress 가 실측 38건 전부 null 이므로 지어낼 근거가 없습니다.
    // 프로젝트 진척율은 묶음 머리행이 보여 줍니다 — 업무 행에 찍으면
    // 프로젝트 수치가 업무 수치처럼 읽힙니다.
    expect(rowProgress(work(), 'ing')).toBeNull()
    expect(rowProgress(work({ project: 'p1' }), 'late')).toBeNull()
  })
})

describe('보고 대상 선정', () => {
  const s = state({
    work: [
      work({ id: 'a', title: '7월완료', status: 'done', completedOn: '2026-07-20' }),
      work({ id: 'b', title: '8월완료', status: 'done', completedOn: '2026-08-03' }),
      work({ id: 'c', title: '진행중', status: 'ing' }),
      work({ id: 'd', title: '지연', status: 'todo', due: '2026-06-30' }),
      work({ id: 'e', title: '손안댐', status: 'todo', due: null }),
    ],
  })

  it('그 달에 완료된 건만 완료로 잡습니다', () => {
    const titles = selectWorkRows(s, 2026, 7).map((r) => r.title)
    expect(titles).toContain('7월완료')
    expect(titles).not.toContain('8월완료')
  })

  it('마감일 없는 todo 는 보고 대상이 아닙니다', () => {
    expect(selectWorkRows(s, 2026, 7).map((r) => r.title)).not.toContain('손안댐')
  })

  it('지연 → 완료 → 진행중 순입니다', () => {
    // 지연이 위인 이유: 지면이 모자라 잘릴 때 먼저 사라지면 안 됩니다.
    // 완료가 진행중보다 위인 이유: 요약 띠에 '완료 N건' 이라고 써 놓고
    // 표에는 완료가 한 건도 없는 보고서가 나왔었습니다.
    expect(selectWorkRows(s, 2026, 7).map((r) => r.chip)).toEqual(['late', 'done', 'ing'])
  })

  it('지면이 한 행뿐이어도 지연이 남습니다', () => {
    expect(selectWorkRows(s, 2026, 7).slice(0, 1)[0]!.chip).toBe('late')
  })
})

describe('프로젝트 묶음', () => {
  const s = state({
    projects: [
      project({ key: 'pa', title: '프로젝트A', milestones: [{ name: 'm', done: true }, { name: 'n', done: false }] }),
      project({ key: 'pb', title: '프로젝트B', milestones: [] }),
      project({ key: 'pc', title: '이번달업무없음' }),
    ],
    work: [
      work({ id: '1', title: 'A1', project: 'pa', status: 'done', completedOn: '2026-08-02' }),
      work({ id: '2', title: 'A2', project: 'pa', status: 'ing' }),
      work({ id: '3', title: 'B1', project: 'pb', status: 'todo', due: '2026-07-01' }),
      work({ id: '4', title: '홀로', project: null, status: 'ing' }),
    ],
  })

  it('업무가 없는 프로젝트는 묶음을 만들지 않습니다', () => {
    expect(selectWorkGroups(s, 2026, 8).map((g) => g.title)).not.toContain('이번달업무없음')
  })

  it('지연이 있는 묶음이 먼저 옵니다', () => {
    expect(selectWorkGroups(s, 2026, 8)[0]!.title).toBe('프로젝트B')
  })

  it('프로젝트 없는 업무는 맨 뒤 미지정으로 모입니다', () => {
    const g = selectWorkGroups(s, 2026, 8)
    expect(g.at(-1)!.title).toBe(UNGROUPED_TITLE)
    expect(g.at(-1)!.rows.map((r) => r.title)).toEqual(['홀로'])
  })

  it('묶음 진척율은 마일스톤에서 나옵니다', () => {
    const a = selectWorkGroups(s, 2026, 8).find((g) => g.title === '프로젝트A')!
    expect(a.progress).toBe(50)
    expect(a.milestones).toEqual({ done: 1, total: 2 })
  })

  it('마일스톤이 없으면 진척율이 null 입니다 (0% 가 아닙니다)', () => {
    const b = selectWorkGroups(s, 2026, 8).find((g) => g.title === '프로젝트B')!
    expect(b.progress).toBeNull()
    expect(b.milestones).toBeNull()
  })

  it('묶음별 상태 건수를 셉니다', () => {
    const a = selectWorkGroups(s, 2026, 8).find((g) => g.title === '프로젝트A')!
    expect(a.counts).toEqual({ done: 1, ing: 1, late: 0 })
  })
})

describe('표 높이 맞추기', () => {
  const g = (title: string, n: number): WorkGroup => ({
    key: title,
    title,
    progress: null,
    milestones: null,
    counts: { done: 0, ing: n, late: 0 },
    rows: Array.from({ length: n }, (_, i) => ({
      title: `${title}-${i}`,
      owner: '—',
      detail: '',
      chip: 'ing' as const,
      progress: null,
      schedule: '(계획)',
    })),
  })

  it('예산 안에 들어가면 그대로 둡니다', () => {
    const r = fitGroups([g('A', 2)], 3.2, 0.24, 0.3)
    expect(r.droppedRows).toBe(0)
    expect(r.groups[0]!.rows).toHaveLength(2)
  })

  it('머리행 높이까지 예산에 넣습니다', () => {
    // 0.24 + 3*0.30 = 1.14. 예산 1.0 이면 2행까지만.
    const r = fitGroups([g('A', 3)], 1.0, 0.24, 0.3)
    expect(r.groups[0]!.rows).toHaveLength(2)
    expect(r.droppedRows).toBe(1)
  })

  it('업무 행보다 머리행을 우선합니다', () => {
    // 머리행 둘(0.48) + 행 하나(0.30) = 0.78.
    // 앞 묶음에 행을 몰아주는 대신 두 프로젝트가 다 보이는 쪽을 고릅니다.
    const r = fitGroups([g('A', 3), g('B', 2)], 0.8, 0.24, 0.3)
    expect(r.groups.map((x) => x.title)).toEqual(['A', 'B'])
    expect(r.droppedGroups).toBe(0)
  })

  it('남는 높이를 묶음에 라운드로빈으로 나눕니다', () => {
    // 앞에서부터 채우면 A 가 2행을 먹고 B 는 0행이 됩니다.
    const r = fitGroups([g('A', 3), g('B', 3)], 1.08, 0.24, 0.3)
    expect(r.groups.map((x) => x.rows.length)).toEqual([1, 1])
  })

  it('머리행조차 안 들어가는 묶음만 통째로 뺍니다', () => {
    const r = fitGroups([g('A', 1), g('B', 1), g('C', 1)], 0.5, 0.24, 0.3)
    expect(r.groups).toHaveLength(2)
    expect(r.droppedGroups).toBe(1)
  })

  it('잘라낸 건수를 정확히 셉니다', () => {
    const r = fitGroups([g('A', 5), g('B', 5)], 3.2, 0.24, 0.3)
    const kept = r.groups.reduce((n, x) => n + x.rows.length, 0)
    expect(kept + r.droppedRows).toBe(10)
  })
})

describe('대분류', () => {
  it('대분류 3종을 각각 셉니다', () => {
    const list = [
      incident(),
      incident({ id: '2' }),
      maintenance({ id: '3' }),
      incident({ id: '4', workType: 'development' }),
    ]
    expect(countByWorkType(list)).toEqual({ incident: 2, maintenance: 1, development: 1 })
  })

  it('대분류를 모르는 티켓을 유지보수로 밀어 넣지 않습니다', () => {
    // DB 기본값이 maintenance 라고 해서 여기서 그렇게 세면,
    // 대시보드에 없던 유지보수 건이 보고서에서 생겨납니다.
    expect(countByWorkType([incident({ workType: null })])).toEqual({
      incident: 0,
      maintenance: 0,
      development: 0,
    })
  })

  it('등급·매우심각 목록의 모수는 장애뿐입니다', () => {
    // 유지보수 티켓도 severity 컬럼이 채워져 있습니다 (DB 기본값 medium).
    // 그것까지 세면 '보통 장애' 가 유지보수 건수만큼 부풀어 오릅니다.
    const list = [incident({ severity: 'medium' }), maintenance({ id: '2' })]
    expect(incidentsOf(list)).toHaveLength(1)
    expect(countBySeverity(incidentsOf(list))).toEqual({ critical: 0, major: 0, normal: 1 })
  })
})

describe('장애 등급', () => {
  it('4등급을 3칸으로 접습니다', () => {
    expect(severityBucket('critical')).toBe('critical')
    expect(severityBucket('high')).toBe('major')
    expect(severityBucket('medium')).toBe('normal')
    expect(severityBucket('low')).toBe('normal')
  })

  it('등급 미지정을 보통으로 둔갑시키지 않습니다', () => {
    expect(severityBucket(null)).toBeNull()
    expect(countBySeverity([incident({ severity: null })])).toEqual({
      critical: 0,
      major: 0,
      normal: 0,
    })
  })
})

describe('월별 추이', () => {
  const list = [
    incident({ id: '1', receivedAt: '2026-07-10' }),
    incident({ id: '2', receivedAt: '2026-08-03' }),
    maintenance({ id: '3', receivedAt: '2026-08-05' }),
  ]

  it('집계 시작 이전 달을 0 으로 채우지 않습니다', () => {
    // "0건" 과 "집계 시작 전" 은 다른 사실입니다.
    const bars = monthlySeries(list, 2026, 8)
    expect(bars.map((b) => b.label)).toEqual(['7월', '8월'])
  })

  it('한 달을 대분류별로 나눠 담습니다', () => {
    expect(monthlySeries(list, 2026, 8).at(-1)).toEqual({
      label: '8월',
      values: { incident: 1, maintenance: 1, development: 0 },
      current: true,
    })
  })

  it('유지보수만 있는 달도 막대를 세웁니다', () => {
    // 장애만 보던 시절에는 이런 달이 통째로 0 으로 보였습니다.
    const only = [maintenance({ id: 'm', receivedAt: '2026-08-04' })]
    expect(monthlySeries(only, 2026, 8)).toHaveLength(1)
    expect(monthlySeries(only, 2026, 8)[0]!.values.maintenance).toBe(1)
  })

  it('최근 7개월만 남깁니다', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      incident({ id: `x${i}`, receivedAt: `2026-${String(i + 1).padStart(2, '0')}-05` }),
    )
    expect(monthlySeries(many, 2026, 12)).toHaveLength(7)
  })

  it('데이터가 없으면 빈 배열입니다', () => {
    expect(monthlySeries([], 2026, 8)).toEqual([])
  })

  it('전월이 집계 시작 이전이면 null 입니다', () => {
    expect(previousMonthTotal(list, 2026, 7)).toBeNull()
    expect(previousMonthTotal(list, 2026, 8)).toBe(1)
  })

  it('전월 건수는 대분류 3종 합입니다', () => {
    const two = [
      incident({ id: '1', receivedAt: '2026-07-10' }),
      maintenance({ id: '2', receivedAt: '2026-07-11' }),
      incident({ id: '3', receivedAt: '2026-08-01' }),
    ]
    expect(previousMonthTotal(two, 2026, 8)).toBe(2)
  })
})

describe('증감 문구', () => {
  it('비교 대상이 없으면 0 건 대비라고 하지 않습니다', () => {
    expect(deltaLabel(3, null)).toBe('전월 비교 없음 (집계 시작 전)')
  })

  it('동일·증가·감소', () => {
    expect(deltaLabel(8, 8)).toBe('전월 8건 대비 △0건 (동일)')
    expect(deltaLabel(10, 8)).toBe('전월 8건 대비 ▲2건')
    expect(deltaLabel(5, 8)).toBe('전월 8건 대비 ▼3건')
  })
})

describe('차월 계획', () => {
  it('다음 달 마감인 미완료 업무만 담습니다', () => {
    const s = state({
      work: [
        work({ id: 'a', title: '다음달', due: '2026-09-10' }),
        work({ id: 'b', title: '이번달', due: '2026-08-10' }),
        work({ id: 'c', title: '다음달완료', status: 'done', due: '2026-09-11' }),
      ],
    })
    expect(selectPlans(s, 2026, 8, 4)).toEqual(['다음달 (9/10)'])
  })

  it('12월의 다음 달은 이듬해 1월입니다', () => {
    const s = state({ work: [work({ id: 'a', title: '내년1월', due: '2027-01-05' })] })
    expect(selectPlans(s, 2026, 12, 4)).toEqual(['내년1월 (1/5)'])
  })
})

describe('중점', () => {
  it('완료가 없으면 지어내지 않습니다', () => {
    expect(focusLine([])).toBe('완료 건 없음')
  })
})

describe('모델 조립', () => {
  const s = state({
    work: [
      work({ id: 'a', title: 'A', status: 'done', completedOn: '2026-08-03' }),
      work({ id: 'b', title: 'B', status: 'ing' }),
      work({ id: 'c', title: 'C', status: 'todo', due: '2026-07-01' }),
    ],
  })

  const opt = {
    year: 2026,
    month: 8,
    author: 'Steven',
    reportedOn: '2026-08-11',
    subtitle: 'WEB',
    team: 'Team',
    table: { budget: 3.2, headerH: 0.24, rowH: 0.3 },
  }

  it('요약 건수는 표에 잘리기 전 전체를 셉니다', () => {
    const m = buildReport(s, [incident()], opt)
    expect(m.summary).toMatchObject({ workTotal: 3, done: 1, ing: 1, late: 1 })
  })

  it('표가 잘리면 그 사실을 각주에 남깁니다', () => {
    // 머리행 0.24 + 1행 0.30 = 0.54 만 허용 → 한 묶음의 한 행만 들어갑니다
    const m = buildReport(s, [], { ...opt, table: { budget: 0.55, headerH: 0.24, rowH: 0.3 } })
    expect(m.groups.flatMap((g) => g.rows)).toHaveLength(1)
    expect(m.footnotes.join(' ')).toContain('안건 3건 중 1건 표기')
  })

  it('티켓이 없으면 그 사실을 각주에 남깁니다', () => {
    const m = buildReport(s, [], opt)
    expect(m.footnotes.join(' ')).toContain('티켓 집계 데이터 없음')
  })

  it('등급 미지정 건수를 각주로 드러냅니다', () => {
    const m = buildReport(s, [incident({ severity: null })], opt)
    expect(m.footnotes.join(' ')).toContain('장애 등급 미지정 1건 제외')
  })

  it('대분류 미상 건수를 각주로 드러냅니다', () => {
    const m = buildReport(s, [incident({ workType: null })], opt)
    expect(m.footnotes.join(' ')).toContain('대분류 미상 1건 제외')
  })

  it('운영 현황에 유지보수·신규개발이 들어갑니다', () => {
    const m = buildReport(
      s,
      [incident(), maintenance({ id: '2' }), incident({ id: '3', workType: 'development' })],
      opt,
    )
    expect(m.operations.counts).toEqual({ incident: 1, maintenance: 1, development: 1 })
    expect(m.operations.total).toBe(3)
    expect(m.summary.ticketCounts).toEqual(m.operations.counts)
  })

  it('추이에서 빠진 신규개발을 각주로 드러냅니다', () => {
    // 막대는 장애·유지보수 둘뿐입니다. 안 적으면 막대 합이 총건수로 읽힙니다.
    const m = buildReport(s, [incident({ id: '1', workType: 'development' })], opt)
    expect(m.footnotes.join(' ')).toContain('추이 막대는 장애·유지보수')
  })

  it('신규개발이 없었던 달에는 그 각주를 달지 않습니다', () => {
    const m = buildReport(s, [incident()], opt)
    expect(m.footnotes.join(' ')).not.toContain('추이 막대는')
  })

  it('보고 기간 라벨이 원본 서식과 같습니다', () => {
    expect(buildReport(s, [], opt).period.label).toBe('2026.08.01 ~ 08.31')
  })
})
