/**
 * 업무 목록 — desk 스냅샷을 **프로젝트 → 담당자 → 업무** 로 묶습니다.
 *
 * 보고서(pptx)와 목적이 다릅니다. 보고서는 그 달에 일어난 일만 골라 한 장에
 * 눌러 담지만, 이 목록은 **스냅샷에 있는 업무를 하나도 빠뜨리지 않고** 폅니다.
 * 그래서 여기서는 자르지 않고, 달로 거르지도 않습니다.
 *
 * 집계 규칙은 여기 순수 함수에만 있습니다. `xlsx.ts` 는 그리기만 합니다.
 */

import { projectProgress, rowProgress } from './aggregate.ts'
import { mergedLabel } from './taskmap.ts'
import type { DeskProject, DeskState, DeskWork } from './types.ts'

/** 프로젝트가 없는 업무가 모이는 자리. 묶지 않고 **개별 항목**으로 나열합니다 */
export const ETC_KEY = '__etc__'
export const ETC_TITLE = '기타'

/** 담당자가 비어 있는 업무. 38건 중 1건이었습니다 — 숨기지 않고 이름만 이렇게 답니다 */
export const NO_OWNER = '미지정'

/** desk 의 status 3종. 보고서의 칩(완료·진행중·지연)과 달리 **원본 그대로**입니다 */
export const STATUS_LABELS: Record<DeskWork['status'], string> = {
  done: '완료',
  ing: '진행중',
  todo: '대기',
  // 전수 목록은 보고서와 달리 **아무것도 빼지 않습니다.** 보류도 그대로 셉니다
  hold: '보류',
}

/**
 * desk 의 `work.types` 실측값 7종.
 *
 * 모르는 값이 오면 **원문을 그대로 둡니다.** 억지로 우리 말로 바꾸면 desk 가
 * 나중에 추가한 유형이 조용히 다른 뜻으로 읽힙니다.
 */
const TYPE_LABELS: Record<string, string> = {
  analysis: '분석',
  plan: '기획',
  design: '설계',
  feature: '기능',
  bug: '오류',
  improve: '개선',
  ops: '운영',
}

export function typeLabel(types: string[] | null | undefined): string {
  return (types ?? []).map((t) => TYPE_LABELS[t] ?? t).join('·')
}

export interface ListRow {
  owner: string
  title: string
  status: string
  /** 미완료 + 마감일 있음 + 마감일 < 기준일. 마감일이 없으면 **지연이 아닙니다** */
  late: boolean
  /**
   * 업무 진척율(0~100).
   *
   * 규칙은 보고서와 **같은 함수**(`aggregate.rowProgress`)를 씁니다 — 완료는
   * 100%, 그 외는 desk 의 `work.progress` 를 그대로, 그것도 없으면 null.
   * 실측 38건은 `work.progress` 가 전부 비어 있어 지금은 완료 건만 찹니다.
   * **미완료 행에 소속 프로젝트의 진척율을 대신 찍지 않습니다** — 프로젝트
   * 수치가 업무 수치처럼 읽힙니다.
   */
  progress: number | null
  types: string
  start: string
  due: string
  completedOn: string
  system: string
  /** desk 에 적힌 것만. 없으면 빈 칸으로 두고 제목을 베끼지 않습니다 */
  detail: string
}

export interface ListGroup {
  key: string
  title: string
  /** 이 묶음에 이름이 올라 있는 사람들 (등장 순서가 아니라 가나다순) */
  owners: string[]
  counts: { done: number; ing: number; todo: number; late: number }
  /** 프로젝트 마일스톤 `done/total`. 없으면 null — 0/0 으로 채우지 않습니다 */
  milestones: { done: number; total: number } | null
  /**
   * 프로젝트 진척율(0~100) = 완료 마일스톤 / 전체.
   *
   * **업무 진척율과 다른 값입니다.** 마일스톤이 없으면 null 이고, 업무 건수로
   * 대신 계산하지 않습니다 — '4건 중 2건 완료 = 50%' 는 프로젝트가 반쯤 됐다는
   * 뜻이 아닙니다. 기타는 프로젝트가 아니므로 항상 null 입니다.
   */
  progress: number | null
  rows: ListRow[]
}

function toRow(w: DeskWork, asOf: string): ListRow {
  const late = w.status !== 'done' && Boolean(w.due && w.due < asOf)
  return {
    owner: (w.owner ?? '').trim() || NO_OWNER,
    title: w.title,
    status: STATUS_LABELS[w.status],
    late,
    progress: rowProgress(w, w.status === 'done' ? 'done' : 'ing'),
    types: typeLabel(w.types),
    start: w.start ?? '',
    due: w.due ?? '',
    completedOn: w.completedOn ?? '',
    system: w.system ?? '',
    detail: [mergedLabel(w), (w.detail?.notes ?? w.assessment ?? '').trim()].filter(Boolean).join(' · '),
  }
}

/**
 * 담당자 정렬.
 *
 * 가나다(로캘)순으로 두되 **미지정은 항상 맨 뒤**입니다. 이름 사이에 섞이면
 * 사람 이름처럼 읽힙니다.
 */
function byOwner(a: string, b: string): number {
  if (a === NO_OWNER) return 1
  if (b === NO_OWNER) return -1
  return a.localeCompare(b, 'ko')
}

