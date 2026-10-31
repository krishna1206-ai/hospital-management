import { ListOrdered } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, Empty, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { toDateInput, waitingLabel } from '../lib/format.js'
import { useAction, useAuth, useCan, useList, useNow, useStartVisit } from '../lib/hooks.js'

export default function Queue() {
  const { user } = useAuth()
  const can = useCan()
  const now = useNow()
  const action = useAction()
  const startVisit = useStartVisit()
  const list = useList('/appointments', {
    filters: { date: toDateInput(), status: 'checked_in,in_progress', order: 'queue', doctor_id: user.role === 'doctor' ? user.id : undefined },
    pageSize: 100,
    refetchInterval: 20000,
  })
  if (list.isLoading) return <Spinner />
  if (list.isError) return <ErrorBox error={list.error} />

  const rows = list.data.rows
  const byDoctor = new Map()
  for (const row of rows) {
    if (!byDoctor.has(row.doctor_id)) byDoctor.set(row.doctor_id, { name: row.doctor_name, department: row.department_name, rows: [] })
    byDoctor.get(row.doctor_id).rows.push(row)
  }
  const waiting = rows.filter((row) => row.status === 'checked_in')
  const longest = waiting.reduce((oldest, row) => (!oldest || row.checked_in_at < oldest ? row.checked_in_at : oldest), null)

  return (
    <div className="stack">
      <PageHeader title="OPD queue" subtitle="Live by doctor. Updates automatically." />
      <div className="stats">
        <Stat label="Waiting" value={waiting.length} />
        <Stat label="With a doctor" value={rows.length - waiting.length} />
        <Stat label="Longest wait" value={longest ? waitingLabel(longest, now) : '—'} />
      </div>
      {byDoctor.size === 0 && <Card><Empty icon={ListOrdered} title="The waiting room is empty">Patients appear here once they check in.</Empty></Card>}
      <div className="queue">
        {[...byDoctor.entries()].map(([doctorId, doctor]) => (
          <Card key={doctorId} title={doctor.name} subtitle={doctor.department} flush>
            {doctor.rows.map((row) => (
              <div className="queue-row" key={row.id}>
                <div className={`token ${row.status === 'in_progress' ? 'live' : ''}`}>{row.token_no ?? '–'}</div>
                <div className="grow">
                  <Link to={`/patients/${row.patient_id}`} className="strong ellipsis" style={{ display: 'block', color: 'inherit' }}>{row.patient_name}</Link>
                  <div className="faint">
                    {row.status === 'in_progress' ? 'With doctor' : `Waiting ${waitingLabel(row.checked_in_at, now)}`}
                    {row.reason ? ` · ${row.reason}` : ''}
                  </div>
                </div>
                {can('clinical:write') && row.doctor_id === user.id ? (
                  <button className="btn sm primary" onClick={() => startVisit(row)}>{row.status === 'checked_in' ? 'Start' : 'Open'}</button>
                ) : (
                  can('appointments:write') && row.status === 'checked_in' && (
                    <button className="btn ghost sm" onClick={() => action(() => api.post(`/appointments/${row.id}/status`, { status: 'no_show' }), 'Marked as no-show')}>No-show</button>
                  )
                )}
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  )
}
