import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdmitModal } from '../components/AdmitModal.jsx'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, ErrorBox, Modal, PageHeader, Spinner, Stat, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDate, words } from '../lib/format.js'
import { useAction, useCan, useList, useMoney, useTab } from '../lib/hooks.js'

const WARD_TYPES = ['general', 'semi_private', 'private', 'icu', 'nicu', 'maternity', 'isolation']
const wardTypeLabel = (type) => (['icu', 'nicu'].includes(type) ? type.toUpperCase() : words(type).replace(/^\w/, (letter) => letter.toUpperCase()))
const BED_LEGEND =[['available', 'var(--good)'], ['occupied', 'var(--info)'], ['cleaning', 'var(--warn)'], ['maintenance', 'var(--text-3)']]

function BedBoard() {
  const can = useCan()
  const navigate = useNavigate()
  const action = useAction()
  const [admitBed, setAdmitBed] = useState(null)
  const [statusBed, setStatusBed] = useState(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['/ipd/bed-board'], refetchInterval: 30000 })
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />

  const beds = data.wards.flatMap((ward) => ward.beds)
  const count = (status) => beds.filter((bed) => bed.status === status).length
  const clickBed = (bed) => {
    if (bed.status === 'occupied') navigate(`/admissions/${bed.admission_id}`)
    else if (bed.status === 'available') {
      if (can('ipd:admit')) setAdmitBed(bed)
      else if (can('ipd:care')) setStatusBed(bed)
    } else if (can('ipd:care') || can('ipd:config')) setStatusBed(bed)
  }
  const setStatus = async (status) => {
    await action(() => api.patch(`/ipd/beds/${statusBed.id}/status`, { status }), `Bed ${statusBed.number} is now ${status}`)
    setStatusBed(null)
  }

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Occupied" value={`${count('occupied')} of ${beds.length}`} />
        <Stat label="Available" value={count('available')} />
        <Stat label="Being cleaned" value={count('cleaning')} />
        <Stat label="Out of service" value={count('maintenance')} />
      </div>
      <div className="legend">
        {BED_LEGEND.map(([status, color]) => (
          <span className="legend-key" key={status}><i style={{ background: color }} /> <span style={{ textTransform: 'capitalize' }}>{status}</span></span>
        ))}
      </div>
      <div>
        {data.wards.map((ward) => (
          <Card
            key={ward.id}
            className="ward"
            title={ward.name}
            subtitle={`${wardTypeLabel(ward.type)}, floor ${ward.floor ?? '—'} · ${ward.beds.filter((bed) => bed.status === 'occupied').length}/${ward.beds.length} occupied`}
            flush
          >
            <div className="beds">
              {ward.beds.map((bed) => (
                <button type="button" key={bed.id} className={`bed ${bed.status}`} onClick={() => clickBed(bed)} aria-label={`Bed ${bed.number}, ${bed.status}${bed.patient_name ? `, ${bed.patient_name}` : ''}`}>
                  <div className="bed-top"><span>Bed {bed.number}</span></div>
                  {bed.status === 'occupied' ? (
                    <>
                      <div className="bed-name">{bed.patient_name}</div>
                      <div className="faint ellipsis">{bed.doctor_name}</div>
                    </>
                  ) : (
                    <div className="faint" style={{ marginTop: 3, textTransform: 'capitalize' }}>{bed.status}</div>
                  )}
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {admitBed && <AdmitModal bedId={admitBed.id} onClose={() => setAdmitBed(null)} />}
      {statusBed && (
        <Modal
          title={`Bed ${statusBed.number}`}
          size="narrow"
          onClose={() => setStatusBed(null)}
          footer={
            <>
              {statusBed.status !== 'available' && <button className="btn primary" onClick={() => setStatus('available')}>Mark available</button>}
              {statusBed.status !== 'cleaning' && <button className="btn" onClick={() => setStatus('cleaning')}>Mark cleaning</button>}
              {statusBed.status !== 'maintenance' && <button className="btn" onClick={() => setStatus('maintenance')}>Out of service</button>}
            </>
          }
        >
          <p>This bed is currently <strong>{statusBed.status}</strong>.</p>
        </Modal>
      )}
    </div>
  )
}

function Admissions() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('admitted')
  const list = useList('/ipd/admissions', { filters: { status } })
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search admission, patient or MRN"
        onRowClick={(row) => navigate(`/admissions/${row.id}`)}
        toolbar={
          <select className="input" aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); list.resetPage() }}>
            <option value="admitted">Currently admitted</option>
            <option value="discharged">Discharged</option>
            <option value="">All</option>
          </select>
        }
        columns={[
          { key: 'admission_no', label: 'Admission', render: (row) => <span className="num strong">{row.admission_no}</span> },
          { key: 'patient_name', label: 'Patient', render: (row) => <><div className="strong">{row.patient_name}</div><div className="faint num">{row.mrn}</div></> },
          { key: 'bed', label: 'Ward / bed', render: (row) => `${row.ward_name}, bed ${row.bed_number}` },
          { key: 'doctor_name', label: 'Doctor' },
          { key: 'reason', label: 'Reason' },
          { key: 'admitted_at', label: 'Admitted', render: (row) => <span className="nowrap">{fmtDate(row.admitted_at)}</span> },
          { key: 'expected_discharge', label: 'Expected out', render: (row) => <span className="nowrap">{fmtDate(row.discharged_at ?? row.expected_discharge)}</span> },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} tone={row.status === 'admitted' ? 'info' : ''} /> },
        ]}
      />
    </Card>
  )
}

