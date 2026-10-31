import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Field, FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, ErrorBox, Modal, PageHeader, Spinner } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDateTime, words } from '../lib/format.js'
import { useAction, useList, useMoney, useOptions, useToast } from '../lib/hooks.js'

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_technician', 'accountant']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ScheduleModal({ doctor, onClose }) {
  const action = useAction()
  const { data, isLoading } = useQuery({ queryKey: [`/staff/doctors/${doctor.id}/schedule`] })
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const blocks = draft ?? data ?? []
  const update = (index, key, value) => setDraft(blocks.map((block, i) => (i === index ? { ...block, [key]: value } : block)))

  const save = async (event) => {
    event.preventDefault()
    setError(null)
    try {
      await action(() => api.put(`/staff/doctors/${doctor.id}/schedule`, { blocks }), 'Schedule saved')
      onClose()
    } catch (failure) {
      setError(failure.fields ? new Error('Each block must end after it starts.') : failure)
    }
  }
  return (
    <Modal
      title={`Clinic hours: ${doctor.name}`}
      size="wide"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save schedule</button>
        </>
      }
    >
      <p className="muted">Appointment slots are generated from these weekly blocks. Existing appointments are not changed.</p>
      <ErrorBox error={error} />
      {isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Day</th><th>Start</th><th>End</th><th>Minutes per patient</th><th /></tr></thead>
            <tbody>
              {blocks.map((block, index) => (
                <tr key={index}>
                  <td>
                    <select className="input" aria-label="Day" value={block.weekday} onChange={(event) => update(index, 'weekday', Number(event.target.value))}>
                      {WEEKDAYS.map((day, value) => <option key={day} value={value}>{day}</option>)}
                    </select>
                  </td>
                  <td><input className="input" type="time" aria-label="Start" value={block.start_time} onChange={(event) => update(index, 'start_time', event.target.value)} /></td>
                  <td><input className="input" type="time" aria-label="End" value={block.end_time} onChange={(event) => update(index, 'end_time', event.target.value)} /></td>
                  <td><input className="input" type="number" aria-label="Minutes per patient" min="5" max="120" value={block.slot_minutes} onChange={(event) => update(index, 'slot_minutes', event.target.value)} /></td>
                  <td><button type="button" className="icon-btn" aria-label="Remove block" onClick={() => setDraft(blocks.filter((_, i) => i !== index))}><Trash2 /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <button type="button" className="btn sm" onClick={() => setDraft([...blocks, { weekday: 1, start_time: '09:00', end_time: '13:00', slot_minutes: 20 }])}><Plus /> Add block</button>
      </div>
    </Modal>
  )
}

function userFields(isNew) {
  return [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'role', label: 'Role', type: 'select', required: true, options: ROLES.map((role) => [role, words(role).replace(/^\w/, (letter) => letter.toUpperCase())]) },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'department_id', label: 'Department', type: 'remote', endpoint: '/staff/departments' },
    { name: 'specialization', label: 'Specialization', help: 'Doctors only' },
    { name: 'license_no', label: 'License number', help: 'Doctors only' },
    { name: 'consultation_fee_cents', label: 'Consultation fee', type: 'money', help: 'Doctors only. Billed when a visit completes.' },
    ...(isNew ? [{ name: 'password', label: 'Temporary password', type: 'password', required: true, span: 2, help: 'At least 10 characters, with a letter and a number. They must change it at first sign-in.' }] : []),
  ]
}

export default function Staff() {
  const money = useMoney()
  const action = useAction()
  const toast = useToast()
  const [role, setRole] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [editing, setEditing] = useState(null)
  const [scheduling, setScheduling] = useState(null)
  const [temporary, setTemporary] = useState(null)
  const departments = useOptions('/staff/departments')
  const list = useList('/staff/users', { filters: { role, department_id: departmentId } })

  const reset = async (user) => {
    const { temporary_password: password } = await action(() => api.post(`/staff/users/${user.id}/reset-password`))
    setTemporary({ user, password })
  }

  return (
    <>
      <PageHeader title="Staff" subtitle={list.data ? `${list.data.total} accounts` : ' '}>
        <button className="btn primary" onClick={() => setEditing({})}><Plus /> Add staff member</button>
      </PageHeader>
      <Card flush>
        <DataTable
          list={list}
          searchPlaceholder="Search name, email or specialization"
          toolbar={
            <>
              <select className="input" aria-label="Role" value={role} onChange={(event) => { setRole(event.target.value); list.resetPage() }}>
                <option value="">All roles</option>
                {ROLES.map((value) => <option key={value} value={value}>{words(value)}</option>)}
              </select>
              <select className="input" aria-label="Department" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); list.resetPage() }}>
                <option value="">All departments</option>
                {departments.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </>
          }
          columns={[
            { key: 'name', label: 'Name', render: (row) => <><div className="strong">{row.name}</div><div className="faint">{row.email}</div></> },
            { key: 'role', label: 'Role', render: (row) => <span style={{ textTransform: 'capitalize' }}>{words(row.role)}</span> },
            { key: 'department_name', label: 'Department' },
            { key: 'specialization', label: 'Specialization' },
            { key: 'consultation_fee_cents', label: 'Fee', align: 'right', render: (row) => (row.role === 'doctor' ? money(row.consultation_fee_cents) : '—') },
            { key: 'last_login_at', label: 'Last sign-in', render: (row) => <span className="nowrap">{fmtDateTime(row.last_login_at)}</span> },
            { key: 'active', label: 'Status', render: (row) => (row.active ? <Badge tone="good" label="Active" /> : <Badge tone="" label="Inactive" />) },
            {
              key: 'actions',
              label: '',
              render: (row) => (
                <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                  {row.role === 'doctor' && <button className="btn ghost sm" onClick={() => setScheduling(row)}>Hours</button>}
                  <button className="btn ghost sm" onClick={() => setEditing(row)}>Edit</button>
                  <button className="btn ghost sm" onClick={() => reset(row)}>Reset password</button>
                  <button className="btn ghost sm" onClick={() => action(() => api.patch(`/staff/users/${row.id}`, { active: row.active ? 0 : 1 }), row.active ? `${row.name} deactivated` : `${row.name} reactivated`)}>
                    {row.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add staff member'}
          size="wide"
          fields={userFields(!editing.id)}
          initial={editing}
          successMessage="Staff member saved"
          onSubmit={(body) => (editing.id ? api.patch(`/staff/users/${editing.id}`, body) : api.post('/staff/users', body))}
          onClose={() => setEditing(null)}
        />
      )}
      {scheduling && <ScheduleModal doctor={scheduling} onClose={() => setScheduling(null)} />}
      {temporary && (
        <Modal
          title="Temporary password"
          size="narrow"
          onClose={() => setTemporary(null)}
          footer={
            <>
              <button className="btn" onClick={() => navigator.clipboard?.writeText(temporary.password).then(() => toast('Copied'))}>Copy</button>
              <button className="btn primary" onClick={() => setTemporary(null)}>Done</button>
            </>
          }
        >
          <p>Share this with {temporary.user.name} privately. It won't be shown again, and they must change it at first sign-in.</p>
          <Field label="Password"><input className="input num" readOnly value={temporary.password} /></Field>
        </Modal>
      )}
    </>
  )
}
