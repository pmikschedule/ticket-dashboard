#!/usr/bin/env -S npx tsx
/**
 * CLI — `doctor` · `scan` · `weekly` · `monthly` · `list` · `ui`.
 *
 *   scan             desk 를 읽어 오늘자 스냅샷을 남깁니다 (주 1회 이상 권장)
 *   weekly [YYYY-MM-DD] 주간 업무 보고 pptx (화~월 구간, 끝나는 월요일로 지정)
 *   monthly [YYYY-MM] 그 달의 보고서 pptx 를 만듭니다 (기본: 지난달)
 *   list             업무 전수 목록 xlsx 를 만듭니다 (프로젝트별 · 담당자별)
 *   ui               태스크 맵 편집 화면 (localhost)
 *   doctor           설정·연결·쿠키 만료를 점검합니다
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.ts'
import { daysLeft, resolveCookie } from './cookie.ts'
import {
  fetchState,
  latestSnapshot,
  listSnapshots,
  makeSnapshot,
  previousDueDates,
  saveSnapshot,
  snapshotAfter,
  snapshotBefore,
  snapshotsBefore,
} from './desk.ts'
import { fetchTickets, signIn } from './dashboard.ts'
import { buildReport, countByWorkType } from './aggregate.ts'
import { ISSUES, STANDALONE_RULE, TABLE, WEEKLY_PROGRESS } from './layout.ts'
import { writeReport } from './render.ts'
import { buildWorkList, summarizeByOwner } from './worklist.ts'
import { buildWeekly } from './weekly.ts'
import { writeWeekly } from './weeklyRender.ts'
import { currentWeek, nextWeek, parseWeekLabel, rangeLabel } from './week.ts'
import { applyTaskMap, loadTaskMap, mapFootnotes } from './taskmap.ts'
import { startUi } from './ui.ts'
import { writeWorkList } from './xlsx.ts'
import type { TicketRow } from './types.ts'

const cfg = loadConfig()
const host = new URL(cfg.deskUrl).host

function say(s = '') {
  process.stdout.write(`${s}\n`)
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
function mapped(state: import('./types.ts').DeskState) {
  const map = loadTaskMap(cfg.taskmapPath)
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
}

/**
 * 티켓(장애·유지보수·신규개발). 대시보드 설정이 없으면 **빈 배열로 진행하고
 * 그 사실을 알립니다.** 여기서 멈추면 desk 쪽만이라도 보고 싶은 사람이
 * 아무것도 못 받습니다.
 */
