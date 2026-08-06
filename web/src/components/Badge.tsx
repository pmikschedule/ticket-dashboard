import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_STYLE,
  STATUS_ACCENT,
  STATUS_LABELS,
  SYSTEM_TYPE_LABELS,
  type Category,
  type Severity,
  type Status,
  type SystemType,
} from '../lib/constants'

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${SEVERITY_STYLE[severity]}`}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  )
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className={`h-2 w-2 rounded-full ${STATUS_ACCENT[status]}`} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  )
}

export function SystemBadge({ systemType }: { systemType: SystemType }) {
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      {SYSTEM_TYPE_LABELS[systemType]}
    </span>
  )
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className="inline-flex items-center rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
      {CATEGORY_LABELS[category]}
    </span>
  )
}

/**
 * LLM 분류가 실패했음을 드러냅니다.
 * 숨기면 담당자는 잘못된 등급을 사실로 믿게 됩니다.
 */
export function ClassifyErrorBadge({ error }: { error: string }) {
  return (
    <span
      title={error}
      className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-300"
    >
      ⚠ 자동분류 실패
    </span>
  )
}

export function OverdueBadge() {
  return (
    <span className="inline-flex items-center rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
      기한 초과
    </span>
  )
}
