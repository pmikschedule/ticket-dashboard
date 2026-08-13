/**
 * 주간 업무 보고 pptx — 월간과 **같은 좌표계**에 주간 모델을 얹습니다.
 *
 * 서식을 새로 만들지 않은 이유는, 좌표가 원본에서 실측한 값이고 슬라이드 경계·칸
 * 겹침을 검사하는 테스트가 이미 그 위에 서 있기 때문입니다. 바뀌는 것은 내용과
 * 2장(운영 현황 → 주간 진척)뿐입니다.
 *
 * 여기서는 **계산하지 않습니다.** 건수·변화·진척은 `weekly.ts` 가 끝낸 값입니다.
 */

import PptxGenJS from 'pptxgenjs'
import {
  C,
  FOOT,
  HEAD,
  ISSUES,
  PLANS,
  SECTION_POS,
  SLIDE,
  STANDALONE_RULE,
  RAIL,
  RAIL_CHIP,
  SUMMARY,
  TABLE,
  WEEKLY_CHIP,
  WEEKLY_PROGRESS,
} from './layout'
import { defineSlideSize, hline, R, rect, round, sectionTitle as drawSectionTitle, text, type Slide } from './draw'
import type { ProgressRow, WeeklyGroup, WeeklyModel, WeeklyRow } from './weekly'
import { chipWidth, fitRail, type ProjectRail, type RailChip } from './milestones'

function sectionTitle(s: Slide, pos: { x: number; y: number; w: number }, label: string) {
  drawSectionTitle(s, pos, label, C.NAVY)
}

function renderHeader(s: Slide, m: WeeklyModel) {
  text(s, '주간 업무 보고', { ...HEAD.title, color: C.NAVY, bold: true })
  text(s, m.subtitle, { ...HEAD.subtitle, color: C.MUTED })

  round(s, HEAD.metaBox.x, HEAD.metaBox.y, HEAD.metaBox.w, HEAD.metaBox.h, C.PANEL)
  text(
    s,
    [
      { text: '보고주차  ', options: { bold: true, color: C.NAVY } },
      { text: `${m.period.label} (${m.period.range})   `, options: { color: C.INK } },
      { text: '작성자  ', options: { bold: true, color: C.NAVY } },
      { text: `${m.author}   `, options: { color: C.INK } },
      { text: '보고일  ', options: { bold: true, color: C.NAVY } },
      { text: m.reportedOn, options: { color: C.INK } },
    ],
    { ...HEAD.metaText, sz: HEAD.metaText.sz, color: C.INK, align: 'center' },
  )
}

/**
 * 요약 띠.
 *
 * 비교 대상이 없는 주에는 **완료·착수·신규 숫자를 내세우지 않습니다.** 지난주
 * 스냅샷이 없으면 그 셋은 '변화' 가 아니라 '모름' 이고, 0 으로 보이면 그 주에
 * 아무 일도 없었다는 뜻이 됩니다.
 */
function renderSummary(s: Slide, m: WeeklyModel) {
  const b = SUMMARY.band
  round(s, b.x, b.y, b.w, b.h, C.BAND)

  const { done, started, ing, late, added } = m.summary
  const body = m.baseline
    ? `금주 완료 ${done} · 착수 ${started} · 신규 ${added} · 진행 ${ing} · 지연 ${late}          `
    : `진행 ${ing} · 지연 ${late} · 완료(금주) ${done}          `

  text(
    s,
    [
      {
        text: 'WEEKLY SUMMARY   ',
        options: { bold: true, color: C.NAVY, fontSize: SUMMARY.text.labelSz },
      },
      { text: body, options: { color: C.INK } },
      { text: '기준  ', options: { bold: true, color: C.NAVY } },
      {
        text: m.baseline ? `지난주 스냅샷 ${m.baseline} 대비` : '기준 주차 — 비교 대상 없음',
        options: { color: m.baseline ? C.INK : C.RED },
      },
    ],
    { ...SUMMARY.text, sz: SUMMARY.text.bodySz, color: C.INK },
  )
}

