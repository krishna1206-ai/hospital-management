import { Search, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { age } from '../lib/format.js'
import { useAction, useCan, useDebounced, useOptions } from '../lib/hooks.js'
import { ErrorBox, Modal } from './ui.jsx'

/** Use `group` when the control holds several buttons: a <label> would forward stray clicks to the first one. */
export function Field({ label, required, error, help, className = '', group, children }) {
  const Wrapper = group ? 'div' : 'label'
  return (
    <Wrapper className={`field ${className}`}>
      {label && (
        <span className="field-label">
          {label}
          {required && <span className="req"> *</span>}
        </span>
      )}
      {children}
      {error ? <span className="field-error">{error}</span> : help ? <span className="field-help">{help}</span> : null}
    </Wrapper>
  )
}

/** Remote-searching patient combobox. */
export function PatientPicker({ value, onChange, invalid, allowCreate }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState(value && typeof value === 'object' ? value : null)
  const box = useRef(null)
  const can = useCan()
  const q = useDebounced(text)
  const { data = [] } = useQuery({ queryKey: ['/search', { q }], enabled: open && q.length > 0 })

  useEffect(() => {
    const onClick = (event) => {
      if (box.current && !box.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const choose = (patient) => {
    setSelected(patient)
    onChange(patient.id, patient)
    setOpen(false)
    setText('')
  }

  if (selected) {
    return (
      <div className="input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="ellipsis">
          <span className="strong">{selected.first_name} {selected.last_name}</span> <span className="faint">{selected.mrn}{selected.dob ? ` · ${age(selected.dob)}` : ''}</span>
        </span>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            setSelected(null)
            onChange(null, null)
          }}
        >
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="global-search" style={{ maxWidth: 'none' }} ref={box}>
      <Search />
      <input
        className={`input ${invalid ? 'invalid' : ''}`}
        placeholder="Search by name, MRN or phone"
        value={text}
        aria-label="Search patients"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
        }}
      />
      {open && (text || allowCreate) && (
        <div className="popover search-results">
          {data.map((patient) => (
            <button type="button" key={patient.id} className="search-item" onClick={() => choose(patient)}>
              <div className="strong">{patient.first_name} {patient.last_name}</div>
              <div className="faint">{patient.mrn} · {age(patient.dob)} · {patient.phone}</div>
            </button>
          ))}
          {text && q === text && data.length === 0 && <div className="search-item faint">No matching patients</div>}
          {allowCreate && can('patients:write') && (
            <button type="button" className="search-item strong" onClick={() => setCreating(true)}>
              <UserPlus size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Register a new patient
            </button>
          )}
        </div>
      )}
      {creating && <PatientFormModal onClose={() => setCreating(false)} onSaved={(patient) => { setCreating(false); choose(patient) }} />}
    </div>
  )
}

function RemoteSelect({ field, value, onChange, invalid }) {
  const options = useOptions(field.endpoint, { params: field.params, label: field.optionLabel ?? 'name' })
  return (
    <select className={`input ${invalid ? 'invalid' : ''}`} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">{field.placeholder ?? 'Select…'}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function renderControl(field, value, onChange, invalid) {
  const className = `input ${invalid ? 'invalid' : ''}`
  switch (field.type) {
    case 'textarea':
      return <textarea className={className} rows={field.rows ?? 3} value={value ?? ''} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
    case 'select':
      return (
        <select className={className} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">{field.placeholder ?? 'Select…'}</option>
          {field.options.map((option) => {
            const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option]
            return (
              <option key={optionValue} value={optionValue}>
                {optionLabel}
              </option>
            )
          })}
        </select>
      )
    case 'remote':
      return <RemoteSelect field={field} value={value} onChange={onChange} invalid={invalid} />
    case 'patient':
      return <PatientPicker value={field.initial} onChange={onChange} invalid={invalid} allowCreate={field.allowCreate} />
    case 'money':
      return <input className={className} type="number" min="0" step="0.01" inputMode="decimal" value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
    case 'checkbox':
      return (
        <span className="check">
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /> {field.checkLabel}
        </span>
      )
    default:
      return <input className={className} type={field.type ?? 'text'} value={value ?? ''} placeholder={field.placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
  }
}

const initialValue = (field, initial) => {
  const value = initial?.[field.name] ?? field.defaultValue ?? ''
  if (field.type === 'money' && value !== '') return (Number(value) / 100).toFixed(2)
  return value
}
const submitValue = (field, value) => {
  if (field.type === 'money') return value === '' ? (field.required ? undefined : 0) : Math.round(Number(value) * 100)
  return value
}

/**
 * A complete create/edit dialog from a field list. Server validation errors appear
 * beside their fields; other failures appear at the top.
 */
export function FormModal({ title, fields, initial, onSubmit, onClose, submitLabel = 'Save', successMessage, size, intro, onError }) {
  const inputs = fields.filter((field) => !field.section)
  const [values, setValues] = useState(() => Object.fromEntries(inputs.map((field) => [field.name, initialValue(field, initial)])))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const action = useAction()

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const body = Object.fromEntries(inputs.map((field) => [field.name, submitValue(field, values[field.name])]))
      const missing = {}
      for (const field of inputs) {
        if (field.required && (body[field.name] === '' || body[field.name] == null)) missing[field.name] = 'Required'
      }
      if (Object.keys(missing).length) {
        setErrors(missing)
        return
      }
      const result = await action(() => onSubmit(body), successMessage)
      onClose(result)
    } catch (error) {
      if (error.fields) setErrors(error.fields)
      if (!onError?.(error) && !error.fields) setFormError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={() => onClose()}
      onSubmit={submit}
      size={size}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose()}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        </>
      }
    >
      {intro}
      <ErrorBox error={formError} />
      <div className="form-grid">
        {fields.map((field, index) =>
          field.section ? (
            <div className="form-section" key={`section-${index}`}>{field.section}</div>
          ) : (
            <Field key={field.name} group={field.type === 'patient'} label={field.label} required={field.required} error={errors[field.name]} help={field.help} className={field.span === 2 || field.type === 'textarea' ? 'span-2' : ''}>
              {renderControl(
                field,
                values[field.name],
                (value) => setValues((current) => ({ ...current, [field.name]: value })),
                Boolean(errors[field.name]),
              )}
            </Field>
          ),
        )}
      </div>
    </Modal>
  )
}

