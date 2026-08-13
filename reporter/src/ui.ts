/**
 * 태스크 맵 UI — 로컬 웹 서버.
 *
 * **`127.0.0.1` 에만 바인딩합니다.** 인증이 없는 도구이고, desk 의 업무 내용을
 * 그대로 보여 주기 때문입니다. 이 Mac 밖에서는 열리지 않아야 합니다.
 *
 * 프레임워크를 안 씁니다 — Node 내장 `http` 와 파일 하나짜리 화면입니다.
 * 이 저장소에 빌드 단계를 하나 더 만들 만큼의 화면이 아닙니다.
 *
 * 계산은 전부 순수 함수(`taskmap.ts` · `suggest.ts` · `weekly.ts`)가 합니다.
 * 여기서는 읽고 쓰고 넘겨주기만 합니다.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestSnapshot, snapshotBefore } from './desk.ts'
import {
  applyTaskMap,
  entrySpan,
  loadTaskMap,
  saveTaskMap,
  validateTaskMap,
  type TaskMap,
} from './taskmap.ts'
import { suggest } from './suggest.ts'
import { buildWeekly } from './weekly.ts'
import { currentWeek, nextWeek, rangeLabel as rangeLabelOf } from './week.ts'
import { ISSUES, STANDALONE_RULE, TABLE, WEEKLY_PROGRESS } from './layout.ts'
import type { Config } from './config.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 1page 예산.
 *
 * 표 영역은 3.20인치 고정이고 프로젝트 머리행 0.20 · 구분선 0.16 · 업무 행 0.26 이
 * 자리를 먹습니다. **편집하는 동안 지금 구성이 한 장에 들어가는지 보여야** 다
 * 만들고 나서 잘리는 일이 없습니다. 그래서 자르기 전 높이를 따로 계산합니다.
 */
function budgetOf(state: ReturnType<typeof applyTaskMap>['state'], base: typeof state | null, day: string) {
  const week = currentWeek(day)
  const uncut = buildWeekly(base, state, {
    week,
    nextWeek: nextWeek(week),
    author: '',
    reportedOn: day,
    subtitle: '',
    team: '',
    baseline: base ? day : null,
    history: [],
    // 자르지 않고 전부 받아 실제로 몇 인치가 필요한지 봅니다
    table: { budget: Number.MAX_SAFE_INTEGER, headerH: TABLE.groupH, ruleH: STANDALONE_RULE.h, rowH: TABLE.rowH },
    maxProgress: WEEKLY_PROGRESS.max,
    maxChanges: ISSUES.max,
  })

  const heads = uncut.groups.reduce(
    (n, g) => n + (g.standalone ? STANDALONE_RULE.h : TABLE.groupH),
    0,
  )
  const rows = uncut.groups.reduce((n, g) => n + g.rows.length, 0)
  const needed = heads + rows * TABLE.rowH

  return {
    needed: Math.round(needed * 100) / 100,
    budget: TABLE.bottom - TABLE.top,
    groups: uncut.groups.length,
    rows,
    fits: needed <= TABLE.bottom - TABLE.top + 1e-9,
    week: rangeLabelOf(week),
  }
}

/**
 * `override` 는 **아직 저장하지 않은 맵**입니다.
 *
 * 예산 게이지는 편집하는 동안 보라고 만든 것이라, 저장해야 갱신되면 쓸모가
 * 절반입니다. 미리보기는 파일을 건드리지 않고 같은 계산만 돌립니다.
 */
function payload(cfg: Config, override?: TaskMap) {
  const snap = latestSnapshot(cfg.snapshotDir)
  if (!snap) throw new Error('스냅샷이 없습니다. 먼저 `npm run scan` 을 실행하세요.')

  const day = snap.meta.scannedAt.slice(0, 10)
  const map = override ?? loadTaskMap(cfg.taskmapPath)
  const applied = applyTaskMap(snap.state, map)
  const byId = new Map(snap.state.work.map((w) => [w.id, w]))

  const baseSnap = snapshotBefore(cfg.snapshotDir, currentWeek(day).from)
  const base = baseSnap ? applyTaskMap(baseSnap.state, map).state : null

  return {
    snapshot: { day, work: snap.state.work.length },
    projects: snap.state.projects.map((p) => ({ key: p.key, title: p.title })),
    // 원본 태스크 — UI 는 **원본을 보고 분류**합니다. 적용 결과가 아닙니다.
    works: snap.state.work.map((w) => ({
      id: w.id,
      title: w.title,
      owner: w.owner ?? '',
      project: w.project ?? null,
      status: w.status,
      start: w.start ?? '',
      due: w.due ?? '',
      completedOn: w.completedOn ?? '',
      // desk 실측 38건 전부 비어 있습니다. 완료면 100%, 그 외는 비웁니다
      progress: w.status === 'done' ? 100 : w.progress,
      types: w.types ?? [],
    })),
    // 항목의 기간·합산 진척은 **서버가 계산합니다.** 화면이 따로 계산하면
    // 규칙이 둘로 갈라지고, 어느 쪽이 보고서와 같은지 알 수 없게 됩니다.
    entryViews: Object.fromEntries(
      map.entries.map((e) => [
        e.key,
        entrySpan(e.members.map((id) => byId.get(id)).filter((w): w is NonNullable<typeof w> => Boolean(w))),
      ]),
    ),
    taskmap: map,
    issues: applied.issues,
    suggestions: suggest(snap.state, map),
    budget: budgetOf(applied.state, base, day),
  }
}

function json(res: import('node:http').ServerResponse, code: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export function startUi(cfg: Config, onReady?: (url: string) => void) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')

      if (req.method === 'GET' && url.pathname === '/') {
        const html = readFileSync(join(HERE, 'ui', 'index.html'), 'utf8')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        json(res, 200, payload(cfg))
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/preview') {
        // 검증 실패는 여기서 막지 않습니다 — 편집 중 잠깐 깨진 상태는 정상이고,
        // 그 순간에도 예산은 보여야 합니다. 저장에서만 막습니다.
        const map = JSON.parse(await readBody(req)) as TaskMap
        const p = payload(cfg, map)
        json(res, 200, {
          budget: p.budget,
          issues: p.issues,
          suggestions: p.suggestions,
          entryViews: p.entryViews,
        })
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/taskmap') {
        const map = JSON.parse(await readBody(req)) as TaskMap
        const errors = validateTaskMap(map)
        if (errors.length > 0) {
          // 저장을 막고 이유를 돌려줍니다. 잘못된 맵이 파일에 남으면
          // 매주 그대로 재생산됩니다.
          json(res, 400, { errors })
          return
        }
        saveTaskMap(cfg.taskmapPath, { ...map, updatedAt: new Date().toISOString().slice(0, 10) })
        json(res, 200, payload(cfg))
        return
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('없는 주소입니다')
    } catch (e) {
      json(res, 500, { errors: [e instanceof Error ? e.message : String(e)] })
    }
  })

  server.listen(cfg.uiPort, '127.0.0.1', () => {
    onReady?.(`http://127.0.0.1:${cfg.uiPort}`)
  })
  return server
}
