/**
 * 업무 목록 xlsx — `worklist.ts` 가 끝낸 값을 시트에 얹습니다.
 *
 * **여기서는 계산하지 않습니다.** 건수·정렬·묶음은 전부 순수 함수가 정한 것이
 * 그대로 들어옵니다. 숫자가 틀리면 볼 곳은 여기가 아닙니다.
 */

import ExcelJS from 'exceljs'
import { ETC_TITLE, type ListGroup, type OwnerSummary } from './worklist.ts'

/** pptx 와 같은 색을 씁니다 — 두 산출물이 같은 자료라는 게 눈으로 보여야 합니다 */
const NAVY = 'FF1F3A5F'
const BAND = 'FFDCE6F1'
const RED = 'FF9B2C2C'
const TEAL = 'FF0F766E'
const MUTED = 'FF5B6B7B'

type Row = ExcelJS.Row

/**
 * 진척율 칸.
 *
 * **문자열이 아니라 숫자로 넣습니다** (0.44 + `0%` 서식). 문자열 '44%' 로 넣으면
 * 정렬하면 100% 가 44% 앞에 오고 평균도 못 냅니다. 값이 없으면 **빈 칸**입니다 —
 * 0% 로 채우면 '아직 시작 안 함' 과 '진척을 모름' 이 같아 보입니다.
 */
function percentCell(cell: ExcelJS.Cell, value: number | null): void {
  if (value === null) return
  cell.value = value / 100
  cell.numFmt = '0%'
}

function headerRow(sheet: ExcelJS.Worksheet, labels: string[]): Row {
  const row = sheet.addRow(labels)
  row.height = 20
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  return row
}

/**
 * 묶음 머리행 — 프로젝트 이름 · 상태 건수 · 마일스톤.
 *
 * 건수는 **자르기 전 전체**입니다. 이 목록은 애초에 자르지 않지만, pptx 와
 * 같은 자리에 같은 숫자가 있어야 두 산출물을 나란히 놓고 볼 수 있습니다.
 */
function groupRow(sheet: ExcelJS.Worksheet, g: ListGroup, cols: number): void {
  // 완료·진행중·대기는 셋이 합쳐 전체가 되지만 **지연은 그 축이 아닙니다**
  // (미완료 + 마감일 경과). 나란히 늘어놓으면 넷을 더해 보게 되므로 따로 뗍니다.
  const parts: string[] = []
  if (g.counts.done > 0) parts.push(`완료 ${g.counts.done}`)
  if (g.counts.ing > 0) parts.push(`진행중 ${g.counts.ing}`)
  if (g.counts.todo > 0) parts.push(`대기 ${g.counts.todo}`)

  const late = g.counts.late > 0 ? `이 중 지연 ${g.counts.late}` : ''
  // 진척율은 마일스톤이 근거이므로 둘을 붙여 씁니다 — 숫자만 있으면 무엇을
  // 세어 나온 값인지 알 수 없고, 업무 진척율과 헷갈립니다.
  const ms = g.milestones
    ? `진척율 ${g.progress}% (마일스톤 ${g.milestones.done}/${g.milestones.total})`
    : ''
  const people = g.owners.length > 0 ? `${g.owners.join(' · ')}` : '담당 없음'
  const summary = [`${g.rows.length}건`, parts.join(' · '), late, people, ms]
    .filter(Boolean)
    .join('   |   ')

  const row = sheet.addRow([`${g.title}      ${summary}`])
  sheet.mergeCells(row.number, 1, row.number, cols)
  row.height = 19
  const cell = row.getCell(1)
  cell.font = { bold: true, size: 10, color: { argb: NAVY } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }
  cell.alignment = { vertical: 'middle' }
}

/**
 * 업무 한 줄.
 *
 * 담당자 칸은 **같은 사람이 이어지면 비웁니다.** 세로로 이름이 반복되면 어디서
 * 사람이 바뀌는지가 오히려 안 보입니다 (`prevOwner` 비교).
 */
