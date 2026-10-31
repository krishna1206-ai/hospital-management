import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useFreeBeds } from '../lib/hooks.js'
import { FormModal } from './forms.jsx'

export function AdmitModal({ patient, bedId, onClose }) {
  const navigate = useNavigate()
  const beds = useFreeBeds()
  const fields = [
    patient ? null : { name: 'patient_id', label: 'Patient', type: 'patient', required: true, span: 2, allowCreate: true },
    { name: 'doctor_id', label: 'Admitting doctor', type: 'remote', endpoint: '/staff/doctors', required: true },
    { name: 'bed_id', label: 'Bed', type: 'select', options: beds, required: true },
    { name: 'reason', label: 'Reason for admission', type: 'textarea', required: true, rows: 2 },
    { name: 'diagnosis', label: 'Provisional diagnosis', span: 2 },
    { name: 'expected_discharge', label: 'Expected discharge', type: 'date' },
  ].filter(Boolean)
  return (
    <FormModal
      // The bed list loads asynchronously; a remount picks up the preselected bed once it's there.
      key={beds.length ? 'ready' : 'loading'}
      title={patient ? `Admit ${patient.first_name} ${patient.last_name}` : 'Admit patient'}
      fields={fields}
      initial={{ bed_id: bedId }}
      submitLabel="Admit patient"
      successMessage="Patient admitted"
      onSubmit={(body) => api.post('/ipd/admissions', { patient_id: patient?.id, ...body })}
      onClose={(result) => {
        onClose()
        if (result) navigate(`/admissions/${result.id}`)
      }}
    />
  )
}
