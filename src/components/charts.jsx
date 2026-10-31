import { useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtShortDate } from '../lib/format.js'
import { Card, Empty } from './ui.jsx'

const axis = { stroke: 'var(--chart-axis)', tick: { fill: 'var(--chart-text)', fontSize: 12 }, tickLine: false }

const compact = (value) => (Math.abs(value) >= 10000 ? new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value) : new Intl.NumberFormat().format(value))

function ChartTip({ active, payload, label, format, labelFormat }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-value num">{format(payload[0].value)}</div>
      <div className="chart-tip-label">{labelFormat(label)}</div>
    </div>
  )
}

/** A chart with its table twin, so no value is reachable only by hovering. */
export function ChartCard({ title, subtitle, data, format = compact, valueLabel = 'Value', children }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <Card
      title={title}
      subtitle={subtitle}
      flush
      actions={
        <button type="button" className="btn ghost sm" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      }
    >
      {asTable ? (
        <div className="table-wrap" style={{ maxHeight: 268 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="right">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row) => (
                <tr key={row.day}>
                  <td>{fmtShortDate(row.day)}</td>
                  <td className="right num">{format(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: '14px 16px 8px 4px' }}>{children}</div>
      )}
    </Card>
  )
}

export function DailyColumns({ data, format = compact }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="day" {...axis} tickFormatter={fmtShortDate} minTickGap={28} />
        <YAxis {...axis} axisLine={false} allowDecimals={false} width={44} tickFormatter={compact} />
        <Tooltip cursor={{ fill: 'var(--surface-3)' }} content={<ChartTip format={format} labelFormat={fmtShortDate} />} />
        <Bar dataKey="value" fill="var(--series-1)" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DailyArea({ data, format = compact, tickFormat = compact }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="day" {...axis} tickFormatter={fmtShortDate} minTickGap={36} />
        <YAxis {...axis} axisLine={false} width={56} tickFormatter={tickFormat} />
        <Tooltip cursor={{ stroke: 'var(--chart-axis)' }} content={<ChartTip format={format} labelFormat={fmtShortDate} />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="var(--series-1)"
          fillOpacity={0.1}
          activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Horizontal ranked bars in plain HTML: the value is always printed, so nothing hides in a tooltip. */
export function RankedBars({ rows, format = compact, nameLabel = (name) => name }) {
  if (!rows?.length) return <Empty title="No data for this period" />
  const max = Math.max(...rows.map((row) => row.value), 1)
  return (
    <div style={{ padding: '8px 0' }}>
      {rows.map((row) => (
        <div className="bar-row" key={row.name}>
          <div className="ellipsis" title={nameLabel(row.name)} style={{ textTransform: 'capitalize' }}>{nameLabel(row.name)}</div>
          <div className="bar-track" title={`${nameLabel(row.name)}: ${format(row.value)}`}>
            <i style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <div className="num strong right">{format(row.value)}</div>
        </div>
      ))}
    </div>
  )
}

export function Meter({ label, value, total }) {
  const percent = total ? Math.round((value / total) * 100) : 0
  const tone = percent >= 95 ? 'bad' : percent >= 85 ? 'warn' : ''
  return (
    <div className="meter-row">
      <div className="meter-label">
        <span className="ellipsis">{label}</span>
        <span className="num muted nowrap">{value}/{total} · {percent}%</span>
      </div>
      <div className="meter" role="img" aria-label={`${label}: ${percent}% occupied`}>
        <i className={tone} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
