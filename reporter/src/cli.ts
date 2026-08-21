#!/usr/bin/env -S npx tsx
/**
 * CLI — `doctor` · `scan` · `push` · `monthly` · `list`.
 *
 * **주간 보고서는 여기 없습니다.** 이슈트래커의 태스크맵 화면에서 만듭니다
 * (`web/src/lib/report/`). 집계 규칙을 두 벌 두지 않기 위해서입니다.
 *
 * **태스크 맵도 여기서 안 고칩니다.** 원본은 대시보드의 `task_map` 이고 이 도구는
 * 읽기만 합니다 (`dashboard.fetchTaskMap`). 편집이 양쪽에 있으면 한쪽이 다른 쪽을
 * 소리 없이 덮어씁니다 — 실제로 그럴 뻔했습니다.
 *
 *   scan             desk 를 읽어 오늘자 스냅샷을 남기고 대시보드에 올립니다
 *   push             밀린 스냅샷을 대시보드에 올립니다 (scan 없이)
 *   monthly [YYYY-MM] 그 달의 보고서 pptx 를 만듭니다 (기본: 지난달)
 *   list             업무 전수 목록 xlsx 를 만듭니다 (프로젝트별 · 담당자별)
 *   doctor           설정·연결·쿠키 만료를 점검합니다
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.ts'
import { daysLeft, resolveCookie } from './cookie.ts'
import {
  daysBetween,
  fetchState,
  latestSnapshot,
  listSnapshots,
  makeSnapshot,
  previousDueDates,
  readSnapshot,
  saveSnapshot,
  todayIso,
} from './desk.ts'
import { fetchTaskMap, fetchTickets, signIn } from './dashboard.ts'
import { buildReport, countByWorkType } from './aggregate.ts'
import { TABLE } from './layout.ts'
import { writeReport } from './render.ts'
import { buildWorkList, summarizeByOwner } from './worklist.ts'
import { applyTaskMap, mapFootnotes, type TaskMap } from './taskmap.ts'
import { uploadSnapshot, uploadedDays } from './upload.ts'
import { writeWorkList } from './xlsx.ts'
import type { TicketRow } from './types.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

const cfg = loadConfig()
const host = new URL(cfg.deskUrl).host

function say(s = '') {
  process.stdout.write(`${s}\n`)
}

/** 맵을 마지막으로 저장한 날. 값이 없으면 `?` 로 둡니다 — 지어내지 않습니다 */
function mapStamp(map: TaskMap): string {
  return map.updatedAt ? map.updatedAt.slice(0, 10) : '?'
}

