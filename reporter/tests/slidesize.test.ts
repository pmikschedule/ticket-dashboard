/**
 * 슬라이드 크기 회귀 테스트.
 *
 * `pptx.layout = 'LAYOUT_16x9'` 로 뒀다가 슬라이드가 10×5.625인치로 만들어진
 * 적이 있습니다. 이름이 16:9 라서 13.333×7.5 인 줄 알았는데 아니었습니다.
 *
 * 좌표는 원본과 한 치도 안 틀렸기 때문에 **도형 좌표를 아무리 대조해도 안 잡힙니다.**
 * 슬라이드만 작아서 오른쪽 단과 아래쪽이 통째로 화면 밖으로 나갔고,
 * 파워포인트도 Keynote 도 그것을 오류로 알리지 않고 잘라 보여 줬습니다.
 * 사람이 열어 보기 전까지 아무도 몰랐습니다.
 */

import { describe, expect, it } from 'vitest'
import PptxGenJS from 'pptxgenjs'
import { SLIDE } from '../src/layout.ts'
import { defineSlideSize } from '../src/draw.ts'

const EMU_PER_INCH = 914_400

/** 원본 `활동_월간요약보고서.pptx` 의 sldSz 실측값 */
const ORIGINAL = { cx: 12_192_000, cy: 6_858_000 }

describe('슬라이드 크기', () => {
  it('좌표계(SLIDE)와 실제 슬라이드가 같습니다', () => {
    const pptx = new PptxGenJS()
    defineSlideSize(pptx)
    expect(pptx.presLayout.width).toBeCloseTo(SLIDE.w * EMU_PER_INCH, 0)
    expect(pptx.presLayout.height).toBeCloseTo(SLIDE.h * EMU_PER_INCH, 0)
  })

  it('원본과 EMU 단위까지 같습니다', () => {
    const pptx = new PptxGenJS()
    defineSlideSize(pptx)
    expect(Math.round(pptx.presLayout.width)).toBe(ORIGINAL.cx)
    expect(Math.round(pptx.presLayout.height)).toBe(ORIGINAL.cy)
  })

  it('LAYOUT_16x9 는 우리가 쓰는 크기가 아닙니다', () => {
    // 이 테스트는 실패를 재현해 두는 것이 목적입니다.
    // 언젠가 누가 '16x9 면 되잖아' 하고 되돌리는 것을 막습니다.
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_16x9'
    expect(Math.round(pptx.presLayout.width)).not.toBe(ORIGINAL.cx)
    expect(pptx.presLayout.width / EMU_PER_INCH).toBeCloseTo(10, 3)
  })
})
