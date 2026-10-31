import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BrandMark } from '../components/Layout.jsx'
import { Field } from '../components/forms.jsx'
import { ErrorBox, Warn } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/hooks.js'

const DEMO_ACCOUNTS = [
  ['Administrator', 'admin@hospital.test'],
  ['Doctor', 'doctor@hospital.test'],
  ['Nurse', 'nurse@hospital.test'],
  ['Reception', 'reception@hospital.test'],
  ['Pharmacist', 'pharmacy@hospital.test'],
  ['Lab technician', 'lab@hospital.test'],
  ['Accountant', 'billing@hospital.test'],
]
const DEMO_PASSWORD = 'Hospital@2026'

export function Login() {
  const client = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [fields, setFields] = useState({})
  const [busy, setBusy] = useState(false)

  const signIn = async (emailValue, passwordValue) => {
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const { user } = await api.post('/auth/login', { email: emailValue, password: passwordValue })
      client.setQueryData(['/auth/me'], { user })
    } catch (failure) {
      if (failure.fields) setFields(failure.fields)
      else setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-side">
        <div className="brand" style={{ padding: 0 }}>
          <BrandMark />
          <span className="brand-name" style={{ fontSize: 16 }}>Meridian HMS</span>
        </div>
        <div>
          <h1>One record for every patient, ward and invoice.</h1>
          <p>From registration to discharge, every department works from the same live information.</p>
        </div>
        <div className="auth-points">
          <div><strong>Clinical</strong> Visits, notes, vitals, prescriptions and results</div>
          <div><strong>Inpatient</strong> Live bed board, transfers and discharge</div>
          <div><strong>Services</strong> Lab, pharmacy, blood bank and theatre</div>
          <div><strong>Finance</strong> Automatic charges, invoices and claims</div>
        </div>
      </div>
      <div className="auth-form">
        <form
          className="auth-card"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            signIn(email, password)
          }}
        >
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 650 }}>Sign in</h2>
            <p className="muted">Use your hospital staff account.</p>
          </div>
          <ErrorBox error={error} />
          <Field label="Email" error={fields.email}>
            <input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Password" error={fields.password}>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <button className="btn primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {import.meta.env.VITE_DEMO && (
            <Warn>Demo site with public passwords. Never enter real patient information. Data resets without notice.</Warn>
          )}
          {(import.meta.env.DEV || import.meta.env.VITE_DEMO) && (
            <div>
              <div className="faint" style={{ marginBottom: 6 }}>Demo accounts</div>
              <div className="demo-list">
                {DEMO_ACCOUNTS.map(([label, account]) => (
                  <button type="button" key={account} className="btn sm" disabled={busy} onClick={() => signIn(account, DEMO_PASSWORD)}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

export function PasswordForm({ onDone, submitLabel = 'Change password' }) {
  const [values, setValues] = useState({ current_password: '', new_password: '', confirm: '' })
  const [fields, setFields] = useState({})
  const [error, setError] = useState(null)
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    setFields({})
    setError(null)
    if (values.new_password !== values.confirm) {
      setFields({ confirm: 'The passwords do not match' })
      return
    }
    try {
      await api.post('/auth/change-password', { current_password: values.current_password, new_password: values.new_password })
      setValues({ current_password: '', new_password: '', confirm: '' })
      onDone()
    } catch (failure) {
      if (failure.fields) setFields(failure.fields)
      else setError(failure)
    }
  }
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit} noValidate>
      <ErrorBox error={error} />
      <Field label="Current password" error={fields.current_password}>
        <input className="input" type="password" autoComplete="current-password" value={values.current_password} onChange={set('current_password')} />
      </Field>
      <Field label="New password" error={fields.new_password} help="At least 10 characters, with a letter and a number.">
        <input className="input" type="password" autoComplete="new-password" value={values.new_password} onChange={set('new_password')} />
      </Field>
      <Field label="Confirm new password" error={fields.confirm}>
        <input className="input" type="password" autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />
      </Field>
      <div><button className="btn primary">{submitLabel}</button></div>
    </form>
  )
}

export function ForcePasswordChange() {
  const client = useQueryClient()
  const { user, signOut } = useAuth()
  return (
    <div className="auth-form" style={{ minHeight: '100%' }}>
      <div className="auth-card">
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 650 }}>Set your password</h2>
          <p className="muted">{user.name}, you're using a temporary password. Choose your own to continue.</p>
        </div>
        <PasswordForm submitLabel="Save and continue" onDone={() => client.invalidateQueries({ queryKey: ['/auth/me'] })} />
        <button type="button" className="btn ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
