import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, FlaskConical, HeartPulse, LogOut, Pill, Printer } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { LabOrderModal, PatientBanner, PrescribeModal, VitalsModal, VitalsSummary } from '../components/clinical.jsx'
import { Field, FormModal } from '../components/forms.jsx'
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDate, fmtDateTime, words } from '../lib/format.js'
import { useAction, useCan, useFreeBeds, useMoney, useSettings } from '../lib/hooks.js'

const CONDITIONS = [['recovered', 'Recovered'], ['improved', 'Improved'], ['unchanged', 'Unchanged'], ['referred', 'Referred'], ['against_advice', 'Left against advice'], ['deceased', 'Deceased']]

function TransferModal({ admission, onClose }) {
  const beds = useFreeBeds()
  return (
    <FormModal
      title={`Transfer ${admission.patient_name}`}
      fields={[
        { name: 'bed_id', label: 'New bed', type: 'select', options: beds, required: true, span: 2 },
        { name: 'reason', label: 'Reason', type: 'textarea', rows: 2 },
      ]}
      submitLabel="Transfer"
      successMessage="Patient transferred"
      onSubmit={(body) => api.post(`/ipd/admissions/${admission.id}/transfer`, body)}
      onClose={onClose}
    />
  )
}

function NursingNotes({ admission }) {
  const can = useCan()
  const action = useAction()
  const [note, setNote] = useState('')
  const open = admission.status === 'admitted'
  const add = async (event) => {
    event.preventDefault()
    if (!note.trim()) return
    await action(() => api.post(`/ipd/admissions/${admission.id}/notes`, { note }), 'Note added')
    setNote('')
  }
  return (
    <Card title="Progress and nursing notes" flush>
      {open && can('ipd:care') && (
        <form className="card-body no-print" style={{ borderBottom: '1px solid var(--border)' }} onSubmit={add}>
          <Field label="Add a note">
            <textarea className="input" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <button className="btn sm primary" style={{ marginTop: 8 }} disabled={!note.trim()}>Add note</button>
        </form>
      )}
      <div className="timeline">
        {admission.notes.length === 0 && <div className="card-body muted">No notes yet.</div>}
        {admission.notes.map((item) => (
          <div className="timeline-item" key={item.id}>
            <div className="note-text">{item.note}</div>
            <div className="faint" style={{ marginTop: 4 }}>{item.author_name} ({words(item.author_role)}), {fmtDateTime(item.created_at)}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function AdmissionDetail() {
  const { id } = useParams()
  const can = useCan()
  const money = useMoney()
  const settings = useSettings()
  const [modal, setModal] = useState(null)
  const query = useQuery({ queryKey: [`/ipd/admissions/${id}`] })
  const admission = query.data
  const patientQuery = useQuery({ queryKey: [`/patients/${admission?.patient_id}`], enabled: Boolean(admission) })
  if (query.isLoading || patientQuery.isLoading) return <Spinner />
  if (query.error) return <ErrorBox error={query.error} />
  if (patientQuery.error) return <ErrorBox error={patientQuery.error} />
  const patient = patientQuery.data
  const open = admission.status === 'admitted'

  return (
    <div className="stack">
      <PageHeader title={`Admission ${admission.admission_no}`} subtitle={`${settings.hospital_name ?? ''}`} back={{ to: '/inpatients?tab=admissions', label: 'Inpatients' }}>
        {open && can('vitals:write') && <button className="btn" onClick={() => setModal('vitals')}><HeartPulse /> Vitals</button>}
        {open && can('lab:order') && <button className="btn" onClick={() => setModal('lab')}><FlaskConical /> Order test</button>}
        {open && can('prescriptions:write') && <button className="btn" onClick={() => setModal('rx')}><Pill /> Prescribe</button>}
        {open && (can('ipd:care') || can('ipd:admit')) && <button className="btn" onClick={() => setModal('transfer')}><ArrowRightLeft /> Transfer</button>}
        {open && can('ipd:discharge') && <button className="btn primary" onClick={() => setModal('discharge')}><LogOut /> Discharge</button>}
        {!open && <button className="btn" onClick={() => window.print()}><Printer /> Print summary</button>}
      </PageHeader>
      <PatientBanner patient={patient}>
        <Badge value={admission.status} tone={open ? 'info' : ''} />
      </PatientBanner>
      <div className="grid-2">
        <Card title="Admission details">
          <dl className="dl">
            {[
              ['Ward and bed', `${admission.ward_name}, bed ${admission.bed_number}`],
              ['Doctor', admission.doctor_name],
              ['Admitted', fmtDateTime(admission.admitted_at)],
              [open ? 'Expected discharge' : 'Discharged', open ? fmtDate(admission.expected_discharge) : fmtDateTime(admission.discharged_at)],
              ['Reason', admission.reason],
              ['Diagnosis', admission.diagnosis],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Latest vitals" subtitle={patient.latest_vitals ? fmtDateTime(patient.latest_vitals.recorded_at) : undefined}>
          <VitalsSummary vitals={patient.latest_vitals} />
        </Card>
      </div>
      {!open && (
        <Card title="Discharge summary" subtitle={`Condition at discharge: ${words(admission.discharge_condition)}`}>
          <div className="note-text">{admission.discharge_summary}</div>
          {admission.discharge_instructions && (
            <>
              <div className="field-label" style={{ marginTop: 12 }}>Instructions for the patient</div>
              <div className="note-text">{admission.discharge_instructions}</div>
            </>
          )}
        </Card>
      )}
      <div className="grid-2">
        <NursingNotes admission={admission} />
        <Card title="Bed history" flush>
          <div className="timeline">
            {admission.stays.map((stay) => (
              <div className="timeline-item" key={stay.id}>
                <div className="strong">{stay.ward_name}, bed {stay.bed_number}</div>
                <div className="muted">
                  {fmtDateTime(stay.started_at)} to {stay.ended_at ? fmtDateTime(stay.ended_at) : 'now'} · {money(stay.daily_rate_cents)}/day
                </div>
                {stay.reason && <div className="faint">{stay.reason}</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>
      {modal === 'vitals' && <VitalsModal patientId={patient.id} admissionId={admission.id} onClose={() => setModal(null)} />}
      {modal === 'lab' && <LabOrderModal patient={patient} onClose={() => setModal(null)} />}
      {modal === 'rx' && <PrescribeModal patient={patient} onClose={() => setModal(null)} />}
      {modal === 'transfer' && <TransferModal admission={admission} onClose={() => setModal(null)} />}
      {modal === 'discharge' && (
        <FormModal
          title={`Discharge ${admission.patient_name}`}
          size="wide"
          intro={<p className="muted">Discharging closes the stay, posts bed charges to billing, and sends the bed for cleaning.</p>}
          fields={[
            { name: 'discharge_condition', label: 'Condition at discharge', type: 'select', options: CONDITIONS, required: true },
            { name: 'discharge_summary', label: 'Discharge summary', type: 'textarea', rows: 5, required: true },
            { name: 'discharge_instructions', label: 'Instructions for the patient', type: 'textarea', rows: 3 },
          ]}
          submitLabel="Discharge patient"
          successMessage="Patient discharged"
          onSubmit={(body) => api.post(`/ipd/admissions/${admission.id}/discharge`, body)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
