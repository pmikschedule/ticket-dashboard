import { describe, expect, it } from 'vitest'

import { briefText, clampText, fits, listLine, wrapLines } from './clamp'
import { TABLE } from './layout'

// 진행사항 칸 그대로 — 0.9인치, 7.3pt, 두 줄 (행 높이 0.26인치에 두 줄이 한계)
const D = { w: TABLE.cols.detail.w, sz: TABLE.cols.detail.sz }
const brief = (text: string, title = '') => briefText(text, title, D.w, D.sz, 2)

describe('wrapLines — 파워포인트처럼 어절로 접습니다', () => {
  it('들어가는 글은 한 줄입니다', () => {
    expect(wrapLines('구현 진행 중', D.w, D.sz)).toEqual(['구현 진행 중'])
  })

  it('어절 경계에서 접습니다', () => {
    expect(wrapLines('기획 및 개발 동시진행 진행 중', D.w, D.sz)).toEqual(['기획 및 개발', '동시진행 진행 중'])
  })

  it('한 줄보다 긴 어절만 글자 단위로 끊습니다', () => {
    const lines = wrapLines('권한관리·인증·게이트웨이', D.w, D.sz)
    expect(lines.length).toBe(2)
    expect(lines.join('')).toBe('권한관리·인증·게이트웨이')
  })

  it('화살표·줄표는 한 글자 폭으로 잽니다 — 대체 글꼴로 그려집니다', () => {
    // 라틴 폭으로 치면 한 줄에 들어가는 것으로 잘못 셉니다
    expect(fits('불가 → 운영 → 배포 → 불가', D.w, D.sz, 1)).toBe(false)
  })
})

describe('진행사항 칸 — 짧게, 칸을 넘지 않게', () => {
  it('들어가는 글은 그대로 둡니다', () => {
    expect(brief('코드리뷰 진행 중 (Sloan)')).toBe('코드리뷰 진행 중 (Sloan)')
  })

  it('넘치면 괄호 속 부연부터 뺍니다', () => {
    expect(brief('미등록 시 본인인증 불가 (배포 선결조건)')).toBe('미등록 시 본인인증 불가')
  })

  it('그래도 넘치면 첫 마디만 남기고 뒤가 있다고 밝힙니다', () => {
    expect(brief('미등록 시 본인인증 불가 → 운영 배포 불가 (배포 선결조건)')).toBe('미등록 시 본인인증 불가…')
  })

  it('안건 이름을 되풀이하는 머리를 뗍니다 — 바로 왼쪽 칸에 이미 있습니다', () => {
    const out = brief(
      '앱 전반 기획 및 개발 총괄 — 권한관리·인증·게이트웨이 설계/구현, 각종 메뉴 기획·개발, 전체 기획 등 앱 전반을 담당.',
      '앱 전반 기획 및 개발 총괄',
    )
    expect(out.startsWith('권한관리')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })

  it('어떤 글도 두 줄을 넘지 않습니다 (2026-09-28 에 네다섯 줄이 아래 행과 겹쳤습니다)', () => {
    const samples = [
      '사용자 테스트 + 마이그레이션 + UI 등 피드백 반영 + 내부 인증 라이브러리 연동(Sloan 안내 예정)',
      '목표: 9/11까지 데이터 마이그레이션 + PRD 배포 후 홀딩 상태로 전환 (Alexa)',
      '개발 MPM 미동작 이슈 대응 + 진행하며 작업 범위 증가로 마감 8/19→8/26 연기',
      'Averyveryveryverylongenglishwordwithoutanyspaces',
    ]
    for (const s of samples) {
      const out = brief(s)
      expect(wrapLines(out, D.w, D.sz).length).toBeLessThanOrEqual(2)
      expect(out.length).toBeGreaterThan(1)
    }
  })

  it('자른 끝에 이음표를 남기지 않습니다', () => {
    const out = brief('사용자 테스트 + 마이그레이션 + UI 등 피드백 반영 + 내부 인증 라이브러리 연동')
    expect(out).not.toMatch(/[+·,]\s*…$/)
  })

  it('빈 글은 빈 글입니다 — 지어내지 않습니다', () => {
    expect(brief('')).toBe('')
    expect(brief('   ')).toBe('')
  })
})

describe('clampText', () => {
  it('줄 수 안에서 자르고 … 을 답니다', () => {
    const out = clampText('가나다라마바사아자차카타파하 가나다라마바사아자차카타파하', D.w, D.sz, 1)
    expect(out.endsWith('…')).toBe(true)
    expect(fits(out, D.w, D.sz, 1)).toBe(true)
  })
})

describe('묶음 행의 안건 — 이름을 들어가는 만큼, 나머지는 건수로', () => {
  const T = { w: TABLE.cols.title.w, sz: TABLE.cols.title.sz }

  it('다 들어가면 다 적습니다', () => {
    expect(listLine(['재가입 구현', '카카오로 가입하기 구현'], T.w, T.sz)).toBe('재가입 구현, 카카오로 가입하기 구현')
  })

  it('넘치면 앞에서부터 싣고 외 N건', () => {
    const out = listLine(
      ['재가입 구현', '카카오로 가입하기 구현', '회원가입 프로젝트 진행상황 팔로업', 'NICE 도메인 등록 (본인인증)'],
      T.w,
      T.sz,
    )
    expect(out).toMatch(/^재가입 구현, .* 외 \d건$/)
    expect(fits(out, T.w, T.sz, 1)).toBe(true)
  })

  it('첫 이름조차 길면 그 이름을 잘라서라도 한 건은 보입니다', () => {
    const long = '아주 긴 업무 이름 '.repeat(8).trim()
    const out = listLine([long, '둘째'], T.w, T.sz)
    expect(out.endsWith(' 외 1건')).toBe(true)
    expect(fits(out, T.w, T.sz, 1)).toBe(true)
  })
})
