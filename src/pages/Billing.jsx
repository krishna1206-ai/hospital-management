import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field, FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, ErrorBox, Modal, PageHeader, Spinner, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { addDays, fmtDate, toDateInput, words } from '../lib/format.js'
import { useAction, useCan, useList, useMoney, useOptions, useSettings, useTab } from '../lib/hooks.js'

function Invoices() {
  const money = useMoney()
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const list = useList('/billing/invoices', { filters: { status } })
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search invoice, patient or MRN"
        onRowClick={(row) => navigate(`/billing/invoices/${row.id}`)}
        toolbar={
          <select className="input" aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); list.resetPage() }}>
            <option value="">All invoices</option>
            <option value="unpaid,partial">Outstanding</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
        }
        columns={[
          { key: 'invoice_no', label: 'Invoice', render: (row) => <span className="num strong nowrap">{row.invoice_no}</span> },
          { key: 'patient', label: 'Patient', render: (row) => <><div className="strong">{row.patient_name}</div><div className="faint num">{row.mrn}</div></> },
          { key: 'created_at', label: 'Date', render: (row) => <span className="nowrap">{fmtDate(row.created_at)}</span> },
          { key: 'total_cents', label: 'Total', align: 'right', render: (row) => money(row.total_cents) },
          { key: 'paid_cents', label: 'Paid', align: 'right', render: (row) => money(row.paid_cents) },
          { key: 'balance_cents', label: 'Balance', align: 'right', render: (row) => <span className="strong">{money(row.status === 'void' ? 0 : row.balance_cents)}</span> },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
        ]}
      />
    </Card>
  )
}