/** 1장 — 프로젝트 → 하위 태스크. 프로젝트 없는 업무는 아래에 독립 항목으로 */
function renderTable(s: Slide, m: WeeklyModel) {
  sectionTitle(s, SECTION_POS.s1, '1. 금주 진행 현황 (프로젝트 · 담당자)')

  rect(s, TABLE.x, TABLE.headY, TABLE.w, TABLE.headH, C.NAVY)
  for (const c of TABLE.headCells) {
    text(s, c.label, {
      x: c.x,
      y: TABLE.headY,
      w: c.w,
      h: TABLE.headH,
      sz: TABLE.headSz,
      color: C.WHITE,
      bold: true,
      align: c.align as 'left' | 'center',
    })
  }

  let y = TABLE.top

  if (m.groups.length === 0) {
    rect(s, TABLE.x, y, TABLE.w, TABLE.rowH, C.WHITE)
    text(s, '이번 주에 진행된 업무가 없습니다', {
      x: TABLE.cols.title.x,
      y,
      w: TABLE.w - 0.14,
      h: TABLE.rowH,
      sz: TABLE.cols.title.sz,
      color: C.MUTED,
    })
    y += TABLE.rowH
  }

  for (const g of m.groups) {
    if (g.standalone) {
      renderStandaloneRule(s, y)
      y += STANDALONE_RULE.h
    } else {
      renderGroupHeader(s, g, y)
      y += TABLE.groupH
    }

    g.rows.forEach((row, i) => {
      renderRow(s, row, y, i % 2 === 1, g.standalone)
      y += TABLE.rowH

      const next = g.rows[i + 1]
      const boundary = next !== undefined && next.chip !== row.chip
      hline(
        s,
        TABLE.x,
        y,
        TABLE.w,
        boundary ? TABLE.groupRule.color : C.RULE,
        boundary ? TABLE.groupRule.pt : 0.75,
      )
    })
  }

  hline(s, TABLE.x, y, TABLE.w, C.NAVY, 1.25)
}

/** 프로젝트 머리행 — 이름 · 금주 변화 · 마일스톤 진척율 */
function renderGroupHeader(s: Slide, g: WeeklyGroup, y: number) {
  const t = TABLE.group
  const h = TABLE.groupH
  rect(s, TABLE.x, y, TABLE.w, h, t.fill)
  rect(s, TABLE.x + 0.07, y + t.accent.dy, t.accent.w, t.accent.h, C.NAVY)

  text(s, g.title, { x: t.title.x, y, w: t.title.w, h, sz: t.title.sz, color: C.NAVY, bold: true })

  // 머리행 건수는 **자르기 전 전체**입니다. 행이 접혀도 몇 건이었는지는 남습니다.
  const parts: string[] = []
  if (g.counts.late > 0) parts.push(`지연 ${g.counts.late}`)
  if (g.counts.done > 0) parts.push(`완료 ${g.counts.done}`)
  if (g.counts.started > 0) parts.push(`착수 ${g.counts.started}`)
  if (g.counts.added > 0) parts.push(`신규 ${g.counts.added}`)
  if (g.counts.ing > 0) parts.push(`진행 ${g.counts.ing}`)
  text(s, parts.join(' · '), {
    x: t.counts.x,
    y,
    w: t.counts.w,
    h,
    sz: t.counts.sz,
    color: C.MUTED,
  })

  if (g.progress !== null && g.milestones) {
    text(s, `${g.progress}%`, {
      x: t.progress.x,
      y: y + t.progress.dy,
      w: t.progress.w,
      h: t.progress.h,
      sz: t.progress.sz,
      color: C.NAVY,
      bold: true,
      align: 'center',
    })
    round(s, t.bar.x, y + t.bar.dy, t.bar.w, t.bar.h, C.RULE)
    if (g.progress > 0) {
      round(s, t.bar.x, y + t.bar.dy, (t.bar.w * g.progress) / 100, t.bar.h, C.NAVY)
    }
    text(s, `마일스톤 ${g.milestones.done}/${g.milestones.total}`, {
      x: t.milestone.x,
      y,
      w: t.milestone.w,
      h,
      sz: t.milestone.sz,
      color: C.MUTED,
      align: 'center',
    })
  }
}

/** 프로젝트 없는 업무 앞의 구분선. 묶음이 아니라 **끊는 줄**입니다 */
function renderStandaloneRule(s: Slide, y: number) {
  const r = STANDALONE_RULE
  hline(s, TABLE.x, y + r.h / 2, TABLE.w, TABLE.groupRule.color, 1)
  rect(s, r.tick.x, y + r.tick.dy, r.tick.w, r.tick.h, C.MUTED)
  text(s, '프로젝트 미지정 — 개별 업무', {
    x: r.label.x,
    y,
    w: r.label.w,
    h: r.h,
    sz: r.label.sz,
    color: C.MUTED,
  })
}

