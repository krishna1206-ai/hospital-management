import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BedDouble, CalendarDays, CircleDollarSign, ClipboardList, FlaskConical, Hourglass, Pill, Receipt, Siren, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { ChartCard, DailyArea, DailyColumns, Meter, RankedBars } from '../components/charts.jsx'
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui.jsx'
import { fmtLongDate, toDateInput } from '../lib/format.js'
import { useAuth, useMoney } from '../lib/hooks.js'

const greeting = () => {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { user } = useAuth()
  const money = useMoney()
  const { data, isLoading, error } = useQuery({ queryKey: ['/dashboard'], refetchInterval: 60000 })

  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const { stats } = data
  const has = (key) => stats[key] !== undefined

  const firstName = user.name.replace(/^Dr\.?\s+/, '').split(' ')[0]
  return (
    <div className="stack">
      <PageHeader title={`${greeting()}, ${firstName}`} subtitle={fmtLongDate(toDateInput())} />

      <div className="stats">
        {has('appointments_today') && <Stat icon={CalendarDays} label={user.role === 'doctor' ? 'Your appointments today' : 'Appointments today'} value={stats.appointments_today} note={`${stats.completed_today} completed`} to="/appointments" />}
        {has('waiting_now') && <Stat icon={Hourglass} label="Waiting now" value={stats.waiting_now} note="Checked in" to="/queue" />}
        {has('er_active') && <Stat icon={Siren} label="In Emergency" value={stats.er_active} note="Active patients" to="/emergency" />}
        {has('beds_total') && <Stat icon={BedDouble} label="Bed occupancy" value={`${stats.beds_total ? Math.round((stats.beds_occupied / stats.beds_total) * 100) : 0}%`} note={`${stats.beds_available} beds free`} to="/inpatients" />}
        {has('rx_pending') && <Stat icon={ClipboardList} label="Prescriptions to fill" value={stats.rx_pending} to="/pharmacy" />}
        {has('low_stock') && user.role === 'pharmacist' && <Stat icon={Pill} label="Low-stock medicines" value={stats.low_stock} to="/pharmacy?tab=medicines" />}
        {has('lab_pending') && <Stat icon={FlaskConical} label="Lab orders in progress" value={stats.lab_pending} to="/laboratory" />}
        {has('revenue_today_cents') && <Stat icon={CircleDollarSign} label="Collected today" value={money(stats.revenue_today_cents)} to="/billing" />}
        {has('outstanding_cents') && <Stat icon={Receipt} label="Outstanding invoices" value={money(stats.outstanding_cents)} note={`${money(stats.unbilled_cents)} not yet invoiced`} to="/billing" />}
        {has('total_patients') && <Stat icon={Users} label="Registered patients" value={stats.total_patients.toLocaleString()} note={`${stats.new_patients_today} new today`} to="/patients" />}
      </div>

      {data.alerts.length > 0 && (
        <Card title="Needs attention" flush>
          {data.alerts.map((alert) => (
            <Link key={alert.title} to={alert.link} className={`alert-row ${alert.severity}`}>
              <AlertTriangle />
              <span className="grow">{alert.title}</span>
              <Badge value={alert.severity} label={alert.severity === 'critical' ? 'Urgent' : 'Warning'} tone={alert.severity === 'critical' ? 'bad' : 'warn'} />
            </Link>
          ))}
        </Card>
      )}

      <div className="grid-2">
        {data.revenue_trend && (
          <ChartCard title="Collections" subtitle="Payments received, last 30 days" data={data.revenue_trend} format={money} valueLabel="Collected">
            <DailyArea data={data.revenue_trend} format={money} tickFormat={(cents) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(cents / 100)} />
          </ChartCard>
        )}
        {data.appointment_trend && (
          <ChartCard title={user.role === 'doctor' ? 'Your appointments' : 'Appointments'} subtitle="Last 14 days" data={data.appointment_trend} valueLabel="Appointments">
            <DailyColumns data={data.appointment_trend} />
          </ChartCard>
        )}
        {data.todays_schedule && (
          <Card
            title="Today's schedule"
            subtitle="Still to be seen"
            flush
            actions={<Link className="btn ghost sm" to="/appointments">View all</Link>}
          >
            {data.todays_schedule.length === 0 && <Empty title="No more appointments today" />}
            {data.todays_schedule.map((row) => (
              <Link className="list-row" to={`/patients/${row.patient_id}`} key={row.id}>
                <span className="num strong">{row.start_time}</span>
                <span className="grow">
                  <div className="ellipsis strong">{row.patient_name}</div>
                  <div className="faint ellipsis">{user.role === 'doctor' ? row.reason : row.doctor_name}</div>
                </span>
                <Badge value={row.status} />
              </Link>
            ))}
          </Card>
        )}
        {data.ward_occupancy && (
          <Card title="Ward occupancy" subtitle="Occupied beds right now" flush actions={<Link className="btn ghost sm" to="/inpatients">Bed board</Link>}>
            <div style={{ padding: '6px 0' }}>
              {data.ward_occupancy.map((ward) => <Meter key={ward.name} label={ward.name} value={ward.occupied} total={ward.total} />)}
            </div>
          </Card>
        )}
        {data.department_load?.length > 0 && (
          <Card title="Department load" subtitle="Appointments, last 14 days" flush>
            <RankedBars rows={data.department_load} />
          </Card>
        )}
      </div>
    </div>
  )
}
