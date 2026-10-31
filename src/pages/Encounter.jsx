import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, FlaskConical, HeartPulse, Pill, Printer, Save } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { FlagBadge, LabOrderModal, PatientBanner, PrescribeModal, PrescriptionLines, VitalsModal, VitalsSummary } from '../components/clinical.jsx'
import { Field } from '../components/forms.jsx'
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDate, fmtDateTime } from '../lib/format.js'
import { useAction, useAuth, useCan, useToast } from '../lib/hooks.js'

const SOAP = [
  ['chief_complaint', 'Chief complaint', 1],
  ['subjective', 'Subjective', 4, 'History of present illness, symptoms, relevant history'],
  ['objective', 'Objective', 4, 'Examination findings'],
  ['assessment', 'Assessment', 3, 'Clinical impression'],
  ['plan', 'Plan', 3, 'Treatment, referrals, patient advice'],
]

function NoteEditor({ encounter, editable }) {
  const action = useAction()
  const toast = useToast()
  const [values, setValues] = useState(() =>
    Object.fromEntries(['chief_complaint', 'subjective', 'objective', 'assessment', 'plan', 'diagnosis', 'icd_code', 'follow_up_date'].map((key) => [key, encounter[key] ?? ''])),
  )
  const [fields, setFields] = useState({})
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const save = () => action(() => api.patch(`/clinical/encounters/${encounter.id}`, values))

  const sign = async () => {
    setFields({})
    try {
      await save()
      await action(() => api.post(`/clinical/encounters/${encounter.id}/sign`), 'Note signed and visit completed')
    } catch (error) {
      if (error.fields) setFields(error.fields)
    }
  }

  if (!editable) {
    return (
      <Card title="Clinical note" subtitle={encounter.signed_at ? `Signed ${fmtDateTime(encounter.signed_at)} by ${encounter.doctor_name}` : `Draft by ${encounter.doctor_name}`}>
        <div className="stack" style={{ gap: 12 }}>
          {SOAP.map(([key, label]) => (
            <div key={key}>
              <div className="field-label">{label}</div>
              <div className="note-text">{encounter[key] || '—'}</div>
            </div>
          ))}
          <div className="form-grid">
            <div><div className="field-label">Diagnosis</div>{encounter.diagnosis || '—'}{encounter.icd_code ? ` (${encounter.icd_code})` : ''}</div>
            <div><div className="field-label">Follow-up</div>{fmtDate(encounter.follow_up_date)}</div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Clinical note"
      actions={
        <>
          <button className="btn" onClick={() => save().then(() => toast('Draft saved'))}><Save /> Save draft</button>
          <button className="btn primary" onClick={sign}><CheckCircle2 /> Sign and complete</button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        {SOAP.map(([key, label, rows, placeholder]) => (
          <Field key={key} label={label}>
            {rows === 1 ? (
              <input className="input" value={values[key]} onChange={set(key)} />
            ) : (
              <textarea className="input" rows={rows} placeholder={placeholder} value={values[key]} onChange={set(key)} />
            )}
          </Field>
        ))}
        <div className="form-grid">
          <Field label="Diagnosis" error={fields.diagnosis}><input className={`input ${fields.diagnosis ? 'invalid' : ''}`} value={values.diagnosis} onChange={set('diagnosis')} /></Field>
          <Field label="ICD-10 code"><input className="input" placeholder="e.g. I10" value={values.icd_code} onChange={set('icd_code')} /></Field>
          <Field label="Follow-up date"><input className="input" type="date" value={values.follow_up_date} onChange={set('follow_up_date')} /></Field>
        </div>
        <p className="faint">Once signed, this note becomes a permanent part of the record and can't be edited.</p>
      </div>
    </Card>
  )
}

export default function Encounter() {
  const { id } = useParams()
  const { user } = useAuth()
  const can = useCan()
  const [modal, setModal] = useState(null)
  const encounterQuery = useQuery({ queryKey: [`/clinical/encounters/${id}`] })
  const encounter = encounterQuery.data
  const patientQuery = useQuery({ queryKey: [`/patients/${encounter?.patient_id}`], enabled: Boolean(encounter) })
  const rxQuery = useQuery({ queryKey: ['/clinical/prescriptions', { encounter_id: id }], enabled: can('prescriptions:read') })
  const labQuery = useQuery({ queryKey: ['/lab/orders', { encounter_id: id }], enabled: can('lab:read') })

  if (encounterQuery.isLoading || patientQuery.isLoading) return <Spinner />
  if (encounterQuery.error) return <ErrorBox error={encounterQuery.error} />
  if (patientQuery.error) return <ErrorBox error={patientQuery.error} />
  const patient = patientQuery.data
  const editable = encounter.status === 'draft' && encounter.doctor_id === user.id && can('clinical:write')

  return (
    <div className="stack">
      <PageHeader
        title={`Visit on ${fmtDate(encounter.created_at)}`}
        subtitle={<>Note status: <Badge value={encounter.status} /></>}
        back={{ to: `/patients/${patient.id}`, label: `${patient.first_name} ${patient.last_name}` }}
      >
        <button className="btn" onClick={() => window.print()}><Printer /> Print</button>
      </PageHeader>
      <PatientBanner patient={patient} />
      <div className="grid-3-1">
        <NoteEditor key={encounter.status} encounter={encounter} editable={editable} />
        <div className="stack">
          <Card title="Vitals" actions={can('vitals:write') && <button className="btn ghost sm" onClick={() => setModal('vitals')}><HeartPulse /> Record</button>}>
            <VitalsSummary vitals={patient.latest_vitals} />
          </Card>
          <Card title="Prescriptions" flush actions={editable && <button className="btn ghost sm" onClick={() => setModal('rx')}><Pill /> Prescribe</button>}>
            {(rxQuery.data?.rows ?? []).length === 0 && <div className="card-body muted">None for this visit.</div>}
            <div className="timeline">
              {(rxQuery.data?.rows ?? []).map((rx) => (
                <div className="timeline-item" key={rx.id}>
                  <div style={{ marginBottom: 4 }}><Badge value={rx.status} /></div>
                  <PrescriptionLines items={rx.items} />
                </div>
              ))}
            </div>
          </Card>
          <Card title="Lab & imaging" flush actions={editable && <button className="btn ghost sm" onClick={() => setModal('lab')}><FlaskConical /> Order</button>}>
            {(labQuery.data?.rows ?? []).length === 0 && <div className="card-body muted">None for this visit.</div>}
            <div className="timeline">
              {(labQuery.data?.rows ?? []).map((order) => (
                <div className="timeline-item" key={order.id}>
                  <div className="actions" style={{ justifyContent: 'space-between' }}>
                    <span className="num strong">{order.order_no}</span>
                    {order.critical_count > 0 ? <FlagBadge flag="critical" /> : <Badge value={order.status} />}
                  </div>
                  <div className="muted">{order.test_names}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      {modal === 'vitals' && <VitalsModal patientId={patient.id} onClose={() => setModal(null)} />}
      {modal === 'rx' && <PrescribeModal patient={patient} encounterId={encounter.id} onClose={() => setModal(null)} />}
      {modal === 'lab' && <LabOrderModal patient={patient} encounterId={encounter.id} onClose={() => setModal(null)} />}
    </div>
  )
}
