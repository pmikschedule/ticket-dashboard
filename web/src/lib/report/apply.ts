/**
 * 태스크 맵 **적용** — desk 태스크를 보고 항목으로 바꿉니다.
 *
 * 규칙 편집(검증·묶기·제외)은 `web/src/lib/taskmap.ts` 가, 그 규칙을 스냅샷에
 * 얹는 일은 여기가 합니다. 나뉜 이유는 편집 화면은 desk 원본을 보여 줘야 하고
 * 보고서는 가공된 결과를 봐야 하기 때문입니다.
 *
 * **원본 스냅샷은 고치지 않습니다.** 맵은 보고 단계에서만 얹는 얇은 층입니다.
 */

import type { TaskEntry } from '../taskmap'
import type { DeskState, DeskWork } from './types'

export interface TaskMapLike {
  entries: TaskEntry[]
}

// ---------------------------------------------------------------------------
// 적용 (순수 함수)
// ---------------------------------------------------------------------------

/** 맵을 적용하며 드러난 사실들. **숨기면 안 되는 것들**이라 호출부가 각주로 냅니다 */
export interface MapIssues {
  /**
   * 어느 보고 항목에도 안 속한 태스크 수.
   *
   * **프로젝트 소속과 무관합니다.** 프로젝트에 잘 붙어 있어도 항목을 안 만들었으면
   * 여기 셉니다. 결함이 아니라 '원본 그대로 한 줄씩 나간다' 는 뜻입니다.
   */
  unmapped: number
  /** 제외 처리된 항목 수 */
  hidden: number
  /** entry 가 가리키는데 desk 에 없는 work.id */
  broken: string[]
  /** 구성원이 하나도 안 남은 항목 key */
  emptied: string[]
}

export interface MapResult {
  state: DeskState
  issues: MapIssues
}

/** 통합된 항목이 달고 다니는 꼬리표. 렌더러가 '구성 2/3' 을 쓸 때 봅니다 */
export interface MergedInfo {
  entryKey: string
  total: number
  done: number
  /** 구성원들의 원래 제목 — UI·미리보기에서 되짚어 봅니다 */
  memberTitles: string[]
}

/** `DeskWork` 를 그대로 흉내 내되 통합 정보를 얹습니다 (아래 계층은 몰라도 됩니다) */
export interface ReportWork extends DeskWork {
  merged?: MergedInfo
}

const first = <T>(xs: (T | null | undefined)[]): T | null => xs.find((x) => x != null) ?? null
const minOf = (xs: (string | null)[]): string | null => {
  const v = xs.filter((x): x is string => Boolean(x)).sort()
  return v[0] ?? null
}
const maxOf = (xs: (string | null)[]): string | null => {
  const v = xs.filter((x): x is string => Boolean(x)).sort()
  return v[v.length - 1] ?? null
}

/**
 * 통합 항목의 상태.
 *
 * **전부 done 이어야 완료입니다.** 3건 중 1건만 끝났는데 완료로 뜨면 그 보고서는
 * 거짓입니다. 일부만 끝난 동안에는 진행중이고, 대신 합산 진척율이 올라갑니다.
 */
function mergedStatus(members: DeskWork[]): DeskWork['status'] {
  if (members.every((m) => m.status === 'done')) return 'done'
  // 전부 멈춰 있을 때만 항목이 보류입니다. 하나라도 굴러가면 그 일은 굴러갑니다
  if (members.every((m) => m.status === 'hold')) return 'hold'
  if (members.some((m) => m.status === 'ing')) return 'ing'
  return 'todo'
}

/**
 * 담당자 표기. 여럿이면 `Alexa 외 1` — 이름을 다 늘어놓으면 칸(0.62인치)을 넘칩니다.
 * 가장 많은 구성원을 맡은 사람을 대표로 세웁니다.
 */
function mergedOwner(members: DeskWork[]): string | null {
  const names = members.map((m) => (m.owner ?? '').trim()).filter(Boolean)
  if (names.length === 0) return null
  const count = new Map<string, number>()
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1)
  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
  const lead = sorted[0]![0]
  return sorted.length === 1 ? lead : `${lead} 외 ${sorted.length - 1}`
}