const PATIENT_FIELDS = [
  { section: 'Identity' },
  { name: 'first_name', label: 'First name', required: true },
  { name: 'last_name', label: 'Last name', required: true },
  { name: 'dob', label: 'Date of birth', type: 'date', required: true },
  { name: 'gender', label: 'Gender', type: 'select', required: true, options: [['male', 'Male'], ['female', 'Female'], ['other', 'Other']] },
  { name: 'national_id', label: 'National ID' },
  { name: 'marital_status', label: 'Marital status', type: 'select', options: ['Single', 'Married', 'Divorced', 'Widowed'] },
  { name: 'occupation', label: 'Occupation' },
  { section: 'Contact' },
  { name: 'phone', label: 'Phone', type: 'tel', required: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address' },
  { name: 'city', label: 'City' },
  { section: 'Emergency contact' },
  { name: 'emergency_name', label: 'Name' },
  { name: 'emergency_phone', label: 'Phone', type: 'tel' },
  { name: 'emergency_relation', label: 'Relationship' },
  { section: 'Medical' },
  { name: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { name: 'allergies', label: 'Allergies', type: 'textarea', rows: 2, placeholder: 'Separate with semicolons, e.g. Penicillin; latex', help: 'Prescriptions are checked against this list.' },
  { name: 'chronic_conditions', label: 'Chronic conditions', type: 'textarea', rows: 2 },
  { section: 'Insurance' },
  { name: 'insurance_provider', label: 'Provider' },
  { name: 'insurance_policy', label: 'Policy number' },
]

export function PatientFormModal({ patient, onClose, onSaved }) {
  const [duplicate, setDuplicate] = useState(null)
  const allowRef = useRef(false)
  const submit = (body) =>
    patient
      ? api.patch(`/patients/${patient.id}`, body)
      : api.post('/patients', { ...body, allow_duplicate: allowRef.current })
  return (
    <FormModal
      title={patient ? 'Edit patient' : 'Register patient'}
      size="wide"
      fields={PATIENT_FIELDS}
      initial={patient}
      submitLabel={patient ? 'Save changes' : duplicate ? 'Register anyway' : 'Register patient'}
      successMessage={patient ? 'Patient updated' : 'Patient registered'}
      onSubmit={submit}
      onClose={(result) => (result ? (onSaved ?? onClose)(result) : onClose())}
      onError={(error) => {
        if (error.data?.duplicate) {
          setDuplicate(error.data.duplicate)
          allowRef.current = true
          return true
        }
        return false
      }}
      intro={
        duplicate && (
          <div className="warn-box">
            <div>
              Possible duplicate: <strong>{duplicate.first_name} {duplicate.last_name}</strong> ({duplicate.mrn}), {duplicate.phone}.{' '}
              Check this is a different person before registering.
            </div>
          </div>
        )
      }
    />
  )
}