function CreateInvoiceModal({ patient, onClose }) {
  const money = useMoney()
  const settings = useSettings()
  const action = useAction()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['/billing/charges', { patient_id: patient.patient_id, unbilled: 1, pageSize: 100 }] })
  const charges = data?.rows ?? []
  const [excluded, setExcluded] = useState(() => new Set())
  const [discount, setDiscount] = useState('')
  const [dueDate, setDueDate] = useState(() => addDays(toDateInput(), 30))
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)
  const services = useOptions('/billing/services', { label: (row) => `${row.name} (${money(row.price_cents)})` })

  const chosen = charges.filter((charge) => !excluded.has(charge.id))
  const subtotal = chosen.reduce((sum, charge) => sum + charge.amount_cents, 0)
  const discountCents = Math.round((Number(discount) || 0) * 100)
  const tax = Math.round(((subtotal - discountCents) * Number(settings.tax_percent || 0)) / 100)

  const toggle = (id) =>
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    try {
      const invoice = await action(
        () => api.post('/billing/invoices', { patient_id: patient.patient_id, charge_ids: chosen.map((charge) => charge.id), discount_cents: discountCents, due_date: dueDate, notes }),
        'Invoice created',
      )
      navigate(`/billing/invoices/${invoice.id}`)
    } catch (failure) {
      setError(failure.fields?.charge_ids ? new Error(failure.fields.charge_ids) : failure)
    }
  }

  return (
    <Modal
      title={`New invoice: ${patient.patient_name}`}
      size="wide"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!chosen.length}>Create invoice</button>
        </>
      }
    >
      <ErrorBox error={error} />
      {isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th style={{ width: 32 }} /><th>Charge</th><th>Type</th><th className="right">Qty</th><th className="right">Amount</th><th /></tr>
            </thead>
            <tbody>
              {charges.map((charge) => (
                <tr key={charge.id}>
                  <td><input type="checkbox" aria-label={`Include ${charge.description}`} checked={!excluded.has(charge.id)} onChange={() => toggle(charge.id)} /></td>
                  <td>{charge.description}<div className="faint">{fmtDate(charge.created_at)}</div></td>
                  <td style={{ textTransform: 'capitalize' }}>{charge.kind}</td>
                  <td className="right num">{charge.quantity}</td>
                  <td className="right num">{money(charge.amount_cents)}</td>
                  <td>
                    {(!charge.source_type || charge.source_type === 'service') && (
                      <button type="button" className="icon-btn" aria-label={`Remove ${charge.description}`} onClick={() => action(() => api.delete(`/billing/charges/${charge.id}`), 'Charge removed')}><Trash2 /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div><button type="button" className="btn sm" onClick={() => setAdding(true)}><Plus /> Add service or charge</button></div>
      <div className="form-grid">
        <Field label="Discount"><input className="input" type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} /></Field>
        <Field label="Due date"><input className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
        <Field label="Notes" className="span-2"><input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      </div>
      <div className="totals" style={{ marginTop: 0 }}>
        <div><span>Subtotal</span><span className="num">{money(subtotal)}</span></div>
        {discountCents > 0 && <div><span>Discount</span><span className="num">−{money(discountCents)}</span></div>}
        {tax > 0 && <div><span>{settings.tax_label || 'Tax'} ({settings.tax_percent}%)</span><span className="num">{money(tax)}</span></div>}
        <div className="grand"><span>Total</span><span className="num">{money(subtotal - discountCents + tax)}</span></div>
      </div>
      {adding && (
        <FormModal
          title="Add charge"
          size="narrow"
          intro={<p className="muted">Choose a listed service, or enter a description and price.</p>}
          fields={[
            { name: 'service_id', label: 'Service', type: 'select', options: services.map((option) => [option.value, option.label]), span: 2 },
            { name: 'description', label: 'Or a description', span: 2 },
            { name: 'unit_price_cents', label: 'Price', type: 'money' },
            { name: 'quantity', label: 'Quantity', type: 'number', defaultValue: 1 },
          ]}
          submitLabel="Add charge"
          onSubmit={(body) =>
            api.post('/billing/charges', {
              patient_id: patient.patient_id,
              service_id: body.service_id,
              description: body.description,
              quantity: body.quantity,
              // The price field defaults to 0, which must not override a chosen service's price.
              unit_price_cents: body.service_id && !body.unit_price_cents ? undefined : body.unit_price_cents,
            })
          }
          onClose={() => setAdding(false)}
        />
      )}
    </Modal>
  )
}

function Unbilled() {
  const money = useMoney()
  const can = useCan()
  const [invoicing, setInvoicing] = useState(null)
  const list = useList('/billing/unbilled')
  return (
    <Card flush>
      <DataTable
        list={list}
        rowKey="patient_id"
        searchPlaceholder="Search patient or MRN"
        emptyTitle="Everything has been invoiced"
        columns={[
          { key: 'patient', label: 'Patient', render: (row) => <><div className="strong">{row.patient_name}</div><div className="faint num">{row.mrn}</div></> },
          { key: 'charge_count', label: 'Charges', align: 'right' },
          { key: 'amount_cents', label: 'Amount', align: 'right', render: (row) => <span className="strong">{money(row.amount_cents)}</span> },
          { key: 'oldest_at', label: 'Oldest charge', render: (row) => fmtDate(row.oldest_at) },
          { key: 'admission_id', label: 'Status', render: (row) => (row.admission_id ? <Badge tone="info" label="Still admitted" /> : <span className="faint">Outpatient</span>) },
          { key: 'actions', label: '', render: (row) => can('billing:write') && <button className="btn sm primary" onClick={() => setInvoicing(row)}>Create invoice</button> },
        ]}
      />
      {invoicing && <CreateInvoiceModal patient={invoicing} onClose={() => setInvoicing(null)} />}
    </Card>
  )
}

function Claims() {
  const money = useMoney()
  const can = useCan()
  const action = useAction()
  const navigate = useNavigate()
  const [deciding, setDeciding] = useState(null)
  const [status, setStatus] = useState('')
  const list = useList('/billing/claims', { filters: { status } })
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search claim, insurer or invoice"
        emptyTitle="No insurance claims"
        emptyText="Submit a claim from an invoice."
        onRowClick={(row) => navigate(`/billing/invoices/${row.invoice_id}`)}
        toolbar={
          <select className="input" aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); list.resetPage() }}>
            <option value="">All claims</option>
            {['submitted', 'approved', 'rejected', 'paid'].map((value) => <option key={value} value={value}>{words(value)}</option>)}
          </select>
        }
        columns={[
          { key: 'claim_no', label: 'Claim', render: (row) => <span className="num strong nowrap">{row.claim_no}</span> },
          { key: 'patient_name', label: 'Patient' },
          { key: 'provider', label: 'Insurer' },
          { key: 'invoice_no', label: 'Invoice', render: (row) => <span className="num nowrap">{row.invoice_no}</span> },
          { key: 'claimed_cents', label: 'Claimed', align: 'right', render: (row) => money(row.claimed_cents) },
          { key: 'approved_cents', label: 'Approved', align: 'right', render: (row) => (row.approved_cents != null ? money(row.approved_cents) : '—') },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} tone={row.status === 'approved' ? 'info' : undefined} /> },
          {
            key: 'actions',
            label: '',
            render: (row) => can('claims:write') && (
              <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }} onClick={(event) => event.stopPropagation()}>
                {row.status === 'submitted' && <button className="btn sm" onClick={() => setDeciding(row)}>Record decision</button>}
                {row.status === 'approved' && <button className="btn sm primary" onClick={() => action(() => api.post(`/billing/claims/${row.id}/settle`), 'Remittance recorded as a payment')}>Record remittance</button>}
              </div>
            ),
          },
        ]}
      />
      {deciding && (
        <FormModal
          title={`Decision on ${deciding.claim_no}`}
          size="narrow"
          fields={[
            { name: 'status', label: 'Decision', type: 'select', required: true, span: 2, options: [['approved', 'Approved'], ['rejected', 'Rejected']] },
            { name: 'approved_cents', label: 'Approved amount', type: 'money', span: 2, help: `Claimed: ${money(deciding.claimed_cents)}` },
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
          ]}
          initial={{ approved_cents: deciding.claimed_cents }}
          submitLabel="Save decision"
          successMessage="Decision recorded"
          onSubmit={(body) => api.post(`/billing/claims/${deciding.id}/decide`, body)}
          onClose={() => setDeciding(null)}
        />
      )}
    </Card>
  )
}

