import { describe, expect, it } from 'vitest'

import { buildWeeklyReport } from './build'
import {
  BODY_BOTTOM,
  ISSUES,
  ISSUES_COMPACT,
  ISSUES_PAGE,
  PLANS,
  PLANS_COMPACT,
  PLANS_PAGE,
  SECTION,
  SLIDE,
  STANDALONE_RULE,
  TABLE,
  TABLE_CONT,
  TABLE_FIT,
} from './layout'
import type { DeskState, DeskWork } from './types'
import { fitTable, paginateGroups, tableHeight, type WeeklyGroup, type WeeklyRow } from './weekly'

function row(i: number): WeeklyRow {
  return {
    id: `w${i}`,
    title: `업무 ${i}`,
    owner: '김',
    detail: '',
    chip: 'ing',
    progress: null,
    schedule: '(계획)',
    dueChangedFrom: null,
  }
}

function group(key: string, rows: number, standalone = false): WeeklyGroup {
  return {
    key,
    title: key,
    standalone,
    continued: false,
    owners: ['김'],
    counts: { done: 0, started: 0, ing: rows, late: 0, added: 0 },
    milestones: null,
    progress: null,
    rows: Array.from({ length: rows }, (_, i) => row(i)),
  }
}

const BOX = { headerH: TABLE.groupH, ruleH: STANDALONE_RULE.h, rowH: TABLE.rowH }

const LAYOUTS = [
  { mode: 'base' as const, budget: TABLE.bottom - TABLE.top, maxChanges: ISSUES.max, maxPlans: PLANS.max },
  { mode: 'compact' as const, budget: TABLE_FIT.compactBottom - TABLE.top, maxChanges: 2, maxPlans: 2 },
  { mode: 'spill' as const, budget: TABLE_FIT.fullBottom - TABLE.top, maxChanges: 9, maxPlans: 6 },
]

const OPT = {
  layouts: LAYOUTS,
  contBudget: TABLE_CONT.bottom - TABLE_CONT.top,
  ...BOX,
  maxPages: TABLE_FIT.maxPages,
}

describe('tableHeight', () => {
  it('머리행과 업무 행의 높이가 다릅니다', () => {
    expect(tableHeight([group('a', 2)], BOX)).toBeCloseTo(TABLE.groupH + 2 * TABLE.rowH, 6)
  })

  it('독립 항목 묶음은 머리행 대신 구분선', () => {
    expect(tableHeight([group('a', 1, true)], BOX)).toBeCloseTo(STANDALONE_RULE.h + TABLE.rowH, 6)
  })
})

describe('fitTable', () => {
  it('원래 자리에 들어가면 그대로 둡니다', () => {
    const fit = fitTable([group('a', 4)], OPT)
    expect(fit.mode).toBe('base')
    expect(fit.pages).toHaveLength(1)
    expect(fit.maxChanges).toBe(ISSUES.max)
  })

  it('조금 넘치면 3·4장을 압축하고 **행은 그대로 다 싣습니다**', () => {
    // 실측 재현: 프로젝트 5 + 개별 업무 1묶음 + 업무 8건 = 3.24 인치 (원래 예산 3.20)
    const groups = [
      group('p1', 1),
      group('p2', 2),
      group('p3', 1),
      group('p4', 2),
      group('p5', 1),
      group('개별 업무', 1, true),
    ]
    expect(tableHeight(groups, BOX)).toBeGreaterThan(TABLE.bottom - TABLE.top)

    const fit = fitTable(groups, OPT)
    expect(fit.mode).toBe('compact')
    expect(fit.pages).toHaveLength(1)
    expect(fit.pages[0]!.reduce((n, g) => n + g.rows.length, 0)).toBe(8)
  })

  it('압축이 이슈를 지운다면 압축하지 않고 다음 장으로 내립니다', () => {
    const groups = [group('p1', 1), group('p2', 2), group('p3', 1), group('p4', 2), group('p5', 1), group('개별', 1, true)]
    // 표만 보면 compact 로 들어가지만, 이슈 5건은 compact 의 두 줄에 안 들어갑니다
    expect(fitTable(groups, OPT, { changes: 5, plans: 0 }).mode).toBe('spill')
    expect(fitTable(groups, OPT, { changes: 2, plans: 2 }).mode).toBe('compact')
  })

  it('원래 자리에 들어가면 이슈가 많아도 구성을 바꾸지 않습니다', () => {
    // base 에서 이슈가 넘치는 것은 표와 상관없는 일입니다 (예전 그대로 각주에 적습니다)
    expect(fitTable([group('a', 4)], OPT, { changes: 9, plans: 9 }).mode).toBe('base')
  })

  it('압축으로도 모자라면 3·4장을 다음 장으로 내립니다', () => {
    const fit = fitTable([group('p', 17)], OPT)
    expect(fit.mode).toBe('spill')
    expect(fit.pages).toHaveLength(1)
    // 자리를 옮긴 것이지 줄인 것이 아닙니다 — 3장에 오히려 더 실립니다
    expect(fit.maxChanges).toBeGreaterThan(ISSUES.max)
  })

  it('그래도 넘치면 장을 잇고, 한 행도 버리지 않습니다', () => {
    const fit = fitTable([group('p', 60)], OPT)
    expect(fit.mode).toBe('spill')
    expect(fit.pages.length).toBeGreaterThan(1)
    expect(fit.pages.reduce((n, p) => n + p.reduce((k, g) => k + g.rows.length, 0), 0)).toBe(60)
  })
})

