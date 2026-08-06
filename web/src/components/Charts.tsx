/**
 * 차트 — 의존성 없이 인라인 SVG 로 그립니다.
 *
 * 설계 규칙:
 *  · 항목 이름은 **항상 글자로** 적습니다. 색이 단독으로 의미를 지지 않습니다.
 *  · 단일 계열에는 색을 돌려 쓰지 않습니다 — 라벨이 이미 항목을 구분합니다.
 *  · 등급처럼 순서가 있는 값에만 단일 색상의 순서형 램프를 씁니다.
 *  · 축·격자는 데이터보다 연하게. 막대 끝은 4px 라운드, 막대 사이 간격은 2px.
 *  · 값이 0인 항목도 지웁니다 대신 남깁니다 — 사라지면 "없음"과 "0건"이 구분되지 않습니다.
 */

import { CHART_INK, SERIES_HUE } from '../lib/constants'

// ── 통계 타일 ────────────────────────────────────────────────────────────────

interface StatTileProps {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'warning'
}

/** 숫자 하나가 답인 경우엔 차트를 그리지 않습니다. */
export function StatTile({ label, value, hint, tone = 'default' }: StatTileProps) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          tone === 'warning' ? 'text-amber-600' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}

// ── 가로 막대 ────────────────────────────────────────────────────────────────

export interface BarDatum {
  label: string
  value: number
  /** 순서형 램프를 쓸 때만 지정합니다. 없으면 단일 색. */
  color?: string
  /** 막대 옆에 붙는 표시값. 없으면 value 를 그대로 씁니다. */
  display?: string
}

interface BarListProps {
  title: string
  data: BarDatum[]
  emptyMessage?: string
  /** 값의 단위. 툴팁과 스크린리더 설명에 씁니다. */
  unit?: string
}

/**
 * 가로 막대 목록. 항목 수가 적고 이름이 길 때 세로 막대보다 읽기 쉽습니다.
 * 값은 모든 막대에 직접 붙입니다 (항목이 10개 이하일 때만 이 방식을 씁니다).
 */
export function BarList({ title, data, emptyMessage, unit = '건' }: BarListProps) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const hasAny = data.some((d) => d.value > 0)

  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>

      {!hasAny ? (
        <p className="mt-4 text-sm text-slate-400">{emptyMessage ?? '표시할 자료가 없습니다.'}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.map((datum) => {
            const pct = (datum.value / max) * 100
            const text = datum.display ?? `${datum.value}${unit}`
            return (
              <li key={datum.label} className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-xs text-slate-600" title={datum.label}>
                  {datum.label}
                </span>
                <span
                  className="relative h-4 flex-1 rounded bg-slate-100"
                  title={`${datum.label}: ${text}`}
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded"
                    style={{
                      width: `${Math.max(datum.value > 0 ? 2 : 0, pct)}%`,
                      backgroundColor: datum.color ?? SERIES_HUE,
                    }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-700">
                  {text}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── 세로 막대 (시계열) ────────────────────────────────────────────────────────

interface ColumnTrendProps {
  title: string
  data: { date: string; count: number }[]
  subtitle?: string
}

/**
 * 일자별 추이. 단일 계열이라 범례가 없습니다 — 제목이 계열을 가리킵니다.
 * 값은 모든 막대에 붙이지 않고 **최댓값에만** 붙입니다. 나머지는 마우스를 올리면 보입니다.
 */
export function ColumnTrend({ title, data, subtitle }: ColumnTrendProps) {
  const width = 640
  const height = 160
  const padding = { top: 16, right: 8, bottom: 22, left: 8 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const max = Math.max(1, ...data.map((d) => d.count))
  const slot = data.length > 0 ? plotWidth / data.length : plotWidth
  const barWidth = Math.max(2, slot - 2) // 막대 사이 2px 간격
  const maxIndex = data.reduce((best, d, i) => (d.count > data[best].count ? i : best), 0)
  const total = data.reduce((sum, d) => sum + d.count, 0)

  return (
    <section className="card p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}

      {total === 0 ? (
        <p className="mt-4 text-sm text-slate-400">이 기간에 접수된 티켓이 없습니다.</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="mt-3 w-full"
          role="img"
          aria-label={`${title}. 총 ${total}건.`}
        >
          {/* 기준선 */}
          <line
            x1={padding.left}
            y1={padding.top + plotHeight}
            x2={width - padding.right}
            y2={padding.top + plotHeight}
            stroke={CHART_INK.baseline}
            strokeWidth={1}
          />

          {data.map((datum, index) => {
            const barHeight = datum.count === 0 ? 0 : (datum.count / max) * plotHeight
            const x = padding.left + index * slot
            const y = padding.top + plotHeight - barHeight
            const day = datum.date.slice(8, 10)
            const isFirstOfWeek = index === 0 || index % 7 === 0

            return (
              <g key={datum.date}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={barHeight > 4 ? 4 : 0}
                  fill={SERIES_HUE}
                >
                  <title>{`${datum.date} · ${datum.count}건`}</title>
                </rect>

                {index === maxIndex && datum.count > 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={y - 4}
                    textAnchor="middle"
                    className="text-[10px] tabular-nums"
                    fill="#0f172a"
                  >
                    {datum.count}
                  </text>
                )}

                {isFirstOfWeek && (
                  <text
                    x={x + barWidth / 2}
                    y={height - 6}
                    textAnchor="middle"
                    className="text-[10px]"
                    fill={CHART_INK.muted}
                  >
                    {datum.date.slice(5, 7)}/{day}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </section>
  )
}