function renderRow(s: Slide, row: WeeklyRow, y: number, zebra: boolean, standalone: boolean) {
  const rowH = TABLE.rowH
  rect(s, TABLE.x, y, TABLE.w, rowH, zebra ? C.ZEBRA : C.WHITE)

  // 독립 항목은 왼쪽에 점을 하나 찍습니다 — 프로젝트 아래 행과 눈으로 구분됩니다
  if (standalone) {
    rect(s, TABLE.x + 0.04, y + rowH / 2 - 0.02, 0.04, 0.04, C.MUTED)
  }

  text(s, row.title, {
    x: TABLE.cols.title.x,
    y,
    w: TABLE.cols.title.w,
    h: rowH,
    sz: TABLE.cols.title.sz,
    color: C.INK,
    bold: true,
  })
  text(s, row.owner, {
    x: TABLE.cols.owner.x,
    y,
    w: TABLE.cols.owner.w,
    h: rowH,
    sz: TABLE.cols.owner.sz,
    color: C.INK,
  })
  text(s, row.detail, {
    x: TABLE.cols.detail.x,
    y,
    w: TABLE.cols.detail.w,
    h: rowH,
    sz: TABLE.cols.detail.sz,
    color: C.MUTED,
  })

  const chip = WEEKLY_CHIP[row.chip]
  const cs = TABLE.cols.status
  const chipY = y + (rowH - cs.h) / 2
  round(s, cs.x, chipY, cs.w, cs.h, chip.bg)
  text(s, chip.label, {
    x: cs.x,
    y: chipY,
    w: cs.w,
    h: cs.h,
    sz: cs.sz,
    color: chip.fg,
    bold: true,
    align: 'center',
  })

  if (row.progress !== null) {
    const p = TABLE.cols.progress
    const bar = TABLE.cols.bar
    text(s, `${row.progress}%`, {
      x: p.x,
      y: y + p.dy,
      w: p.w,
      h: p.h,
      sz: p.sz,
      color: chip.fg,
      bold: true,
      align: 'center',
    })
    round(s, bar.x, y + bar.dy, bar.w, bar.h, C.RULE)
    if (row.progress > 0) {
      round(s, bar.x, y + bar.dy, (bar.w * row.progress) / 100, bar.h, chip.fg)
    }
  }

  // 일정이 금주에 바뀌었으면 화살표가 들어간 문자열이라 조금 진하게 씁니다
  text(s, row.schedule, {
    x: TABLE.cols.schedule.x,
    y,
    w: TABLE.cols.schedule.w,
    h: rowH,
    sz: TABLE.cols.schedule.sz,
    color: row.dueChangedFrom ? C.AMBER : C.INK,
    bold: Boolean(row.dueChangedFrom),
    align: 'center',
  })
}

/**
 * 2장 — 프로젝트 진척.
 *
 * 막대의 연한 부분이 지난주까지, 진한 부분이 **금주 증가분**입니다.
 * 비교 대상이 없는 주에는 증가분을 그리지 않고 현재 값만 남색으로 칠합니다.
 */
function renderProgress(s: Slide, m: WeeklyModel) {
  sectionTitle(s, SECTION_POS.s2, '2. 주간 진척')

  const p = WEEKLY_PROGRESS
  round(s, p.panel.x, p.panel.y, p.panel.w, p.panel.h, C.WHITE)
  text(s, '프로젝트 진척 (마일스톤)', { ...p.title, color: C.NAVY, bold: true })
  text(s, m.baseline ? '연한 칸=지난주 · 진한 칸=금주' : '비교 대상 없음', {
    ...p.legend,
    color: C.MUTED,
    align: 'right',
  })

  if (m.progress.length === 0) {
    text(s, '마일스톤이 등록된 프로젝트가 없습니다', { ...p.empty, color: C.MUTED, align: 'center' })
    return
  }

  m.progress.slice(0, p.max).forEach((row, i) => {
    renderProgressRow(s, row, p.firstY + i * p.rowH)
  })
}

