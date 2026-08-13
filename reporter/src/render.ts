/**
 * pptx 렌더러 — `layout.ts` 의 좌표에 `ReportModel` 을 얹습니다.
 *
 * 여기서는 **계산하지 않습니다.** 건수·진척율·판정은 전부 `aggregate.ts` 가
 * 끝낸 값으로 들어옵니다. 숫자가 틀리면 볼 곳은 여기가 아닙니다.
 *
 * 원본과 같은 PptxGenJS 를 씁니다. 원본이 네이티브 표·차트를 하나도 쓰지 않고
 * 사각형과 텍스트로만 그렸기 때문에, 같은 방식으로 그려야 서식이 일치합니다.
 */

import PptxGenJS from 'pptxgenjs'
import {
  C,
  CHART,
  CRITICAL_LIST,
  FOOT,
  HEAD,
  ISSUES,
  PLANS,
  SECTION_POS,
  STATUS_CHIP,
  SUMMARY,
  TABLE,
  TYPE_CARDS,
  WORK_TYPE_STYLE,
} from './layout.ts'
import { TREND_TYPES, WORK_TYPES, WORK_TYPE_LABELS, type ReportModel } from './types.ts'
import {
  defineSlideSize,
  hline,
  rect,
  round,
  sectionTitle as drawSectionTitle,
  text,
  type Slide,
} from './draw.ts'

/** 장 제목은 색만 고정해 넘깁니다 — 좌표·굵기는 draw.ts 가 압니다 */
function sectionTitle(s: Slide, pos: { x: number; y: number; w: number }, label: string) {
  drawSectionTitle(s, pos, label, C.NAVY)
}

// ---------------------------------------------------------------------------

function renderHeader(s: Slide, m: ReportModel) {
  text(s, '활동 월간 요약 보고서', { ...HEAD.title, color: C.NAVY, bold: true })
  text(s, m.subtitle, { ...HEAD.subtitle, color: C.MUTED })

  round(s, HEAD.metaBox.x, HEAD.metaBox.y, HEAD.metaBox.w, HEAD.metaBox.h, C.PANEL)
  text(
    s,
    [
      { text: '보고기간  ', options: { bold: true, color: C.NAVY } },
      { text: `${m.period.label}   `, options: { color: C.INK } },
      { text: '작성자  ', options: { bold: true, color: C.NAVY } },
      { text: `${m.author}   `, options: { color: C.INK } },
      { text: '보고일  ', options: { bold: true, color: C.NAVY } },
      { text: m.reportedOn, options: { color: C.INK } },
    ],
    { ...HEAD.metaText, sz: HEAD.metaText.sz, color: C.INK, align: 'center' },
  )
}

function renderSummary(s: Slide, m: ReportModel) {
  const b = SUMMARY.band
  round(s, b.x, b.y, b.w, b.h, C.BAND)

  const { workTotal, done, ing, late, ticketTotal, ticketCounts, focus } = m.summary

  // 전월 대비는 2장 카드 옆으로 옮겼습니다. 띠에 대분류 셋을 풀어 쓰면서
  // 증감까지 남기면 한 줄이 넘쳐 '중점' 이 잘립니다 — 잘리는 쪽이 하필
  // 사람이 손으로 쓴 문장입니다.
  const c = ticketCounts

  text(
    s,
    [
      {
        text: 'MONTHLY SUMMARY   ',
        options: { bold: true, color: C.NAVY, fontSize: SUMMARY.text.labelSz },
      },
      {
        text: `개발 안건 ${workTotal}건 (완료 ${done} · 진행 ${ing} · 지연 ${late})          `,
        options: { color: C.INK },
      },
      {
        text: `운영 ${ticketTotal}건 (장애 ${c.incident} · 유지보수 ${c.maintenance} · 신규 ${c.development})          `,
        options: { color: C.INK },
      },
      { text: '중점  ', options: { bold: true, color: C.NAVY } },
      { text: focus, options: { color: C.INK } },
    ],
    { ...SUMMARY.text, sz: SUMMARY.text.bodySz, color: C.INK },
  )
}

/**
 * 1장 표.
 *
 * 행 높이는 원본(9행) 기준을 유지하되, 행이 더 많으면 남은 높이를 나눠 씁니다.
 * `TABLE.minRowH` 아래로는 줄이지 않습니다 — 더 줄이면 글자가 칸을 넘칩니다.
 * 넘치는 행은 `aggregate.buildReport` 가 이미 잘라내고 꼬리말에 적어 둡니다.
 */
