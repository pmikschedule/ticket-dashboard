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
import { buildWeekly, diffWork, type WeeklyModel } from './weekly'
import { addDays, holidaysIn, nextWeek, parseWeekLabel, rangeLabel, weekOf, type Week } from './week'

export interface BuildInput {
  /** 그 주의 마감 상태를 담은 스냅샷 */
  state: DeskState
  /** 스냅샷을 뜬 날 */
  day: string
  /** 구간 시작 이전의 스냅샷. 없으면 기준 주차 */
  base: DeskState | null
  baseDay: string | null
  /**
   * `base` 보다 **한 주씩 더 앞선** 스냅샷들 (가까운 것부터). 금주에 처리된 일이
   * 없을 때 비교 기준을 앞당기는 데 씁니다. 없으면 앞당기지 않습니다.
   */
  earlier?: { day: string; state: DeskState }[]
  /** 보고서를 만든 날. 없으면 `day` — 머리글의 보고일입니다 */
  reportedOn?: string
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
  const pick = pickBaseline(input, now.state, week)

  const model = buildWeekly(pick.before, now.state, {
    week,
    nextWeek: nextWeek(week),
    reportedOn: input.reportedOn ?? input.day,
    snapshotDay: input.day,
    widened: pick.widened,
    subtitle: input.subtitle,
    baseline: pick.day,
    // 정체(3주 연속)는 스냅샷 3주치가 쌓여야 판정합니다. 화면에서는 아직
    // 과거 스냅샷을 여러 개 내려받지 않으므로 비워 두고, 못 잰다는 사실은
    // buildWeekly 가 각주에 적습니다.
    history: [],
    // **한 장짜리 보고서입니다.** 이슈(3장)와 차주 계획(4장)은 진행 현황과 같은
    // 장에 있어야 합니다 — 그게 이 보고서의 서식이고, 받는 사람은 한 장을 봅니다.
    //
    // 한때 표가 넘치면 3·4장을 압축하거나(compact) 다음 장으로 내리고(spill) 표를
    // 이어지는 장에 계속 그렸습니다. 표를 안 자르려는 것이었지만 **서식이 바뀌는
    // 것**이라 그렇게 두지 않습니다. 그다음에는 넘치면 행을 잘랐는데, 각주가
    // 슬라이드에 안 그려져 **자른 사실이 어디에도 안 보였습니다** (9/21 주에 desk
    // 에 등록된 16건 중 10건만 실렸습니다). 이제는 자르기 전에 묶습니다(`fold`).
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
      // 넘치면 자르기 전에 **같은 프로젝트·같은 상태끼리 묶습니다.** 서식(좌표·열)은
      // 그대로이고 행의 내용만 합칩니다 — 한 장이라는 서식과 '빠짐없이' 를 같이 지킵니다.
      fold: true,
      cols: {
        title: { w: TABLE.cols.title.w, sz: TABLE.cols.title.sz, lines: 1 },
        // 행 높이(0.26인치)에 7.3pt 두 줄이 들어갑니다. 셋째 줄부터 아래 행과 겹칩니다
        detail: { w: TABLE.cols.detail.w, sz: TABLE.cols.detail.sz, lines: 2 },
      },
    },
    tickets: input.tickets,
  })

  model.footnotes.push(...mapFootnotes(now.issues, input.entries.length > 0))
  if (pick.widened) {
    model.footnotes.push(
      `금주 완료 없음${pick.widened.reason ? ` (${pick.widened.reason})` : ''} — ${pick.widened.range} 처리분까지 담았습니다`,
    )
  }
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

/**
 * 비교 기준 고르기 — **금주에 처리된 일이 없으면 한 주씩 앞당깁니다.**
 *
 * 연휴가 낀 주(2026-09-22 ~ 9/28, 추석)는 완료가 0 입니다. 지난주 스냅샷과만
 * 비교하면 표에는 진행중 몇 줄만 남고, 바로 전 주에 끝낸 아홉 건은 그 주 보고를
 * 걸렀다면 **어느 보고서에도 안 실립니다.** 그래서 완료가 나올 때까지 기준을 한
 * 주씩 당겨 직전 처리분을 담고, 그 사실을 요약 띠에 적습니다(`widened`).
 *
 * '처리' 는 **완료**입니다. 착수·신규만 있는 주도 처리한 일은 없는 주입니다.
 * 끝까지 당겨도 완료가 없으면 원래 기준으로 돌아갑니다 — 두 주를 합쳐도 없는
 * 것을 합쳐 봐야 표만 흐려집니다.
 *
 * 맵은 양쪽에 똑같이 얹습니다 (위 `buildWeeklyReport` 주석과 같은 이유).
 */
function pickBaseline(
  input: BuildInput,
  now: DeskState,
  week: Week,
): { before: DeskState | null; day: string | null; widened: WeeklyModel['widened'] } {
  const map = { entries: input.entries }
  const own = input.base ? applyTaskMap(input.base, map).state : null
  const plain = { before: own, day: input.baseDay, widened: null }
  if (!own || diffWork(own, now).done.size > 0) return plain

  for (const e of input.earlier ?? []) {
    const before = applyTaskMap(e.state, map).state
    if (diffWork(before, now).done.size === 0) continue
    // 담기는 기간은 그 스냅샷 **다음 날**이 속한 구간부터입니다 (월 18:00 스냅샷이면 화요일)
    const from = weekOf(addDays(e.day, 1)).from
    return {
      before,
      day: e.day,
      widened: {
        from,
        range: rangeLabel({ ...week, from }),
        reason: holidaysIn(now.holidays ?? [], week) || null,
      },
    }
  }
  return plain
}
