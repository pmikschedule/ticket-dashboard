import { useSystems } from '../hooks/queries'
import {
  SEVERITIES,
  SEVERITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  UNCLASSIFIED_SYSTEM,
  WORK_TYPES,
  WORK_TYPE_LABELS,
  type Severity,
  type Status,
  type WorkType,
} from '../lib/constants'
import type { AppUser, TicketFilters } from '../lib/types'

interface Props {
  value: TicketFilters
  onChange: (next: TicketFilters) => void
  users: AppUser[]
  /** 칸반은 상태별로 열을 나누므로 상태 필터가 필요 없습니다. */
  showStatus?: boolean
}

/** 필터는 차트·목록 위 한 줄에 모읍니다. */
export default function Filters({ value, onChange, users, showStatus = true }: Props) {
  const { data: systems = [] } = useSystems()

  function set<K extends keyof TicketFilters>(key: K, next: TicketFilters[K]) {
    onChange({ ...value, [key]: next })
  }

  const isFiltered =
    (value.status && value.status !== 'all') ||
    (value.workType && value.workType !== 'all') ||
    (value.severity && value.severity !== 'all') ||
    (value.systemType && value.systemType !== 'all') ||
    (value.assigneeId && value.assigneeId !== 'all') ||
    !!value.search?.trim()

  return (
    <div className="card flex flex-wrap items-end gap-3 p-3">
      <div className="min-w-[200px] flex-1">
        <label className="label" htmlFor="filter-search">
          검색
        </label>
        <input
          id="filter-search"
          type="search"
          className="field"
          placeholder="제목 또는 요청자 메일"
          value={value.search ?? ''}
          onChange={(event) => set('search', event.target.value)}
        />
      </div>

      {showStatus && (
        <div>
          <label className="label" htmlFor="filter-status">
            상태
          </label>
          <select
            id="filter-status"
            className="field"
            value={value.status ?? 'all'}
            onChange={(event) => set('status', event.target.value as Status | 'all')}
          >
            <option value="all">전체</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="label" htmlFor="filter-work-type">
          대분류
        </label>
        <select
          id="filter-work-type"
          className="field"
          value={value.workType ?? 'all'}
          onChange={(event) => set('workType', event.target.value as WorkType | 'all')}
        >
          <option value="all">전체</option>
          {WORK_TYPES.map((workType) => (
            <option key={workType} value={workType}>
              {WORK_TYPE_LABELS[workType]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="filter-severity">
          등급
        </label>
        <select
          id="filter-severity"
          className="field"
          value={value.severity ?? 'all'}
          onChange={(event) => set('severity', event.target.value as Severity | 'all')}
        >
          <option value="all">전체</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {SEVERITY_LABELS[severity]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="filter-system">
          시스템
        </label>
        <select
          id="filter-system"
          className="field"
          value={value.systemType ?? 'all'}
          onChange={(event) => set('systemType', event.target.value)}
        >
          <option value="all">전체</option>
          <option value="unclassified">{UNCLASSIFIED_SYSTEM}</option>
          {systems.map((system) => (
            <option key={system.code} value={system.code}>
              {system.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="filter-assignee">
          담당자
        </label>
        <select
          id="filter-assignee"
          className="field"
          value={value.assigneeId ?? 'all'}
          onChange={(event) => set('assigneeId', event.target.value)}
        >
          <option value="all">전체</option>
          <option value="unassigned">미배정</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name || user.email}
            </option>
          ))}
        </select>
      </div>

      {isFiltered && (
        <button type="button" className="btn-secondary" onClick={() => onChange({})}>
          초기화
        </button>
      )}
    </div>
  )
}