/**
 * 합산 진척율 = 완료 구성원 ÷ 전체 구성원.
 *
 * desk 의 `work.progress` 가 전부 비어 있어 업무 단위 진척율은 원래 못 냅니다.
 * 하지만 **사람이 명시적으로 묶은 항목**은 구성원 개수라는 근거가 있습니다.
 * 지어낸 숫자가 아니라 셀 수 있는 값입니다 — 그래서 `구성 2/3` 을 함께 적어
 * 근거를 드러냅니다. 프로젝트 마일스톤 진척율과는 다른 값입니다.
 */
function mergedProgress(members: DeskWork[]): number {
  const done = members.filter((m) => m.status === 'done').length
  return Math.round((done / members.length) * 100)
}

function mergeMembers(entry: TaskEntry, members: DeskWork[]): ReportWork {
  const status = mergedStatus(members)
  const doneCount = members.filter((m) => m.status === 'done').length

  return {
    id: entry.key,
    owner: mergedOwner(members),
    title: entry.title?.trim() || members[0]!.title,
    // project 를 안 적었으면 구성원에게서 물려받습니다. 구성원끼리 다르면
    // 첫 번째를 쓰지 않고 null 로 둡니다 — 어디에 넣을지는 사람이 정할 일입니다.
    project:
      entry.project !== undefined
        ? entry.project
        : new Set(members.map((m) => m.project)).size === 1
          ? (members[0]!.project ?? null)
          : null,
    system: first(members.map((m) => m.system)),
    parent: null,
    status,
    start: minOf(members.map((m) => m.start)),
    /**
     * 마감 = **아직 안 끝난 구성원 중 가장 이른 마감일**.
     *
     * 기획안에는 '최대 마감일' 로 적었는데, 실제로 돌려 보니 그러면 **지연이
     * 사라집니다.** 카보너스 3건을 묶었더니 8/4 에 마감이 지난 '분석'이
     * 8/20 마감인 '구현'에 가려져 지연 3건이 2건으로 줄었습니다.
     * 통합은 표를 줄이려고 하는 것이지 늦은 일을 감추려는 게 아닙니다.
     *
     * 남은 마감 중 가장 이른 날은 '다음에 무엇이 걸려 있는가' 이기도 해서
     * 주간 보고에 더 맞습니다. 전부 끝났으면 마지막 마감일을 씁니다.
     */
    due:
      status === 'done'
        ? maxOf(members.map((m) => m.due))
        : minOf(members.filter((m) => m.status !== 'done').map((m) => m.due)),
    completedOn: status === 'done' ? maxOf(members.map((m) => m.completedOn)) : null,
    progress: mergedProgress(members),
    types: [...new Set(members.flatMap((m) => m.types ?? []))],
    detail: null,
    assessment: entry.note?.trim() || null,
    log: [],
    merged: {
      entryKey: entry.key,
      total: members.length,
      done: doneCount,
      memberTitles: members.map((m) => m.title),
    },
  }
}

/** 구성원이 하나인 항목 — 통합이 아니라 **재배정·개명**입니다 */
function retag(entry: TaskEntry, member: DeskWork): ReportWork {
  return {
    ...member,
    id: entry.key,
    title: entry.title?.trim() || member.title,
    project: entry.project !== undefined ? entry.project : member.project,
    assessment: entry.note?.trim() || member.assessment,
  }
}

/**
 * 맵을 얹은 보고용 상태를 만듭니다.
 *
 * - entry 에 속한 태스크는 항목 하나로 바뀝니다
 * - 어디에도 안 속한 태스크는 **그대로 남습니다** (미분류를 버리지 않습니다)
 * - `hidden` 항목만 빠지고, 몇 건인지는 `issues` 에 남습니다
 *
 * 프로젝트 목록·의사결정 등 나머지는 손대지 않습니다.
 */