function Wards() {
  const can = useCan()
  const money = useMoney()
  const [editing, setEditing] = useState(null)
  const [addingBed, setAddingBed] = useState(null)
  const { data = [], isLoading } = useQuery({ queryKey: ['/ipd/wards'] })
  if (isLoading) return <Spinner />
  const fields = (isNew) => [
    { name: 'name', label: 'Ward name', required: true },
    { name: 'type', label: 'Type', type: 'select', required: true, options: WARD_TYPES.map((type) => [type, words(type)]) },
    { name: 'floor', label: 'Floor' },
    { name: 'department_id', label: 'Department', type: 'remote', endpoint: '/staff/departments' },
    { name: 'daily_rate_cents', label: 'Daily rate', type: 'money', required: true },
    ...(isNew ? [{ name: 'bed_count', label: 'Number of beds', type: 'number', defaultValue: 4 }] : []),
  ]
  return (
    <Card
      flush
      title="Wards and rates"
      actions={can('ipd:config') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add ward</button>}
    >
      <DataTable
        rows={data}
        columns={[
          { key: 'name', label: 'Ward', render: (row) => <span className="strong">{row.name}</span> },
          { key: 'type', label: 'Type', render: (row) => wardTypeLabel(row.type) },
          { key: 'floor', label: 'Floor' },
          { key: 'department_name', label: 'Department' },
          { key: 'beds', label: 'Beds', align: 'right', render: (row) => `${row.occupied_count}/${row.bed_count}` },
          { key: 'daily_rate_cents', label: 'Daily rate', align: 'right', render: (row) => money(row.daily_rate_cents) },
          {
            key: 'actions',
            label: '',
            render: (row) => can('ipd:config') && (
              <div className="actions" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={() => setAddingBed(row)}>Add bed</button>
                <button className="btn ghost sm" onClick={() => setEditing(row)}>Edit</button>
              </div>
            ),
          },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add ward'}
          fields={fields(!editing.id)}
          initial={editing}
          successMessage="Ward saved"
          onSubmit={(body) => (editing.id ? api.patch(`/ipd/wards/${editing.id}`, body) : api.post('/ipd/wards', body))}
          onClose={() => setEditing(null)}
        />
      )}
      {addingBed && (
        <FormModal
          title={`Add bed to ${addingBed.name}`}
          size="narrow"
          fields={[{ name: 'number', label: 'Bed number', required: true, span: 2 }]}
          successMessage="Bed added"
          onSubmit={(body) => api.post(`/ipd/wards/${addingBed.id}/beds`, body)}
          onClose={() => setAddingBed(null)}
        />
      )}
    </Card>
  )
}

export default function Inpatients() {
  const can = useCan()
  const [tab, setTab] = useTab('beds')
  const [admitting, setAdmitting] = useState(false)
  return (
    <>
      <PageHeader title="Inpatients" subtitle="Beds, admissions and wards">
        {can('ipd:admit') && <button className="btn primary" onClick={() => setAdmitting(true)}><Plus /> Admit patient</button>}
      </PageHeader>
      <Tabs tabs={[{ value: 'beds', label: 'Bed board' }, { value: 'admissions', label: 'Admissions' }, { value: 'wards', label: 'Wards' }]} value={tab} onChange={setTab} />
      {tab === 'beds' && <BedBoard />}
      {tab === 'admissions' && <Admissions />}
      {tab === 'wards' && <Wards />}
      {admitting && <AdmitModal onClose={() => setAdmitting(false)} />}
    </>
  )
}