function renderProgressRow(s: Slide, row: ProgressRow, y: number) {
  const p = WEEKLY_PROGRESS
  const moved = row.delta !== null && row.delta > 0

  text(s, row.title, { x: p.name.x, y, w: p.name.w, h: p.name.h, sz: p.name.sz, color: C.INK, bold: true })

  const pct =
    row.before !== null && row.before !== row.after
      ? `${row.before}% → ${row.after}%`
      : `${row.after}%`
  text(s, pct, {
    x: p.pct.x,
    y,
    w: p.pct.w,
    h: p.pct.h,
    sz: p.pct.sz,
    color: moved ? C.TEAL : C.NAVY,
    bold: true,
    align: 'right',
  })

  const barY = y + p.bar.dy
  round(s, p.bar.x, barY, p.bar.w, p.bar.h, C.RULE)
  const beforeW = ((row.before ?? row.after) / 100) * p.bar.w
  const afterW = (row.after / 100) * p.bar.w
  if (beforeW > 0) round(s, p.bar.x, barY, beforeW, p.bar.h, row.before === null ? C.NAVY : C.BAR)
  // 증가분만 진하게. 0 이면 아무것도 안 그립니다 — 안 움직인 것도 사실입니다.
  if (afterW > beforeW) round(s, p.bar.x + beforeW, barY, afterW - beforeW, p.bar.h, C.TEAL)

  const delta =
    row.delta === null ? '금주 비교 없음' : row.delta > 0 ? `금주 +${row.delta}` : '금주 변화 없음'
  text(s, `마일스톤 ${row.milestones.done}/${row.milestones.total} · ${delta}`, {
    x: p.sub.x,
    y: y + p.sub.dy,
    w: p.sub.w,
    h: p.sub.h,
    sz: p.sub.sz,
    color: moved ? C.TEAL : C.MUTED,
  })
}

/** 3장 — 일정 변경 · 정체 · 지연 */
function renderChanges(s: Slide, m: WeeklyModel) {
  sectionTitle(s, SECTION_POS.s3, '3. 이슈 — 일정 변경 · 보류 · 지연 · 정체')
  const p = ISSUES.panel
  round(s, p.x, p.y, p.w, p.h, C.PANEL)

  if (m.changes.length === 0) {
    text(s, m.baseline ? '해당 없음' : '비교 대상이 없어 변화를 산출하지 않았습니다', {
      x: ISSUES.text.x,
      y: ISSUES.firstY,
      w: ISSUES.text.w,
      h: ISSUES.text.h,
      sz: ISSUES.text.sz,
      color: C.MUTED,
    })
    return
  }

  m.changes.slice(0, ISSUES.max).forEach((it, i) => {
    const y = ISSUES.firstY + i * ISSUES.gap
    rect(s, ISSUES.tick.x, y + ISSUES.tick.dy, ISSUES.tick.w, ISSUES.tick.h, C.AMBER)
    text(
      s,
      [
        { text: `${it.label}   `, options: { bold: true, color: C.NAVY } },
        { text: it.body, options: { color: C.INK } },
      ],
      { x: ISSUES.text.x, y, w: ISSUES.text.w, h: ISSUES.text.h, sz: ISSUES.text.sz, color: C.INK },
    )
  })
}

function renderPlans(s: Slide, m: WeeklyModel, nextLabel: string) {
  sectionTitle(s, SECTION_POS.s4, `4. 차주(${nextLabel}) 계획`)
  const p = PLANS.panel
  round(s, p.x, p.y, p.w, p.h, C.PANEL)

  if (m.plans.length === 0) {
    text(s, '· 차주 마감인 업무 없음', {
      x: PLANS.text.x - 0.14,
      y: PLANS.firstY,
      w: PLANS.text.w,
      h: PLANS.text.h,
      sz: PLANS.text.sz,
      color: C.MUTED,
    })
    return
  }

  m.plans.slice(0, PLANS.max).forEach((t, i) => {
    const y = PLANS.firstY + i * PLANS.gap
    rect(s, PLANS.dot.x, y + PLANS.dot.dy, PLANS.dot.w, PLANS.dot.h, C.NAVY)
    text(s, t, { x: PLANS.text.x, y, w: PLANS.text.w, h: PLANS.text.h, sz: PLANS.text.sz, color: C.INK })
  })
}

function renderFooter(s: Slide, m: WeeklyModel) {
  const notes = m.footnotes.length > 0 ? ` · ${m.footnotes.join(' · ')}` : ''
  text(s, `※ 데이터 출처: desk (${m.reportedOn} 스냅샷)${notes}`, {
    ...FOOT.left,
    color: C.MUTED,
    valign: 'top',
  })
  text(s, m.team, { ...FOOT.right, color: C.MUTED, align: 'right' })
}

/**
 * 2장째 슬라이드 — 프로젝트 진행 레일.
 *
 * desk `Weekly Report` 의 `1 프로젝트 진행 · 마일스톤` 을 옮긴 것입니다.
 * **일정표가 아니라 "지금 어디까지 왔는가" 를 보는 장**이라, 날짜보다 칩의
 * 위치가 본문입니다.
 */
