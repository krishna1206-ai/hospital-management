import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, Empty, PageHeader, Spinner, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { addDays, fmtDate, fmtShortDate, toDateInput, words } from '../lib/format.js'
import { useAction, useAuth, useCan, useList, useOptions, useTab } from '../lib/hooks.js'

const startOfWeek = (value) => {
  const date = new Date(`${value}T12:00:00`)
  return addDays(value, -((date.getDay() + 6) % 7))
}

function WeekRoster() {
  const can = useCan()
  const action = useAction()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(toDateInput()))
  const [adding, setAdding] = useState(false)
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const { data = [], isLoading } = useQuery({ queryKey: ['/staff/shifts', { from: days[0], to: days[6] }] })
  const canManage = can('hr:manage')
  const staff = useOptions('/staff/users', { enabled: canManage })

  const people = [...new Map(data.map((shift) => [shift.user_id, { id: shift.user_id, name: shift.user_name, role: shift.role }])).values()].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Card
      flush
      title={`Week of ${fmtDate(weekStart)}`}
      actions={
        <>
          <button className="icon-btn" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft /></button>
          <button className="btn ghost sm" onClick={() => setWeekStart(startOfWeek(toDateInput()))}>This week</button>
          <button className="icon-btn" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight /></button>
          {canManage && <button className="btn sm primary" onClick={() => setAdding(true)}><Plus /> Add shift</button>}
        </>
      }
    >
      {isLoading ? <Spinner /> : people.length === 0 ? <Empty title="No shifts this week" /> : (
        <div className="table-wrap">
          <table className="table roster">
            <thead>
              <tr>
                <th>Staff</th>
                {days.map((day) => <th key={day}>{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })} {fmtShortDate(day)}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td className="nowrap"><div className="strong">{person.name}</div><div className="faint" style={{ textTransform: 'capitalize' }}>{words(person.role)}</div></td>
                  {days.map((day) => (
                    <td key={day}>
                      {data.filter((shift) => shift.user_id === person.id && shift.date === day).map((shift) => (
                        <div className={`shift-chip ${shift.shift}`} key={shift.id}>
                          {shift.shift}
                          {canManage && (
                            <button type="button" aria-label={`Remove ${shift.shift} shift`} onClick={() => action(() => api.delete(`/staff/shifts/${shift.id}`), 'Shift removed')}><X size={12} /></button>
                          )}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <FormModal
          title="Add shift"
          size="narrow"
          fields={[
            { name: 'user_id', label: 'Staff member', type: 'select', required: true, span: 2, options: staff.map((option) => [option.value, option.label]) },
            { name: 'date', label: 'Date', type: 'date', required: true, span: 2, defaultValue: toDateInput() },
            { name: 'shift', label: 'Shift', type: 'select', required: true, span: 2, options: [['morning', 'Morning'], ['evening', 'Evening'], ['night', 'Night']] },
          ]}
          submitLabel="Add shift"
          successMessage="Shift added"
          onSubmit={(body) => api.post('/staff/shifts', body)}
          onClose={() => setAdding(false)}
        />
      )}
    </Card>
  )
}

function Leave() {
  const can = useCan()
  const { user } = useAuth()
  const action = useAction()
  const [requesting, setRequesting] = useState(false)
  const list = useList('/staff/leave')
  const canManage = can('hr:manage')
  const decide = (row, status) => action(() => api.post(`/staff/leave/${row.id}/decide`, { status }), `Leave ${status}`)
  return (
    <Card flush title={canManage ? 'Leave requests' : 'My leave'} actions={<button className="btn sm primary" onClick={() => setRequesting(true)}><Plus /> Request leave</button>}>
      <DataTable
        list={list}
        emptyTitle="No leave requests"
        columns={[
          ...(canManage ? [{ key: 'user_name', label: 'Staff', render: (row) => <span className="strong">{row.user_name}</span> }] : []),
          { key: 'type', label: 'Type', render: (row) => <span style={{ textTransform: 'capitalize' }}>{row.type}</span> },
          { key: 'start_date', label: 'From', render: (row) => <span className="nowrap">{fmtDate(row.start_date)}</span> },
          { key: 'end_date', label: 'To', render: (row) => <span className="nowrap">{fmtDate(row.end_date)}</span> },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
          {
            key: 'actions',
            label: '',
            render: (row) => canManage && row.status === 'pending' && row.user_id !== user.id && (
              <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                <button className="btn sm" onClick={() => decide(row, 'approved')}>Approve</button>
                <button className="btn ghost sm" onClick={() => decide(row, 'rejected')}>Reject</button>
              </div>
            ),
          },
        ]}
      />
      {requesting && (
        <FormModal
          title="Request leave"
          fields={[
            { name: 'type', label: 'Type', type: 'select', required: true, span: 2, options: [['annual', 'Annual'], ['sick', 'Sick'], ['unpaid', 'Unpaid'], ['other', 'Other']] },
            { name: 'start_date', label: 'From', type: 'date', required: true },
            { name: 'end_date', label: 'To', type: 'date', required: true },
            { name: 'reason', label: 'Reason', type: 'textarea', rows: 2 },
          ]}
          submitLabel="Send request"
          successMessage="Leave request sent"
          onSubmit={(body) => api.post('/staff/leave', body)}
          onClose={() => setRequesting(false)}
        />
      )}
    </Card>
  )
}

export default function Roster() {
  const [tab, setTab] = useTab('roster')
  return (
    <>
      <PageHeader title="Roster & leave" subtitle="Approved leave automatically closes a doctor's appointment slots" />
      <Tabs tabs={[{ value: 'roster', label: 'Duty roster' }, { value: 'leave', label: 'Leave' }]} value={tab} onChange={setTab} />
      {tab === 'roster' ? <WeekRoster /> : <Leave />}
    </>
  )
}
