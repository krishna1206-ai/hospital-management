import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api.js'
import { age, fmtDate, initials, words } from '../lib/format.js'
import { useAction } from '../lib/hooks.js'
import { Field, FormModal } from './forms.jsx'
import { Badge, ErrorBox, Modal, Spinner, Warn } from './ui.jsx'

export function AllergyStrip({ allergies }) {
  if (!allergies) return null
  return (
    <div className="allergy-strip">
      <AlertTriangle /> Allergies: {allergies}
    </div>
  )
}

/** Identifies the patient on every clinical screen: name, age, MRN, and allergies. */
export function PatientBanner({ patient, children }) {
  return (
    <div className="card">
      <div className="patient-banner">
        <div className="patient-avatar">{initials(`${patient.first_name} ${patient.last_name}`)}</div>
        <div className="grow">
          <div className="patient-name">
            <Link to={`/patients/${patient.id}`} style={{ color: 'inherit' }}>{patient.first_name} {patient.last_name}</Link>
          </div>
          <div className="meta">
            <span className="num">{patient.mrn}</span>
            <span style={{ textTransform: 'capitalize' }}>{age(patient.dob)} · {patient.gender}</span>
            <span>DOB {fmtDate(patient.dob)}</span>
            {patient.blood_group && <span>Blood group {patient.blood_group}</span>}
            <span>{patient.phone}</span>
          </div>
        </div>
        {children && <div className="actions no-print">{children}</div>}
      </div>
      <AllergyStrip allergies={patient.allergies} />
    </div>
  )
}

const blankLine = { medicine_id: '', dose: '', frequency: '', route: 'Oral', duration_days: '', quantity: '', instructions: '' }
const FREQUENCIES = ['Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every 6 hours', 'Every 8 hours', 'At bedtime', 'As needed']

