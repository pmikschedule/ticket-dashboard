/**
 * 레이아웃 경계 검사.
 *
 * 오른쪽 단의 장 제목 폭을 왼쪽 단(5.0)과 같게 뒀다가 슬라이드 밖으로
 * 0.55인치 넘어간 적이 있습니다. 파워포인트는 그것을 오류로 알려 주지 않고
 * 그냥 잘라 그립니다 — 사람이 눈으로 보기 전까지 아무도 모릅니다.
 * 그래서 좌표 상수 자체를 검사합니다.
 */

import { describe, expect, it } from 'vitest'
import {
  CHART,
  CRITICAL_LIST,
  FOOT,
  HEAD,
  ISSUES,
  PLANS,
  SECTION,
  SECTION_POS,
  SLIDE,
  SUMMARY,
  TABLE,
  TYPE_CARDS,
} from '../src/layout.ts'

interface Box {
  name: string
  x: number
  y: number
  w: number
  h: number
}

const boxes: Box[] = [
  { name: '제목', ...HEAD.title },
  { name: '부제', ...HEAD.subtitle },
  { name: '헤더 상자', ...HEAD.metaBox },
  { name: '헤더 글자', ...HEAD.metaText },
  { name: '요약 띠', ...SUMMARY.band },
  { name: '요약 글자', ...SUMMARY.text },
  { name: '표', x: TABLE.x, y: TABLE.headY, w: TABLE.w, h: TABLE.bottom - TABLE.headY },
  { name: '차트 패널', ...CHART.panel },
  { name: '차트 제목', ...CHART.title },
  { name: '범례', x: CHART.legend.x, y: CHART.legend.y, w: CHART.legend.itemW + CHART.legend.textDx + CHART.legend.textW, h: CHART.legend.h },
  { name: '단위', ...CHART.unit },
  { name: '대분류 제목', ...TYPE_CARDS.title },
  { name: '증감', ...TYPE_CARDS.delta },
  { name: '장애 등급 줄', ...TYPE_CARDS.severityLine },
  { name: '심각목록 제목', ...CRITICAL_LIST.title },
  { name: '심각목록 각주', ...CRITICAL_LIST.note },
  { name: '3장 패널', ...ISSUES.panel },
  { name: '4장 패널', ...PLANS.panel },
  { name: '꼬리말 좌', ...FOOT.left },
  { name: '꼬리말 우', ...FOOT.right },
]

for (const [key, p] of Object.entries(SECTION_POS)) {
  boxes.push({
    name: `장 제목 ${key}`,
    x: p.x + SECTION.label.dx,
    y: p.y - SECTION.tick.dy,
    w: p.w,
    h: SECTION.label.h,
  })
}

for (const c of TABLE.headCells) {
  boxes.push({ name: `표 머리 ${c.label}`, x: c.x, y: TABLE.headY, w: c.w, h: TABLE.headH })
}

TYPE_CARDS.xs.forEach((x, i) => {
  boxes.push({
    name: `대분류 카드 ${i}`,
    x,
    y: TYPE_CARDS.y,
    w: TYPE_CARDS.w,
    h: TYPE_CARDS.h,
  })
})

