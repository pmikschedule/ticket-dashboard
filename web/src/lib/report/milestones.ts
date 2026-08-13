/**
 * 프로젝트 진행 레일 — desk `Weekly Report` 의 `1 프로젝트 진행 · 마일스톤`.
 *
 * **일정표가 아닙니다.** 각 프로젝트가 지금 어느 단계까지 왔는지를 눈으로 보는
 * 장입니다. 그래서 날짜보다 **칩의 위치**가 본문이고, 현재 칩은 무슨 일이 있어도
 * 접지 않습니다.
 *
 * 여기도 순수 함수입니다. 폭 계산까지 여기서 끝내고 렌더러는 그리기만 합니다 —
 * 지면이 모자랄 때 무엇을 접었는지가 각주에 나가야 하는데, 그 판단이 렌더러에
 * 있으면 각주가 사실과 어긋납니다.
 */

import type { DeskState } from './types'

export interface RailChip {
  name: string
  done: boolean
  /** 첫 미완료 마일스톤. 이 장의 본문이라 절대 접지 않습니다 */
  current: boolean
  /** 현재 칩에만 붙는 파생 날짜 (`7/29`). 근거는 아래 `currentDate` 주석 */
  date: string | null
  /** 완료분을 접어 만든 요약 칩(`✓4`) */
  summary?: boolean
}

export interface ProjectRail {
  key: string
  title: string
  /** desk 의 `보류` 배지 */
  hold: boolean
  done: number
  total: number
  /** `project.due`. 없으면 null — 오늘로 채우지 않습니다 */
  due: string | null
  chips: RailChip[]
}

/** `2026-07-29` → `7/29` */
function short(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}/${d}`
}

/**
 * 현재 칩에 붙는 날짜 — **파생값**입니다.
 *
 * desk 는 `/api/state` 한 곳만 쓰고 그 응답의 마일스톤은 `{name, done}` 뿐입니다.
 * 화면의 `구현~7/29` 는 desk 가 계산해 붙이는 값이라 우리도 계산해야 합니다.
 * 그 프로젝트의 **미완료 업무 중 가장 이른 마감일**로 잡으면 실측에서 화면과
 * 일치했습니다 — BRS 7/29 · 카보너스 관리자 8/20 · Mobile App 8/11.
 *
 * 파생값이므로 호출부가 각주에 밝힙니다. desk 가 나중에 필드를 열면 그때
 * 이 함수만 바꾸면 됩니다.
 */
function currentDate(state: DeskState, projectKey: string): string | null {
  const dues = state.work
    .filter((w) => w.project === projectKey && w.status !== 'done' && w.due)
    .map((w) => w.due!)
    .sort()
  return dues[0] ? short(dues[0]) : null
}

/**
 * 마일스톤이 있는 프로젝트의 레일.
 *
 * **보류 프로젝트는 맨 뒤로** 보냅니다 (desk 화면과 같은 순서). 그 안에서는
 * desk 가 준 순서를 그대로 둡니다 — 우리가 다시 정렬하면 desk 를 보던 사람이
 * 다른 문서로 읽습니다.
 *
 * 마일스톤이 없는 프로젝트는 그릴 것이 없어 뺍니다. 몇 개를 뺐는지는
 * 호출부가 각주에 적습니다.
 */
export function projectRails(state: DeskState): ProjectRail[] {
  const rails = state.projects
    .filter((p) => (p.milestones ?? []).length > 0)
    .map((p) => {
      const ms = p.milestones!
      const firstOpen = ms.findIndex((m) => !m.done)
      return {
        key: p.key,
        title: p.title,
        hold: p.hold === true,
        done: ms.filter((m) => m.done).length,
        total: ms.length,
        due: p.due ?? null,
        chips: ms.map((m, i) => ({
          name: m.name,
          done: m.done,
          current: i === firstOpen,
          date: i === firstOpen ? currentDate(state, p.key) : null,
        })),
      } satisfies ProjectRail
    })

  return [...rails.filter((r) => !r.hold), ...rails.filter((r) => r.hold)]
}

// ---------------------------------------------------------------------------
// 폭 맞추기
// ---------------------------------------------------------------------------

/**
 * 글자 폭(인치) 어림.
 *
 * 한글은 한 글자가 대략 1em, 라틴 문자는 절반입니다. pptx 는 글자 폭을 알려
 * 주지 않으므로 이 어림으로 미리 재고, 넘치면 줄입니다. **넉넉하게 잡습니다** —
 * 모자라게 잡으면 칩이 겹쳐 그려지고 파워포인트는 알려 주지 않습니다.
 */
export function textWidth(s: string, sz: number): number {
  let em = 0
  for (const ch of s) em += /[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? 1 : 0.52
  return (em * sz) / 72
}

export interface RailMetrics {
  /** 칩 안쪽 좌우 여백 */
  padX: number
  /** 칩 사이 이음선이 차지하는 폭 */
  gap: number
  /** 큰 것부터 시도할 글자 크기 */
  sizes: readonly number[]
}

export function chipWidth(c: RailChip, sz: number, m: RailMetrics): number {
  const label = c.date ? `${c.name} ~${c.date}` : c.name
  return textWidth(label, sz) + m.padX * 2
}

export function railWidth(chips: RailChip[], sz: number, m: RailMetrics): number {
  const w = chips.reduce((n, c) => n + chipWidth(c, sz, m), 0)
  return w + Math.max(0, chips.length - 1) * m.gap
}

export interface FittedRail {
  chips: RailChip[]
  sz: number
  /** 접어 버린 완료 마일스톤 수. 0 이면 다 폈습니다 */
  collapsed: number
}

/**
 * 레일을 주어진 폭에 맞춥니다.
 *
 * 1. 글자를 작은 쪽으로 내려 본다
 * 2. 그래도 넘치면 **완료된 앞쪽부터 `✓4` 로 접는다**
 * 3. 그래도 넘치면 접을 수 있는 만큼 접고 끝낸다 (남은 것은 렌더러가 잘라 그림)
 *
 * **현재 칩과 그 뒤는 접지 않습니다.** '어디까지 왔고 다음이 무엇인가' 가 이
 * 장의 본문이고, 지나온 단계의 이름은 그다음입니다.
 */
export function fitRail(chips: RailChip[], availW: number, m: RailMetrics): FittedRail {
  for (const sz of m.sizes) {
    if (railWidth(chips, sz, m) <= availW) return { chips, sz, collapsed: 0 }
  }

  const smallest = m.sizes[m.sizes.length - 1]!
  const doneCount = chips.filter((c) => c.done).length

  // 완료분을 k 개씩 접어 본다. k = doneCount 면 완료가 전부 요약 칩 하나가 된다
  for (let k = 2; k <= doneCount; k += 1) {
    const folded: RailChip[] = [
      { name: `✓${k}`, done: true, current: false, date: null, summary: true },
      ...chips.slice(k),
    ]
    for (const sz of m.sizes) {
      if (railWidth(folded, sz, m) <= availW) return { chips: folded, sz, collapsed: k }
    }
  }

  if (doneCount >= 2) {
    return {
      chips: [
        { name: `✓${doneCount}`, done: true, current: false, date: null, summary: true },
        ...chips.slice(doneCount),
      ],
      sz: smallest,
      collapsed: doneCount,
    }
  }
  return { chips, sz: smallest, collapsed: 0 }
}
