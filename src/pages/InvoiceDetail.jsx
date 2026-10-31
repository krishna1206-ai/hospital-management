import { useQuery } from '@tanstack/react-query'
import { Ban, CreditCard, FileCheck2, Printer } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDate, fmtDateTime, words } from '../lib/format.js'
import { useCan, useMoney, useSettings } from '../lib/hooks.js'

const METHODS = [['cash', 'Cash'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['mobile', 'Mobile payment']]

export default function InvoiceDetail() {
  const { id } = useParams()
  const can = useCan()
  const money = useMoney()
  const settings = useSettings()
  const [modal, setModal] = useState(null)
  const { data: invoice, isLoading, error } = useQuery({ queryKey: [`/billing/invoices/${id}`] })
  if (isLoading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const isVoid = invoice.status === 'void'
  const balance = isVoid ? 0 : invoice.balance_cents
  const openClaim = invoice.claims.some((claim) => ['submitted', 'approved'].includes(claim.status))

  return (
    <div className="stack">
      <PageHeader title={invoice.invoice_no} back={{ to: '/billing', label: 'Billing' }}>
        <button className="btn" onClick={() => window.print()}><Printer /> Print</button>
        {can('billing:void') && !isVoid && invoice.paid_cents === 0 && <button className="btn danger" onClick={() => setModal('void')}><Ban /> Void</button>}
        {can('claims:write') && balance > 0 && !openClaim && <button className="btn" onClick={() => setModal('claim')}><FileCheck2 /> Submit claim</button>}
        {can('billing:write') && balance > 0 && <button className="btn primary" onClick={() => setModal('pay')}><CreditCard /> Take payment</button>}
      </PageHeader>

      <Card flush>
        <div className="doc">
          <div className="doc-head">
            <div>
              <div className="doc-title">{settings.hospital_name}</div>
              <div className="muted">{settings.hospital_address}</div>
              <div className="muted">{settings.hospital_phone} · {settings.hospital_email}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="doc-title">Invoice</div>
              <div className="num strong">{invoice.invoice_no}</div>
              <div className="muted">Issued {fmtDate(invoice.created_at)}</div>
              {invoice.due_date && <div className="muted">Due {fmtDate(invoice.due_date)}</div>}
              <div style={{ marginTop: 4 }}><Badge value={invoice.status} /></div>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div className="field-label">Bill to</div>
            <Link to={`/patients/${invoice.patient_id}`} className="strong" style={{ color: 'inherit' }}>{invoice.patient_name}</Link>
            <div className="muted num">{invoice.mrn} · {invoice.patient_phone}</div>
            {invoice.patient_address && <div className="muted">{invoice.patient_address}</div>}
            {invoice.insurance_provider && <div className="muted">Insurance: {invoice.insurance_provider} {invoice.insurance_policy}</div>}
          </div>
          {isVoid && <div className="error-box" style={{ marginBottom: 12 }}>This invoice is void{invoice.void_reason ? `: ${invoice.void_reason}` : ''}. Its charges have returned to "Ready to invoice".</div>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Description</th><th>Type</th><th className="right">Qty</th><th className="right">Unit price</th><th className="right">Amount</th></tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td style={{ textTransform: 'capitalize' }}>{item.kind}</td>
                    <td className="right num">{item.quantity}</td>
                    <td className="right num">{money(item.unit_price_cents)}</td>
                    <td className="right num">{money(item.amount_cents)}</td>
                  </tr>
                ))}
                {invoice.items.length === 0 && <tr><td colSpan={5} className="muted">Charges were released when this invoice was voided.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="totals">
            <div><span>Subtotal</span><span className="num">{money(invoice.subtotal_cents)}</span></div>
            {invoice.discount_cents > 0 && <div><span>Discount</span><span className="num">−{money(invoice.discount_cents)}</span></div>}
            {invoice.tax_cents > 0 && <div><span>{settings.tax_label || 'Tax'}</span><span className="num">{money(invoice.tax_cents)}</span></div>}
            <div><span className="strong">Total</span><span className="num strong">{money(invoice.total_cents)}</span></div>
            <div><span>Paid</span><span className="num">−{money(invoice.paid_cents)}</span></div>
            <div className="grand"><span>Balance due</span><span className="num">{money(balance)}</span></div>
          </div>
          {invoice.notes && <p className="muted" style={{ marginTop: 12 }}>{invoice.notes}</p>}
        </div>
      </Card>

      {invoice.payments.length > 0 && (
        <Card title="Payments" flush>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Received by</th><th className="right">Amount</th></tr></thead>
              <tbody>
                {invoice.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="nowrap">{fmtDateTime(payment.created_at)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{words(payment.method)}</td>
                    <td>{payment.reference ?? '—'}</td>
                    <td>{payment.received_by_name ?? '—'}</td>
                    <td className="right num">{money(payment.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {invoice.claims.length > 0 && (
        <Card title="Insurance claims" flush>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Claim</th><th>Insurer</th><th className="right">Claimed</th><th className="right">Approved</th><th>Status</th></tr></thead>
              <tbody>
                {invoice.claims.map((claim) => (
                  <tr key={claim.id}>
                    <td className="num strong nowrap">{claim.claim_no}</td>
                    <td>{claim.provider}</td>
                    <td className="right num">{money(claim.claimed_cents)}</td>
                    <td className="right num">{claim.approved_cents != null ? money(claim.approved_cents) : '—'}</td>
                    <td><Badge value={claim.status} tone={claim.status === 'approved' ? 'info' : undefined} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {modal === 'pay' && (
        <FormModal
          title="Take payment"
          size="narrow"
          intro={<p className="muted">Balance due: <strong className="num">{money(balance)}</strong></p>}
          fields={[
            { name: 'amount_cents', label: 'Amount', type: 'money', required: true, span: 2 },
            { name: 'method', label: 'Method', type: 'select', options: METHODS, required: true, span: 2 },
            { name: 'reference', label: 'Reference', span: 2, help: 'Card slip, transfer or transaction number.' },
          ]}
          initial={{ amount_cents: balance, method: 'cash' }}
          submitLabel="Record payment"
          successMessage="Payment recorded"
          onSubmit={(body) => api.post(`/billing/invoices/${invoice.id}/payments`, body)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'void' && (
        <FormModal
          title={`Void ${invoice.invoice_no}?`}
          size="narrow"
          intro={<p className="muted">The invoice stays on record as void, and its charges return to "Ready to invoice".</p>}
          fields={[{ name: 'reason', label: 'Reason', type: 'textarea', required: true, rows: 2 }]}
          submitLabel="Void invoice"
          successMessage="Invoice voided"
          onSubmit={(body) => api.post(`/billing/invoices/${invoice.id}/void`, body)}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'claim' && (
        <FormModal
          title="Submit insurance claim"
          fields={[
            { name: 'provider', label: 'Insurer', required: true },
            { name: 'policy_no', label: 'Policy number' },
            { name: 'claimed_cents', label: 'Amount claimed', type: 'money', required: true, span: 2 },
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
          ]}
          initial={{ provider: invoice.insurance_provider, policy_no: invoice.insurance_policy, claimed_cents: balance }}
          submitLabel="Submit claim"
          successMessage="Claim submitted"
          onSubmit={(body) => api.post('/billing/claims', { ...body, invoice_id: invoice.id })}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