describe('슬라이드 경계', () => {
  it.each(boxes)('$name 이 슬라이드 안에 있습니다', (b) => {
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(SLIDE.w)
    expect(b.y + b.h).toBeLessThanOrEqual(SLIDE.h)
  })

  it('막대 7개가 차트 패널을 넘지 않습니다', () => {
    const last = CHART.bar.firstX + (CHART.maxBars - 1) * CHART.bar.gap + CHART.bar.w
    expect(last).toBeLessThanOrEqual(CHART.panel.x + CHART.panel.w)
  })

  it('2계열 막대가 원본 슬롯 폭 안에 들어갑니다', () => {
    // 슬롯 폭(0.30)과 간격(0.53)은 원본 그대로입니다. 쪼갠 두 막대가 슬롯을
    // 넘으면 옆 달의 막대와 붙어 어느 달 것인지 알 수 없게 됩니다.
    expect(2 * CHART.bar.seriesW + CHART.bar.seriesGap).toBeCloseTo(CHART.bar.w, 6)
  })

  it('제목·범례·단위가 한 줄에서 겹치지 않습니다', () => {
    const legendEnd =
      CHART.legend.x + CHART.legend.itemW + CHART.legend.textDx + CHART.legend.textW
    expect(CHART.title.x + CHART.title.w).toBeLessThanOrEqual(CHART.legend.x)
    expect(legendEnd).toBeLessThanOrEqual(CHART.unit.x)
    expect(CHART.unit.x + CHART.unit.w).toBeLessThanOrEqual(CHART.panel.x + CHART.panel.w)
  })

  it('대분류 제목과 전월 대비가 겹치지 않습니다', () => {
    expect(TYPE_CARDS.title.x + TYPE_CARDS.title.w).toBeLessThanOrEqual(TYPE_CARDS.delta.x)
    expect(TYPE_CARDS.delta.x + TYPE_CARDS.delta.w).toBeLessThanOrEqual(
      CHART.panel.x + CHART.panel.w,
    )
  })

  it('장애 등급 줄이 카드와 매우심각 목록 사이에 들어갑니다', () => {
    expect(TYPE_CARDS.severityLine.y).toBeGreaterThanOrEqual(TYPE_CARDS.y + TYPE_CARDS.h)
    expect(TYPE_CARDS.severityLine.y + TYPE_CARDS.severityLine.h).toBeLessThanOrEqual(
      CRITICAL_LIST.title.y,
    )
  })

  it('막대 최고점이 격자 위로 솟지 않습니다', () => {
    expect(CHART.baseline - CHART.maxBarH).toBeGreaterThanOrEqual(CHART.grid.ys[0]! - 0.05)
  })

  it('매우심각 목록 4줄이 각주를 침범하지 않습니다', () => {
    const bottom = CRITICAL_LIST.firstY + (CRITICAL_LIST.max - 1) * CRITICAL_LIST.gap + CRITICAL_LIST.text.h
    expect(bottom).toBeLessThanOrEqual(CRITICAL_LIST.note.y + 0.01)
  })

  it('3장 항목 3줄이 패널 안에 들어갑니다', () => {
    const bottom = ISSUES.firstY + (ISSUES.max - 1) * ISSUES.gap + ISSUES.text.h
    expect(bottom).toBeLessThanOrEqual(ISSUES.panel.y + ISSUES.panel.h + 0.05)
  })

  it('4장 항목 4줄이 패널 안에 들어갑니다', () => {
    const bottom = PLANS.firstY + (PLANS.max - 1) * PLANS.gap + PLANS.text.h
    expect(bottom).toBeLessThanOrEqual(PLANS.panel.y + PLANS.panel.h + 0.05)
  })
})

describe('표 칸', () => {
  it('칸이 겹치지 않고 표 폭 안에 있습니다', () => {
    const cols = [
      TABLE.cols.title,
      TABLE.cols.owner,
      TABLE.cols.detail,
      { x: TABLE.cols.status.x, w: TABLE.cols.status.w },
      { x: TABLE.cols.progress.x, w: TABLE.cols.progress.w },
      TABLE.cols.schedule,
    ]
    for (let i = 0; i < cols.length - 1; i += 1) {
      expect(cols[i]!.x + cols[i]!.w).toBeLessThanOrEqual(cols[i + 1]!.x)
    }
    const last = cols.at(-1)!
    expect(last.x + last.w).toBeLessThanOrEqual(TABLE.x + TABLE.w + 0.01)
  })

  it('9행이 표 영역을 정확히 채웁니다', () => {
    const rowH = (TABLE.bottom - TABLE.top) / TABLE.baseRows
    expect(TABLE.top + TABLE.baseRows * rowH).toBeCloseTo(TABLE.bottom, 6)
    expect(rowH).toBeGreaterThan(TABLE.minRowH)
  })

  it('진척 막대가 진척율 칸 아래에 들어갑니다', () => {
    const rowH = (TABLE.bottom - TABLE.top) / TABLE.baseRows
    expect(TABLE.cols.bar.dy + TABLE.cols.bar.h).toBeLessThanOrEqual(rowH)
  })
})