export function PrescribeModal({ patient, encounterId, onClose }) {
  const [lines, setLines] = useState([{ ...blankLine }])
  const [notes, setNotes] = useState('')
  const [conflicts, setConflicts] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const { data } = useQuery({ queryKey: ['/pharmacy/medicines', { pageSize: 100 }] })
  const medicines = data?.rows ?? []
  const action = useAction()

  const setLine = (index, key, value) => setLines((current) => current.map((line, i) => (i === index ? { ...line, [key]: value } : line)))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await action(
        () => api.post('/clinical/prescriptions', { patient_id: patient.id, encounter_id: encounterId, notes, items: lines, allergy_override: Boolean(conflicts) }),
        'Prescription sent to pharmacy',
      )
      onClose()
    } catch (failure) {
      if (failure.data?.allergy_conflicts) setConflicts(failure.data.allergy_conflicts)
      else setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Prescribe for ${patient.first_name} ${patient.last_name}`}
      size="wide"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${conflicts ? 'danger' : 'primary'}`} disabled={busy}>
            {conflicts ? 'Override allergy and prescribe' : 'Send to pharmacy'}
          </button>
        </>
      }
    >
      {patient.allergies && <Warn>Recorded allergies: <strong>{patient.allergies}</strong></Warn>}
      {conflicts && (
        <div className="error-box" role="alert">
          <strong>Allergy conflict.</strong>{' '}
          {conflicts.map((conflict) => `${conflict.medicine} matches the recorded allergy "${conflict.allergy}"`).join('; ')}. Change the medicine, or override only with clinical justification. Overrides are recorded.
        </div>
      )}
      <ErrorBox error={error} />
      {lines.map((line, index) => (
        <div className="form-grid" key={index} style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
          <Field label="Medicine" required className="span-2">
            <select className="input" value={line.medicine_id} onChange={(event) => { setLine(index, 'medicine_id', event.target.value); setConflicts(null) }}>
              <option value="">Select a medicine…</option>
              {medicines.map((medicine) => (
                <option key={medicine.id} value={medicine.id}>
                  {medicine.name} {medicine.strength} ({medicine.form}): {medicine.in_stock} in stock
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dose" required><input className="input" placeholder="1 tablet" value={line.dose} onChange={(event) => setLine(index, 'dose', event.target.value)} /></Field>
          <Field label="Frequency" required>
            <select className="input" value={line.frequency} onChange={(event) => setLine(index, 'frequency', event.target.value)}>
              <option value="">Select…</option>
              {FREQUENCIES.map((frequency) => <option key={frequency}>{frequency}</option>)}
            </select>
          </Field>
          <Field label="Duration (days)"><input className="input" type="number" min="1" value={line.duration_days} onChange={(event) => setLine(index, 'duration_days', event.target.value)} /></Field>
          <Field label="Quantity" required><input className="input" type="number" min="1" value={line.quantity} onChange={(event) => setLine(index, 'quantity', event.target.value)} /></Field>
          <Field label="Route">
            <select className="input" value={line.route} onChange={(event) => setLine(index, 'route', event.target.value)}>
              {['Oral', 'IV', 'IM', 'Subcutaneous', 'Topical', 'Inhaled'].map((route) => <option key={route}>{route}</option>)}
            </select>
          </Field>
          <Field label="Instructions"><input className="input" value={line.instructions} onChange={(event) => setLine(index, 'instructions', event.target.value)} /></Field>
          {lines.length > 1 && (
            <div className="span-2">
              <button type="button" className="btn ghost sm" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><Trash2 /> Remove</button>
            </div>
          )}
        </div>
      ))}
      <div>
        <button type="button" className="btn sm" onClick={() => setLines((current) => [...current, { ...blankLine }])}><Plus /> Add medicine</button>
      </div>
      <Field label="Notes for pharmacy"><textarea className="input" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
    </Modal>
  )
}

export function LabOrderModal({ patient, encounterId, onClose }) {
  const [selected, setSelected] = useState(() => new Set())
  const [priority, setPriority] = useState('routine')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: ['/lab/tests', { pageSize: 100 }] })
  const action = useAction()
  const tests = data?.rows ?? []

  const toggle = (id) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    try {
      await action(() => api.post('/lab/orders', { patient_id: patient.id, encounter_id: encounterId, test_ids: [...selected], priority, notes }), 'Order sent to the laboratory')
      onClose()
    } catch (failure) {
      setError(failure.fields?.test_ids ? new Error(failure.fields.test_ids) : failure)
    }
  }

  return (
    <Modal
      title={`Order tests for ${patient.first_name} ${patient.last_name}`}
      size="wide"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Place order ({selected.size})</button>
        </>
      }
    >
      <ErrorBox error={error} />
      {isLoading && <Spinner />}
      {['laboratory', 'radiology'].map((category) => (
        <div key={category}>
          <div className="form-section" style={{ borderTop: 0, paddingBottom: 6 }}>{category}</div>
          <div className="form-grid">
            {tests.filter((test) => test.category === category).map((test) => (
              <label className="check" key={test.id}>
                <input type="checkbox" checked={selected.has(test.id)} onChange={() => toggle(test.id)} />
                <span>{test.name} <span className="faint">{test.code}</span></span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="form-grid">
        <Field label="Priority">
          <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT</option>
          </select>
        </Field>
        <Field label="Clinical notes"><input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      </div>
    </Modal>
  )
}

const VITAL_FIELDS = [
  { name: 'temperature_c', label: 'Temperature (°C)', type: 'number' },
  { name: 'pulse', label: 'Pulse (bpm)', type: 'number' },
  { name: 'systolic', label: 'Systolic (mmHg)', type: 'number' },
  { name: 'diastolic', label: 'Diastolic (mmHg)', type: 'number' },
  { name: 'resp_rate', label: 'Respiratory rate', type: 'number' },
  { name: 'spo2', label: 'SpO₂ (%)', type: 'number' },
  { name: 'weight_kg', label: 'Weight (kg)', type: 'number' },
  { name: 'height_cm', label: 'Height (cm)', type: 'number' },
  { name: 'pain_score', label: 'Pain score (0–10)', type: 'number' },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
]

export function VitalsModal({ patientId, admissionId, onClose }) {
  return (
    <FormModal
      title="Record vitals"
      fields={VITAL_FIELDS}
      successMessage="Vitals recorded"
      onSubmit={(body) => api.post('/clinical/vitals', { ...body, patient_id: patientId, admission_id: admissionId })}
      onClose={onClose}
    />
  )
}

export function VitalsSummary({ vitals }) {
  if (!vitals) return <div className="muted">No vitals recorded yet.</div>
  const items = [
    ['Blood pressure', vitals.systolic ? `${vitals.systolic}/${vitals.diastolic} mmHg` : null],
    ['Pulse', vitals.pulse ? `${vitals.pulse} bpm` : null],
    ['Temperature', vitals.temperature_c ? `${Number(vitals.temperature_c).toFixed(1)} °C` : null],
    ['SpO₂', vitals.spo2 ? `${vitals.spo2}%` : null],
    ['Respiratory rate', vitals.resp_rate ? `${vitals.resp_rate}/min` : null],
    ['Weight', vitals.weight_kg ? `${vitals.weight_kg} kg` : null],
  ].filter(([, value]) => value)
  return (
    <dl className="dl">
      {items.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd className="num">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** One prescription with its lines, shared by chart, visit, and pharmacy screens. */
export function PrescriptionLines({ items }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((item) => (
        <li key={item.id}>
          <span className="strong">{item.medicine_name} {item.strength}</span>: {item.dose}, {item.frequency.toLowerCase()}
          {item.duration_days ? ` for ${item.duration_days} days` : ''}
          {item.instructions ? `. ${item.instructions}` : ''} <span className="faint">(qty {item.quantity})</span>
        </li>
      ))}
    </ul>
  )
}

export const FlagBadge = ({ flag }) => (flag ? <Badge value={flag} /> : <span className="faint">{words('pending')}</span>)
