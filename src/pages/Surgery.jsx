import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, PageHeader, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { addDays, fmtDate, toDateInput } from '../lib/format.js'
import { useAction, useCan, useList, useMoney, useTab } from '../lib/hooks.js'

function Schedule() {
  const can = useCan()
  const money = useMoney()
  const action = useAction()
  const [from, setFrom] = useState(() => addDays(toDateInput(), -7))
  const [to, setTo] = useState(() => addDays(toDateInput(), 30))
  const [finishing, setFinishing] = useState(null)
  const list = useList('/surgery', { filters: { from, to } })
  const setStatus = (row, status, message) => action(() => api.post(`/surgery/${row.id}/status`, { status }), message)
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search patient, procedure or surgeon"
        emptyTitle="No surgeries in this period"
        toolbar={
          <>
            <input className="input" type="date" aria-label="From" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input className="input" type="date" aria-label="To" value={to} onChange={(event) => setTo(event.target.value)} />
          </>
        }
        columns={[
          { key: 'date', label: 'Date', render: (row) => <span className="nowrap">{fmtDate(row.date)}</span> },
          { key: 'time', label: 'Time', render: (row) => <span className="num nowrap">{row.start_time}–{row.end_time}</span> },
          { key: 'theatre_name', label: 'Theatre' },
          { key: 'procedure_name', label: 'Procedure', render: (row) => <span className="strong">{row.procedure_name}</span> },
          { key: 'patient', label: 'Patient', render: (row) => <><Link to={`/patients/${row.patient_id}`}>{row.patient_name}</Link>{row.patient_allergies && <div className="faint">Allergy: {row.patient_allergies}</div>}</> },
          { key: 'surgeon_name', label: 'Surgeon' },
          { key: 'price_cents', label: 'Fee', align: 'right', render: (row) => money(row.price_cents) },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
          {
            key: 'actions',
            label: '',
            render: (row) => can('surgery:write') && (
              <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                {row.status === 'scheduled' && <button className="btn sm" onClick={() => setStatus(row, 'in_progress', 'Surgery started')}>Start</button>}
                {row.status === 'in_progress' && <button className="btn sm primary" onClick={() => setFinishing(row)}>Complete</button>}
                {row.status === 'scheduled' && <button className="btn ghost sm" onClick={() => setStatus(row, 'cancelled', 'Surgery cancelled')}>Cancel</button>}
              </div>
            ),
          },
        ]}
      />
      {finishing && (
        <FormModal
          title={`Complete: ${finishing.procedure_name}`}
          fields={[{ name: 'post_op_notes', label: 'Post-operative notes', type: 'textarea', rows: 4, required: true }]}
          submitLabel="Complete surgery"
          successMessage="Surgery completed and billed"
          onSubmit={(body) => api.post(`/surgery/${finishing.id}/status`, { status: 'completed', ...body })}
          onClose={() => setFinishing(null)}
        />
      )}
    </Card>
  )
}

function Theatres() {
  const can = useCan()
  const [editing, setEditing] = useState(null)
  const list = useList('/surgery/theatres')
  return (
    <Card flush title="Operating theatres" actions={can('surgery:write') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add theatre</button>}>
      <DataTable
        list={list}
        onRowClick={can('surgery:write') ? setEditing : undefined}
        columns={[
          { key: 'name', label: 'Theatre', render: (row) => <span className="strong">{row.name}</span> },
          { key: 'location', label: 'Location' },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add theatre'}
          size="narrow"
          fields={[{ name: 'name', label: 'Name', required: true, span: 2 }, { name: 'location', label: 'Location', span: 2 }]}
          initial={editing}
          successMessage="Theatre saved"
          onSubmit={(body) => (editing.id ? api.patch(`/surgery/theatres/${editing.id}`, body) : api.post('/surgery/theatres', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

export default function Surgery() {
  const can = useCan()
  const [tab, setTab] = useTab('schedule')
  const [scheduling, setScheduling] = useState(false)
  return (
    <>
      <PageHeader title="Surgery" subtitle="Theatre schedule. Clashes for a theatre or surgeon are refused automatically.">
        {can('surgery:write') && <button className="btn primary" onClick={() => setScheduling(true)}><Plus /> Schedule surgery</button>}
      </PageHeader>
      <Tabs tabs={[{ value: 'schedule', label: 'Schedule' }, { value: 'theatres', label: 'Theatres' }]} value={tab} onChange={setTab} />
      {tab === 'schedule' ? <Schedule /> : <Theatres />}
      {scheduling && (
        <FormModal
          title="Schedule surgery"
          size="wide"
          fields={[
            { name: 'patient_id', label: 'Patient', type: 'patient', required: true, span: 2 },
            { name: 'procedure_name', label: 'Procedure', required: true, span: 2 },
            { name: 'surgeon_id', label: 'Surgeon', type: 'remote', endpoint: '/staff/doctors', required: true },
            { name: 'anesthetist_id', label: 'Anesthetist', type: 'remote', endpoint: '/staff/doctors' },
            { name: 'theatre_id', label: 'Theatre', type: 'remote', endpoint: '/surgery/theatres', required: true },
            { name: 'anesthesia_type', label: 'Anesthesia', type: 'select', options: ['General', 'Spinal', 'Epidural', 'Local', 'Sedation'] },
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'price_cents', label: 'Fee', type: 'money' },
            { name: 'start_time', label: 'Start', type: 'time', required: true },
            { name: 'end_time', label: 'End', type: 'time', required: true },
            { name: 'pre_op_notes', label: 'Pre-operative notes', type: 'textarea', rows: 3 },
          ]}
          submitLabel="Schedule"
          successMessage="Surgery scheduled"
          onSubmit={(body) => api.post('/surgery', body)}
          onClose={() => setScheduling(false)}
        />
      )}
    </>
  )
}
