import { useQuery } from '@tanstack/react-query'
import { BedDouble, CalendarPlus, FilePlus2, FlaskConical, HeartPulse, Pencil, Pill, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FlagBadge, LabOrderModal, PatientBanner, PrescribeModal, PrescriptionLines, VitalsModal, VitalsSummary } from '../components/clinical.jsx'
import { PatientFormModal } from '../components/forms.jsx'
import { AdmitModal } from '../components/AdmitModal.jsx'
import { BookAppointmentModal } from '../components/BookAppointmentModal.jsx'
import { Badge, Card, DataTable, Empty, ErrorBox, PageHeader, Spinner, Stat, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDate, fmtDateTime, words } from '../lib/format.js'
import { useAction, useCan, useList, useMoney, useTab } from '../lib/hooks.js'

function Overview({ patient }) {
  const money = useMoney()
  const can = useCan()
  return (
    <div className="stack">
      <div className="stats">
        {patient.current_admission && (
          <Stat icon={BedDouble} label="Currently admitted" value={patient.current_admission.ward_name} note={`Bed ${patient.current_admission.bed_number}`} to={`/admissions/${patient.current_admission.id}`} />
        )}
        {patient.next_appointment && (
          <Stat label="Next appointment" value={fmtDate(patient.next_appointment.date)} note={`${patient.next_appointment.start_time}, ${patient.next_appointment.doctor_name}`} />
        )}
        {patient.balance_due_cents !== null && <Stat label="Balance due" value={money(patient.balance_due_cents)} />}
      </div>
      <div className="grid-2">
        <Card title="Demographics">
          <dl className="dl">
            {[
              ['Address', [patient.address, patient.city].filter(Boolean).join(', ')],
              ['Email', patient.email],
              ['National ID', patient.national_id],
              ['Marital status', patient.marital_status],
              ['Occupation', patient.occupation],
              ['Registered', fmtDate(patient.created_at)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Emergency contact and insurance">
          <dl className="dl">
            {[
              ['Contact', patient.emergency_name ? `${patient.emergency_name}${patient.emergency_relation ? ` (${patient.emergency_relation})` : ''}` : null],
              ['Contact phone', patient.emergency_phone],
              ['Insurer', patient.insurance_provider],
              ['Policy', patient.insurance_policy],
              ['Chronic conditions', patient.chronic_conditions],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {can('clinical:read') && (
          <Card title="Latest vitals" subtitle={patient.latest_vitals ? fmtDateTime(patient.latest_vitals.recorded_at) : undefined}>
            <VitalsSummary vitals={patient.latest_vitals} />
          </Card>
        )}
      </div>
    </div>
  )
}

function Visits({ patientId }) {
  const list = useList('/clinical/encounters', { filters: { patient_id: patientId }, pageSize: 10 })
  const navigate = useNavigate()
  const columns = [
    { key: 'created_at', label: 'Date', render: (row) => fmtDate(row.created_at) },
    { key: 'type', label: 'Type', render: (row) => row.type.toUpperCase() },
    { key: 'doctor_name', label: 'Doctor' },
    { key: 'chief_complaint', label: 'Complaint' },
    { key: 'diagnosis', label: 'Diagnosis', render: (row) => (row.diagnosis ? `${row.diagnosis}${row.icd_code ? ` (${row.icd_code})` : ''}` : '—') },
    { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
  ]
  return <Card flush><DataTable list={list} columns={columns} onRowClick={(row) => navigate(`/encounters/${row.id}`)} emptyTitle="No visit notes yet" /></Card>
}

function Vitals({ patientId }) {
  const list = useList('/clinical/vitals', { filters: { patient_id: patientId }, pageSize: 15 })
  const columns = [
    { key: 'recorded_at', label: 'Recorded', render: (row) => <span className="nowrap">{fmtDateTime(row.recorded_at)}</span> },
    { key: 'bp', label: 'BP', align: 'right', render: (row) => (row.systolic ? `${row.systolic}/${row.diastolic}` : '—') },
    { key: 'pulse', label: 'Pulse', align: 'right' },
    { key: 'temperature_c', label: 'Temp °C', align: 'right', render: (row) => (row.temperature_c ? Number(row.temperature_c).toFixed(1) : '—') },
    { key: 'spo2', label: 'SpO₂', align: 'right' },
    { key: 'resp_rate', label: 'RR', align: 'right' },
    { key: 'weight_kg', label: 'Kg', align: 'right' },
    { key: 'recorded_by_name', label: 'By' },
  ]
  return <Card flush><DataTable list={list} columns={columns} emptyTitle="No vitals recorded" /></Card>
}

function Prescriptions({ patientId }) {
  const list = useList('/clinical/prescriptions', { filters: { patient_id: patientId }, pageSize: 10 })
  const can = useCan()
  const action = useAction()
  if (list.isLoading) return <Spinner />
  const rows = list.data?.rows ?? []
  return (
    <Card flush>
      {rows.length === 0 && <Empty title="No prescriptions yet" />}
      <div className="timeline">
        {rows.map((rx) => (
          <div className="timeline-item" key={rx.id}>
            <div className="actions" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="muted">{fmtDateTime(rx.created_at)} · {rx.doctor_name}</span>
              <span className="actions">
                {rx.allergy_override === 1 && <Badge tone="bad" label="Allergy override" />}
                <Badge value={rx.status} />
                {can('prescriptions:write') && rx.status === 'active' && (
                  <button className="btn ghost sm" onClick={() => action(() => api.post(`/clinical/prescriptions/${rx.id}/cancel`), 'Prescription cancelled')}>Cancel</button>
                )}
              </span>
            </div>
            <PrescriptionLines items={rx.items} />
            {rx.notes && <div className="faint" style={{ marginTop: 4 }}>{rx.notes}</div>}
          </div>
        ))}
      </div>
    </Card>
  )
}

function LabResults({ patientId }) {
  const list = useList('/lab/orders', { filters: { patient_id: patientId }, pageSize: 10 })
  const [openId, setOpenId] = useState(null)
  const detail = useQuery({ queryKey: [`/lab/orders/${openId}`], enabled: Boolean(openId) })
  const columns = [
    { key: 'order_no', label: 'Order', render: (row) => <span className="num strong">{row.order_no}</span> },
    { key: 'created_at', label: 'Ordered', render: (row) => fmtDate(row.created_at) },
    { key: 'test_names', label: 'Tests' },
    { key: 'priority', label: 'Priority', render: (row) => <Badge value={row.priority} /> },
    { key: 'status', label: 'Status', render: (row) => (row.critical_count > 0 ? <Badge tone="bad" label="Critical result" /> : <Badge value={row.status} />) },
  ]
  return (
    <div className="stack">
      <Card flush><DataTable list={list} columns={columns} onRowClick={(row) => setOpenId(row.id)} emptyTitle="No lab orders yet" /></Card>
      {openId && detail.data && (
        <Card title={`Results: ${detail.data.order_no}`} flush actions={<button className="btn ghost sm" onClick={() => setOpenId(null)}>Close</button>}>
          <DataTable
            rows={detail.data.items}
            columns={[
              { key: 'name', label: 'Test' },
              { key: 'result', label: 'Result', render: (item) => (item.result_value != null ? `${item.result_value} ${item.unit ?? ''}` : item.result_text ? <span className="note-text">{item.result_text}</span> : '—') },
              { key: 'range', label: 'Reference', render: (item) => (item.ref_low != null ? `${item.ref_low}–${item.ref_high} ${item.unit ?? ''}` : '—') },
              { key: 'flag', label: 'Flag', render: (item) => <FlagBadge flag={item.flag} /> },
            ]}
          />
        </Card>
      )}
    </div>
  )
}

function AppointmentsTab({ patientId }) {
  const { data = [], isLoading } = useQuery({ queryKey: [`/patients/${patientId}/appointments`] })
  if (isLoading) return <Spinner />
  return (
    <Card flush>
      <DataTable
        rows={data}
        columns={[
          { key: 'date', label: 'Date', render: (row) => fmtDate(row.date) },
          { key: 'start_time', label: 'Time', render: (row) => <span className="num">{row.start_time}</span> },
          { key: 'doctor_name', label: 'Doctor' },
          { key: 'department_name', label: 'Department' },
          { key: 'type', label: 'Type', render: (row) => <span style={{ textTransform: 'capitalize' }}>{words(row.type)}</span> },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
        ]}
        emptyTitle="No appointments yet"
      />
    </Card>
  )
}

function Admissions({ patientId }) {
  const list = useList('/ipd/admissions', { filters: { patient_id: patientId }, pageSize: 10 })
  const navigate = useNavigate()
  return (
    <Card flush>
      <DataTable
        list={list}
        onRowClick={(row) => navigate(`/admissions/${row.id}`)}
        columns={[
          { key: 'admission_no', label: 'Admission', render: (row) => <span className="num strong">{row.admission_no}</span> },
          { key: 'admitted_at', label: 'Admitted', render: (row) => fmtDate(row.admitted_at) },
          { key: 'discharged_at', label: 'Discharged', render: (row) => fmtDate(row.discharged_at) },
          { key: 'ward_name', label: 'Ward' },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} tone={row.status === 'admitted' ? 'info' : ''} /> },
        ]}
        emptyTitle="No admissions yet"
      />
    </Card>
  )
}

function Invoices({ patientId }) {
  const money = useMoney()
  const list = useList('/billing/invoices', { filters: { patient_id: patientId }, pageSize: 10 })
  const navigate = useNavigate()
  return (
    <Card flush>
      <DataTable
        list={list}
        onRowClick={(row) => navigate(`/billing/invoices/${row.id}`)}
        columns={[
          { key: 'invoice_no', label: 'Invoice', render: (row) => <span className="num strong">{row.invoice_no}</span> },
          { key: 'created_at', label: 'Date', render: (row) => fmtDate(row.created_at) },
          { key: 'total_cents', label: 'Total', align: 'right', render: (row) => money(row.total_cents) },
          { key: 'balance_cents', label: 'Balance', align: 'right', render: (row) => money(row.status === 'void' ? 0 : row.balance_cents) },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
        ]}
        emptyTitle="No invoices yet"
      />
    </Card>
  )
}

export default function PatientChart() {
  const { id } = useParams()
  const can = useCan()
  const { data: patient, isLoading, error } = useQuery({ queryKey: [`/patients/${id}`] })
  const [tab, setTab] = useTab('overview')
  const [modal, setModal] = useState(null)
  const navigate = useNavigate()
  const action = useAction()

  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />

  const startNote = async () => {
    const note = await action(() => api.post('/clinical/encounters', { patient_id: patient.id }))
    navigate(`/encounters/${note.id}`)
  }

  const tabs = [
    { value: 'overview', label: 'Overview' },
    can('clinical:read') && { value: 'visits', label: 'Visits' },
    can('clinical:read') && { value: 'vitals', label: 'Vitals' },
    can('prescriptions:read') && { value: 'prescriptions', label: 'Prescriptions' },
    can('lab:read') && { value: 'lab', label: 'Lab & imaging' },
    can('appointments:read') && { value: 'appointments', label: 'Appointments' },
    can('ipd:read') && { value: 'admissions', label: 'Admissions' },
    can('billing:read') && { value: 'invoices', label: 'Billing' },
  ].filter(Boolean)

  return (
    <div className="stack">
      <PageHeader title="Patient chart" back={{ to: '/patients', label: 'Patients' }}>
        {can('patients:write') && <button className="btn" onClick={() => setModal('edit')}><Pencil /> Edit</button>}
        {can('appointments:write') && <button className="btn" onClick={() => setModal('book')}><CalendarPlus /> Book</button>}
        {can('vitals:write') && <button className="btn" onClick={() => setModal('vitals')}><HeartPulse /> Vitals</button>}
        {can('lab:order') && <button className="btn" onClick={() => setModal('lab')}><FlaskConical /> Order test</button>}
        {can('prescriptions:write') && <button className="btn" onClick={() => setModal('rx')}><Pill /> Prescribe</button>}
        {can('clinical:write') && <button className="btn" onClick={startNote}><FilePlus2 /> New note</button>}
        {can('ipd:admit') && !patient.current_admission && <button className="btn primary" onClick={() => setModal('admit')}><Plus /> Admit</button>}
      </PageHeader>
      <PatientBanner patient={patient}>
        {patient.current_admission && (
          <Link to={`/admissions/${patient.current_admission.id}`}><Badge tone="info" label={`Admitted: ${patient.current_admission.ward_name}, bed ${patient.current_admission.bed_number}`} /></Link>
        )}
      </PatientBanner>
      <div>
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'overview' && <Overview patient={patient} />}
        {tab === 'visits' && <Visits patientId={id} />}
        {tab === 'vitals' && <Vitals patientId={id} />}
        {tab === 'prescriptions' && <Prescriptions patientId={id} />}
        {tab === 'lab' && <LabResults patientId={id} />}
        {tab === 'appointments' && <AppointmentsTab patientId={id} />}
        {tab === 'admissions' && <Admissions patientId={id} />}
        {tab === 'invoices' && <Invoices patientId={id} />}
      </div>
      {modal === 'edit' && <PatientFormModal patient={patient} onClose={() => setModal(null)} />}
      {modal === 'book' && <BookAppointmentModal patient={patient} onClose={() => setModal(null)} />}
      {modal === 'vitals' && <VitalsModal patientId={patient.id} admissionId={patient.current_admission?.id} onClose={() => setModal(null)} />}
      {modal === 'lab' && <LabOrderModal patient={patient} onClose={() => setModal(null)} />}
      {modal === 'rx' && <PrescribeModal patient={patient} onClose={() => setModal(null)} />}
      {modal === 'admit' && <AdmitModal patient={patient} onClose={() => setModal(null)} />}
    </div>
  )
}
