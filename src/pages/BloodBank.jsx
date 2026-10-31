import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, PageHeader, Stat, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { addDays, fmtDate, toDateInput, words } from '../lib/format.js'
import { useAction, useCan, useList, useTab } from '../lib/hooks.js'

const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const COMPONENTS = [['whole_blood', 'Whole blood'], ['packed_rbc', 'Packed red cells'], ['plasma', 'Plasma'], ['platelets', 'Platelets']]

function Units() {
  const can = useCan()
  const action = useAction()
  const [status, setStatus] = useState('available')
  const [group, setGroup] = useState('')
  const [issuing, setIssuing] = useState(null)
  const list = useList('/blood/units', { filters: { status, blood_group: group } })
  const today = toDateInput()
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search unit or donor"
        toolbar={
          <>
            <select className="input" aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); list.resetPage() }}>
              <option value="available">Available</option>
              <option value="issued">Issued</option>
              <option value="discarded">Discarded</option>
              <option value="">All</option>
            </select>
            <select className="input" aria-label="Blood group" value={group} onChange={(event) => { setGroup(event.target.value); list.resetPage() }}>
              <option value="">All groups</option>
              {GROUPS.map((value) => <option key={value}>{value}</option>)}
            </select>
          </>
        }
        columns={[
          { key: 'unit_no', label: 'Unit', render: (row) => <span className="num strong nowrap">{row.unit_no}</span> },
          { key: 'blood_group', label: 'Group', render: (row) => <span className="strong">{row.blood_group}</span> },
          { key: 'component', label: 'Component', render: (row) => <span style={{ textTransform: 'capitalize' }}>{words(row.component)}</span> },
          { key: 'donor_name', label: 'Donor' },
          { key: 'collected_on', label: 'Collected', render: (row) => <span className="nowrap">{fmtDate(row.collected_on)}</span> },
          {
            key: 'expires_on',
            label: 'Expires',
            render: (row) => (
              <span className="actions nowrap" style={{ flexWrap: 'nowrap' }}>
                {fmtDate(row.expires_on)}
                {row.status === 'available' && row.expires_on < today && <Badge tone="bad" label="Expired" />}
              </span>
            ),
          },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} tone={row.status === 'issued' ? 'info' : undefined} /> },
          { key: 'issued_patient_name', label: 'Issued to' },
          {
            key: 'actions',
            label: '',
            render: (row) => can('blood:write') && row.status === 'available' && (
              <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                {row.expires_on >= today && <button className="btn sm" onClick={() => setIssuing(row)}>Issue</button>}
                <button className="btn ghost sm" onClick={() => action(() => api.post(`/blood/units/${row.id}/discard`), 'Unit discarded')}>Discard</button>
              </div>
            ),
          },
        ]}
      />
      {issuing && (
        <FormModal
          title={`Issue ${issuing.blood_group} unit ${issuing.unit_no}`}
          intro={<p className="muted">Compatibility with the patient's blood group is checked before release. Perform a bedside check as usual.</p>}
          fields={[{ name: 'patient_id', label: 'Patient', type: 'patient', required: true, span: 2 }]}
          submitLabel="Issue unit"
          successMessage="Unit issued"
          onSubmit={(body) => api.post(`/blood/units/${issuing.id}/issue`, body)}
          onClose={() => setIssuing(null)}
        />
      )}
    </Card>
  )
}

function Donors() {
  const can = useCan()
  const [editing, setEditing] = useState(null)
  const list = useList('/blood/donors')
  return (
    <Card flush title="Donors" actions={can('blood:write') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add donor</button>}>
      <DataTable
        list={list}
        searchPlaceholder="Search name, phone or group"
        onRowClick={can('blood:write') ? setEditing : undefined}
        columns={[
          { key: 'name', label: 'Donor', render: (row) => <span className="strong">{row.name}</span> },
          { key: 'blood_group', label: 'Group' },
          { key: 'phone', label: 'Phone' },
          { key: 'last_donation_on', label: 'Last donation', render: (row) => fmtDate(row.last_donation_on) },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add donor'}
          fields={[
            { name: 'name', label: 'Name', required: true, span: 2 },
            { name: 'blood_group', label: 'Blood group', type: 'select', options: GROUPS, required: true },
            { name: 'phone', label: 'Phone', type: 'tel' },
          ]}
          initial={editing}
          successMessage="Donor saved"
          onSubmit={(body) => (editing.id ? api.patch(`/blood/donors/${editing.id}`, body) : api.post('/blood/donors', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

export default function BloodBank() {
  const can = useCan()
  const [tab, setTab] = useTab('units')
  const [adding, setAdding] = useState(false)
  const { data: stock = [] } = useQuery({ queryKey: ['/blood/stock'] })
  const today = toDateInput()
  return (
    <div className="stack">
      <PageHeader title="Blood bank" subtitle="In-date units available for issue">
        {can('blood:write') && <button className="btn primary" onClick={() => setAdding(true)}><Plus /> Add unit</button>}
      </PageHeader>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))' }}>
        {stock.map((row) => <Stat key={row.blood_group} label={row.blood_group} value={row.units} note={row.units < 2 ? 'Low' : `unit${row.units === 1 ? '' : 's'}`} />)}
      </div>
      <div>
        <Tabs tabs={[{ value: 'units', label: 'Units' }, { value: 'donors', label: 'Donors' }]} value={tab} onChange={setTab} />
        {tab === 'units' ? <Units /> : <Donors />}
      </div>
      {adding && (
        <FormModal
          title="Add blood unit"
          fields={[
            { name: 'blood_group', label: 'Blood group', type: 'select', options: GROUPS, required: true },
            { name: 'component', label: 'Component', type: 'select', options: COMPONENTS, required: true },
            { name: 'collected_on', label: 'Collected on', type: 'date', required: true, defaultValue: today },
            { name: 'expires_on', label: 'Expires on', type: 'date', required: true, defaultValue: addDays(today, 35) },
            { name: 'donor_id', label: 'Donor', type: 'remote', endpoint: '/blood/donors', span: 2 },
          ]}
          submitLabel="Add unit"
          successMessage="Unit added to stock"
          onSubmit={(body) => api.post('/blood/units', body)}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
