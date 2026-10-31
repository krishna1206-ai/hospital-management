import { useState } from 'react'
import { Field } from '../components/forms.jsx'
import { Card, ErrorBox, PageHeader, Spinner } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useAction, useSettings } from '../lib/hooks.js'

function SettingsForm({ settings }) {
  const action = useAction()
  const [values, setValues] = useState({
    hospital_name: settings.hospital_name ?? '',
    hospital_address: settings.hospital_address ?? '',
    hospital_phone: settings.hospital_phone ?? '',
    hospital_email: settings.hospital_email ?? '',
    currency: settings.currency ?? 'USD',
    tax_percent: settings.tax_percent ?? '0',
    tax_label: settings.tax_label ?? 'Tax',
    er_fee: (Number(settings.er_fee_cents || 0) / 100).toFixed(2),
    blood_fee: (Number(settings.blood_unit_fee_cents || 0) / 100).toFixed(2),
  })
  const [fields, setFields] = useState({})
  const [error, setError] = useState(null)
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }))

  const save = async (event) => {
    event.preventDefault()
    setFields({})
    setError(null)
    const { er_fee: erFee, blood_fee: bloodFee, ...rest } = values
    try {
      await action(
        () =>
          api.patch('/settings', {
            ...rest,
            currency: values.currency.toUpperCase(),
            er_fee_cents: Math.round(Number(erFee) * 100),
            blood_unit_fee_cents: Math.round(Number(bloodFee) * 100),
          }),
        'Settings saved',
      )
    } catch (failure) {
      if (failure.fields) setFields(failure.fields)
      else setError(failure)
    }
  }

  return (
    <form className="stack" onSubmit={save} noValidate>
      <ErrorBox error={error} />
      <Card title="Hospital details" subtitle="Shown on invoices and printed documents">
        <div className="form-grid">
          <Field label="Name" error={fields.hospital_name}><input className="input" value={values.hospital_name} onChange={set('hospital_name')} /></Field>
          <Field label="Phone" error={fields.hospital_phone}><input className="input" value={values.hospital_phone} onChange={set('hospital_phone')} /></Field>
          <Field label="Address" error={fields.hospital_address}><input className="input" value={values.hospital_address} onChange={set('hospital_address')} /></Field>
          <Field label="Email" error={fields.hospital_email}><input className="input" type="email" value={values.hospital_email} onChange={set('hospital_email')} /></Field>
        </div>
      </Card>
      <Card title="Billing" subtitle="Applies to invoices created from now on">
        <div className="form-grid">
          <Field label="Currency code" error={fields.currency} help="3-letter code, e.g. USD, EUR, PKR, INR"><input className="input" maxLength={3} value={values.currency} onChange={set('currency')} /></Field>
          <Field label="Tax rate (%)" error={fields.tax_percent}><input className="input" type="number" min="0" max="100" step="0.01" value={values.tax_percent} onChange={set('tax_percent')} /></Field>
          <Field label="Tax label" error={fields.tax_label} help="e.g. VAT, GST"><input className="input" value={values.tax_label} onChange={set('tax_label')} /></Field>
          <Field label="Emergency attendance fee"><input className="input" type="number" min="0" step="0.01" value={values.er_fee} onChange={set('er_fee')} /></Field>
          <Field label="Blood unit fee"><input className="input" type="number" min="0" step="0.01" value={values.blood_fee} onChange={set('blood_fee')} /></Field>
        </div>
      </Card>
      <div><button className="btn primary">Save settings</button></div>
    </form>
  )
}

export default function SettingsPage() {
  const settings = useSettings()
  return (
    <>
      <PageHeader title="Settings" />
      {settings.currency ? <SettingsForm settings={settings} /> : <Spinner />}
    </>
  )
}
