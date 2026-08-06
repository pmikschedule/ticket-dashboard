import { useMemo } from 'react'

import { BarList, ColumnTrend, StatTile } from '../components/Charts'
import { useLeadTimes } from '../hooks/queries'
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RAMP,
  STATUS_LABELS,
  SYSTEM_TYPE_LABELS,
} from '../lib/constants'
import { formatHours } from '../lib/format'
import { buildDashboardStats } from '../lib/stats'

/**
 * 통계 대시보드 (기획서 3.2):
 * 시스템별 접수 현황 · 처리 리드타임 · 장애 등급별 통계.
 *
 * 모든 집계는 src/lib/stats.ts 순수 함수를 거칩니다 — 화면에서 직접 계산하지 않습니다.
 */
export default function StatsPage() {
  const { data: rows = [], isLoading, error } = useLeadTimes()
  const stats = useMemo(() => buildDashboardStats(rows), [rows])

  if (error) {
    return (
      <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
        통계를 불러오지 못했습니다: {error instanceof Error ? error.message : String(error)}
      </p>
    )
  }

  if (isLoading) return <p className="text-sm text-slate-500">불러오는 중…</p>

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-slate-500">
          아직 적재된 티켓이 없습니다. 에이전트가 메일을 수집하면 여기에 통계가 쌓입니다.
        </p>
      </div>
    )
  }

  const { leadTime } = stats

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="전체 티켓" value={`${stats.total}건`} />
        <StatTile
          label="진행 중"
          value={`${stats.open}건`}
          hint={`완료 ${stats.done}건`}
          tone={stats.open > stats.done ? 'warning' : 'default'}
        />
        <StatTile
          label="평균 리드타임"
          value={formatHours(leadTime.averageHours)}
          hint={`완료 ${leadTime.completed}건 기준`}
        />
        <StatTile
          label="중앙값 / P90"
          value={formatHours(leadTime.medianHours)}
          hint={`P90 ${formatHours(leadTime.p90Hours)}`}
        />
      </div>

      <ColumnTrend
        title="최근 14일 접수 추이"
        subtitle="메일 수신일 기준"
        data={stats.intake}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList
          title="시스템별 접수 현황"
          data={stats.bySystem.map((bucket) => ({
            label: SYSTEM_TYPE_LABELS[bucket.key],
            value: bucket.count,
          }))}
        />

        <BarList
          title="장애 등급별 현황"
          data={[...stats.bySeverity]
            .reverse()
            .map((bucket) => ({
              label: SEVERITY_LABELS[bucket.key],
              value: bucket.count,
              color: SEVERITY_RAMP[bucket.key],
            }))}
        />

        <BarList
          title="상태별 분포"
          data={stats.byStatus.map((bucket) => ({
            label: STATUS_LABELS[bucket.key],
            value: bucket.count,
          }))}
        />

        <BarList
          title="요청 유형별 현황"
          data={stats.byCategory.map((bucket) => ({
            label: CATEGORY_LABELS[bucket.key],
            value: bucket.count,
          }))}
        />
      </div>

      <BarList
        title="시스템별 평균 처리 리드타임"
        unit=""
        emptyMessage="완료된 티켓이 아직 없어 리드타임을 계산할 수 없습니다."
        data={stats.leadTimeBySystem.map((entry) => ({
          label: SYSTEM_TYPE_LABELS[entry.key],
          // 완료 건이 없는 시스템은 0 이 아니라 '자료 없음' 입니다.
          value: entry.averageHours ?? 0,
          display:
            entry.completed === 0
              ? '자료 없음'
              : `${formatHours(entry.averageHours)} (${entry.completed}건)`,
        }))}
      />
    </div>
  )
}
