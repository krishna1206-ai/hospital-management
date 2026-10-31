import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api.js'
import { toDateInput, words } from '../lib/format.js'
import { useAction, useOptions } from '../lib/hooks.js'
import { Field, PatientPicker } from './forms.jsx'
import { ErrorBox, Modal, Spinner, Warn } from './ui.jsx'

/** Books a new appointment, or moves an existing one when `appointment` is given. */
export function BookAppointmentModal({ patient, appointment, onClose }) {
  const [patientId, setPatientId] = useState(patient?.id ?? null)
  const [departmentId, setDepartmentId] = useState('')
  const [doctorId, setDoctorId] = useState(appointment?.doctor_id ?? '')
  const [date, setDate] = useState(appointment?.date ?? toDateInput())
  const [slot, setSlot] = useState(null)
  const [type, setType] = useState('consultation')
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const action = useAction()

  const departments = useOptions('/staff/departments')
  const doctors = useOptions('/staff/doctors', {
    params: { department_id: departmentId },
    label: (row) => `${row.name}${row.specialization ? `, ${row.specialization}` : ''}`,
  })
  const slots = useQuery({ queryKey: ['/appointments/slots', { doctor_id: doctorId, date }], enabled: Boolean(doctorId && date) })

  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    if (!patientId) return setError(new Error('Choose a patient'))
    if (!doctorId) return setError(new Error('Choose a doctor'))
    if (!slot) return setError(new Error('Choose a time'))
    setBusy(true)
    try {
      await action(
        () =>
          appointment
            ? api.post(`/appointments/${appointment.id}/reschedule`, { doctor_id: doctorId, date, start_time: slot })
            : api.post('/appointments', { patient_id: patientId, doctor_id: doctorId, date, start_time: slot, type, reason }),
        appointment ? 'Appointment moved' : 'Appointment booked',
      )
      onClose()
    } catch (failure) {
      setError(failure)
      setSlot(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={appointment ? 'Reschedule appointment' : 'Book appointment'}
      onClose={onClose}
      onSubmit={submit}
      size="wide"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{appointment ? 'Move appointment' : 'Book appointment'}</button>
        </>
      }
    >
      <ErrorBox error={error} />
      {!appointment && (
        <Field label="Patient" required group>
          <PatientPicker value={patient} onChange={(id) => setPatientId(id)} allowCreate />
        </Field>
      )}
      <div className="form-grid">
        <Field label="Department">
          <select className="input" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setDoctorId(''); setSlot(null) }}>
            <option value="">All departments</option>
            {departments.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Doctor" required>
          <select className="input" value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setSlot(null) }}>
            <option value="">Select a doctor…</option>
            {doctors.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Date" required>
          <input className="input" type="date" min={toDateInput()} value={date} onChange={(event) => { setDate(event.target.value); setSlot(null) }} />
        </Field>
        {!appointment && (
          <Field label="Visit type">
            <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
              {['consultation', 'follow_up', 'procedure', 'telehealth'].map((value) => <option key={value} value={value}>{words(value)}</option>)}
            </select>
          </Field>
        )}
      </div>
      {doctorId && (
        <Field label="Available times" required group>
          {slots.isLoading ? <Spinner /> : slots.data?.on_leave ? (
            <Warn>This doctor is on leave on this date.</Warn>
          ) : slots.data?.slots.length ? (
            <div className="slots">
              {slots.data.slots.map(({ start_time: time }) => (
                <button type="button" key={time} className={`slot ${slot === time ? 'selected' : ''}`} aria-pressed={slot === time} onClick={() => setSlot(time)}>{time}</button>
              ))}
            </div>
          ) : (
            <div className="muted">No open times on this date. Try another day.</div>
          )}
        </Field>
      )}
      {!appointment && (
        <Field label="Reason for visit">
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      )}
    </Modal>
  )
}
