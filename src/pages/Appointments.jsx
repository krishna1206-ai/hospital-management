import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookAppointmentModal } from '../components/BookAppointmentModal.jsx'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, PageHeader } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { addDays, age, fmtLongDate, toDateInput, words } from '../lib/format.js'
import { useAction, useAuth, useCan, useList, useOptions, useStartVisit } from '../lib/hooks.js'

const STATUSES = ['scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show']

export default function Appointments() {
  const { user } = useAuth()
  const can = useCan()
  const navigate = useNavigate()
  const action = useAction()
  const startVisit = useStartVisit()
  const [date, setDate] = useState(toDateInput)
  const [doctorId, setDoctorId] = useState(user.role === 'doctor' ? String(user.id) : '')
  const [status, setStatus] = useState('')
  const [booking, setBooking] = useState(false)
  const [moving, setMoving] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const doctors = useOptions('/staff/doctors')
  const list = useList('/appointments', { filters: { date, doctor_id: doctorId, status }, pageSize: 50 })
  const isToday = date === toDateInput()

  const setStatusOf = (row, next, message) => action(() => api.post(`/appointments/${row.id}/status`, { status: next }), message)
  const stop = (fn) => (event) => {
    event.stopPropagation()
    fn()
  }

  const columns = [
    { key: 'start_time', label: 'Time', render: (row) => <span className="num strong">{row.start_time}</span> },
    { key: 'token_no', label: 'Token', render: (row) => (row.token_no ? <span className="num">#{row.token_no}</span> : '—') },
    {
      key: 'patient',
      label: 'Patient',
      render: (row) => (
        <>
          <div className="strong">{row.patient_name}</div>
          <div className="faint num">{row.mrn} · {age(row.patient_dob)}</div>
        </>
      ),
    },
    { key: 'doctor_name', label: 'Doctor' },
    { key: 'type', label: 'Type', render: (row) => <span style={{ textTransform: 'capitalize' }}>{words(row.type)}</span> },
    { key: 'reason', label: 'Reason' },
    { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          {row.status === 'scheduled' && isToday && <button className="btn sm" onClick={stop(() => setStatusOf(row, 'checked_in', `${row.patient_name} checked in`))}>Check in</button>}
          {['checked_in', 'in_progress'].includes(row.status) && can('clinical:write') && (
            <button className="btn sm primary" onClick={stop(() => startVisit(row))}>{row.status === 'checked_in' ? 'Start visit' : 'Open note'}</button>
          )}
          {row.encounter_id && row.status === 'completed' && can('clinical:read') && <button className="btn ghost sm" onClick={stop(() => navigate(`/encounters/${row.encounter_id}`))}>View note</button>}
          {can('appointments:write') && row.status === 'scheduled' && <button className="btn ghost sm" onClick={stop(() => setMoving(row))}>Move</button>}
          {can('appointments:write') && ['scheduled', 'checked_in'].includes(row.status) && (
            <>
              {isToday && <button className="btn ghost sm" onClick={stop(() => setStatusOf(row, 'no_show', 'Marked as no-show'))}>No-show</button>}
              <button className="btn ghost sm" onClick={stop(() => setCancelling(row))}>Cancel</button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Appointments" subtitle={fmtLongDate(date)}>
        {can('appointments:write') && <button className="btn primary" onClick={() => setBooking(true)}><Plus /> Book appointment</button>}
      </PageHeader>
      <Card flush>
        <DataTable
          list={list}
          columns={columns}
          onRowClick={(row) => navigate(`/patients/${row.patient_id}`)}
          emptyTitle="No appointments on this day"
          searchPlaceholder="Search patient or doctor"
          toolbar={
            <>
              <div className="actions" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft /></button>
                <input className="input" type="date" aria-label="Date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} />
                <button className="icon-btn" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><ChevronRight /></button>
                {!isToday && <button className="btn ghost sm" onClick={() => setDate(toDateInput())}>Today</button>}
              </div>
              <select className="input" aria-label="Doctor" value={doctorId} onChange={(event) => setDoctorId(event.target.value)}>
                <option value="">All doctors</option>
                {doctors.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select className="input" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((value) => <option key={value} value={value}>{words(value)}</option>)}
              </select>
            </>
          }
        />
      </Card>
      {booking && <BookAppointmentModal onClose={() => setBooking(false)} />}
      {moving && <BookAppointmentModal appointment={moving} onClose={() => setMoving(null)} />}
      {cancelling && (
        <FormModal
          title={`Cancel appointment: ${cancelling.patient_name}`}
          size="narrow"
          fields={[{ name: 'cancel_reason', label: 'Reason', type: 'textarea', required: true, rows: 2 }]}
          submitLabel="Cancel appointment"
          successMessage="Appointment cancelled"
          onSubmit={(body) => api.post(`/appointments/${cancelling.id}/status`, { status: 'cancelled', ...body })}
          onClose={() => setCancelling(null)}
        />
      )}
    </>
  )
}
