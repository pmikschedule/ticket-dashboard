import { describe, expect, it } from 'vitest'

import { buildReplyBody, buildReplySubject, leadTimeHours } from './reply'
import type { TicketMeta } from './types'

const ticket = {
  subject: 'ERP 전표 저장 오류',
  reporter_name: '김영희',
  received_at: '2026-08-05T09:00:00+00:00',
}

const meta: Pick<
  TicketMeta,
  'category' | 'severity' | 'system_type' | 'status' | 'completed_at'
> = {
  category: 'error',
  severity: 'critical',
  system_type: 'erp',
  status: 'done',
  completed_at: '2026-08-05T15:00:00+00:00',
}

describe('buildReplySubject', () => {
  it('RE: 를 붙입니다', () => {
    expect(buildReplySubject('ERP 오류')).toBe('RE: ERP 오류')
  })
  it('이미 있으면 겹쳐 붙이지 않습니다', () => {
    expect(buildReplySubject('RE: ERP 오류')).toBe('RE: ERP 오류')
  })
  it('소문자 re: 도 인식합니다', () => {
    expect(buildReplySubject('re: ERP 오류')).toBe('re: ERP 오류')
  })
  it('빈 제목은 기본값', () => {
    expect(buildReplySubject('')).toBe('RE: 요청 처리 결과')
  })
})

describe('leadTimeHours', () => {
  it('시간 차이', () => {
    expect(leadTimeHours('2026-08-05T09:00:00Z', '2026-08-05T15:00:00Z')).toBe(6)
  })
  it('완료 전이면 null', () => {
    expect(leadTimeHours('2026-08-05T09:00:00Z', null)).toBeNull()
  })
  it('완료가 접수보다 빠르면 null', () => {
    expect(leadTimeHours('2026-08-05T15:00:00Z', '2026-08-05T09:00:00Z')).toBeNull()
  })
})

describe('buildReplyBody', () => {
  it('요청자 이름으로 인사합니다', () => {
    expect(buildReplyBody(ticket, meta)).toContain('김영희님, 안녕하세요.')
  })

  it('이름이 없으면 일반 인사', () => {
    const body = buildReplyBody({ ...ticket, reporter_name: null }, meta)
    expect(body.startsWith('안녕하세요.')).toBe(true)
  })

  it('코드값이 아니라 한글 라벨이 들어갑니다', () => {
    const body = buildReplyBody(ticket, meta)
    expect(body).toContain('오류')
    expect(body).toContain('Critical')
    expect(body).toContain('ERP')
    expect(body).toContain('완료')
    expect(body).not.toContain('system_type')
  })

  it('소요 시간이 들어갑니다', () => {
    expect(buildReplyBody(ticket, meta)).toContain('6.0시간')
  })

  it('코멘트가 있으면 처리 내역 절이 생깁니다', () => {
    const body = buildReplyBody(ticket, meta, [
      { content: '핫픽스 배포 완료' },
      { content: '회계팀 확인 완료' },
    ])
    expect(body).toContain('■ 처리 내역')
    expect(body).toContain('핫픽스 배포 완료')
  })

  it('코멘트가 없으면 절 자체가 없습니다 — 빈 제목만 남기지 않습니다', () => {
    expect(buildReplyBody(ticket, meta, [])).not.toContain('■ 처리 내역')
  })

  it('공백뿐인 코멘트는 걸러냅니다', () => {
    expect(buildReplyBody(ticket, meta, [{ content: '   ' }])).not.toContain('■ 처리 내역')
  })

  it('meta 가 없어도 터지지 않습니다', () => {
    expect(buildReplyBody(ticket, null)).toContain('안녕하세요')
  })

  it('서명으로 끝납니다', () => {
    expect(buildReplyBody(ticket, meta).trimEnd().endsWith('IT 운영팀 드림')).toBe(true)
  })
})