function renderRailSlide(s: Slide, m: WeeklyModel): string[] {
  const notes: string[] = []

  text(s, '프로젝트 진행', { ...RAIL.title, color: C.NAVY, bold: true })
  text(s, `${m.period.range} · ${m.reportedOn} 스냅샷`, {
    ...RAIL.asOf,
    color: C.MUTED,
    align: 'right',
  })

  if (m.rails.length === 0) {
    text(s, '마일스톤이 등록된 프로젝트가 없습니다', { ...RAIL.empty, color: C.MUTED })
    return notes
  }

  // 프로젝트가 많으면 행을 줄이되 최소 높이 아래로는 안 내려갑니다.
  // 그래도 안 들어가면 뒤쪽을 자르고 몇 개를 잘랐는지 적습니다.
  const budget = RAIL.bottom - RAIL.top
  const rowH = Math.max(RAIL.minRowH, Math.min(RAIL.rowH, budget / m.rails.length))
  const fit = Math.floor(budget / rowH)
  const shown = m.rails.slice(0, fit)
  if (shown.length < m.rails.length) {
    notes.push(`프로젝트 ${m.rails.length}개 중 ${shown.length}개 표기`)
  }

  // 머리글
  text(s, '프로젝트', { x: RAIL.name.x, y: RAIL.head.y, w: RAIL.name.w, h: RAIL.head.h, sz: RAIL.head.sz, color: C.MUTED })
  text(s, '진행', { x: RAIL.count.x, y: RAIL.head.y, w: RAIL.count.w, h: RAIL.head.h, sz: RAIL.head.sz, color: C.MUTED, align: 'center' })
  text(s, '마일스톤', { x: RAIL.rail.x, y: RAIL.head.y, w: 2, h: RAIL.head.h, sz: RAIL.head.sz, color: C.MUTED })
  text(s, '목표', { x: RAIL.due.x, y: RAIL.head.y, w: RAIL.due.w, h: RAIL.head.h, sz: RAIL.head.sz, color: C.MUTED, align: 'right' })
  hline(s, RAIL.name.x, RAIL.top - 0.03, SLIDE.w - RAIL.name.x * 2, C.RULE, 0.75)

  let collapsedRows = 0
  shown.forEach((r, i) => {
    const y = RAIL.top + i * rowH
    if (i % 2 === 1) rect(s, RAIL.name.x, y, SLIDE.w - RAIL.name.x * 2, rowH, C.ZEBRA)
    if (renderRailRow(s, r, y, rowH, m.reportedOn)) collapsedRows += 1
  })

  if (collapsedRows > 0) {
    notes.push(`레일 ${collapsedRows}개는 완료분을 접어 표기 (✓N)`)
  }
  // 칩 날짜는 desk 응답에 없는 값이라 우리가 계산합니다. 반드시 밝힙니다.
  if (shown.some((r) => r.chips.some((c) => c.date))) {
    notes.push('마일스톤 날짜는 그 프로젝트 미완료 업무의 최소 마감일(파생)')
  }
  return notes
}

