/**
 * 주간 현황 — 팀 전체가 공유하는 작업별 목록.
 *
 * 행을 만드는 부분은 **전부 순수 함수**입니다. 엑셀 라이브러리는 마지막
 * 쓰기 단계에서만 쓰고, 그것도 동적 import 라 내려받기를 누를 때만 로드됩니다
 * (일상적으로 쓰는 보드·통계 화면에 1MB 를 얹지 않기 위해서입니다).
 */

import {
  CATEGORY_LABELS,
  RESOLUTION_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  UNCLASSIFIED_SYSTEM,
  WORK_TYPE_LABELS,
} from './constants'
import type { LeadTimeRow } from './types'

/** 주간 보고에서의 구분. 같은 목록도 이게 있어야 "주간" 이 됩니다. */
export type WeeklyBucket = '금주 완료' | '금주 접수' | '진행 중'

export interface WeeklyRow {
  bucket: WeeklyBucket
  ticketId: number
  workType: string
  category: string
  severity: string
  system: string
  subject: string
  assignee: string
  status: string
  receivedAt: string
  dueDate: string
  completedAt: string
  /** 어떻게 끝났는가. 완료가 아니거나 안 골랐으면 빈 문자열 — 'Fixed' 로 채우지 않습니다 */
  resolution: string
  /** 접수 → 완료. 완료되지 않았으면 빈 문자열 */
  leadTime: string
  /** 보류에 머문 시간. 없으면 빈 문자열 */
  onHold: string
  overdue: string
}

export interface WeeklyRange {
  /** 주 시작 (월요일 00:00) */
  start: Date
  /** 주 끝 (일요일 23:59:59.999) */
  end: Date
  label: string
}

/** ISO 주차 기준 — 월요일 시작. `offset` 은 몇 주 전인지 (0=이번 주). */
export function weekRange(today: Date = new Date(), offset = 0): WeeklyRange {
  const start = new Date(today)
  // getDay(): 0=일요일. 월요일을 주 시작으로 삼습니다.
  const dayOfWeek = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - dayOfWeek - offset * 7)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)

  return { start, end, label: `${fmt(start)} ~ ${fmt(end)}` }
}

function fmt(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateOnly(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : fmt(date)
}

function within(value: string | null, range: WeeklyRange): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= range.start.getTime() && time <= range.end.getTime()
}

function hoursText(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return ''
  if (hours < 24) return `${hours.toFixed(1)}시간`
  return `${(hours / 24).toFixed(1)}일`
}

/**
 * 주간 대상 티켓을 고릅니다.
 *
 * 신규개발은 제외합니다 — 주간 현황은 상시 업무(장애·유지보수)의 진척을
 * 공유하는 것이고, 신규개발은 Gantt 로 따로 봅니다.
 */
export function selectWeekly(rows: LeadTimeRow[], range: WeeklyRange): LeadTimeRow[] {
  return rows.filter((row) => {
    if (row.work_type === 'development') return false
    // 금주 완료 · 금주 접수 · 아직 진행 중인 건이 대상입니다.
    if (within(row.completed_at, range)) return true
    if (within(row.received_at, range)) return true
    return row.status !== 'done'
  })
}

function bucketOf(row: LeadTimeRow, range: WeeklyRange): WeeklyBucket {
  if (within(row.completed_at, range)) return '금주 완료'
  if (within(row.received_at, range)) return '금주 접수'
  return '진행 중'
}

const BUCKET_ORDER: Record<WeeklyBucket, number> = {
  '금주 완료': 0,
  '금주 접수': 1,
  '진행 중': 2,
}

export interface WeeklyLookups {
  systemLabel: (code: string | null) => string | undefined
  userName: (id: string | null) => string | undefined
}

/** 엑셀에 그대로 들어갈 행. 라벨은 전부 한글로 바꿔서 넣습니다. */
export function buildWeeklyRows(
  rows: LeadTimeRow[],
  range: WeeklyRange,
  lookups: WeeklyLookups,
  today: Date = new Date(),
): WeeklyRow[] {
  return selectWeekly(rows, range)
    .map((row) => {
      const overdue =
        row.status !== 'done' &&
        !!row.due_date &&
        new Date(`${row.due_date}T23:59:59`).getTime() < today.getTime()

      return {
        bucket: bucketOf(row, range),
        ticketId: row.ticket_id,
        workType: WORK_TYPE_LABELS[row.work_type] ?? row.work_type,
        category: CATEGORY_LABELS[row.category] ?? row.category,
        severity: SEVERITY_LABELS[row.severity] ?? row.severity,
        system: lookups.systemLabel(row.system_type) ?? UNCLASSIFIED_SYSTEM,
        subject: row.subject,
        assignee: lookups.userName(row.assignee_id) ?? '미배정',
        status: STATUS_LABELS[row.status] ?? row.status,
        receivedAt: dateOnly(row.received_at),
        dueDate: row.due_date ?? '',
        completedAt: dateOnly(row.completed_at),
        resolution: row.resolution ? RESOLUTION_LABELS[row.resolution] : '',
        leadTime: hoursText(row.lead_time_hours),
        onHold: row.hold_hours > 0 ? hoursText(row.hold_hours) : '',
        overdue: overdue ? '초과' : '',
      }
    })
    .sort((a, b) => {
      const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
      if (byBucket !== 0) return byBucket
      return a.ticketId - b.ticketId
    })
}