function renderTable(s: Slide, m: ReportModel) {
  sectionTitle(s, SECTION_POS.s1, '1. 개발 안건별 진행 현황')

  // 머리글
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

  const rowH = TABLE.rowH
  const groupH = TABLE.groupH
  let y = TABLE.top

  if (m.groups.length === 0) {
    rect(s, TABLE.x, y, TABLE.w, rowH, C.WHITE)
    text(s, '해당 기간에 진행된 안건이 없습니다', {
      x: TABLE.cols.title.x,
      y,
      w: TABLE.w - 0.14,
      h: rowH,
      sz: TABLE.cols.title.sz,
      color: C.MUTED,
    })
    y += rowH
  }

  m.groups.forEach((group) => {
    renderGroupHeader(s, group, y)
    y += groupH

    group.rows.forEach((row, i) => {
      renderWorkRow(s, row, y, rowH, i % 2 === 1)
      y += rowH

      // 묶음 안에서 상태가 바뀌는 자리는 진한 선으로 끊습니다.
      const next = group.rows[i + 1]
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
  })

  hline(s, TABLE.x, y, TABLE.w, C.NAVY, 1.25)
}

/** 프로젝트 묶음 머리행 — 이름 · 상태 건수 · 마일스톤 진척율 */
function renderGroupHeader(s: Slide, group: ReportModel['groups'][number], y: number) {
  const g = TABLE.group
  const h = TABLE.groupH
  rect(s, TABLE.x, y, TABLE.w, h, g.fill)
  rect(s, TABLE.x + 0.07, y + g.accent.dy, g.accent.w, g.accent.h, C.NAVY)

  text(s, group.title, {
    x: g.title.x,
    y,
    w: g.title.w,
    h,
    sz: g.title.sz,
    color: C.NAVY,
    bold: true,
  })

  const parts: string[] = []
  if (group.counts.late > 0) parts.push(`지연 ${group.counts.late}`)
  if (group.counts.done > 0) parts.push(`완료 ${group.counts.done}`)
  if (group.counts.ing > 0) parts.push(`진행 ${group.counts.ing}`)
  text(s, parts.join(' · '), {
    x: g.counts.x,
    y,
    w: g.counts.w,
    h,
    sz: g.counts.sz,
    color: C.MUTED,
  })

  // 마일스톤이 없는 프로젝트(와 '프로젝트 미지정')는 진척율 칸을 비웁니다
  if (group.progress !== null && group.milestones) {
    text(s, `${group.progress}%`, {
      x: g.progress.x,
      y: y + g.progress.dy,
      w: g.progress.w,
      h: g.progress.h,
      sz: g.progress.sz,
      color: C.NAVY,
      bold: true,
      align: 'center',
    })
    round(s, g.bar.x, y + g.bar.dy, g.bar.w, g.bar.h, C.RULE)
    if (group.progress > 0) {
      round(s, g.bar.x, y + g.bar.dy, (g.bar.w * group.progress) / 100, g.bar.h, C.NAVY)
    }
    text(s, `마일스톤 ${group.milestones.done}/${group.milestones.total}`, {
      x: g.milestone.x,
      y,
      w: g.milestone.w,
      h,
      sz: g.milestone.sz,
      color: C.MUTED,
      align: 'center',
    })
  }
}

function renderWorkRow(s: Slide, row: ReportModel['groups'][number]['rows'][number], y: number, rowH: number, zebra: boolean) {
  {
    rect(s, TABLE.x, y, TABLE.w, rowH, zebra ? C.ZEBRA : C.WHITE)

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

    // 상태 칩
    const chip = STATUS_CHIP[row.chip]
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

    // 진척율 — 값이 없으면 숫자도 막대도 그리지 않습니다
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

    text(s, row.schedule, {
      x: TABLE.cols.schedule.x,
      y,
      w: TABLE.cols.schedule.w,
      h: rowH,
      sz: TABLE.cols.schedule.sz,
      color: C.INK,
      align: 'center',
    })
  }
}

/**
 * 2장 운영 현황 — 추이(장애·유지보수 2계열) · 당월 대분류 카드 · 장애 등급 · 매우심각 목록.
 *
 * 막대가 7개보다 적으면 **왼쪽부터 채우고 빈 자리는 그대로 둡니다.**
 * 간격을 늘려 폭을 채우면 없는 기간이 있는 것처럼 보입니다.
 */
function renderOperations(s: Slide, m: ReportModel) {
  sectionTitle(s, SECTION_POS.s2, '2. 운영 현황')

  const p = CHART.panel
  round(s, p.x, p.y, p.w, p.h, C.WHITE)
  text(s, '월별 처리 건수', { ...CHART.title, color: C.NAVY, bold: true })
  renderLegend(s)
  text(s, '(단위: 건)', { ...CHART.unit, color: C.MUTED, align: 'right' })

  for (const gy of CHART.grid.ys) {
    hline(s, CHART.grid.x, gy, CHART.grid.w, C.GRID, 0.75)
  }

  const series = m.operations.series
  // 두 계열이 **같은 눈금**을 씁니다. 계열마다 최댓값을 따로 잡으면 3건과 30건이
  // 같은 높이로 그려집니다.
  const max = Math.max(1, ...series.flatMap((b) => TREND_TYPES.map((k) => b.values[k])))

  series.forEach((b, i) => {
    const slotX = CHART.bar.firstX + i * CHART.bar.gap

    TREND_TYPES.forEach((kind, k) => {
      const bx = slotX + k * (CHART.bar.seriesW + CHART.bar.seriesGap)
      const h = (b.values[kind] / max) * CHART.maxBarH
      const by = CHART.baseline - h
      if (h > 0) rect(s, bx, by, CHART.bar.seriesW, h, WORK_TYPE_STYLE[kind].fg)

      // 값은 당월에만 붙입니다 (layout.ts CHART.valueLabel 주석 참조)
      if (b.current) {
        text(s, String(b.values[kind]), {
          x: bx + (CHART.bar.seriesW - CHART.valueLabel.w) / 2,
          y: by + CHART.valueLabel.dy,
          w: CHART.valueLabel.w,
          h: CHART.valueLabel.h,
          sz: CHART.valueLabel.sz,
          color: WORK_TYPE_STYLE[kind].fg,
          bold: true,
          align: 'center',
        })
      }
    })

    text(s, b.label, {
      x: slotX + CHART.monthLabel.dx,
      y: CHART.monthLabel.y,
      w: CHART.monthLabel.w,
      h: CHART.monthLabel.h,
      sz: CHART.monthLabel.sz,
      color: b.current ? C.NAVY : C.MUTED,
      bold: b.current,
      align: 'center',
    })
  })

  if (series.length === 0) {
    text(s, '집계 데이터 없음', {
      x: CHART.grid.x,
      y: CHART.baseline - 0.6,
      w: CHART.grid.w,
      h: 0.3,
      sz: 8,
      color: C.MUTED,
      align: 'center',
    })
  }

  hline(s, CHART.grid.x, CHART.baseline, CHART.grid.w, C.AXIS, 1)

  // 당월 대분류 카드
  text(s, '당월 대분류 건수', { ...TYPE_CARDS.title, color: C.NAVY, bold: true })
  text(s, deltaText(m), { ...TYPE_CARDS.delta, color: C.MUTED, align: 'right' })

  WORK_TYPES.forEach((kind, i) => {
    const x = TYPE_CARDS.xs[i]!
    const style = WORK_TYPE_STYLE[kind]
    round(s, x, TYPE_CARDS.y, TYPE_CARDS.w, TYPE_CARDS.h, style.bg)
    text(s, WORK_TYPE_LABELS[kind], {
      x,
      y: TYPE_CARDS.y + 0.02,
      w: TYPE_CARDS.w,
      h: 0.17,
      sz: TYPE_CARDS.labelSz,
      color: style.fg,
      bold: true,
      align: 'center',
    })
    text(s, `${m.operations.counts[kind]}건`, {
      x,
      y: TYPE_CARDS.y + 0.17,
      w: TYPE_CARDS.w,
      h: 0.23,
      sz: TYPE_CARDS.countSz,
      color: style.fg,
      bold: true,
      align: 'center',
    })
  })

  // 장애 등급 — 카드 자리를 대분류에 내주고 한 줄로 내려왔습니다.
  // 모수가 장애라는 것을 문구에 박아 둡니다. 안 적으면 유지보수까지 센 것으로 읽힙니다.
  const sev = m.operations.severity
  text(
    s,
    [
      { text: '장애 등급  ', options: { bold: true, color: C.NAVY } },
      { text: `매우심각 ${sev.critical}`, options: { color: C.RED } },
      { text: ' · ', options: { color: C.MUTED } },
      { text: `심각 ${sev.major}`, options: { color: C.AMBER } },
      { text: ' · ', options: { color: C.MUTED } },
      { text: `보통 ${sev.normal}`, options: { color: C.TEAL } },
    ],
    { ...TYPE_CARDS.severityLine, color: C.MUTED },
  )

  // 매우심각 목록
  const crit = m.operations.criticalTitles
  text(s, `당월 매우심각 장애 (${crit.length}건)`, {
    ...CRITICAL_LIST.title,
    color: C.NAVY,
    bold: true,
  })

  if (crit.length === 0) {
    text(s, '· 매우심각 장애 없음', {
      x: CRITICAL_LIST.text.x - 0.13,
      y: CRITICAL_LIST.firstY,
      w: CRITICAL_LIST.text.w,
      h: CRITICAL_LIST.text.h,
      sz: CRITICAL_LIST.text.sz,
      color: C.MUTED,
    })
  }

  crit.slice(0, CRITICAL_LIST.max).forEach((t, i) => {
    const y = CRITICAL_LIST.firstY + i * CRITICAL_LIST.gap
    rect(
      s,
      CRITICAL_LIST.dot.x,
      y + CRITICAL_LIST.dot.dy,
      CRITICAL_LIST.dot.w,
      CRITICAL_LIST.dot.h,
      C.RED,
    )
    text(s, t, {
      x: CRITICAL_LIST.text.x,
      y,
      w: CRITICAL_LIST.text.w,
      h: CRITICAL_LIST.text.h,
      sz: CRITICAL_LIST.text.sz,
      color: C.INK,
    })
  })

  text(s, m.operations.note, { ...CRITICAL_LIST.note, color: C.MUTED })
}

/** 추이 범례. 막대가 두 계열이 된 순간부터 없으면 안 됩니다 */
function renderLegend(s: Slide) {
  const g = CHART.legend
  TREND_TYPES.forEach((kind, i) => {
    const x = g.x + i * g.itemW
    rect(s, x, g.y + g.swatch.dy, g.swatch.w, g.swatch.h, WORK_TYPE_STYLE[kind].fg)
    text(s, WORK_TYPE_LABELS[kind], {
      x: x + g.textDx,
      y: g.y,
      w: g.textW,
      h: g.h,
      sz: g.sz,
      color: C.MUTED,
    })
  })
}

/**
 * 전월 대비. 모수는 **대분류 3종 합**입니다 — 장애만 세던 값이 아닙니다.
 * 카드 셋 옆에 붙으므로 셋의 합에 대한 증감이라야 읽는 사람이 속지 않습니다.
 */
function deltaText(m: ReportModel): string {
  const { total, prevTotal } = m.operations
  if (prevTotal === null) return '전월 비교 없음 (집계 시작 전)'
  const d = total - prevTotal
  if (d === 0) return `전월 ${prevTotal}건 대비 △0건 (동일)`
  return `전월 ${prevTotal}건 대비 ${d > 0 ? '▲' : '▼'}${Math.abs(d)}건`
}

function renderIssues(s: Slide, m: ReportModel) {
  sectionTitle(s, SECTION_POS.s3, '3. 주요 이슈 및 의사결정 필요 사항')
  const p = ISSUES.panel
  round(s, p.x, p.y, p.w, p.h, C.PANEL)

  if (m.issues.length === 0) {
    text(s, '해당 없음', {
      x: ISSUES.text.x,
      y: ISSUES.firstY,
      w: ISSUES.text.w,
      h: ISSUES.text.h,
      sz: ISSUES.text.sz,
      color: C.MUTED,
    })
    return
  }

  m.issues.slice(0, ISSUES.max).forEach((it, i) => {
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

function renderPlans(s: Slide, m: ReportModel, nextLabel: string) {
  sectionTitle(s, SECTION_POS.s4, `4. 차월(${nextLabel}) 계획`)
  const p = PLANS.panel
  round(s, p.x, p.y, p.w, p.h, C.PANEL)

  if (m.plans.length === 0) {
    text(s, '· 등록된 계획 없음', {
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

function renderFooter(s: Slide, m: ReportModel) {
  const notes = m.footnotes.length > 0 ? ` · ${m.footnotes.join(' · ')}` : ''
  text(s, `※ 데이터 출처: desk (${m.reportedOn} 기준) · 티켓 대시보드${notes}`, {
    ...FOOT.left,
    color: C.MUTED,
    valign: 'top',
  })
  text(s, m.team, { ...FOOT.right, color: C.MUTED, align: 'right' })
}

// ---------------------------------------------------------------------------

export function buildPptx(m: ReportModel): PptxGenJS {
  const pptx = new PptxGenJS()
  defineSlideSize(pptx)
  pptx.title = `활동 월간 요약 보고서 (${m.period.from.slice(0, 7).replace('-', '.')})`
  pptx.author = m.author
  pptx.company = m.team

  const s = pptx.addSlide()
  s.background = { color: C.WHITE }

  const [y, mo] = m.period.from.split('-')
  const nextLabel = `${Number(mo) === 12 ? 1 : Number(mo) + 1}월`
  void y

  renderHeader(s, m)
  renderSummary(s, m)
  renderTable(s, m)
  renderOperations(s, m)
  renderIssues(s, m)
  renderPlans(s, m, nextLabel)
  renderFooter(s, m)

  return pptx
}

export async function writeReport(m: ReportModel, outPath: string): Promise<void> {
  const pptx = buildPptx(m)
  await pptx.writeFile({ fileName: outPath })
}