/** 한 줄. 완료분을 접었으면 true 를 돌려줍니다 (각주에 셉니다) */
function renderRailRow(s: Slide, r: ProjectRail, y: number, rowH: number, asOf: string): boolean {
  const dim = r.hold
  const nameColor = dim ? C.MUTED : C.INK

  // 이름 + 보류 배지
  const nameW = dim ? RAIL.name.w - RAIL.holdBadge.w - 0.06 : RAIL.name.w
  text(s, r.title, { x: RAIL.name.x, y, w: nameW, h: rowH, sz: RAIL.name.sz, color: nameColor, bold: !dim })
  if (dim) {
    const bx = RAIL.name.x + nameW + 0.06
    const by = y + (rowH - RAIL.holdBadge.h) / 2
    round(s, bx, by, RAIL.holdBadge.w, RAIL.holdBadge.h, C.AMBER_BG)
    text(s, '보류', { x: bx, y: by, w: RAIL.holdBadge.w, h: RAIL.holdBadge.h, sz: RAIL.holdBadge.sz, color: C.AMBER, bold: true, align: 'center' })
  }

  text(s, `${r.done}/${r.total}`, {
    x: RAIL.count.x,
    y,
    w: RAIL.count.w,
    h: rowH,
    sz: RAIL.count.sz,
    color: dim ? C.MUTED : C.NAVY,
    bold: true,
    align: 'center',
  })

  // 목표일 — 없으면 '—' 로 두고 오늘로 채우지 않습니다.
  // 지난 목표는 붉게: 늦었다는 사실이 이 장에서도 보여야 합니다.
  const overdue = r.due !== null && r.due < asOf
  // 보고서 전체가 `8/31` 꼴을 씁니다. 여기만 `08/31` 이면 다른 문서처럼 보입니다
  const dueShort = r.due ? `${Number(r.due.slice(5, 7))}/${Number(r.due.slice(8, 10))}` : null
  text(s, dueShort ? `목표 ${dueShort}` : '목표 —', {
    x: RAIL.due.x,
    y,
    w: RAIL.due.w,
    h: rowH,
    sz: RAIL.due.sz,
    color: overdue ? C.RED : C.MUTED,
    bold: overdue,
    align: 'right',
  })

  const fitted = fitRail(r.chips, RAIL.rail.w, RAIL.rail)
  let x = RAIL.rail.x
  const chipY = y + (rowH - RAIL.rail.chipH) / 2

  fitted.chips.forEach((c, i) => {
    const w = chipWidth(c, fitted.sz, RAIL.rail)
    if (x + w > RAIL.rail.x + RAIL.rail.w) return // 마지막 한 칸이 남으면 그리지 않습니다
    if (i > 0) {
      // 칩 사이 이음선 — 단계가 이어진다는 표시입니다
      hline(s, x - RAIL.rail.gap + 0.02, chipY + RAIL.link.dy, RAIL.link.w, C.RULE, 0.75)
    }
    renderChip(s, c, x, chipY, w, fitted.sz, dim)
    x += w + RAIL.rail.gap
  })

  return fitted.collapsed > 0
}

function renderChip(s: Slide, c: RailChip, x: number, y: number, w: number, sz: number, dim: boolean) {
  const style = c.current ? RAIL_CHIP.current : c.done ? RAIL_CHIP.done : RAIL_CHIP.todo
  const h = RAIL.rail.chipH

  round(s, x, y, w, h, dim ? C.PANEL : style.bg)
  if (c.current && !dim) {
    // 현재 칩만 테두리를 줍니다 — 이 장에서 가장 먼저 보여야 하는 것입니다
    s.addShape('roundRect', {
      x,
      y,
      w,
      h,
      fill: { color: C.WHITE },
      line: { color: C.NAVY, width: 1 },
      rectRadius: R,
    })
  }
  text(s, c.date ? `${c.name} ~${c.date}` : c.name, {
    x,
    y,
    w,
    h,
    sz,
    color: dim ? C.MUTED : style.fg,
    bold: c.current,
    align: 'center',
  })
}

export function buildWeeklyPptx(m: WeeklyModel, nextLabel: string): PptxGenJS {
  const pptx = new PptxGenJS()
  defineSlideSize(pptx)
  pptx.title = `주간 업무 보고 (${m.period.label})`
  pptx.author = m.author
  pptx.company = m.team

  const s = pptx.addSlide()
  s.background = { color: C.WHITE }

  renderHeader(s, m)
  renderSummary(s, m)
  renderTable(s, m)
  renderProgress(s, m)
  renderChanges(s, m)
  renderPlans(s, m, nextLabel)
  renderFooter(s, m)

  // 2장째 — 프로젝트 진행 레일. 접거나 자른 사실은 이 장 꼬리말에 적습니다.
  const rail = pptx.addSlide()
  rail.background = { color: C.WHITE }
  const railNotes = renderRailSlide(rail, m)
  text(rail, `※ 출처: desk (${m.reportedOn} 스냅샷)${railNotes.length ? ` · ${railNotes.join(' · ')}` : ''}`, {
    ...FOOT.left,
    color: C.MUTED,
    valign: 'top',
  })
  text(rail, m.team, { ...FOOT.right, color: C.MUTED, align: 'right' })

  return pptx
}

/**
 * 브라우저 내려받기.
 *
 * Node 의 `writeFile` 대신 blob 을 만들어 링크를 눌러 줍니다 — 이 코드는 이제
 * 정적 사이트 안에서 돕니다. 서버가 없으므로 파일은 사용자 기기에서 만들어지고
 * 업무 내용이 어디로도 전송되지 않습니다.
 */
export async function downloadWeekly(m: WeeklyModel, nextLabel: string, fileName: string): Promise<void> {
  const pptx = buildWeeklyPptx(m, nextLabel)
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
