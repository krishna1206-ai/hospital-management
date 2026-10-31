import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AllergyStrip } from '../components/clinical.jsx'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, Empty, ErrorBox, Modal, PageHeader, Spinner, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDate, fmtDateTime, toDateInput, addDays, words } from '../lib/format.js'
import { useAction, useCan, useList, useMoney, useOptions, useTab } from '../lib/hooks.js'

function DispenseModal({ rx, onClose }) {
  const action = useAction()
  const money = useMoney()
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(rx.items.map((item) => [item.id, Math.min(item.quantity - item.dispensed_qty, item.in_stock)])),
  )
  const [error, setError] = useState(null)
  const total = rx.items.reduce((sum, item) => sum + (Number(quantities[item.id]) || 0) * item.unit_price_cents, 0)
  const submit = async (event) => {
    event.preventDefault()
    setError(null)
    try {
      await action(
        () => api.post(`/pharmacy/prescriptions/${rx.id}/dispense`, { items: rx.items.map((item) => ({ item_id: item.id, quantity: Number(quantities[item.id]) || 0 })) }),
        'Dispensed and charged to the patient',
      )
      onClose()
    } catch (failure) {
      setError(failure)
    }
  }
  return (
    <Modal
      title={`Dispense for ${rx.patient_name}`}
      size="wide"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <span className="grow muted" style={{ alignSelf: 'center' }}>Total to charge: <strong className="num">{money(total)}</strong></span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Dispense</button>
        </>
      }
    >
      <ErrorBox error={error} />
      {rx.allergy_override === 1 && <div className="error-box"><strong>Allergy override.</strong> The prescriber overrode an allergy warning. Confirm with them before dispensing.</div>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Medicine</th><th>Directions</th><th className="right">Remaining</th><th className="right">In stock</th><th style={{ width: 110 }}>Dispense</th></tr>
          </thead>
          <tbody>
            {rx.items.map((item) => {
              const remaining = item.quantity - item.dispensed_qty
              return (
                <tr key={item.id}>
                  <td><span className="strong">{item.medicine_name}</span> <span className="faint">{item.strength} {item.form}</span></td>
                  <td>{item.dose}, {item.frequency.toLowerCase()}{item.instructions ? `. ${item.instructions}` : ''}</td>
                  <td className="right num">{remaining}</td>
                  <td className="right num">{item.in_stock}</td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      max={remaining}
                      aria-label={`Quantity of ${item.medicine_name}`}
                      value={quantities[item.id]}
                      disabled={remaining === 0}
                      onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="faint">Stock is taken from the batch that expires first. Expired batches are never used.</p>
    </Modal>
  )
}

function Queue() {
  const can = useCan()
  const [dispensing, setDispensing] = useState(null)
  const list = useList('/clinical/prescriptions', { filters: { status: 'active,partial' }, refetchInterval: 30000, enabled: can('prescriptions:read') })
  if (list.isLoading) return <Spinner />
  if (list.isError) return <ErrorBox error={list.error} />
  const rows = list.data?.rows ?? []
  return (
    <Card flush>
      {rows.length === 0 && <Empty title="No prescriptions waiting" />}
      <div className="timeline">
        {rows.map((rx) => (
          <div key={rx.id} style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="queue-row" style={{ borderBottom: 0, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 240 }}>
                <Link to={`/patients/${rx.patient_id}`} className="strong" style={{ color: 'inherit' }}>{rx.patient_name}</Link> <span className="faint num">{rx.mrn}</span>
                <div className="faint">{rx.doctor_name} · {fmtDateTime(rx.created_at)}</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {rx.items.map((item) => (
                    <li key={item.id}>
                      {item.medicine_name} {item.strength} <span className="faint">× {item.quantity}{item.dispensed_qty ? ` (${item.dispensed_qty} given)` : ''}{item.in_stock < item.quantity - item.dispensed_qty ? `, only ${item.in_stock} in stock` : ''}</span>
                    </li>
                  ))}
                </ul>
                {rx.notes && <div className="muted" style={{ marginTop: 4 }}>Note: {rx.notes}</div>}
              </div>
              <div className="actions">
                <Badge value={rx.status} />
                {can('pharmacy:dispense') && <button className="btn sm primary" onClick={() => setDispensing(rx)}>Dispense</button>}
              </div>
            </div>
            <AllergyStrip allergies={rx.patient_allergies} />
          </div>
        ))}
      </div>
      {dispensing && <DispenseModal rx={dispensing} onClose={() => setDispensing(null)} />}
    </Card>
  )
}

const MEDICINE_FIELDS = [
  { name: 'name', label: 'Brand / display name', required: true },
  { name: 'generic_name', label: 'Generic name', help: 'Used for the allergy check.' },
  { name: 'form', label: 'Form', type: 'select', options: ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Inhaler', 'IV Fluid', 'Cream', 'Drops'] },
  { name: 'strength', label: 'Strength', placeholder: '500 mg' },
  { name: 'category', label: 'Category' },
  { name: 'manufacturer', label: 'Manufacturer' },
  { name: 'unit_price_cents', label: 'Unit price', type: 'money', required: true },
  { name: 'reorder_level', label: 'Reorder level', type: 'number', required: true, defaultValue: 20 },
]

function Medicines() {
  const can = useCan()
  const money = useMoney()
  const [low, setLow] = useState(false)
  const [editing, setEditing] = useState(null)
  const list = useList('/pharmacy/medicines', { filters: { low: low ? 1 : undefined } })
  return (
    <Card flush title="Medicine catalog" actions={can('pharmacy:write') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add medicine</button>}>
      <DataTable
        list={list}
        searchPlaceholder="Search name, generic or category"
        onRowClick={can('pharmacy:write') ? setEditing : undefined}
        toolbar={<label className="check"><input type="checkbox" checked={low} onChange={(event) => { setLow(event.target.checked); list.resetPage() }} /> Low stock only</label>}
        columns={[
          { key: 'name', label: 'Medicine', render: (row) => <><div className="strong">{row.name} {row.strength}</div><div className="faint">{row.generic_name}</div></> },
          { key: 'form', label: 'Form' },
          { key: 'category', label: 'Category' },
          { key: 'unit_price_cents', label: 'Price', align: 'right', render: (row) => money(row.unit_price_cents) },
          { key: 'in_stock', label: 'In stock', align: 'right', render: (row) => <span className="strong">{row.in_stock}</span> },
          { key: 'level', label: 'Level', render: (row) => (row.in_stock <= row.reorder_level ? <Badge tone="bad" label="Reorder" /> : <Badge tone="good" label="OK" />) },
          { key: 'next_expiry', label: 'Next expiry', render: (row) => <span className="nowrap">{fmtDate(row.next_expiry)}</span> },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add medicine'}
          fields={MEDICINE_FIELDS}
          initial={editing}
          successMessage="Medicine saved"
          onSubmit={(body) => (editing.id ? api.patch(`/pharmacy/medicines/${editing.id}`, body) : api.post('/pharmacy/medicines', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

function Batches() {
  const can = useCan()
  const money = useMoney()
  const [expiring, setExpiring] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [adjusting, setAdjusting] = useState(null)
  const list = useList('/pharmacy/batches', { filters: { expiring_days: expiring ? 90 : undefined } })
  const today = toDateInput()
  const soon = addDays(today, 60)
  const medicines = useOptions('/pharmacy/medicines', { label: (row) => `${row.name} ${row.strength ?? ''}` })
  return (
    <Card flush title="Stock batches" actions={can('pharmacy:write') && <button className="btn sm primary" onClick={() => setReceiving(true)}><Plus /> Receive stock</button>}>
      <DataTable
        list={list}
        searchPlaceholder="Search medicine or batch"
        toolbar={<label className="check"><input type="checkbox" checked={expiring} onChange={(event) => { setExpiring(event.target.checked); list.resetPage() }} /> Expiring within 90 days</label>}
        columns={[
          { key: 'medicine_name', label: 'Medicine', render: (row) => <span className="strong">{row.medicine_name} {row.strength}</span> },
          { key: 'batch_no', label: 'Batch', render: (row) => <span className="num">{row.batch_no}</span> },
          { key: 'supplier_name', label: 'Supplier' },
          { key: 'quantity', label: 'Quantity', align: 'right' },
          { key: 'cost_cents', label: 'Unit cost', align: 'right', render: (row) => money(row.cost_cents) },
          {
            key: 'expiry_date',
            label: 'Expiry',
            render: (row) => (
              <span className="actions nowrap" style={{ flexWrap: 'nowrap' }}>
                {fmtDate(row.expiry_date)}
                {row.expiry_date < today ? <Badge tone="bad" label="Expired" /> : row.expiry_date <= soon ? <Badge tone="warn" label="Soon" /> : null}
              </span>
            ),
          },
          { key: 'actions', label: '', render: (row) => can('pharmacy:write') && <button className="btn ghost sm" onClick={() => setAdjusting(row)}>Adjust</button> },
        ]}
      />
      {receiving && (
        <FormModal
          title="Receive stock"
          fields={[
            { name: 'medicine_id', label: 'Medicine', type: 'select', options: medicines.map((option) => [option.value, option.label]), required: true, span: 2 },
            { name: 'batch_no', label: 'Batch number', required: true },
            { name: 'expiry_date', label: 'Expiry date', type: 'date', required: true },
            { name: 'quantity', label: 'Quantity', type: 'number', required: true },
            { name: 'cost_cents', label: 'Unit cost', type: 'money' },
            { name: 'supplier_id', label: 'Supplier', type: 'remote', endpoint: '/pharmacy/suppliers', span: 2 },
          ]}
          submitLabel="Receive"
          successMessage="Stock received"
          onSubmit={(body) => api.post('/pharmacy/batches', body)}
          onClose={() => setReceiving(false)}
        />
      )}
      {adjusting && (
        <FormModal
          title={`Adjust ${adjusting.medicine_name}, batch ${adjusting.batch_no}`}
          size="narrow"
          intro={<p className="muted">{adjusting.quantity} units in this batch. Use a negative number to remove stock.</p>}
          fields={[
            { name: 'delta', label: 'Change', type: 'number', required: true, span: 2 },
            { name: 'kind', label: 'Type', type: 'select', defaultValue: 'adjust', span: 2, options: [['adjust', 'Stock correction'], ['expire', 'Expired write-off']] },
            { name: 'reason', label: 'Reason', required: true, span: 2 },
          ]}
          submitLabel="Apply"
          successMessage="Stock adjusted"
          onSubmit={(body) => api.post(`/pharmacy/batches/${adjusting.id}/adjust`, body)}
          onClose={() => setAdjusting(null)}
        />
      )}
    </Card>
  )
}

function Movements() {
  const list = useList('/pharmacy/movements')
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search medicine, batch or reference"
        columns={[
          { key: 'created_at', label: 'When', render: (row) => <span className="nowrap">{fmtDateTime(row.created_at)}</span> },
          { key: 'medicine_name', label: 'Medicine', render: (row) => <span className="strong">{row.medicine_name}</span> },
          { key: 'batch_no', label: 'Batch' },
          { key: 'kind', label: 'Type', render: (row) => <span style={{ textTransform: 'capitalize' }}>{words(row.kind)}</span> },
          { key: 'quantity', label: 'Quantity', align: 'right', render: (row) => (row.quantity > 0 ? `+${row.quantity}` : row.quantity) },
          { key: 'reference', label: 'Reference' },
          { key: 'user_name', label: 'By' },
        ]}
      />
    </Card>
  )
}

function Suppliers() {
  const can = useCan()
  const [editing, setEditing] = useState(null)
  const list = useList('/pharmacy/suppliers')
  return (
    <Card flush title="Suppliers" actions={can('pharmacy:write') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add supplier</button>}>
      <DataTable
        list={list}
        searchPlaceholder="Search suppliers"
        onRowClick={can('pharmacy:write') ? setEditing : undefined}
        columns={[
          { key: 'name', label: 'Supplier', render: (row) => <span className="strong">{row.name}</span> },
          { key: 'contact_person', label: 'Contact' },
          { key: 'phone', label: 'Phone' },
          { key: 'email', label: 'Email' },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add supplier'}
          fields={[
            { name: 'name', label: 'Name', required: true, span: 2 },
            { name: 'contact_person', label: 'Contact person' },
            { name: 'phone', label: 'Phone', type: 'tel' },
            { name: 'email', label: 'Email', type: 'email' },
            { name: 'address', label: 'Address' },
          ]}
          initial={editing}
          successMessage="Supplier saved"
          onSubmit={(body) => (editing.id ? api.patch(`/pharmacy/suppliers/${editing.id}`, body) : api.post('/pharmacy/suppliers', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

export default function Pharmacy() {
  const [tab, setTab] = useTab('queue')
  const { data: pending } = useQuery({ queryKey: ['/clinical/prescriptions', { status: 'active,partial', pageSize: 1 }] })
  return (
    <>
      <PageHeader title="Pharmacy" subtitle={pending ? `${pending.total} prescription${pending.total === 1 ? '' : 's'} waiting` : ' '} />
      <Tabs
        tabs={[
          { value: 'queue', label: 'Dispensing queue' },
          { value: 'medicines', label: 'Medicines' },
          { value: 'batches', label: 'Stock batches' },
          { value: 'movements', label: 'Stock history' },
          { value: 'suppliers', label: 'Suppliers' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'queue' && <Queue />}
      {tab === 'medicines' && <Medicines />}
      {tab === 'batches' && <Batches />}
      {tab === 'movements' && <Movements />}
      {tab === 'suppliers' && <Suppliers />}
    </>
  )
}
