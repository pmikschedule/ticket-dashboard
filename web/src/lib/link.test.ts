import { describe, expect, it } from 'vitest'

import {
  buildMailComment,
  formatSender,
  isMailComment,
  parseTicketNumber,
  rankLinkCandidates,
} from './link'
import type { ScannedMail, TicketWithMeta } from './types'

function mail(overrides: Partial<ScannedMail> = {}) {
  return {
    subject: 'RE: ERP 전표 저장 오류',
    body: '추가 정보입니다.\n화면 캡처를 첨부합니다.',
    sender_name: '홍길동',
    sender_email: 'hong@corp.kr',
    received_at: '2026-08-07T05:32:00.000Z',
    scanned_at: '2026-08-07T05:40:00.000Z',
    ...overrides,
  } as ScannedMail
}

function ticket(overrides: Partial<TicketWithMeta> = {}) {
  return {
    id: 1,
    reporter_email: 'hong@corp.kr',
    received_at: '2026-08-01T00:00:00.000Z',
    ticket_meta: { status: 'in_progress' },
    ...overrides,
  } as TicketWithMeta
}

describe('formatSender', () => {
  it('이름이 있으면 이름과 주소를 함께 보여 줍니다', () => {
    expect(formatSender(mail())).toBe('홍길동 <hong@corp.kr>')
  })

  it('이름이 없으면 주소만', () => {
    expect(formatSender(mail({ sender_name: null }))).toBe('hong@corp.kr')
  })

  it('공백뿐인 이름은 없는 것으로 봅니다', () => {
    expect(formatSender(mail({ sender_name: '   ' }))).toBe('hong@corp.kr')
  })

  it('주소도 없으면 그렇다고 말합니다', () => {
    expect(formatSender(mail({ sender_name: null, sender_email: '' }))).toBe('발신자 미상')
  })
})

describe('buildMailComment', () => {
  it('머리에 시각과 발신자를 답니다', () => {
    const text = buildMailComment(mail())
    expect(text.split('\n')[0]).toContain('홍길동 <hong@corp.kr>')
    expect(text).toContain('제목: RE: ERP 전표 저장 오류')
    expect(text).toContain('추가 정보입니다.')
  })

  it('메일에서 온 코멘트임을 표시합니다', () => {
    expect(isMailComment(buildMailComment(mail()))).toBe(true)
  })

  it('사람이 쓴 코멘트는 표시가 없습니다', () => {
    expect(isMailComment('확인했습니다. 내일 배포합니다.')).toBe(false)
  })

  it('덧붙인 메모가 있으면 맨 뒤에 답니다', () => {
    expect(buildMailComment(mail(), '요청자 재확인함')).toContain('— 요청자 재확인함')
  })

  it('메모가 공백뿐이면 붙이지 않습니다', () => {
    expect(buildMailComment(mail(), '   ')).not.toContain('—')
  })

  it('제목과 본문이 비어도 자리를 지킵니다', () => {
    const text = buildMailComment(mail({ subject: '', body: '' }))
    expect(text).toContain('제목: (제목 없음)')
    expect(text).toContain('(본문 없음)')
  })

  it('수신일시가 없으면 스캔 시각을 씁니다', () => {
    const text = buildMailComment(mail({ received_at: null }))
    expect(text).not.toContain('시각 미상')
  })

  it('둘 다 없으면 지어내지 않습니다', () => {
    const text = buildMailComment(mail({ received_at: null, scanned_at: null as never }))
    expect(text).toContain('시각 미상')
  })
})

describe('parseTicketNumber', () => {
  it('숫자를 번호로 읽습니다', () => {
    expect(parseTicketNumber('42')).toBe(42)
  })

  it('#을 붙여도 읽습니다', () => {
    expect(parseTicketNumber('#42')).toBe(42)
  })

  it('앞뒤 공백은 무시합니다', () => {
    expect(parseTicketNumber('  #42  ')).toBe(42)
  })

  it('제목 검색어는 번호가 아닙니다', () => {
    expect(parseTicketNumber('ERP')).toBeNull()
    expect(parseTicketNumber('42번 건')).toBeNull()
  })

  it('0과 음수는 티켓 번호가 아닙니다', () => {
    expect(parseTicketNumber('0')).toBeNull()
    expect(parseTicketNumber('-3')).toBeNull()
  })

  it('빈 문자열은 번호가 아닙니다', () => {
    expect(parseTicketNumber('')).toBeNull()
  })
})

describe('rankLinkCandidates', () => {
  it('같은 요청자의 티켓을 맨 위로', () => {
    const ranked = rankLinkCandidates(
      [ticket({ id: 1, reporter_email: 'other@corp.kr' }), ticket({ id: 2 })],
      'hong@corp.kr',
    )
    expect(ranked[0].id).toBe(2)
  })

  it('주소 대소문자는 무시합니다', () => {
    const ranked = rankLinkCandidates(
      [ticket({ id: 1, reporter_email: 'other@corp.kr' }), ticket({ id: 2 })],
      'HONG@CORP.KR',
    )
    expect(ranked[0].id).toBe(2)
  })

  it('같은 요청자라면 안 끝난 건이 먼저', () => {
    const ranked = rankLinkCandidates(
      [
        ticket({ id: 1, ticket_meta: { status: 'done' } as never }),
        ticket({ id: 2, ticket_meta: { status: 'triage' } as never }),
      ],
      'hong@corp.kr',
    )
    expect(ranked[0].id).toBe(2)
  })

  it('조건이 같으면 최근 접수 순', () => {
    const ranked = rankLinkCandidates(
      [
        ticket({ id: 1, received_at: '2026-07-01T00:00:00.000Z' }),
        ticket({ id: 2, received_at: '2026-08-01T00:00:00.000Z' }),
      ],
      'hong@corp.kr',
    )
    expect(ranked[0].id).toBe(2)
  })

  it('완료된 건도 목록에서 빼지 않습니다', () => {
    const ranked = rankLinkCandidates(
      [ticket({ id: 1, ticket_meta: { status: 'done' } as never })],
      'hong@corp.kr',
    )
    expect(ranked).toHaveLength(1)
  })

  it('원본 배열을 바꾸지 않습니다', () => {
    const input = [ticket({ id: 1, reporter_email: 'other@corp.kr' }), ticket({ id: 2 })]
    rankLinkCandidates(input, 'hong@corp.kr')
    expect(input[0].id).toBe(1)
  })
})