export function applyTaskMap(state: DeskState, map: TaskMapLike): MapResult {
  const byId = new Map(state.work.map((w) => [w.id, w]))
  const claimed = new Set<string>()
  const broken: string[] = []
  const emptied: string[] = []

  const built: ReportWork[] = []
  let hidden = 0

  for (const entry of map.entries) {
    const members: DeskWork[] = []
    for (const id of entry.members) {
      const w = byId.get(id)
      if (!w) {
        // desk 에서 사라졌거나 id 가 바뀐 것. **조용히 지우지 않습니다** —
        // 지우면 다음 주에 그 태스크가 미분류로 되살아나고 아무도 이유를 모릅니다.
        broken.push(id)
        continue
      }
      claimed.add(id)
      members.push(w)
    }

    if (members.length === 0) {
      emptied.push(entry.key)
      continue
    }
    if (entry.hidden) {
      hidden += 1
      continue
    }

    built.push(members.length === 1 ? retag(entry, members[0]!) : mergeMembers(entry, members))
  }

  const rest = state.work.filter((w) => !claimed.has(w.id))

  return {
    state: { ...state, work: [...built, ...rest] },
    issues: { unmapped: rest.length, hidden, broken, emptied },
  }
}

/** 목록 화면이 쓰는 항목 요약 — 기간과 합산 진척율 */
export interface EntrySpan {
  /** 구성원 중 **가장 이른 시작일**. 없으면 null */
  start: string | null
  /** 구성원 중 **가장 나중에 끝나는 날**. 완료된 건 완료일, 아직이면 마감일 */
  end: string | null
  /** end 가 실제 완료일이면 true, 아직 안 온 예정일이면 false */
  endIsActual: boolean
  /** 합산 진척율 = 완료 구성원 ÷ 전체 */
  progress: number
  done: number
  total: number
}

/**
 * 항목의 기간과 진척.
 *
 * **보고서 표의 마감 칸과 규칙이 다릅니다.** 표는 지연을 감추지 않으려고 '미완료
 * 구성원 중 가장 이른 마감' 을 쓰지만(위 `mergeMembers` 주석), 목록 화면은 이
 * 항목이 **언제 시작해서 언제 끝나는 일인지** 를 보는 자리라 전체 구간을 폅니다.
 * 둘은 같은 값이 아니고, 같아야 할 이유도 없습니다.
 */
export function entrySpan(members: DeskWork[]): EntrySpan {
  const done = members.filter((m) => m.status === 'done').length
  const ends = members.map((m) => m.completedOn ?? m.due)
  const end = maxOf(ends)
  // 가장 나중 날짜가 어느 구성원의 '완료일' 이면 실제 종료, '마감일' 이면 예정입니다
  const endIsActual =
    end !== null && members.some((m) => m.status === 'done' && m.completedOn === end)

  return {
    start: minOf(members.map((m) => m.start)),
    end,
    endIsActual,
    progress: members.length > 0 ? Math.round((done / members.length) * 100) : 0,
    done,
    total: members.length,
  }
}

/**
 * `구성 2/3` 꼬리표.
 *
 * 통합 항목의 진척율이 **무엇을 센 값인지** 밝히는 자리입니다. 숫자만 두면
 * 프로젝트 마일스톤 진척율과 같은 값처럼 읽힙니다 — 같은 표에 둘 다 나옵니다.
 */
export function mergedLabel(w: DeskWork): string | null {
  const m = (w as ReportWork).merged
  return m ? `구성 ${m.done}/${m.total}` : null
}

/**
 * 각주 문구. 호출부(주간·월간·목록)가 같은 말을 쓰도록 여기서 만듭니다.
 *
 * `active` 는 맵에 항목이 하나라도 있는지입니다. 맵을 아직 안 쓰는 동안에는
 * '항목 미지정 38건' 이 매주 각주에 뜨는데, 그건 결함이 아니라 **이 기능을 아직 안
 * 쓰는 상태**라 알릴 것이 없습니다. 한 건이라도 분류하기 시작하면 그때부터
 * 남은 미분류가 의미를 갖습니다.
 */
export function mapFootnotes(issues: MapIssues, active: boolean): string[] {
  const out: string[] = []
  if (active && issues.unmapped > 0) out.push(`태스크 맵 항목 미지정 ${issues.unmapped}건 (원본 그대로 1건=1행)`)
  if (issues.hidden > 0) out.push(`수동 제외 ${issues.hidden}건`)
  if (issues.broken.length > 0) out.push(`맵핑 끊김 ${issues.broken.length}건 — UI 에서 확인 필요`)
  if (issues.emptied.length > 0) out.push(`구성원이 사라진 항목 ${issues.emptied.length}건`)
  return out
}
