import { describe, expect, it } from 'vitest'

import {
  allowedTransitions,
  canAssign,
  canDeleteComment,
  canEditTicket,
  canMoveTo,
  canRequestSend,
  canSendReply,
  isAdmin,
  isOverdue,
  receivedAtError,
  RECEIVED_AT_SKEW_MINUTES,
  requiresHoldReason,
  requiresResolution,
} from './workflow'
import type { AppUser, TicketMeta } from './types'

const admin: AppUser = {
  id: 'admin-1',
  email: 'admin@example.co.kr',
  name: '관리자',
  role: 'admin',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
}

const member: AppUser = { ...admin, id: 'member-1', name: 'David', role: 'member' }
const inactiveAdmin: AppUser = { ...admin, id: 'admin-2', is_active: false }

function meta(overrides: Partial<TicketMeta> = {}): TicketMeta {
  return {
    ticket_id: 1,
    work_type: 'maintenance',
    category: 'error',
    severity: 'high',
    system_type: 'erp',
    status: 'in_progress',
    assignee_id: null,
    estimated_days: null,
    promoted_at: null,
    promoted_by: null,
    llm_model: null,
    llm_confidence: null,
    llm_reason: null,
    llm_error: null,
    completed_at: null,
    resolution: null,
    hold_reason: null,
    hold_from_status: null,
    updated_at: '2026-08-05T00:00:00Z',
    ...overrides,
  }
}

describe('allowedTransitions', () => {
  it('팀원은 인접 단계로만', () => {
    expect(allowedTransitions('in_progress', false)).toEqual(['triage', 'testing', 'on_hold'])
  })

  it('첫 단계는 앞으로만', () => {
    expect(allowedTransitions('intake', false)).toEqual(['triage', 'on_hold'])
  })

  it('마지막 단계는 뒤로만', () => {
    expect(allowedTransitions('done', false)).toEqual(['deploy'])
  })

  it('관리자는 어디로든 (현재 상태 제외)', () => {
    const result = allowedTransitions('intake', true)
    expect(result).toHaveLength(6)
    expect(result).toContain('done')
    expect(result).not.toContain('intake')
  })
})

describe('canMoveTo', () => {
  it('팀원의 단계 건너뛰기는 막습니다', () => {
    expect(canMoveTo('intake', 'done', false)).toBe(false)
  })
  it('팀원의 한 칸 전진은 허용', () => {
    expect(canMoveTo('intake', 'triage', false)).toBe(true)
  })
  it('팀원의 한 칸 후퇴도 허용 — 잘못 옮긴 걸 되돌려야 합니다', () => {
    expect(canMoveTo('testing', 'in_progress', false)).toBe(true)
  })
  it('관리자는 건너뛸 수 있습니다', () => {
    expect(canMoveTo('intake', 'done', true)).toBe(true)
  })
})

describe('isAdmin', () => {
  it('관리자', () => expect(isAdmin(admin)).toBe(true))
  it('팀원', () => expect(isAdmin(member)).toBe(false))
  it('비활성 관리자는 관리자가 아닙니다', () => expect(isAdmin(inactiveAdmin)).toBe(false))
  it('null', () => expect(isAdmin(null)).toBe(false))
})

describe('canEditTicket', () => {
  it('관리자는 전체', () => {
    expect(canEditTicket(admin, meta())).toBe(true)
  })
  it('팀원은 본인 할당 건만', () => {
    expect(canEditTicket(member, meta({ assignee_id: 'member-1' }))).toBe(true)
  })
  it('팀원은 남의 티켓을 못 고칩니다', () => {
    expect(canEditTicket(member, meta({ assignee_id: 'other' }))).toBe(false)
  })
  it('미배정 티켓도 팀원은 못 고칩니다', () => {
    expect(canEditTicket(member, meta({ assignee_id: null }))).toBe(false)
  })
  it('비로그인', () => {
    expect(canEditTicket(null, meta())).toBe(false)
  })
})

describe('canAssign / canRequestSend', () => {
  it('배정은 관리자만', () => {
    expect(canAssign(admin)).toBe(true)
    expect(canAssign(member)).toBe(false)
  })
  it('발송 요청은 관리자만', () => {
    expect(canRequestSend(admin)).toBe(true)
    expect(canRequestSend(member)).toBe(false)
  })
})

