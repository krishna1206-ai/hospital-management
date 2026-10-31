import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { RankedBars } from '../components/charts.jsx'
import { Card, DataTable, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui.jsx'
import { addDays, downloadCsv, toDateInput, words } from '../lib/format.js'
import { useMoney } from '../lib/hooks.js'

const PRESETS = [['Last 7 days', 6], ['Last 30 days', 29], ['Last 90 days', 89]]

export default function Reports() {
  const money = useMoney()
  const today = toDateInput()
  const [from, setFrom] = useState(() => addDays(today, -29))
  const [to, setTo] = useState(today)
  const { data, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['/reports/summary', { from, to }],
    enabled: Boolean(from && to),
    placeholderData: (previous) => previous,
  })

  const exportCsv = () => {
    const rows = [
      ['Collections', data.collections_cents / 100],
      ['Invoiced', data.invoiced_cents / 100],
      ['New patients', data.new_patients],
      ['Appointments', data.appointments],
      ['Admissions', data.admissions],
      ['Emergency visits', data.er_visits],
      ['Surgeries', data.surgeries],
      ['Average length of stay (days)', data.avg_length_of_stay_days ?? ''],
      ...data.revenue_by_kind.map((row) => [`Revenue: ${row.name}`, row.value / 100]),
      ...data.collections_by_method.map((row) => [`Collections: ${words(row.name)}`, row.value / 100]),
      ...data.doctor_performance.map((row) => [`Completed visits: ${row.name}`, row.completed]),
      ...data.top_diagnoses.map((row) => [`Diagnosis: ${row.name}`, row.value]),
      ...data.top_medicines.map((row) => [`Dispensed: ${row.name}`, row.value]),
      ...data.top_tests.map((row) => [`Test: ${row.name}`, row.value]),
    ]
    downloadCsv(`hospital-report-${from}-to-${to}.csv`, [{ label: 'Metric', value: (row) => row[0] }, { label: 'Value', value: (row) => row[1] }], rows)
  }

  return (
    <div className="stack">
      <PageHeader title="Reports" subtitle="Financial and operational performance">
        {data && <button className="btn" onClick={exportCsv}><Download /> Export CSV</button>}
      </PageHeader>
      <div className="actions no-print">
        {PRESETS.map(([label, days]) => {
          const presetFrom = addDays(today, -days)
          const active = from === presetFrom && to === today
          return <button key={label} className={`btn sm ${active ? 'primary' : ''}`} aria-pressed={active} onClick={() => { setFrom(presetFrom); setTo(today) }}>{label}</button>
        })}
        <input className="input" style={{ width: 'auto' }} type="date" aria-label="From" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
        <span className="muted">to</span>
        <input className="input" style={{ width: 'auto' }} type="date" aria-label="To" value={to} min={from} onChange={(event) => setTo(event.target.value)} />
      </div>
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <div className={`stack ${isPlaceholderData ? 'is-fetching' : ''}`}>
          <div className="stats">
            <Stat label="Collections" value={money(data.collections_cents)} />
            <Stat label="Invoiced" value={money(data.invoiced_cents)} />
            <Stat label="New patients" value={data.new_patients} />
            <Stat label="Appointments" value={data.appointments} />
            <Stat label="Admissions" value={data.admissions} />
            <Stat label="Average stay" value={data.avg_length_of_stay_days != null ? `${data.avg_length_of_stay_days} days` : '—'} />
            <Stat label="Emergency visits" value={data.er_visits} />
            <Stat label="Surgeries" value={data.surgeries} />
          </div>
          <div className="grid-2">
            <Card title="Revenue by service" subtitle="Invoiced in this period" flush>
              <RankedBars rows={data.revenue_by_kind} format={money} />
            </Card>
            <Card title="Collections by method" flush>
              <RankedBars rows={data.collections_by_method} format={money} nameLabel={words} />
            </Card>
            <Card title="Appointments by outcome" flush>
              <RankedBars rows={data.appointments_by_status} nameLabel={words} />
            </Card>
            <Card title="Receivables aging" subtitle="Outstanding today, by invoice age" flush>
              <RankedBars
                format={money}
                rows={[
                  { name: '0–30 days', value: data.aging.d0_30 },
                  { name: '31–60 days', value: data.aging.d31_60 },
                  { name: '61–90 days', value: data.aging.d61_90 },
                  { name: 'Over 90 days', value: data.aging.d90_plus },
                ]}
              />
            </Card>
            <Card title="Top diagnoses" flush><RankedBars rows={data.top_diagnoses} /></Card>
            <Card title="Most dispensed medicines" subtitle="Units" flush><RankedBars rows={data.top_medicines} /></Card>
            <Card title="Most ordered tests" flush><RankedBars rows={data.top_tests} /></Card>
          </div>
          <Card title="Doctor activity" flush>
            <DataTable
              rowKey="name"
              rows={data.doctor_performance}
              emptyTitle="No appointments in this period"
              columns={[
                { key: 'name', label: 'Doctor', render: (row) => <span className="strong">{row.name}</span> },
                { key: 'department_name', label: 'Department' },
                { key: 'visits', label: 'Booked', align: 'right' },
                { key: 'completed', label: 'Completed', align: 'right' },
                { key: 'no_shows', label: 'No-shows', align: 'right' },
                { key: 'rate', label: 'No-show rate', align: 'right', render: (row) => `${row.visits ? Math.round((row.no_shows / row.visits) * 100) : 0}%` },
              ]}
            />
          </Card>
        </div>
      )}
    </div>
  )
}