function workRow(sheet: ExcelJS.Worksheet, r: ListGroup['rows'][number], sameOwner: boolean): void {
  const row = sheet.addRow([
    sameOwner ? '' : r.owner,
    r.title,
    r.late ? `${r.status} (지연)` : r.status,
    null, // 진척율 — 숫자+서식으로 따로 넣습니다
    r.types,
    r.start,
    r.due,
    r.completedOn,
    r.system,
    r.detail,
  ])
  percentCell(row.getCell(4), r.progress)
  row.height = 17
  row.eachCell({ includeEmpty: true }, (cell, i) => {
    cell.font = { size: 9.5 }
    cell.alignment = { vertical: 'middle', wrapText: i === 10 }
    if (i >= 3 && i <= 8) cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  row.getCell(1).font = { size: 9.5, bold: !sameOwner }
  row.getCell(2).font = { size: 9.5, bold: true }
  if (r.late) row.getCell(3).font = { size: 9.5, bold: true, color: { argb: RED } }
  else if (r.status === '완료') row.getCell(3).font = { size: 9.5, color: { argb: TEAL } }
  if (r.progress !== null) row.getCell(4).font = { size: 9.5, bold: true, color: { argb: NAVY } }
  if (!r.detail) row.getCell(10).font = { size: 9.5, color: { argb: MUTED } }
}

function autoFilterAndFreeze(sheet: ExcelJS.Worksheet, headerRowNumber: number): void {
  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }]
}

/**
 * 요약 시트 꼬리말.
 *
 * '지연' 칸이 완료·진행중·대기 옆에 있으면 넷을 더해 전체가 나온다고 읽힙니다.
 * 지연은 **미완료 건에 붙는 표시**이지 네 번째 상태가 아닙니다. 한 줄로 밝힙니다.
 */
function lateNote(sheet: ExcelJS.Worksheet, cols: number): void {
  sheet.addRow([])
  const row = sheet.addRow([
    '※ 지연은 완료·진행중·대기와 별개 축입니다 (미완료 + 마감일 경과). 합계에 더하지 마세요.',
  ])
  sheet.mergeCells(row.number, 1, row.number, cols)
  row.getCell(1).font = { size: 9, color: { argb: MUTED } }
}

export interface ListMeta {
  /** 스냅샷을 뜬 날. 목록의 모든 판정이 이 시각 기준입니다 */
  asOf: string
  sourceUpdatedAt: string | null
}