function fail(e: unknown): never {
  say(`\n✖ ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

/** 쿠키를 잡고 만료를 알립니다. **만료 임박을 조용히 넘기지 않습니다.** */
function cookieOrDie() {
  const hit = resolveCookie(host, cfg.cfAuthorization, cfg.chromeProfile)
  const left = daysLeft(hit.expiresAt)
  const when = hit.expiresAt.toISOString().slice(0, 16).replace('T', ' ')
  if (left < 0) {
    throw new Error(`쿠키가 ${when} 에 만료됐습니다. Chrome 으로 desk 에 다시 로그인하세요.`)
  }
  say(`  쿠키   : ${hit.profile} · 만료 ${when} (${left}일 남음)`)
  if (left <= 7) {
    say(`  ⚠ 만료가 ${left}일 남았습니다. Chrome 으로 desk 에 다시 로그인해 두세요.`)
  }
  return hit
}

/**
 * 태스크 맵을 얹습니다.
 *
 * **세 산출물이 전부 이걸 거칩니다.** 주간만 적용하면 같은 주의 주간·월간·목록이
 * 서로 다른 항목 구성을 보여 주게 됩니다 — 어느 쪽이 맞는지 아무도 모릅니다.
 */
function mapped(state: import('./types.ts').DeskState, map: TaskMap) {
  const r = applyTaskMap(state, map)
  return { ...r, entries: map.entries.length }
}

async function cmdScan() {
  say('desk 스캔')
  const hit = cookieOrDie()
  const { state, email } = await fetchState(cfg.deskUrl, hit.value)
  say(`  계정   : ${email ?? '(알 수 없음)'}`)

  const snap = makeSnapshot(state, new Date())
  const path = saveSnapshot(cfg.snapshotDir, snap)
  say(
    `  수집   : work ${snap.meta.counts.work} · projects ${snap.meta.counts.projects} · decisions ${snap.meta.counts.decisions}`,
  )
  say(`  원본시각: ${snap.meta.sourceUpdatedAt ?? '(없음)'}`)
  say(`  저장   : ${path}`)
  say(`  누적   : 스냅샷 ${listSnapshots(cfg.snapshotDir).length}개`)

  // 업로드가 실패해도 **스캔은 성공입니다.** 스냅샷은 로컬에 남았고 나중에
  // `push` 로 올릴 수 있습니다. 여기서 죽으면 그날 수집까지 실패한 것처럼 보입니다.
  await pushAll({ quiet: true })
}

/**
 * 대시보드에 올립니다.
 *
 * **로컬 파일이 원본이고 대시보드가 사본입니다.** 로컬에 있는데 대시보드에 없는
 * 날짜만 올립니다 — 이미 올린 것을 매번 다시 올리면 스냅샷 하나가 수백 KB 라
 * 스캔마다 몇 MB 를 왕복하게 됩니다.
 */
async function pushAll(opt: { quiet?: boolean } = {}) {
  if (!cfg.supabaseUrl || !cfg.supabaseEmail) {
    if (!opt.quiet) throw new Error('대시보드 설정이 없습니다 (.env 의 SUPABASE_* 확인)')
    say('  업로드 : 건너뜀 — 대시보드 설정 없음 (.env 의 SUPABASE_*)')
    return
  }

  try {
    const client = await signIn({
      url: cfg.supabaseUrl,
      anonKey: cfg.supabaseAnonKey,
      email: cfg.supabaseEmail,
      password: cfg.supabasePassword,
    })

    const already = await uploadedDays(client)
    const missing = listSnapshots(cfg.snapshotDir).filter((f) => !already.has(f.slice(0, 10)))

    let kb = 0
    for (const file of missing) {
      const r = await uploadSnapshot(client, readSnapshot(cfg.snapshotDir, file))
      kb += r.sizeKb
    }

    // 태스크 맵은 **올리지 않습니다.** 대시보드가 원본이고 여기는 읽기만 합니다
    if (missing.length > 0) say(`  업로드 : 스냅샷 ${missing.length}개 (${kb}KB)`)
    else say('  업로드 : 새 스냅샷 없음')
  } catch (e) {
    // 스캔에 딸려 돌 때는 여기서 멈추지 않습니다 — 스냅샷은 이미 로컬에 남았습니다
    const msg = e instanceof Error ? e.message : String(e)
    if (!opt.quiet) throw e
    say(`  ⚠ 업로드 실패 — ${msg}`)
    say('    스냅샷은 로컬에 남았습니다. 나중에 `npm run push` 로 올리세요.')
  }
}

async function cmdPush() {
  say('대시보드 업로드')
  await pushAll()
}

/** 대시보드 접속. 설정이 없으면 null — 무엇을 포기할지는 부르는 쪽이 정합니다 */
async function connect(): Promise<SupabaseClient | null> {
  if (!cfg.supabaseUrl || !cfg.supabaseEmail) return null
  return signIn({
    url: cfg.supabaseUrl,
    anonKey: cfg.supabaseAnonKey,
    email: cfg.supabaseEmail,
    password: cfg.supabasePassword,
  })
}

/**
 * 티켓(장애·유지보수·신규개발). 대시보드 설정이 없으면 **빈 배열로 진행하고
 * 그 사실을 알립니다.** 여기서 멈추면 desk 쪽만이라도 보고 싶은 사람이
 * 아무것도 못 받습니다.
 */
async function loadTickets(
  client: SupabaseClient | null,
): Promise<{ list: TicketRow[]; warning: string | null }> {
  if (!client) {
    return {
      list: [],
      warning: '대시보드 설정이 없어 운영 집계를 건너뜁니다 (.env 의 SUPABASE_* 확인)',
    }
  }
  return { list: await fetchTickets(client), warning: null }
}

/**
 * 태스크 맵 — 못 읽으면 **멈춥니다.**
 *
 * 티켓과 다릅니다. 티켓이 없으면 운영 현황 한 절이 비고 그 사실이 각주에 남지만,
 * 맵이 없으면 **본문의 모양 자체가 달라집니다** — 묶어 둔 항목이 원본 태스크
 * 여러 줄로 도로 흩어지고, 보고서는 멀쩡해 보입니다. 지난주와 이번 주의 행
 * 구성이 다른데 아무도 이유를 모르게 되므로, 조용히 빈 맵으로 진행하지 않습니다.
 *
 * 항목이 **0개인 것**은 사실이므로 그대로 진행합니다. '못 읽었다' 와 '없다' 는
 * 다른 상태입니다.
 */
async function requireTaskMap(client: SupabaseClient | null): Promise<TaskMap> {
  if (!client) {
    throw new Error(
      '태스크 맵을 읽을 수 없습니다 — 대시보드 설정이 필요합니다 (.env 의 SUPABASE_*).\n' +
        '  맵의 원본은 대시보드입니다. 편집은 이슈트래커 › 태스크맵 화면에서 합니다.',
    )
  }
  return fetchTaskMap(client)
}

async function cmdMonthly(argMonth?: string) {
  const now = new Date()
  const target = argMonth ?? defaultMonth(now)
  const m = /^(\d{4})-(\d{2})$/.exec(target)
  if (!m) throw new Error(`월 형식이 잘못됐습니다: ${target} (예: 2026-08)`)
  const year = Number(m[1])
  const month = Number(m[2])

  say(`활동 월간 요약 보고서 — ${year}.${m[2]}`)

  const snap = latestSnapshot(cfg.snapshotDir)
  if (!snap) {
    throw new Error('스냅샷이 없습니다. 먼저 `npm run scan` 을 한 번 실행하세요.')
  }
  say(`  스냅샷 : ${snap.meta.scannedAt.slice(0, 10)} (work ${snap.meta.counts.work})`)

  const client = await connect()
  const map = await requireTaskMap(client)
  const { list: tickets, warning } = await loadTickets(client)
  if (warning) say(`  ⚠ ${warning}`)
  else {
    const c = countByWorkType(tickets)
    say(
      `  티켓   : 전체 ${tickets.length}건 수집 (장애 ${c.incident} · 유지보수 ${c.maintenance} · 신규개발 ${c.development})`,
    )
  }

  const m2 = mapped(snap.state, map)
  say(
    m2.entries > 0
      ? `  태스크맵: 항목 ${m2.entries}개 적용 · 항목 미지정 ${m2.issues.unmapped}건 (대시보드 ${mapStamp(map)} 저장)`
      : '  태스크맵: 항목 없음 — 원본 그대로 1건=1행',
  )

  const model = buildReport(m2.state, tickets, {
    year,
    month,
    author: cfg.author,
    reportedOn: snap.meta.scannedAt.slice(0, 10),
    subtitle: cfg.subtitle,
    team: cfg.team,
    prevDueById: previousDueDates(cfg.snapshotDir, snap.meta.scannedAt.slice(0, 10)),
    table: {
      budget: TABLE.bottom - TABLE.top,
      headerH: TABLE.groupH,
      rowH: TABLE.rowH,
    },
  })

  model.footnotes.push(...mapFootnotes(m2.issues, m2.entries > 0))

  mkdirSync(cfg.outDir, { recursive: true })
  const out = join(cfg.outDir, `활동_월간요약보고서_${year}-${m[2]}.pptx`)
  await writeReport(model, out)

  const s = model.summary
  const shown = model.groups.reduce((n, g) => n + g.rows.length, 0)
  say(
    `  안건   : ${s.workTotal}건 (완료 ${s.done} · 진행 ${s.ing} · 지연 ${s.late})` +
      (shown < s.workTotal ? ` — 표에는 ${shown}건만` : ''),
  )
  say(`  묶음   : 프로젝트 ${model.groups.length}개`)
  const o = model.operations
  say(
    `  운영   : 당월 ${o.total}건 (장애 ${o.counts.incident} · 유지보수 ${o.counts.maintenance} · 신규개발 ${o.counts.development})`,
  )
  for (const f of model.footnotes) say(`  각주   : ${f}`)
  say(`  생성   : ${out}`)
}

/**
 * 업무 전수 목록.
 *
 * 보고서와 달리 **달로 거르지 않고 자르지도 않습니다.** 스냅샷에 있는 업무가
 * 전부 들어갑니다 — pptx 한 장에 안 들어가서 접힌 것들을 확인하는 자리입니다.
 * 티켓은 안 봅니다. 이건 desk 업무 목록입니다.
 *
 * 다만 **태스크 맵은 봅니다.** 보고서에서 접힌 건을 확인하는 자리인데 항목 구성이
 * 보고서와 다르면 대조가 안 됩니다.
 */
async function cmdList() {
  const snap = latestSnapshot(cfg.snapshotDir)
  if (!snap) {
    throw new Error('스냅샷이 없습니다. 먼저 `npm run scan` 을 한 번 실행하세요.')
  }
  const asOf = snap.meta.scannedAt.slice(0, 10)
  say(`업무 목록 — 기준일 ${asOf}`)

  const map = await requireTaskMap(await connect())
  const m3 = mapped(snap.state, map)
  const groups = buildWorkList(m3.state, asOf)
  const owners = summarizeByOwner(groups)

  mkdirSync(cfg.outDir, { recursive: true })
  const out = join(cfg.outDir, `업무목록_${asOf}.xlsx`)
  await writeWorkList(groups, owners, { asOf, sourceUpdatedAt: snap.meta.sourceUpdatedAt }, out)

  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  const empty = groups.filter((g) => g.rows.length === 0).length
  say(`  업무   : ${total}건 · 프로젝트 ${groups.length - 1}개${empty > 0 ? ` (업무 0건 ${empty}개 포함)` : ''} + 기타`)
  for (const f of mapFootnotes(m3.issues, m3.entries > 0)) say(`  맵     : ${f}`)
  say(`  인원   : ${owners.length}명 — ${owners.map((o) => `${o.owner} ${o.total}`).join(' · ')}`)
  say(`  생성   : ${out}`)
}

/** 기본 대상은 **지난달**입니다. 이달은 아직 안 끝났으므로 월간 보고가 성립하지 않습니다 */
function defaultMonth(now: Date): string {
  const y = now.getFullYear()
  const mo = now.getMonth() // 0-based = 지난달
  const d = mo === 0 ? new Date(y - 1, 11, 1) : new Date(y, mo - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function cmdDoctor() {
  say('설정 점검')
  say(`  desk   : ${cfg.deskUrl}`)
  say(`  스냅샷 : ${cfg.snapshotDir} (${listSnapshots(cfg.snapshotDir).length}개)`)
  say(`  출력   : ${cfg.outDir}`)

  let ok = true
  try {
    const hit = cookieOrDie()
    const r = await fetchState(cfg.deskUrl, hit.value)
    say(`  desk 연결: OK — ${r.state.work.length}건 (${r.email ?? '?'})`)
  } catch (e) {
    ok = false
    say(`  desk 연결: 실패 — ${e instanceof Error ? e.message : e}`)
  }

  try {
    const client = await connect()
    const { list, warning } = await loadTickets(client)
    if (warning || !client) {
      ok = false
      say(`  대시보드 : 미설정 — ${warning}`)
    } else {
      const c = countByWorkType(list)
      say(
        `  대시보드 : OK — 티켓 ${list.length}건 (장애 ${c.incident} · 유지보수 ${c.maintenance} · 신규개발 ${c.development})`,
      )

      const map = await fetchTaskMap(client)
      say(`  태스크맵 : 항목 ${map.entries.length}개 · ${mapStamp(map)} 저장 (원본은 대시보드)`)

      // **스냅샷 나이가 곧 보고서가 밀린 정도입니다.** 주간 보고서는 대시보드에
      // 올라간 최신 스냅샷의 날짜로 구간을 정하므로, 여기가 늙으면 화면은
      // 멀쩡한 얼굴로 지난 구간을 만들어 냅니다.
      const days = [...(await uploadedDays(client))].sort()
      const newest = days[days.length - 1]
      if (!newest) {
        ok = false
        say('  스냅샷   : 대시보드에 없음 — `npm run scan` 을 한 번 돌리세요')
      } else {
        const age = daysBetween(newest, todayIso())
        say(`  스냅샷   : 대시보드 최신 ${newest} (${age}일 전) · ${days.length}개`)
        if (age >= 7) {
          ok = false
          say(
            `  ⚠ 스냅샷이 ${age}일 지났습니다. 주간 보고서가 지난 구간으로 만들어집니다 — \`npm run scan\` 을 돌리세요.`,
          )
        }
      }
    }
  } catch (e) {
    ok = false
    say(`  대시보드 : 실패 — ${e instanceof Error ? e.message : e}`)
  }

  say(ok ? '\n전부 정상입니다.' : '\n일부 점검이 실패했습니다.')
  if (!ok) process.exit(1)
}

const [cmd, arg] = process.argv.slice(2)

try {
  if (cmd === 'scan') await cmdScan()
  else if (cmd === 'monthly') await cmdMonthly(arg)
  else if (cmd === 'list') await cmdList()
  else if (cmd === 'push') await cmdPush()
  else if (cmd === 'doctor') await cmdDoctor()
  else {
    say('사용법: reporter <scan|push|monthly [YYYY-MM]|list|doctor>')
    process.exit(2)
  }
} catch (e) {
  fail(e)
}