async function loadTickets(): Promise<{ list: TicketRow[]; warning: string | null }> {
  if (!cfg.supabaseUrl || !cfg.supabaseEmail) {
    return {
      list: [],
      warning: '대시보드 설정이 없어 운영 집계를 건너뜁니다 (.env 의 SUPABASE_* 확인)',
    }
  }
  const client = await signIn({
    url: cfg.supabaseUrl,
    anonKey: cfg.supabaseAnonKey,
    email: cfg.supabaseEmail,
    password: cfg.supabasePassword,
  })
  return { list: await fetchTickets(client), warning: null }
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

  const { list: tickets, warning } = await loadTickets()
  if (warning) say(`  ⚠ ${warning}`)
  else {
    const c = countByWorkType(tickets)
    say(
      `  티켓   : 전체 ${tickets.length}건 수집 (장애 ${c.incident} · 유지보수 ${c.maintenance} · 신규개발 ${c.development})`,
    )
  }

  const m2 = mapped(snap.state)
  if (m2.entries > 0) say(`  태스크맵: 항목 ${m2.entries}개 적용 · 항목 미지정 ${m2.issues.unmapped}건`)

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
 * 주간 업무 보고.
 *
 * **지난주 스냅샷과 대조**해 변화(완료·착수·신규·일정변경·마일스톤 증가)를 냅니다.
 * 비교 대상이 없으면 만들기를 거부하지 않고 **기준 주차**로 냅니다 — 첫 주에도
 * 현재 상태는 보고할 수 있어야 하고, 비교가 없었다는 사실은 슬라이드에 적힙니다.
 */
async function cmdWeekly(argWeek?: string) {
  const newest = latestSnapshot(cfg.snapshotDir)
  if (!newest) {
    throw new Error('스냅샷이 없습니다. 먼저 `npm run scan` 을 한 번 실행하세요.')
  }
  const scannedOn = newest.meta.scannedAt.slice(0, 10)

  // 기본은 **방금 끝난 구간** — 가장 최근 월요일로 끝나는 화~월 7일입니다.
  // 기준일은 스냅샷 날짜입니다. 오늘 날짜를 쓰면 오래된 스냅샷으로 최신 주를
  // 만들게 되어, 비어 있는 보고서가 나옵니다.
  const week = argWeek ? parseWeekLabel(argWeek) : currentWeek(scannedOn)
  if (!week) {
    throw new Error(`주간 지정이 잘못됐습니다: ${argWeek} — 끝나는 **월요일**을 YYYY-MM-DD 로 주세요 (예: 2026-08-10)`)
  }

  // 구간이 끝난 뒤 처음 뜬 스냅샷이 그 주의 마감 상태입니다. 아직 안 떴으면
  // 최신 것을 쓰되, 구간 밖이라는 사실을 각주에 남깁니다.
  const snap = snapshotAfter(cfg.snapshotDir, week.to) ?? newest
  const snapDay = snap.meta.scannedAt.slice(0, 10)

  say(`주간 업무 보고 — ${rangeLabel(week)}`)
  say(`  스냅샷 : ${snapDay} (work ${snap.meta.counts.work})`)

  const base = snapshotBefore(cfg.snapshotDir, week.from)
  if (base) {
    const baseDay = base.meta.scannedAt.slice(0, 10)
    say(`  비교   : ${baseDay} 스냅샷 대비`)
  } else {
    say('  비교   : 없음 — 기준 주차로 만듭니다 (스냅샷이 한 주치뿐)')
  }

  // 기준 스냅샷에도 **같은 맵**을 적용합니다. 한쪽만 적용하면 통합 항목이
  // 지난주엔 없던 것으로 보여 전부 '금주 신규' 가 됩니다.
  const now = mapped(snap.state)
  const before = base ? mapped(base.state).state : null
  if (now.entries > 0) {
    say(`  태스크맵: 항목 ${now.entries}개 적용 · 항목 미지정 ${now.issues.unmapped}건`)
  }

  const model = buildWeekly(before, now.state, {
    week,
    nextWeek: nextWeek(week),
    author: cfg.author,
    reportedOn: snapDay,
    subtitle: cfg.subtitle,
    team: cfg.team,
    baseline: base ? base.meta.scannedAt.slice(0, 10) : null,
    history: snapshotsBefore(cfg.snapshotDir, week.from, 2).map((x) => mapped(x.state).state),
    table: {
      budget: TABLE.bottom - TABLE.top,
      headerH: TABLE.groupH,
      ruleH: STANDALONE_RULE.h,
      rowH: TABLE.rowH,
    },
    maxProgress: WEEKLY_PROGRESS.max,
    maxChanges: ISSUES.max,
  })

  mkdirSync(cfg.outDir, { recursive: true })
  if (snapDay > week.to) {
    // 그 주 마감 뒤에 뜬 스냅샷이 없어 이후 상태로 만들었다는 사실을 밝힙니다
    footnoteLate(model, week.to, snapDay)
  }
  model.footnotes.push(...mapFootnotes(now.issues, now.entries > 0))

  const out = join(cfg.outDir, `주간업무보고_${week.id}.pptx`)
  await writeWeekly(model, rangeLabel(nextWeek(week)), out)

  const s = model.summary
  say(`  변화   : 완료 ${s.done} · 착수 ${s.started} · 신규 ${s.added} · 진행 ${s.ing} · 지연 ${s.late}`)
  say(`  묶음   : 프로젝트 ${model.groups.filter((g) => !g.standalone).length}개` +
      (model.groups.some((g) => g.standalone) ? ' + 개별 업무' : ''))
  say(`  진척   : 프로젝트 ${model.progress.length}개 (마일스톤 있는 것만)`)
  for (const f of model.footnotes) say(`  각주   : ${f}`)
  say(`  생성   : ${out}`)
}

/** 구간 마감보다 늦은 스냅샷을 썼다는 각주. 조용히 넘기면 그 주 상태로 오해합니다 */
function footnoteLate(model: { footnotes: string[] }, weekTo: string, snapDay: string) {
  model.footnotes.push(`구간 마감(${weekTo}) 이후 스냅샷(${snapDay}) 기준`)
}

/**
 * 업무 전수 목록.
 *
 * 보고서와 달리 **달로 거르지 않고 자르지도 않습니다.** 스냅샷에 있는 업무가
 * 전부 들어갑니다 — pptx 한 장에 안 들어가서 접힌 것들을 확인하는 자리입니다.
 * 대시보드(티켓)는 안 봅니다. 이건 desk 업무 목록입니다.
 */
async function cmdList() {
  const snap = latestSnapshot(cfg.snapshotDir)
  if (!snap) {
    throw new Error('스냅샷이 없습니다. 먼저 `npm run scan` 을 한 번 실행하세요.')
  }
  const asOf = snap.meta.scannedAt.slice(0, 10)
  say(`업무 목록 — 기준일 ${asOf}`)

  const m3 = mapped(snap.state)
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

/** 태스크 맵 편집 화면. 브라우저를 자동으로 엽니다 */
async function cmdUi() {
  startUi(cfg, (url) => {
    say(`태스크 맵 UI — ${url}`)
    say(`  맵     : ${cfg.taskmapPath}`)
    say('  멈추려면 Ctrl+C')
    // 열어 주지 않으면 주소를 복사해 붙이게 됩니다
    import('node:child_process').then(({ spawn }) => spawn('open', [url], { stdio: 'ignore' }))
  })
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
    const { list, warning } = await loadTickets()
    if (warning) {
      ok = false
      say(`  대시보드 : 미설정 — ${warning}`)
    } else {
      const c = countByWorkType(list)
      say(
        `  대시보드 : OK — 티켓 ${list.length}건 (장애 ${c.incident} · 유지보수 ${c.maintenance} · 신규개발 ${c.development})`,
      )
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
  else if (cmd === 'weekly') await cmdWeekly(arg)
  else if (cmd === 'monthly') await cmdMonthly(arg)
  else if (cmd === 'list') await cmdList()
  else if (cmd === 'ui') await cmdUi()
  else if (cmd === 'doctor') await cmdDoctor()
  else {
    say('사용법: reporter <scan|weekly [YYYY-MM-DD(월)]|monthly [YYYY-MM]|list|ui|doctor>')
    process.exit(2)
  }
} catch (e) {
  fail(e)
}