export async function writeWorkList(
  groups: ListGroup[],
  owners: OwnerSummary[],
  meta: ListMeta,
  outPath: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.created = new Date(`${meta.asOf}T00:00:00Z`)

  // ── 1. 업무 목록 ──────────────────────────────────────────────────────────
  const list = wb.addWorksheet('업무 목록', { views: [{ state: 'frozen', ySplit: 3 }] })
  const COLS = 10

  const title = list.addRow([`업무 목록 — 프로젝트별 · 담당자별 (기준일 ${meta.asOf})`])
  list.mergeCells(1, 1, 1, COLS)
  title.height = 24
  title.getCell(1).font = { bold: true, size: 13, color: { argb: NAVY } }

  const note = list.addRow([
    `desk 스냅샷 ${meta.asOf}${meta.sourceUpdatedAt ? ` (원본 ${meta.sourceUpdatedAt})` : ''} · 프로젝트가 없는 업무는 '${ETC_TITLE}' 에 개별 항목으로 둡니다 · 지연 = 미완료 + 마감일 경과 · 진척율은 머리행(프로젝트=마일스톤 기준)과 업무 행(desk work.progress)이 서로 다른 값입니다`,
  ])
  list.mergeCells(2, 1, 2, COLS)
  note.getCell(1).font = { size: 9, color: { argb: MUTED } }

  headerRow(list, [
    '담당자',
    '안건',
    '상태',
    '진척율',
    '유형',
    '시작',
    '마감',
    '완료',
    '시스템',
    '주요 진행 내용',
  ])
  list.columns = [
    { width: 12 },
    { width: 44 },
    { width: 12 },
    { width: 9 },
    { width: 12 },
    { width: 11 },
    { width: 11 },
    { width: 11 },
    { width: 10 },
    { width: 52 },
  ]

  for (const g of groups) {
    groupRow(list, g, COLS)
    let prevOwner = ''
    for (const r of g.rows) {
      workRow(list, r, r.owner === prevOwner)
      prevOwner = r.owner
    }
    if (g.rows.length === 0) {
      const empty = list.addRow(['', '등록된 업무 없음'])
      empty.getCell(2).font = { size: 9.5, italic: true, color: { argb: MUTED } }
    }
  }

  // ── 2. 인원별 요약 ────────────────────────────────────────────────────────
  const per = wb.addWorksheet('인원별 요약')
  headerRow(per, ['담당자', '전체', '완료', '진행중', '대기', '지연', '완료율', '참여 프로젝트'])
  per.columns = [
    { width: 12 },
    { width: 8 },
    { width: 8 },
    { width: 9 },
    { width: 8 },
    { width: 8 },
    { width: 9 },
    { width: 64 },
  ]
  for (const o of owners) {
    const row = per.addRow([
      o.owner,
      o.total,
      o.done,
      o.ing,
      o.todo,
      o.late,
      null, // 완료율
      o.projects.join(' · '),
    ])
    percentCell(row.getCell(7), o.doneRate)
    row.eachCell((cell, i) => {
      cell.font = { size: 9.5, bold: i === 1 }
      if (i >= 2 && i <= 7) cell.alignment = { horizontal: 'center' }
    })
    if (o.late > 0) row.getCell(6).font = { size: 9.5, bold: true, color: { argb: RED } }
    row.getCell(7).font = { size: 9.5, bold: true, color: { argb: NAVY } }
    row.getCell(8).font = { size: 9, color: { argb: MUTED } }
  }
  lateNote(per, 8)
  // 완료율을 진척율로 읽지 않게 못박습니다. desk 에 사람 단위 진척 값은 없습니다.
  const rateNote = per.addRow([
    '※ 완료율 = 완료 ÷ 전체 건수입니다. 업무마다 크기가 달라 일의 진척과는 다릅니다 — desk 에 사람 단위 진척 값은 없습니다.',
  ])
  per.mergeCells(rateNote.number, 1, rateNote.number, 8)
  rateNote.getCell(1).font = { size: 9, color: { argb: MUTED } }
  autoFilterAndFreeze(per, 1)

  // ── 3. 프로젝트별 요약 ────────────────────────────────────────────────────
  const proj = wb.addWorksheet('프로젝트별 요약')
  headerRow(proj, [
    '프로젝트',
    '업무',
    '완료',
    '진행중',
    '대기',
    '지연',
    '진척율',
    '마일스톤',
    '참여 인원',
  ])
  proj.columns = [
    { width: 32 },
    { width: 8 },
    { width: 8 },
    { width: 9 },
    { width: 8 },
    { width: 8 },
    { width: 9 },
    { width: 12 },
    { width: 44 },
  ]
  for (const g of groups) {
    const row = proj.addRow([
      g.title,
      g.rows.length,
      g.counts.done,
      g.counts.ing,
      g.counts.todo,
      g.counts.late,
      null, // 진척율 — 마일스톤이 없으면 빈 칸입니다
      // 마일스톤이 없는 프로젝트를 0/0 으로 채우지 않습니다
      g.milestones ? `${g.milestones.done}/${g.milestones.total}` : '',
      g.owners.join(' · '),
    ])
    percentCell(row.getCell(7), g.progress)
    row.eachCell((cell, i) => {
      cell.font = { size: 9.5, bold: i === 1 }
      if (i >= 2 && i <= 8) cell.alignment = { horizontal: 'center' }
    })
    if (g.counts.late > 0) row.getCell(6).font = { size: 9.5, bold: true, color: { argb: RED } }
    if (g.progress !== null) row.getCell(7).font = { size: 9.5, bold: true, color: { argb: NAVY } }
    if (g.rows.length === 0) row.getCell(1).font = { size: 9.5, color: { argb: MUTED } }
    row.getCell(9).font = { size: 9, color: { argb: MUTED } }
  }
  lateNote(proj, 9)
  // 진척율의 근거를 밝힙니다. 업무 건수로 낸 값이 아닙니다.
  const msNote = proj.addRow([
    '※ 진척율 = 완료 마일스톤 ÷ 전체 마일스톤입니다. 업무 건수와는 무관하고, 마일스톤이 없는 프로젝트는 빈 칸입니다 (0% 가 아닙니다).',
  ])
  proj.mergeCells(msNote.number, 1, msNote.number, 9)
  msNote.getCell(1).font = { size: 9, color: { argb: MUTED } }
  autoFilterAndFreeze(proj, 1)

  for (const sheet of [per, proj]) {
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    })
  }
  await wb.xlsx.writeFile(outPath)
}
