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
  ISSUES_COMPACT,
  ISSUES_PAGE,
  PLANS,
  PLANS_COMPACT,
  PLANS_PAGE,
  SECTION_POS,
  SLIDE,
  STANDALONE_RULE,
  RAIL,
  RAIL_CHIP,
  SUMMARY,
  TABLE,
  TABLE_CONT,
  WEEKLY_CHIP,
  WEEKLY_OPS,
  WORK_TYPE_STYLE,
} from './layout'
import { defineSlideSize, hline, R, rect, round, sectionTitle as drawSectionTitle, text, type Slide } from './draw'
import type { WeeklyGroup, WeeklyModel, WeeklyRow } from './weekly'
import { opsDeltaLabel } from './ops'
import { CATEGORIES, CATEGORY_LABELS, WORK_TYPES, WORK_TYPE_LABELS } from '../constants'
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

/**
 * 1장 — 프로젝트 → 하위 태스크. 프로젝트 없는 업무는 아래에 독립 항목으로.
 *
 * **한 장 분량(`page`)만 받습니다.** 몇 장이 되는지, 어디서 끊는지는
 * `weekly.paginateGroups` 가 이미 정했습니다 — 여기서 다시 재지 않습니다.
 * `geom` 은 그 장의 표 시작 위치입니다 (1장과 이어지는 장이 다릅니다).
 */
