import { describe, expect, it } from 'vitest'
import * as upload from '../src/upload.ts'
import { snapshotRow } from '../src/upload.ts'
import type { DeskState, Snapshot } from '../src/types.ts'

function state(over: Partial<DeskState> = {}): DeskState {
  return { updatedAt: null, work: [], projects: [], decisions: [], systems: [], people: [], ...over }
}

function snap(over: Partial<Snapshot['meta']> = {}, st: DeskState = state()): Snapshot {
  return {
    meta: {
      scannedAt: '2026-08-13T11:33:17.000Z',
      yearMonth: '2026-08',
      sourceUpdatedAt: '2026-08-13T11:30:00.000Z',
      counts: { work: 42, projects: 10, decisions: 2 },
      ...over,
    },
    state: st,
  }
}

describe('스냅샷 → 행', () => {
  it('스캔 날짜가 기본키입니다 — 하루 한 개', () => {
    expect(snapshotRow(snap()).day).toBe('2026-08-13')
  })

  it('state 를 가공하지 않고 통째로 넣습니다', () => {
    // 보고서 서식이 바뀌어도 과거 스냅샷에서 다시 뽑을 수 있어야 합니다.
    // 여기서 요약하면 그 순간 정보가 사라지고 되돌릴 방법이 없습니다.
    const original = state({ work: [{ id: 'w1' } as never], projects: [{ key: 'p' } as never] })
    expect(snapshotRow(snap({}, original)).state).toBe(original)
  })

  it('원본 시각이 없으면 null 로 둡니다 (스캔 시각으로 채우지 않습니다)', () => {
    expect(snapshotRow(snap({ sourceUpdatedAt: null })).source_at).toBeNull()
  })

  it('counts 는 목록 화면이 본문 없이 훑기 위한 사본입니다', () => {
    expect(snapshotRow(snap()).counts).toEqual({ work: 42, projects: 10, decisions: 2 })
  })
})

/**
 * **이 도구는 태스크 맵을 쓰지 않습니다.**
 *
 * 예전에는 로컬 `config/taskmap.json` 을 대시보드로 덮어썼습니다. 편집이 화면으로
 * 옮겨 간 뒤에도 그 코드가 남아 있었고, 로컬 파일은 비어 있었습니다 — 스캔 한
 * 번이면 화면에서 만든 분류가 통째로 날아가는 상태였습니다. 게다가 화면의 낙관적
 * 잠금을 우회했습니다.
 *
 * 되돌아오기 쉬운 종류의 코드라 테스트로 못박습니다. 맵의 원본은 대시보드이고
 * 이 도구는 `dashboard.fetchTaskMap` 으로 읽기만 합니다.
 */
describe('업로드 방향', () => {
  it('태스크 맵을 올리는 함수가 없습니다', () => {
    expect(Object.keys(upload)).not.toContain('uploadTaskMap')
  })

  it('올리는 것은 스냅샷뿐입니다', () => {
    expect(Object.keys(upload).filter((k) => k.startsWith('upload')).sort()).toEqual([
      'uploadSnapshot',
      'uploadedDays',
    ])
  })
})