/** 한 사람 안에서의 순서: 진행중 → 대기 → 완료. 손대고 있는 일이 위로 옵니다 */
const STATUS_ORDER: Record<string, number> = { 진행중: 0, 보류: 1, 대기: 2, 완료: 3 }

function rowOrder(a: ListRow, b: ListRow): number {
  const o = byOwner(a.owner, b.owner)
  if (o !== 0) return o
  // 같은 사람 안에서는 지연을 맨 위로 올립니다 — 목록에서 먼저 눈에 띄어야 합니다
  if (a.late !== b.late) return a.late ? -1 : 1
  const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
  if (s !== 0) return s
  const ka = a.due || a.completedOn || '9999-99-99'
  const kb = b.due || b.completedOn || '9999-99-99'
  if (ka !== kb) return ka.localeCompare(kb)
  return a.title.localeCompare(b.title, 'ko')
}

/**
 * 프로젝트로 묶습니다.
 *
 * - **업무가 없는 프로젝트도 남깁니다.** 보고서와 다른 점입니다 — 이건 전수
 *   목록이고, "그 프로젝트에 등록된 업무가 0건" 도 알아야 하는 사실입니다.
 * - 프로젝트가 없거나 desk 에 없는 키를 가리키는 업무는 **기타**로 갑니다.
 *   기타는 묶음이 아니라 개별 항목의 모음이므로 마일스톤도 진척율도 없습니다.
 *
 * 묶음 순서는 업무가 많은 것 → 제목순이고, 기타는 항상 맨 뒤입니다.
 */
export function buildWorkList(state: DeskState, asOf: string): ListGroup[] {
  const projects = new Map<string, DeskProject>(state.projects.map((p) => [p.key, p]))

  const buckets = new Map<string, DeskWork[]>()
  for (const p of state.projects) buckets.set(p.key, [])
  buckets.set(ETC_KEY, [])

  for (const w of state.work) {
    const key = w.project && projects.has(w.project) ? w.project : ETC_KEY
    buckets.get(key)!.push(w)
  }

  const groups: ListGroup[] = [...buckets.entries()].map(([key, works]) => {
    const project = projects.get(key)
    const ms = project?.milestones ?? null
    const rows = works.map((w) => toRow(w, asOf)).sort(rowOrder)
    return {
      key,
      title: key === ETC_KEY ? ETC_TITLE : (project?.title ?? key),
      owners: [...new Set(rows.map((r) => r.owner))].sort(byOwner),
      counts: {
        done: rows.filter((r) => r.status === '완료').length,
        ing: rows.filter((r) => r.status === '진행중').length,
        // 보류는 대기와 함께 셉니다 — 둘 다 '지금 굴러가지 않는' 상태입니다
        todo: rows.filter((r) => r.status === '대기' || r.status === '보류').length,
        late: rows.filter((r) => r.late).length,
      },
      milestones:
        key !== ETC_KEY && ms && ms.length > 0
          ? { done: ms.filter((m) => m.done).length, total: ms.length }
          : null,
      progress: key === ETC_KEY ? null : projectProgress(project),
      rows,
    }
  })

  return groups.sort((a, b) => {
    if (a.key === ETC_KEY) return 1
    if (b.key === ETC_KEY) return -1
    if (a.rows.length !== b.rows.length) return b.rows.length - a.rows.length
    return a.title.localeCompare(b.title, 'ko')
  })
}

export interface OwnerSummary {
  owner: string
  done: number
  ing: number
  todo: number
  late: number
  total: number
  /**
   * 완료율(0~100) = 완료 / 전체.
   *
   * **진척율이 아닙니다.** desk 에는 사람 단위 진척 값이 없고, 업무 건수는
   * 크기가 제각각이라 '완료 3/9' 가 일의 3분의 1을 뜻하지 않습니다. 그래서
   * 이름을 완료율로 두고 시트에도 그렇게 적습니다.
   */
  doneRate: number | null
  /** 이름이 올라 있는 프로젝트. 기타만 맡은 사람은 빈 배열이 아니라 ['기타'] 입니다 */
  projects: string[]
}

/** 사람별 집계. 묶음을 가로질러 셉니다 — 한 사람이 여러 프로젝트에 걸쳐 있습니다 */
export function summarizeByOwner(groups: ListGroup[]): OwnerSummary[] {
  const map = new Map<string, OwnerSummary>()

  for (const g of groups) {
    for (const r of g.rows) {
      const s =
        map.get(r.owner) ??
        { owner: r.owner, done: 0, ing: 0, todo: 0, late: 0, total: 0, doneRate: null, projects: [] }
      if (r.status === '완료') s.done += 1
      else if (r.status === '진행중') s.ing += 1
      else s.todo += 1
      if (r.late) s.late += 1
      s.total += 1
      if (!s.projects.includes(g.title)) s.projects.push(g.title)
      map.set(r.owner, s)
    }
  }

  return [...map.values()]
    // 업무가 0건인 사람은 애초에 map 에 안 들어오므로 0 나누기가 없습니다
    .map((s) => ({ ...s, doneRate: s.total > 0 ? Math.round((s.done / s.total) * 100) : null }))
    .sort((a, b) => byOwner(a.owner, b.owner))
}