describe('paginateGroups', () => {
  const box = { first: 1.0, cont: 1.0, ...BOX, maxPages: 10 }

  it('묶음이 잘리면 뒷장에 머리행을 다시 세웁니다', () => {
    const pages = paginateGroups([group('p', 8)], box)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0]![0]!.continued).toBe(false)
    expect(pages[1]![0]!.continued).toBe(true)
    expect(pages[1]![0]!.title).toBe('p')
  })

  it('어느 장도 예산을 넘지 않습니다', () => {
    const pages = paginateGroups([group('a', 5), group('b', 7), group('c', 3, true)], box)
    for (const page of pages) expect(tableHeight(page, BOX)).toBeLessThanOrEqual(1.0 + 1e-9)
  })

  it('머리행만 남고 행이 없는 장 끝을 만들지 않습니다', () => {
    const pages = paginateGroups([group('a', 3), group('b', 3), group('c', 3)], box)
    for (const page of pages) for (const g of page) expect(g.rows.length).toBeGreaterThan(0)
  })

  it('장 수 상한에서 멈춥니다 (무한히 늘리지 않습니다)', () => {
    const pages = paginateGroups([group('p', 500)], { ...box, maxPages: 3 })
    expect(pages).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// 통합 — 화면이 부르는 그 경로로 확인합니다
// ---------------------------------------------------------------------------

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

function state(count: number): DeskState {
  return {
    updatedAt: '2026-08-13',
    work: Array.from({ length: count }, (_, i) => work({ id: `w${i}`, title: `업무 ${i}` })),
    projects: [],
    decisions: [],
    systems: [],
    people: [],
  }
}

describe('buildWeeklyReport — 진행 현황은 목록에 있는 것을 다 싣습니다', () => {
  const base = {
    day: '2026-08-13',
    base: null,
    baseDay: null,
    entries: [],
    tickets: [],
    weekId: '2026-08-10',
    subtitle: 'SW Development Team',
  }

  it('예전 같으면 잘렸을 건수도 각주에 "N건 중 M건" 이 안 붙습니다', () => {
    const out = buildWeeklyReport({ ...base, state: state(20) })
    const shown = out.model.pages.reduce((n, p) => n + p.reduce((k, g) => k + g.rows.length, 0), 0)
    expect(shown).toBe(20)
    expect(out.model.footnotes.some((f) => /업무 \d+건 중/.test(f))).toBe(false)
  })

  it('장이 늘어나면 몇 장에 나눠 실었는지 밝힙니다', () => {
    const out = buildWeeklyReport({ ...base, state: state(40) })
    expect(out.model.pages.length).toBeGreaterThan(1)
    expect(out.model.footnotes.some((f) => f.includes('나눠 실었습니다'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 좌표 — 새 자리들이 서로 겹치거나 슬라이드를 넘지 않는지
// ---------------------------------------------------------------------------

/** 장 제목이 실제로 차지하는 아래끝 (막대는 y 부터, 글자는 조금 위에서 시작합니다) */
function sectionBottom(pos: { y: number }): number {
  return pos.y - SECTION.tick.dy + SECTION.label.h
}

function listBottom(box: { firstY: number; gap: number; text: { h: number } }, n: number): number {
  return box.firstY + (n - 1) * box.gap + box.text.h
}

describe('배치 좌표', () => {
  it('압축 배치 — 표 바닥과 3·4장 제목이 겹치지 않습니다', () => {
    expect(TABLE_FIT.compactBottom).toBeLessThanOrEqual(ISSUES_COMPACT.section.y - SECTION.tick.dy)
    expect(ISSUES_COMPACT.section.y).toBe(PLANS_COMPACT.section.y)
  })

  it('압축 배치 — 항목이 패널 안에 있고 패널이 꼬리말 위에 있습니다', () => {
    for (const box of [ISSUES_COMPACT, PLANS_COMPACT]) {
      expect(sectionBottom(box.section)).toBeLessThanOrEqual(box.panel.y)
      expect(listBottom(box, box.max)).toBeLessThanOrEqual(box.panel.y + box.panel.h)
      expect(box.panel.y + box.panel.h).toBeLessThanOrEqual(BODY_BOTTOM)
    }
  })

  it('내려보낸 배치 — 표가 슬라이드 아래 여백을 침범하지 않습니다', () => {
    expect(TABLE_FIT.fullBottom).toBeLessThanOrEqual(BODY_BOTTOM)
    expect(TABLE_CONT.bottom).toBeLessThanOrEqual(BODY_BOTTOM)
  })

  it('전용 장 — 두 절이 겹치지 않고 슬라이드 안에 들어갑니다', () => {
    expect(listBottom(ISSUES_PAGE, ISSUES_PAGE.max)).toBeLessThanOrEqual(
      ISSUES_PAGE.panel.y + ISSUES_PAGE.panel.h,
    )
    expect(ISSUES_PAGE.panel.y + ISSUES_PAGE.panel.h).toBeLessThanOrEqual(
      sectionBottom(PLANS_PAGE.section) - SECTION.label.h,
    )
    expect(sectionBottom(PLANS_PAGE.section)).toBeLessThanOrEqual(PLANS_PAGE.panel.y)
    expect(listBottom(PLANS_PAGE, PLANS_PAGE.max)).toBeLessThanOrEqual(PLANS_PAGE.panel.y + PLANS_PAGE.panel.h)
    expect(PLANS_PAGE.panel.y + PLANS_PAGE.panel.h).toBeLessThanOrEqual(SLIDE.h)
  })

  it('전용 장은 1장보다 더 싣습니다 (옮긴 것이지 줄인 것이 아닙니다)', () => {
    expect(ISSUES_PAGE.max).toBeGreaterThan(ISSUES.max)
    expect(PLANS_PAGE.max).toBeGreaterThan(PLANS.max)
  })

  it('이어지는 장 — 표 머리글과 첫 행이 1장과 같은 간격입니다', () => {
    expect(TABLE_CONT.top - TABLE_CONT.headY).toBeCloseTo(TABLE.top - TABLE.headY, 6)
    expect(TABLE_CONT.title.y + TABLE_CONT.title.h).toBeLessThanOrEqual(TABLE_CONT.headY)
    expect(TABLE_CONT.bottom).toBeLessThanOrEqual(SLIDE.h)
  })
})

// ---------------------------------------------------------------------------
// 표 칸 — 행 안에 들어가는가, 서로 겹치지 않는가
// ---------------------------------------------------------------------------

describe('표 칸 좌표', () => {
  it('업무 행의 요소가 행 높이를 넘지 않습니다 (마지막 행 마감선이 깨지던 원인)', () => {
    const c = TABLE.cols
    expect(c.progress.dy + c.progress.h).toBeLessThanOrEqual(TABLE.rowH)
    expect(c.bar.dy + c.bar.h).toBeLessThanOrEqual(TABLE.rowH)
    expect((TABLE.rowH - c.status.h) / 2 + c.status.h).toBeLessThanOrEqual(TABLE.rowH)
  })

  it('묶음 머리행의 요소도 머리행 높이를 넘지 않습니다', () => {
    const g = TABLE.group
    expect(g.accent.dy + g.accent.h).toBeLessThanOrEqual(TABLE.groupH)
    expect(g.progress.dy + g.progress.h).toBeLessThanOrEqual(TABLE.groupH)
    expect(g.bar.dy + g.bar.h).toBeLessThanOrEqual(TABLE.groupH)
  })

  it('왼쪽 네 칸이 겹치지 않고 상태 칩 앞에서 끝납니다', () => {
    const c = TABLE.cols
    expect(c.title.x + c.title.w).toBeLessThanOrEqual(c.owner.x)
    expect(c.owner.x + c.owner.w).toBeLessThanOrEqual(c.detail.x)
    expect(c.detail.x + c.detail.w).toBeLessThanOrEqual(c.status.x)
    expect(TABLE.group.title.x + TABLE.group.title.w).toBeLessThanOrEqual(TABLE.group.counts.x)
    expect(TABLE.group.counts.x + TABLE.group.counts.w).toBeLessThanOrEqual(c.status.x)
  })

  it('머리글 칸이 본문 칸과 같은 순서로 늘어섭니다', () => {
    const heads = TABLE.headCells
    for (let i = 1; i < heads.length; i += 1) {
      expect(heads[i - 1]!.x + heads[i - 1]!.w).toBeLessThanOrEqual(heads[i]!.x)
    }
    expect(heads.at(-1)!.x + heads.at(-1)!.w).toBeLessThanOrEqual(TABLE.x + TABLE.w)
  })

  it('진행사항 칸은 여덟 글자 폭입니다 (7.3pt 한글 한 글자 ≒ 0.101인치)', () => {
    const head = TABLE.headCells.find((h) => h.label === '진행사항')
    expect(head).toBeDefined()
    expect(TABLE.cols.detail.w).toBeLessThanOrEqual(8 * 0.101 + 0.1)
  })
})
