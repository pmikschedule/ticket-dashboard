/**
 * 주간 운영 현황 — 티켓 대시보드에서 그 주에 접수된 요청을 셉니다.
 *
 * 주간 보고서 2장의 본문입니다. desk(프로젝트 업무)와 **다른 축**이에요 —
 * 이쪽은 메일로 들어온 요청이고, 1장의 표는 desk 에 등록된 개발 안건입니다.
 * 두 숫자가 안 맞는 게 정상이고, 그래서 장 제목으로 갈라 둡니다.
 *
 * 기간은 보고서와 **같은 화~월 구간**입니다. 월 누적으로 세면 주간 보고서
 * 안에서 기간이 둘이 되어, 어느 숫자가 그 주 것인지 알 수 없게 됩니다.
 */

import type { Category, Severity, Status, WorkType } from '../constants'
import { inWeek, previousWeek, type Week } from './week'

/** 보고서가 쓰는 티켓의 최소 형태 */
export interface ReportTicket {
  id: number
  title: string
  /** 접수일 = tickets.received_at (created_at 이 아닙니다) */
  receivedAt: string
  workType: WorkType
  category: Category
  severity: Severity
  status: Status
  system: string | null
}

/** 등급 4종을 보고서 3칸으로. medium·low 를 '보통' 으로 합칩니다 */
export type SeverityBucket = 'critical' | 'major' | 'normal'

export interface OpsSummary {
  /** 그 주 접수 건수 */
  total: number
  /** 전주 접수. **집계 시작 이전이면 null** (0 이 아닙니다) */
  prevTotal: number | null
  byWorkType: Record<WorkType, number>
  byCategory: Record<Category, number>
  /** 처리 상태 — 6단계를 셋으로 접습니다 */
  progress: { done: number; doing: number; waiting: number }
  /** **장애만** 모수입니다. 유지보수 티켓의 등급은 세지 않습니다 */
  severity: Record<SeverityBucket, number>
  criticalTitles: string[]
}

function severityBucket(s: Severity): SeverityBucket {
  if (s === 'critical') return 'critical'
  if (s === 'high') return 'major'
  return 'normal'
}

/**
 * 라이프사이클 6단계를 셋으로.
 *
 * `intake`·`triage` 는 아직 손대기 전이라 대기, 그 뒤 넷은 굴러가는 중,
 * `done` 만 완료입니다. 여섯을 그대로 늘어놓으면 좁은 칸에 안 들어가고,
 * 읽는 사람에게도 '접수' 와 '분류' 의 차이는 주간 보고 수준에서 뜻이 없습니다.
 */
function progressBucket(s: Status): 'done' | 'doing' | 'waiting' {
  if (s === 'done') return 'done'
  return s === 'intake' || s === 'triage' ? 'waiting' : 'doing'
}

export function ticketsInWeek(tickets: ReportTicket[], week: Week): ReportTicket[] {
  return tickets.filter((t) => inWeek(t.receivedAt, week))
}

export function summarizeOps(tickets: ReportTicket[], week: Week): OpsSummary {
  const mine = ticketsInWeek(tickets, week)
  const incidents = mine.filter((t) => t.workType === 'incident')

  const byWorkType: Record<WorkType, number> = { incident: 0, maintenance: 0, development: 0 }
  const byCategory: Record<Category, number> = { error: 0, improve: 0, fix: 0, new: 0 }
  const progress = { done: 0, doing: 0, waiting: 0 }
  const severity: Record<SeverityBucket, number> = { critical: 0, major: 0, normal: 0 }

  for (const t of mine) {
    byWorkType[t.workType] += 1
    byCategory[t.category] += 1
    progress[progressBucket(t.status)] += 1
  }
  for (const t of incidents) severity[severityBucket(t.severity)] += 1

  return {
    total: mine.length,
    prevTotal: previousTotal(tickets, week),
    byWorkType,
    byCategory,
    progress,
    severity,
    criticalTitles: incidents
      .filter((t) => t.severity === 'critical')
      .map((t) => (t.system ? `${t.title} (${t.system})` : t.title)),
  }
}

/**
 * 전주 접수 건수.
 *
 * **집계 시작 이전이면 null 입니다.** 0 으로 두면 "전주 0건 대비 ▲12" 가 되어
 * 그 주에 갑자기 몰린 것처럼 읽힙니다. 티켓이 하나도 없던 주와 시스템이 아직
 * 안 돌던 주는 다른 사실입니다.
 */
function previousTotal(tickets: ReportTicket[], week: Week): number | null {
  const first = tickets
    .map((t) => t.receivedAt)
    .filter(Boolean)
    .sort()[0]
  if (!first) return null

  const prev = previousWeek(week)
  if (prev.to < first) return null
  return ticketsInWeek(tickets, prev).length
}

/** `전주 8건 대비 ▲4` 형태. 비교 대상이 없으면 그렇게 적습니다 */
export function opsDeltaLabel(ops: OpsSummary): string {
  if (ops.prevTotal === null) return '전주 비교 없음 (집계 시작 전)'
  const d = ops.total - ops.prevTotal
  if (d === 0) return `전주 ${ops.prevTotal}건 대비 △0`
  return `전주 ${ops.prevTotal}건 대비 ${d > 0 ? '▲' : '▼'}${Math.abs(d)}`
}