export interface WeeklySummary {
  completed: number
  received: number
  ongoing: number
  overdue: number
  /** 이 주에 보류 상태인 건 — 진행 중과 섞으면 팀이 손대고 있는 줄 압니다 */
  onHold: number
}

export function summarizeWeekly(rows: WeeklyRow[]): WeeklySummary {
  return {
    completed: rows.filter((r) => r.bucket === '금주 완료').length,
    received: rows.filter((r) => r.bucket === '금주 접수').length,
    ongoing: rows.filter((r) => r.bucket === '진행 중').length,
    overdue: rows.filter((r) => r.overdue === '초과').length,
    onHold: rows.filter((r) => r.status === STATUS_LABELS.on_hold).length,
  }
}

/** 엑셀 열 정의. 화면 표와 순서를 맞춥니다. */
export const WEEKLY_COLUMNS: { header: string; key: keyof WeeklyRow; width: number }[] = [
  { header: '구분', key: 'bucket', width: 10 },
  { header: '번호', key: 'ticketId', width: 7 },
  { header: '대분류', key: 'workType', width: 10 },
  { header: '유형', key: 'category', width: 8 },
  { header: '등급', key: 'severity', width: 9 },
  { header: '시스템', key: 'system', width: 14 },
  { header: '제목', key: 'subject', width: 46 },
  { header: '담당자', key: 'assignee', width: 12 },
  { header: '상태', key: 'status', width: 11 },
  { header: '접수일', key: 'receivedAt', width: 12 },
  { header: '기한', key: 'dueDate', width: 12 },
  { header: '기한초과', key: 'overdue', width: 9 },
  { header: '완료일', key: 'completedAt', width: 12 },
  { header: '종료 방식', key: 'resolution', width: 12 },
  { header: '보류', key: 'onHold', width: 9 },
  { header: '소요', key: 'leadTime', width: 10 },
]

export function weeklyFileName(range: WeeklyRange): string {
  return `주간현황_${fmt(range.start)}_${fmt(range.end)}.xlsx`
}

/**
 * 엑셀 파일을 만들어 내려받습니다.
 *
 * exceljs 는 1MB 가 넘어서 **동적 import** 로 이때만 로드합니다.
 * 보드·통계처럼 매일 여는 화면의 첫 로딩을 늦추지 않기 위해서입니다.
 */
export async function downloadWeeklyExcel(
  rows: WeeklyRow[],
  range: WeeklyRange,
  summary: WeeklySummary,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('주간현황', {
    views: [{ state: 'frozen', ySplit: 3 }], // 제목 2줄 + 헤더 1줄 고정
  })

  // 제목 줄
  sheet.mergeCells(1, 1, 1, WEEKLY_COLUMNS.length)
  const title = sheet.getCell(1, 1)
  title.value = `유지보수 주간 현황  (${range.label})`
  title.font = { size: 14, bold: true }
  title.alignment = { vertical: 'middle' }
  sheet.getRow(1).height = 24

  sheet.mergeCells(2, 1, 2, WEEKLY_COLUMNS.length)
  const sub = sheet.getCell(2, 1)
  sub.value =
    `금주 완료 ${summary.completed}건 · 금주 접수 ${summary.received}건 · ` +
    `진행 중 ${summary.ongoing}건 · 보류 ${summary.onHold}건 · 기한 초과 ${summary.overdue}건`
  sub.font = { size: 10, color: { argb: 'FF52514E' } }

  // 헤더
  const headerRow = sheet.getRow(3)
  WEEKLY_COLUMNS.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = column.header
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  headerRow.height = 20
  sheet.columns = WEEKLY_COLUMNS.map((column) => ({ width: column.width }))

  // 본문
  rows.forEach((row) => {
    const values = WEEKLY_COLUMNS.map((column) => row[column.key])
    const added = sheet.addRow(values)
    added.font = { size: 10 }
    added.alignment = { vertical: 'top' }

    // 기한 초과만 색으로 드러냅니다. 나머지는 글자로 충분합니다.
    if (row.overdue) {
      added.getCell(WEEKLY_COLUMNS.findIndex((c) => c.key === 'overdue') + 1).font = {
        size: 10,
        bold: true,
        color: { argb: 'FFC0392B' },
      }
    }
  })

  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + rows.length, column: WEEKLY_COLUMNS.length },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = weeklyFileName(range)
  link.click()
  URL.revokeObjectURL(url)
}
