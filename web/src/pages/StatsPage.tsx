import { useMemo } from 'react'

import { BarList, ColumnTrend, StatTile } from '../components/Charts'
import { useLeadTimes, useSystems } from '../hooks/queries'
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SEVERITY_RAMP,
  RESOLUTION_LABELS,
  STATUS_LABELS,
  UNSPECIFIED_RESOLUTION,
  WORK_TYPE_LABELS,
  WORK_TYPE_RAMP,
} from '../lib/constants'
import { formatHours } from '../lib/format'
import { buildDashboardStats, type DurationSummary } from '../lib/stats'

/** 지표 하나를 평균/중앙값/P90 으로 풀어 보여줍니다. */
function DurationCard({
  title,
  hint,
  summary,
  emptyMessage,
}: {
  title: string
  hint: string
  summary: DurationSummary
  emptyMessage: string
}) {
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <span className="text-[11px] text-slate-400">{hint}</span>
      </div>

      {summary.samples === 0 ? (
        <p className="mt-3 text-sm text-slate-400">{emptyMessage}</p>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {formatHours(summary.averageHours)}
          </p>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
            <div>
              <dt className="text-slate-500">중앙값</dt>
              <dd className="text-slate-800">{formatHours(summary.medianHours)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">P90</dt>
              <dd className="text-slate-800">{formatHours(summary.p90Hours)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">최장</dt>
              <dd className="text-slate-800">{formatHours(summary.slowestHours)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-slate-400">{summary.samples}건 기준</p>
        </>
      )}
    </section>
  )
}

/**
 * 통계 대시보드 (기획서 3.2):
 * 시스템별 접수 현황 · 처리 리드타임 · 장애 등급별 통계 · MTTR.
 *
 * 모든 집계는 src/lib/stats.ts 순수 함수를 거칩니다 — 화면에서 직접 계산하지 않습니다.
 */
export default function StatsPage() {
  const { data: rows = [], isLoading, error } = useLeadTimes()
  const { data: systems = [] } = useSystems()
  const stats = useMemo(() => buildDashboardStats(rows, systems), [rows, systems])

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

  const { leadTime, incidentWait, incidentRepair } = stats

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
          hint={`접수→완료 · ${leadTime.samples}건 기준`}
        />
        <StatTile
          label="장애 MTTR"
          value={formatHours(incidentRepair.averageHours)}
          hint={`착수→완료 · ${incidentRepair.samples}건 기준`}
          tone={
            incidentRepair.averageHours !== null && incidentRepair.averageHours > 24
              ? 'warning'
              : 'default'
          }
        />
      </div>

      {/*
        대기와 수리를 나눠서 보여줍니다. 하나만 재면 "우리가 느린 건지,
        접수가 늦게 전달된 건지" 를 구분할 수 없습니다.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DurationCard
          title="장애 대기 시간 (MTTA)"
          hint="접수 → 착수"
          summary={incidentWait}
          emptyMessage="아직 착수한 장애가 없습니다."
        />
        <DurationCard
          title="장애 수리 시간 (MTTR)"
          hint="착수 → 완료"
          summary={incidentRepair}
          emptyMessage="아직 완료된 장애가 없습니다."
        />
      </div>

      {/*
        지표가 무엇을 빼고 잰 값인지 밝힙니다. 안 밝히면 보는 사람은
        벽시계 시간으로 읽고, 그러면 숫자를 잘못 씁니다.
      */}
      <p className="text-xs text-slate-500">
        MTTA·MTTR 은 <strong>보류(On Hold)에 머문 시간을 뺀</strong> 값입니다 — 요청자
        회신을 기다린 시간은 팀이 일한 시간이 아닙니다. 반려·중복·취소·처리하지 않음으로
        끝난 건은 모수에서 뺐습니다. 리드타임(접수→완료)은 요청자가 실제로 겪은 시간이라
        보류를 빼지 않습니다.
        {stats.onHold > 0 && (
          <span className="ml-1 font-medium text-amber-700">
            지금 보류 중 {stats.onHold}건.
          </span>
        )}
      </p>

      <ColumnTrend title="최근 14일 접수 추이" subtitle="메일 수신일 기준" data={stats.intake} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList
          title="대분류별 현황"
          data={stats.byWorkType.map((bucket) => ({
            label: WORK_TYPE_LABELS[bucket.key],
            value: bucket.count,
            color: WORK_TYPE_RAMP[bucket.key],
          }))}
        />

        <BarList
          title="장애 등급별 현황"
          data={[...stats.bySeverity].reverse().map((bucket) => ({
            label: SEVERITY_LABELS[bucket.key],
            value: bucket.count,
            color: SEVERITY_RAMP[bucket.key],
          }))}
        />

        <BarList
          title="시스템별 접수 현황"
          emptyMessage="등록된 시스템이 없습니다. 설정 화면에서 시스템 종류를 먼저 등록하세요."
          data={stats.bySystem.map((bucket) => ({
            label: bucket.label,
            value: bucket.count,
          }))}
        />

        <BarList
          title="종료 방식 (완료 건)"
          emptyMessage="아직 완료된 건이 없습니다."
          data={[
            ...stats.byResolution.map((bucket) => ({
              label: RESOLUTION_LABELS[bucket.key],
              value: bucket.count,
            })),
            // 안 고른 건을 'Fixed' 에 섞지 않고 그대로 드러냅니다.
            ...(stats.unspecifiedResolution > 0
              ? [{ label: UNSPECIFIED_RESOLUTION, value: stats.unspecifiedResolution }]
              : []),
          ]}
        />

        <BarList
          title="상태별 분포"
          data={stats.byStatus.map((bucket) => ({
            label: STATUS_LABELS[bucket.key],
            value: bucket.count,
          }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList
          title="요청 유형별 현황"
          data={stats.byCategory.map((bucket) => ({
            label: CATEGORY_LABELS[bucket.key],
            value: bucket.count,
          }))}
        />

        <BarList
          title="시스템별 평균 처리 리드타임"
          unit=""
          emptyMessage="완료된 티켓이 아직 없어 리드타임을 계산할 수 없습니다."
          data={stats.leadTimeBySystem.map((entry) => ({
            label: entry.label,
            // 완료 건이 없는 시스템은 0 이 아니라 '자료 없음' 입니다.
            value: entry.averageHours ?? 0,
            display:
              entry.completed === 0
                ? '자료 없음'
                : `${formatHours(entry.averageHours)} (${entry.completed}건)`,
          }))}
        />
      </div>
    </div>
  )
}
