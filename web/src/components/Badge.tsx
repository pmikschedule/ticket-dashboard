import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_STYLE,
  STATUS_ACCENT,
  STATUS_LABELS,
  UNCLASSIFIED_SYSTEM,
  WORK_TYPE_LABELS,
  WORK_TYPE_STYLE,
  type Category,
  type Severity,
  type Status,
  type WorkType,
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

/**
 * 시스템 배지.
 *
 * 표시명은 등록표에서 찾아 넘깁니다. 등록표에 없는 코드(시스템을 지운 뒤의
 * 과거 티켓)는 '미분류' 로 보이되, 원래 코드를 툴팁으로 남겨 추적할 수 있게 합니다.
 */
export function SystemBadge({ code, label }: { code: string | null; label?: string | null }) {
  const unclassified = !label
  return (
    <span
      title={code && unclassified ? `등록표에 없는 코드: ${code}` : undefined}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
        unclassified ? 'bg-slate-50 text-slate-400' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {label || UNCLASSIFIED_SYSTEM}
    </span>
  )
}

/** 대분류 배지. 장애·유지보수·신규개발은 관리 방식이 달라 눈에 먼저 들어와야 합니다. */
export function WorkTypeBadge({ workType }: { workType: WorkType }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${WORK_TYPE_STYLE[workType]}`}
    >
      {WORK_TYPE_LABELS[workType]}
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
