/**
 * pptx 그리기 원시 함수 — 월간·주간 렌더러가 **같은 것**을 씁니다.
 *
 * 원본이 네이티브 표·차트를 하나도 쓰지 않고 사각형과 텍스트로만 그려져 있어서,
 * 여기 있는 것은 그 넷(사각형·둥근사각형·선·글자)이 전부입니다. 둘로 나뉘어
 * 있으면 한쪽만 고쳐져서 두 보고서의 모서리 반지름이 달라집니다.
 */

import PptxGenJS from 'pptxgenjs'
import { FONT, SECTION, SLIDE } from './layout'

export type Slide = ReturnType<PptxGenJS['addSlide']>

/** 모든 둥근 모서리가 원본에서 0.04인치였습니다 */
export const R = 0.04

const NO_LINE = { type: 'none' as const }

export function rect(s: Slide, x: number, y: number, w: number, h: number, fill: string) {
  s.addShape('rect', { x, y, w, h, fill: { color: fill }, line: NO_LINE })
}

export function round(s: Slide, x: number, y: number, w: number, h: number, fill: string) {
  s.addShape('roundRect', { x, y, w, h, fill: { color: fill }, line: NO_LINE, rectRadius: R })
}

export function hline(s: Slide, x: number, y: number, w: number, color: string, pt: number) {
  s.addShape('line', { x, y, w, h: 0, line: { color, width: pt } })
}

export interface TextOpt {
  x: number
  y: number
  w: number
  h: number
  sz: number
  color: string
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
}

export function text(s: Slide, body: string | PptxGenJS.TextProps[], o: TextOpt) {
  s.addText(body as never, {
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    fontSize: o.sz,
    fontFace: FONT,
    color: o.color,
    bold: o.bold ?? false,
    align: o.align ?? 'left',
    valign: o.valign ?? 'middle',
    margin: 0,
    // 한 줄짜리 칸이 자동 줄바꿈으로 밀리면 좌표가 어긋납니다.
    // 표 본문만 줄바꿈을 허용하고 나머지는 호출부에서 잘라 넣습니다.
    wrap: true,
  })
}

/** 장 제목 — 남색 세로 막대 + 글자 */
export function sectionTitle(
  s: Slide,
  pos: { x: number; y: number; w: number },
  label: string,
  navy: string,
) {
  rect(s, pos.x, pos.y, SECTION.tick.w, SECTION.tick.h, navy)
  text(s, label, {
    x: pos.x + SECTION.label.dx,
    y: pos.y - SECTION.tick.dy,
    w: pos.w,
    h: SECTION.label.h,
    sz: SECTION.label.sz,
    color: navy,
    bold: true,
  })
}

export const LAYOUT_NAME = 'REPORT_WIDE'

export function defineSlideSize(pptx: PptxGenJS): void {
  // PptxGenJS 의 'LAYOUT_16x9' 는 13.333×7.5 가 **아니라 10×5.625인치**입니다.
  // 이름만 보고 그것을 쓰면 좌표는 원본과 한 치도 안 틀리는데 슬라이드만 작아서,
  // 오른쪽 단과 아래쪽이 통째로 화면 밖으로 나갑니다. 파워포인트도 Keynote 도
  // 이것을 오류로 알리지 않고 그냥 잘라 보여 줍니다. 13.333×7.5 는 'LAYOUT_WIDE'
  // 이지만, 이름에 기대지 않고 layout.ts 의 SLIDE 값으로 직접 정의합니다.
  pptx.defineLayout({ name: LAYOUT_NAME, width: SLIDE.w, height: SLIDE.h })
  pptx.layout = LAYOUT_NAME
}
