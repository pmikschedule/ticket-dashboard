/**
 * 통합·재배정 후보 찾기.
 *
 * **제안만 합니다.** 코드가 자동으로 묶으면 다른 일을 합쳐 놓고 아무도 모릅니다 —
 * `PG사 화면 기획`(Jacqueline)과 `PG사 화면 기획 리뷰`(Alexa)는 제목이 거의 같지만
 * 담당자가 다르고, 같은 일인지 아닌지는 데이터로 판별할 수 없습니다.
 *
 * 사람이 승인하면 그 순간 `taskmap.json` 에 박히고, 다음 주부터는 제안이 아니라
 * 규칙입니다. 그래서 승인 버튼이 반드시 사람 손에 있어야 합니다.
 */

import type { DeskState, DeskWork } from './types.ts'
import type { TaskMap } from './taskmap.ts'

/**
 * 제목에서 성격 꼬리를 떼어 낸 앞부분.
 *
 * 실측에서 이 규칙만으로 4묶음이 잡혔습니다 — 카보너스 관리자 서비스(분석·설계·구현),
 * FABB 보너스(설계·구현), PG사 화면(기획·기획 리뷰), 결제 시스템 운영서버 배포(+재개).
 */
const TAIL = /\s*(분석|기획|설계|구현|개발|배포|검증|점검|테스트|리뷰|이관|마이그레이션)/

export function titleStem(title: string): string {
  const head = title.split(TAIL)[0]!.trim()
  // 꼬리를 떼고 남은 게 너무 짧으면 접두어로 못 씁니다 ('구현' 한 단어짜리 제목 등)
  return head.length >= 3 ? head : ''
}

export type SuggestionKind = 'merge' | 'assign'

export interface Suggestion {
  kind: SuggestionKind
  /** 왜 묶으라고 하는지. UI 가 그대로 보여 줍니다 */
  reason: string
  title: string
  project: string | null
  memberIds: string[]
  memberTitles: string[]
}

/**
 * 아직 어느 항목에도 안 속한 태스크만 대상으로 합니다.
 *
 * 이미 분류한 것을 다시 제안하면 매주 같은 제안이 뜨고, 사람이 제안 영역 자체를
 * 안 보게 됩니다.
 */
function unmappedWork(state: DeskState, map: TaskMap): DeskWork[] {
  const claimed = new Set(map.entries.flatMap((e) => e.members))
  return state.work.filter((w) => !claimed.has(w.id))
}

export function suggest(state: DeskState, map: TaskMap): Suggestion[] {
  const pool = unmappedWork(state, map)
  const known = new Set(state.projects.map((p) => p.key))

  const byStem = new Map<string, DeskWork[]>()
  for (const w of pool) {
    const stem = titleStem(w.title)
    if (!stem) continue
    const list = byStem.get(stem)
    if (list) list.push(w)
    else byStem.set(stem, [w])
  }

  const out: Suggestion[] = []

  for (const [stem, works] of byStem) {
    if (works.length < 2) continue

    const projects = [...new Set(works.map((w) => w.project).filter((p): p is string => Boolean(p) && known.has(p!)))]
    // 프로젝트가 둘 이상 섞였으면 어디로 넣을지 코드가 못 정합니다. 사람이 고릅니다.
    const project = projects.length === 1 ? projects[0]! : null

    const kinds = [...new Set(works.flatMap((w) => w.types ?? []))]
    const reason =
      projects.length === 0
        ? `제목 앞부분이 같고 ${works.length}건 모두 프로젝트가 없습니다`
        : works.some((w) => !w.project)
          ? `제목 앞부분이 같은데 일부만 프로젝트에 붙어 있습니다`
          : `한 프로젝트 안에서 성격만 나뉘어 있습니다 (${kinds.join('·')})`

    out.push({
      kind: works.some((w) => !w.project) && project ? 'assign' : 'merge',
      reason,
      title: stem,
      project,
      memberIds: works.map((w) => w.id),
      memberTitles: works.map((w) => w.title),
    })
  }

  // 건수가 많은 제안이 위로 — 표에서 줄어드는 행이 많은 순입니다
  return out.sort((a, b) => b.memberIds.length - a.memberIds.length || a.title.localeCompare(b.title, 'ko'))
}