function renderTable(s: Slide, page: WeeklyGroup[], geom: { headY: number; top: number }) {
  rect(s, TABLE.x, geom.headY, TABLE.w, TABLE.headH, C.NAVY)
  for (const c of TABLE.headCells) {
    text(s, c.label, {
      x: c.x,
      y: geom.headY,
      w: c.w,
      h: TABLE.headH,
      sz: TABLE.headSz,
      color: C.WHITE,
      bold: true,
      align: c.align as 'left' | 'center',
    })
  }

  let y = geom.top

  if (page.length === 0) {
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

  for (const g of page) {
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

  // 앞 장에서 이어졌으면 밝힙니다. 뒷장만 본 사람에게는 이 머리행이 처음입니다
  text(s, g.continued ? `${g.title} (계속)` : g.title, {
    x: t.title.x,
    y,
    w: t.title.w,
    h,
    sz: t.title.sz,
    color: C.NAVY,
    bold: true,
  })

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
 * 2장 — 운영 현황 (티켓 대시보드).
 *
 * 1장의 표는 desk 의 개발 안건이고 여기는 메일로 들어온 요청입니다. **다른
 * 축이라 숫자가 안 맞는 게 정상**이고, 그래서 장 제목으로 갈라 둡니다.
 */
function renderOps(s: Slide, m: WeeklyModel) {
  sectionTitle(s, SECTION_POS.s2, '2. 운영 현황')

  const o = WEEKLY_OPS
  round(s, o.panel.x, o.panel.y, o.panel.w, o.panel.h, C.WHITE)

  const ops = m.ops
  text(s, `금주 접수 ${ops.total}건`, { ...o.total, color: C.NAVY, bold: true })
  text(s, opsDeltaLabel(ops), { ...o.delta, color: C.MUTED, align: 'right' })

  // 대분류 카드 — 이 장에서 가장 먼저 보여야 하는 것입니다
  WORK_TYPES.forEach((kind, i) => {
    const x = o.cards.xs[i]!
    const style = WORK_TYPE_STYLE[kind]
    round(s, x, o.cards.y, o.cards.w, o.cards.h, style.bg)
    text(s, WORK_TYPE_LABELS[kind], {
      x,
      y: o.cards.y + 0.02,
      w: o.cards.w,
      h: 0.17,
      sz: o.cards.labelSz,
      color: style.fg,
      bold: true,
      align: 'center',
    })
    text(s, `${ops.byWorkType[kind]}건`, {
      x,
      y: o.cards.y + 0.17,
      w: o.cards.w,
      h: 0.23,
      sz: o.cards.countSz,
      color: style.fg,
      bold: true,
      align: 'center',
    })
  })

  const line = (i: number, label: string, body: PptxGenJS.TextProps[]) =>
    text(s, [{ text: `${label}  `, options: { bold: true, color: C.NAVY } }, ...body], {
      x: o.line.x,
      y: o.line.ys[i]!,
      w: o.line.w,
      h: o.line.h,
      sz: o.line.sz,
      color: C.MUTED,
    })

  // 중분류는 대분류와 **다른 축**입니다 (유지보수이면서 개선일 수 있습니다).
  // 합계가 대분류와 같아도 같은 것을 두 번 센 게 아닙니다.
  line(0, '중분류', [
    { text: CATEGORIES.map((c) => `${CATEGORY_LABELS[c]} ${ops.byCategory[c]}`).join(' · '), options: { color: C.INK } },
  ])
  line(1, '처리', [
    { text: `완료 ${ops.progress.done} · 진행 ${ops.progress.doing} · 대기 ${ops.progress.waiting}`, options: { color: C.INK } },
  ])
  // 등급은 **장애만** 모수입니다. 유지보수 티켓에도 등급 컬럼은 있지만 세면
  // '보통 장애' 가 유지보수 건수만큼 부풀어 오릅니다.
  line(2, '장애 등급', [
    { text: `매우심각 ${ops.severity.critical}`, options: { color: C.RED } },
    { text: ' · ', options: { color: C.MUTED } },
    { text: `심각 ${ops.severity.major}`, options: { color: C.AMBER } },
    { text: ' · ', options: { color: C.MUTED } },
    { text: `보통 ${ops.severity.normal}`, options: { color: C.TEAL } },
  ])

  const crit = ops.criticalTitles
  text(s, `금주 매우심각 장애 (${crit.length}건)`, { ...o.critical.title, color: C.NAVY, bold: true })
  if (crit.length === 0) {
    text(s, '· 매우심각 장애 없음', {
      x: o.critical.text.x - 0.13,
      y: o.critical.firstY,
      w: o.critical.text.w,
      h: o.critical.text.h,
      sz: o.critical.text.sz,
      color: C.MUTED,
    })
  }
  crit.slice(0, o.critical.max).forEach((t, i) => {
    const y = o.critical.firstY + i * o.critical.gap
    rect(s, o.critical.dot.x, y + o.critical.dot.dy, o.critical.dot.w, o.critical.dot.h, C.RED)
    text(s, t, {
      x: o.critical.text.x,
      y,
      w: o.critical.text.w,
      h: o.critical.text.h,
      sz: o.critical.text.sz,
      color: C.INK,
    })
  })
  text(s, `※ 출처: 티켓 대시보드 (${m.period.range} 접수 기준)`, {
    ...o.critical.note,
    color: C.MUTED,
  })
}

/**
 * 3·4장은 **세 자리** 중 하나에 그려집니다 (`m.layout`).
 *
 * 자리마다 좌표와 줄 수가 다를 뿐 그리는 내용은 같아서, 상자를 받아 그립니다.
 * 여기서 개수를 다시 자르지 않습니다 — `m.changes`·`m.plans` 는 이미 그 자리에
 * 맞게 잘린 목록이고, 두 곳에서 자르면 각주의 건수와 화면이 갈라집니다.
 */
interface IssueBox {
  panel: { x: number; y: number; w: number; h: number }
  firstY: number
  gap: number
  tick: { x: number; w: number; h: number; dy: number }
  text: { x: number; w: number; h: number; sz: number }
}

interface PlanBox {
  panel: { x: number; y: number; w: number; h: number }
  firstY: number
  gap: number
  dot: { x: number; w: number; h: number; dy: number }
  text: { x: number; w: number; h: number; sz: number }
}

/** 3장 — 일정 변경 · 정체 · 지연 */
function renderChanges(s: Slide, m: WeeklyModel, pos: { x: number; y: number; w: number }, box: IssueBox) {
  sectionTitle(s, pos, '3. 이슈 — 일정 변경 · 보류 · 지연 · 정체')
  const p = box.panel
  round(s, p.x, p.y, p.w, p.h, C.PANEL)

  if (m.changes.length === 0) {
    text(s, m.baseline ? '해당 없음' : '비교 대상이 없어 변화를 산출하지 않았습니다', {
      x: box.text.x,
      y: box.firstY,
      w: box.text.w,
      h: box.text.h,
      sz: box.text.sz,
      color: C.MUTED,
    })
    return
  }

  m.changes.forEach((it, i) => {
    const y = box.firstY + i * box.gap
    rect(s, box.tick.x, y + box.tick.dy, box.tick.w, box.tick.h, C.AMBER)
    text(
      s,
      [
        { text: `${it.label}   `, options: { bold: true, color: C.NAVY } },
        { text: it.body, options: { color: C.INK } },
      ],
      { x: box.text.x, y, w: box.text.w, h: box.text.h, sz: box.text.sz, color: C.INK },
    )
  })
}

function renderPlans(
  s: Slide,
  m: WeeklyModel,
  nextLabel: string,
  pos: { x: number; y: number; w: number },
  box: PlanBox,
) {
  sectionTitle(s, pos, `4. 차주(${nextLabel}) 계획`)
  const p = box.panel
  round(s, p.x, p.y, p.w, p.h, C.PANEL)

  if (m.plans.length === 0) {
    text(s, '· 차주 마감인 업무 없음', {
      x: box.text.x - 0.14,
      y: box.firstY,
      w: box.text.w,
      h: box.text.h,
      sz: box.text.sz,
      color: C.MUTED,
    })
    return
  }

  m.plans.forEach((t, i) => {
    const y = box.firstY + i * box.gap
    rect(s, box.dot.x, y + box.dot.dy, box.dot.w, box.dot.h, C.NAVY)
    text(s, t, { x: box.text.x, y, w: box.text.w, h: box.text.h, sz: box.text.sz, color: C.INK })
  })
}

/**
 * 3·4장을 1장에 그립니다 (`base`·`compact`).
 *
 * `compact` 는 표가 조금 넘칠 때입니다 — 두 절을 아래로 밀고 줄 수를 줄여 표에
 * 0.78인치를 넘깁니다. 넘긴 만큼 실제로 표가 더 그려지므로 자리를 바꾼 것이지
 * 내용을 버린 것이 아니고, 3·4장에서 못 실은 줄은 각주가 셉니다.
 */
function renderSectionsInline(s: Slide, m: WeeklyModel, nextLabel: string) {
  if (m.layout === 'compact') {
    renderChanges(s, m, ISSUES_COMPACT.section, ISSUES_COMPACT)
    renderPlans(s, m, nextLabel, PLANS_COMPACT.section, PLANS_COMPACT)
    return
  }
  renderChanges(s, m, SECTION_POS.s3, ISSUES)
  renderPlans(s, m, nextLabel, SECTION_POS.s4, PLANS)
}

/** 3·4장 전용 장 (`spill`) — 슬라이드를 가로로 다 쓰므로 1장에 있을 때보다 넉넉합니다 */
function renderSectionSlide(s: Slide, m: WeeklyModel, nextLabel: string) {
  text(s, '이슈 · 차주 계획', { ...ISSUES_PAGE.title, color: C.NAVY, bold: true })
  renderChanges(s, m, ISSUES_PAGE.section, ISSUES_PAGE)
  renderPlans(s, m, nextLabel, PLANS_PAGE.section, PLANS_PAGE)
}

/**
 * 꼬리말은 **왼쪽만** 씁니다.
 *
 * 오른쪽 팀명은 뺐습니다 — 부제가 이미 팀 이름이라 중복이고, 예전 값이
 * 잘못 박혀 있었습니다. 왼쪽 각주는 남깁니다: 지면 때문에 잘라낸 행, 비교
 * 대상이 없다는 사실, 파생값이라는 표시가 여기 들어갑니다. 지우면 보고서가
 * 실제보다 완전해 보입니다.
 */
function renderFooter(s: Slide, m: WeeklyModel) {
  const notes = m.footnotes.length > 0 ? ` · ${m.footnotes.join(' · ')}` : ''
  text(s, `※ 데이터 출처: desk (${m.reportedOn} 스냅샷)${notes}`, {
    ...FOOT.left,
    color: C.MUTED,
    valign: 'top',
  })
}

/**
 * 2장째 슬라이드 — 프로젝트 진행 레일.
 *
 * desk `Weekly Report` 의 `1 프로젝트 진행 · 마일스톤` 을 옮긴 것입니다.
 * **일정표가 아니라 "지금 어디까지 왔는가" 를 보는 장**이라, 날짜보다 칩의
 * 위치가 본문입니다.
 */
function renderRailSlide(s: Slide, m: WeeklyModel): void {
  // 이 장에는 꼬리말이 없습니다. 여기서 드러난 사실은 1장 각주로 보냅니다.
  const notes = m.footnotes

  text(s, '프로젝트 진행', { ...RAIL.title, color: C.NAVY, bold: true })

  if (m.rails.length === 0) {
    text(s, '마일스톤이 등록된 프로젝트가 없습니다', { ...RAIL.empty, color: C.MUTED })
    return
  }

  // 프로젝트가 많으면 행을 줄이되 최소 높이 아래로는 안 내려갑니다.
  // 그래도 안 들어가면 뒤쪽을 자르고 몇 개를 잘랐는지 적습니다.
  const budget = RAIL.bottom - RAIL.top
  const rowH = Math.max(RAIL.minRowH, Math.min(RAIL.rowH, budget / m.rails.length))
  const fit = Math.floor(budget / rowH)
  const shown = m.rails.slice(0, fit)
  if (shown.length < m.rails.length) {
    notes.push(`프로젝트 진행 ${m.rails.length}개 중 ${shown.length}개 표기`)
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

  const s = pptx.addSlide()
  s.background = { color: C.WHITE }

  renderHeader(s, m)
  renderSummary(s, m)
  sectionTitle(s, SECTION_POS.s1, '1. 금주 진행 현황 (프로젝트 · 담당자)')
  renderTable(s, m.pages[0] ?? [], TABLE)
  renderOps(s, m)

  // 3·4장은 1장에 남거나(base·compact) 별도 장으로 내려갑니다(spill).
  if (m.layout !== 'spill') renderSectionsInline(s, m, nextLabel)

  // 표가 한 장에 안 들어가면 **자르지 않고 장을 잇습니다.** 이어지는 장은
  // 머리말·요약 띠·오른쪽 단이 없어 표가 더 위에서 시작하고 더 내려갑니다.
  m.pages.slice(1).forEach((page, i) => {
    const cont = pptx.addSlide()
    cont.background = { color: C.WHITE }
    text(cont, `1. 금주 진행 현황 (계속 ${i + 2}/${m.pages.length})`, {
      ...TABLE_CONT.title,
      color: C.NAVY,
      bold: true,
    })
    renderTable(cont, page, TABLE_CONT)
  })

  if (m.layout === 'spill') {
    const sec = pptx.addSlide()
    sec.background = { color: C.WHITE }
    renderSectionSlide(sec, m, nextLabel)
  }

  // 2장째 — 프로젝트 진행 레일. 이 장에는 꼬리말을 두지 않습니다.
  //
  // 대신 **접거나 자르거나 파생한 사실은 1장 각주로 올립니다.** 2장에서 지운
  // 것은 자리이지 사실이 아닙니다 — 마일스톤 날짜가 desk 가 준 값이 아니라
  // 우리가 계산한 값이라는 표시는 어딘가에 남아야 합니다.
  const rail = pptx.addSlide()
  rail.background = { color: C.WHITE }
  renderRailSlide(rail, m)

  // 1장 꼬리말은 **맨 마지막**입니다. 2장에서 접거나 파생한 사실이 각주에
  // 얹힌 뒤라야 그 내용까지 실립니다. 순서를 되돌리면 조용히 빠집니다.
  renderFooter(s, m)

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
