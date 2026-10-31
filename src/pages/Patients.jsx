import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PatientFormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, PageHeader } from '../components/ui.jsx'
import { age, fmtDate } from '../lib/format.js'
import { useCan, useList } from '../lib/hooks.js'

export default function Patients() {
  const can = useCan()
  const navigate = useNavigate()
  const [gender, setGender] = useState('')
  const [creating, setCreating] = useState(false)
  const list = useList('/patients', { filters: { gender } })

  const columns = [
    { key: 'mrn', label: 'MRN', render: (row) => <span className="num strong">{row.mrn}</span> },
    { key: 'name', label: 'Patient', render: (row) => <span className="strong">{row.first_name} {row.last_name}</span> },
    { key: 'age', label: 'Age / sex', render: (row) => <span style={{ textTransform: 'capitalize' }}>{age(row.dob)} · {row.gender}</span> },
    { key: 'blood_group', label: 'Blood' },
    { key: 'phone', label: 'Phone', render: (row) => <span className="num nowrap">{row.phone}</span> },
    { key: 'insurance_provider', label: 'Insurance' },
    { key: 'last_visit', label: 'Last visit', render: (row) => fmtDate(row.last_visit) },
    { key: 'status', label: 'Status', render: (row) => (row.admission_id ? <Badge value="admitted" /> : <span className="faint">Outpatient</span>) },
  ]

  return (
    <>
      <PageHeader title="Patients" subtitle={list.data ? `${list.data.total.toLocaleString()} registered` : ' '}>
        {can('patients:write') && <button className="btn primary" onClick={() => setCreating(true)}><Plus /> Register patient</button>}
      </PageHeader>
      <Card flush>
        <DataTable
          list={list}
          columns={columns}
          searchPlaceholder="Search name, MRN, phone or ID"
          onRowClick={(row) => navigate(`/patients/${row.id}`)}
          emptyTitle="No patients match"
          toolbar={
            <select className="input" aria-label="Filter by gender" value={gender} onChange={(event) => { setGender(event.target.value); list.resetPage() }}>
              <option value="">All genders</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          }
        />
      </Card>
      {creating && <PatientFormModal onClose={() => setCreating(false)} onSaved={(patient) => navigate(`/patients/${patient.id}`)} />}
    </>
  )
}