describe('canSendReply', () => {
  it('완료 상태여야 보냅니다', () => {
    expect(canSendReply(admin, meta({ status: 'done' }))).toBe(true)
  })
  it('완료 전에는 못 보냅니다', () => {
    expect(canSendReply(admin, meta({ status: 'deploy' }))).toBe(false)
  })
  it('완료여도 팀원은 못 보냅니다', () => {
    expect(canSendReply(member, meta({ status: 'done' }))).toBe(false)
  })
})

describe('canDeleteComment', () => {
  it('본인 코멘트', () => expect(canDeleteComment(member, 'member-1')).toBe(true))
  it('남의 코멘트는 팀원이 못 지웁니다', () => {
    expect(canDeleteComment(member, 'other')).toBe(false)
  })
  it('관리자는 남의 것도 지웁니다', () => {
    expect(canDeleteComment(admin, 'other')).toBe(true)
  })
})

describe('isOverdue', () => {
  const today = new Date('2026-08-10T12:00:00+09:00')

  it('기한 없음', () => expect(isOverdue(null, 'in_progress', today)).toBe(false))
  it('지난 기한', () => expect(isOverdue('2026-08-01', 'in_progress', today)).toBe(true))
  it('오늘은 아직 초과가 아닙니다', () => {
    expect(isOverdue('2026-08-10', 'in_progress', today)).toBe(false)
  })
  it('완료된 티켓은 지연으로 보지 않습니다', () => {
    expect(isOverdue('2026-08-01', 'done', today)).toBe(false)
  })
})

describe('보류(on_hold) 전이', () => {
  it('완료가 아닌 단계에서는 보류로 갈 수 있습니다', () => {
    for (const status of ['intake', 'triage', 'in_progress', 'testing', 'deploy'] as const) {
      expect(allowedTransitions(status, false)).toContain('on_hold')
    }
  })

  it('완료된 건은 보류할 수 없습니다 — 끝난 건은 기다릴 게 없습니다', () => {
    expect(allowedTransitions('done', false)).not.toContain('on_hold')
  })

  it('보류에서는 직전 단계로만 돌아갑니다', () => {
    expect(allowedTransitions('on_hold', false, 'testing')).toEqual(['testing'])
  })

  it('보류를 거쳐 단계를 건너뛸 수 없습니다', () => {
    // testing 에서 보류했다면 done 으로 바로 갈 수 없어야 합니다.
    expect(canMoveTo('on_hold', 'done', false, 'testing')).toBe(false)
    expect(canMoveTo('on_hold', 'testing', false, 'testing')).toBe(true)
  })

  it('돌아갈 자리를 모르면 팀원은 못 움직입니다 (옛 티켓)', () => {
    expect(allowedTransitions('on_hold', false, null)).toEqual([])
  })

  it('관리자는 보류에서도 어디로든', () => {
    expect(allowedTransitions('on_hold', true, null)).toContain('done')
  })

  it('보류는 사유를, 완료는 종료 방식을 요구합니다', () => {
    expect(requiresHoldReason('on_hold')).toBe(true)
    expect(requiresHoldReason('in_progress')).toBe(false)
    expect(requiresResolution('done')).toBe(true)
    expect(requiresResolution('on_hold')).toBe(false)
  })
})

describe('receivedAtError', () => {
  const now = new Date('2026-08-10T12:00:00Z')

  it('과거 접수일은 통과합니다 — 그게 고치는 목적입니다', () => {
    expect(receivedAtError('2026-07-01T09:00:00Z', now)).toBeNull()
  })

  it('미래 접수일은 막습니다 — 리드타임이 음수가 되고 화면은 그걸 지웁니다', () => {
    expect(receivedAtError('2026-08-11T09:00:00Z', now)).not.toBeNull()
  })

  it('시계 오차만큼은 봐 줍니다', () => {
    const skew = RECEIVED_AT_SKEW_MINUTES * 60_000
    expect(receivedAtError(new Date(now.getTime() + skew - 1000).toISOString(), now)).toBeNull()
    expect(receivedAtError(new Date(now.getTime() + skew + 60_000).toISOString(), now)).not.toBeNull()
  })

  it('빈 값·깨진 값', () => {
    expect(receivedAtError(null, now)).not.toBeNull()
    expect(receivedAtError('어제', now)).not.toBeNull()
  })
})