function Services() {
  const money = useMoney()
  const can = useCan()
  const [editing, setEditing] = useState(null)
  const list = useList('/billing/services', { pageSize: 50 })
  return (
    <Card flush title="Service price list" actions={can('services:write') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add service</button>}>
      <DataTable
        list={list}
        searchPlaceholder="Search services"
        onRowClick={can('services:write') ? setEditing : undefined}
        columns={[
          { key: 'code', label: 'Code', render: (row) => <span className="num strong">{row.code}</span> },
          { key: 'name', label: 'Service' },
          { key: 'category', label: 'Category' },
          { key: 'price_cents', label: 'Price', align: 'right', render: (row) => money(row.price_cents) },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add service'}
          fields={[
            { name: 'code', label: 'Code', required: true },
            { name: 'name', label: 'Name', required: true },
            { name: 'category', label: 'Category' },
            { name: 'price_cents', label: 'Price', type: 'money', required: true },
          ]}
          initial={editing}
          successMessage="Service saved"
          onSubmit={(body) => (editing.id ? api.patch(`/billing/services/${editing.id}`, body) : api.post('/billing/services', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

export default function Billing() {
  const [tab, setTab] = useTab('invoices')
  return (
    <>
      <PageHeader title="Billing" subtitle="Clinical departments post charges automatically. Roll them onto invoices here." />
      <Tabs
        tabs={[
          { value: 'invoices', label: 'Invoices' },
          { value: 'unbilled', label: 'Ready to invoice' },
          { value: 'claims', label: 'Insurance claims' },
          { value: 'services', label: 'Price list' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'invoices' && <Invoices />}
      {tab === 'unbilled' && <Unbilled />}
      {tab === 'claims' && <Claims />}
      {tab === 'services' && <Services />}
    </>
  )
}
