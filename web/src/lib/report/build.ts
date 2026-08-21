/**
 * 주간 보고서 조립 — 스냅샷 두 개와 태스크 맵을 받아 모델을 만듭니다.
 *
 * 화면은 이 함수 하나만 부르면 됩니다. **집계는 전부 순수 함수**이고 여기는
 * 그것을 순서대로 엮는 자리입니다 — DB 접근도 파일 접근도 없습니다.
 */

import { applyTaskMap, mapFootnotes } from './apply'
import { ISSUES, PLANS, STANDALONE_RULE, TABLE, TABLE_CONT } from './layout'
import type { TaskEntry } from '../taskmap'
import type { ReportTicket } from './ops'
import type { DeskState } from './types'
import { buildWeekly, type WeeklyModel } from './weekly'
import { nextWeek, parseWeekLabel, rangeLabel, weekOf, type Week } from './week'

export interface BuildInput {
  /** 그 주의 마감 상태를 담은 스냅샷 */
  state: DeskState
  /** 스냅샷을 뜬 날 */
  day: string
  /** 구간 시작 이전의 스냅샷. 없으면 기준 주차 */
  base: DeskState | null
  baseDay: string | null
  entries: TaskEntry[]
  /** 그 주 운영 현황의 원천. 대시보드를 못 읽었으면 빈 배열 */
  tickets: ReportTicket[]
  /** 끝나는 월요일(`2026-08-24`). 없으면 **스냅샷이 속한 구간** */
  weekId?: string
  subtitle: string
}

export interface BuildOutput {
  model: WeeklyModel
  week: Week
  nextLabel: string
  fileName: string
}

/**
 * **맵을 양쪽 스냅샷에 다 적용합니다.**
 *
 * 한쪽만 적용하면 통합 항목이 지난주엔 없던 것으로 보여 전부 '금주 신규' 가
 * 됩니다. diff 는 `work.id` 로 대조하는데 통합 항목의 id 는 우리가 만든
 * `entry.key` 라, 양쪽이 같은 규칙을 거쳐야 짝이 맞습니다.
 */
export function buildWeeklyReport(input: BuildInput): BuildOutput {
  const week = (input.weekId ? parseWeekLabel(input.weekId) : null) ?? weekOf(input.day)

  const now = applyTaskMap(input.state, { entries: input.entries })
  const before = input.base ? applyTaskMap(input.base, { entries: input.entries }).state : null

  const model = buildWeekly(before, now.state, {
    week,
    nextWeek: nextWeek(week),
    reportedOn: input.day,
    subtitle: input.subtitle,
    baseline: input.baseDay,
    // 정체(3주 연속)는 스냅샷 3주치가 쌓여야 판정합니다. 화면에서는 아직
    // 과거 스냅샷을 여러 개 내려받지 않으므로 비워 두고, 못 잰다는 사실은
    // buildWeekly 가 각주에 적습니다.
    history: [],
    // **한 장짜리 보고서입니다.** 이슈(3장)와 차주 계획(4장)은 진행 현황과 같은
    // 장에 있어야 합니다 — 그게 이 보고서의 서식이고, 받는 사람은 한 장을 봅니다.
    //
    // 한때 표가 넘치면 3·4장을 압축하거나(compact) 다음 장으로 내리고(spill) 표를
    // 이어지는 장에 계속 그렸습니다. 표를 안 자르려는 것이었지만 **서식이 바뀌는
    // 것**이라 그렇게 두지 않습니다. 넘치면 예전처럼 행을 자르고 몇 건 중 몇 건인지
    // 각주에 적습니다 — 자른 사실이 남으면 읽는 사람이 확인할 수 있습니다.
    //
    // `layouts`·`maxPages` 는 그대로 두고 값만 한 장으로 묶었습니다. 서식을 바꾸는
    // 것은 코드가 아니라 **결정**이므로, 되돌릴 일이 생기면 여기 한 곳만 봅니다.
    table: {
      layouts: [
        { mode: 'base', budget: TABLE.bottom - TABLE.top, maxChanges: ISSUES.max, maxPlans: PLANS.max },
      ],
      contBudget: TABLE_CONT.bottom - TABLE_CONT.top,
      headerH: TABLE.groupH,
      ruleH: STANDALONE_RULE.h,
      rowH: TABLE.rowH,
      maxPages: 1,
    },
    tickets: input.tickets,
  })

  model.footnotes.push(...mapFootnotes(now.issues, input.entries.length > 0))
  if (input.day > week.to) {
    // 그 주 마감 뒤에 뜬 스냅샷이 없어 이후 상태로 만들었다는 사실을 밝힙니다
    model.footnotes.push(`구간 마감(${week.to}) 이후 스냅샷(${input.day}) 기준`)
  } else if (input.day < week.to) {
    // **아직 안 닫힌 구간**입니다. 마감 전 중간 집계라 같은 구간을 다음 주에 다시
    // 만들면 숫자가 달라집니다 — 안 적으면 확정된 수치로 읽힙니다.
    model.footnotes.push(`구간 진행 중 · ${input.day} 기준 (마감 ${week.to})`)
  }

  return {
    model,
    week,
    nextLabel: rangeLabel(nextWeek(week)),
    fileName: `주간업무보고_${week.id}.pptx`,
  }
}
