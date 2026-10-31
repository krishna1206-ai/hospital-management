import { useQuery } from '@tanstack/react-query'
import { Plus, Printer } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FlagBadge } from '../components/clinical.jsx'
import { Field, FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, ErrorBox, Modal, PageHeader, Spinner, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { age, fmtDateTime, words } from '../lib/format.js'
import { useAction, useCan, useList, useMoney, useSettings, useTab } from '../lib/hooks.js'

const STATUSES = ['ordered', 'collected', 'in_progress', 'completed', 'cancelled']

function OrderModal({ orderId, onClose }) {
  const can = useCan()
  const settings = useSettings()
  const action = useAction()
  const { data: order, isLoading, error } = useQuery({ queryKey: [`/lab/orders/${orderId}`] })
  const [results, setResults] = useState({})
  const [formError, setFormError] = useState(null)

  if (isLoading) return <Modal title="Lab order" onClose={onClose}><Spinner /></Modal>
  if (error) return <Modal title="Lab order" onClose={onClose}><ErrorBox error={error} /></Modal>

  const canProcess = can('lab:process')
  const entering = canProcess && ['collected', 'in_progress'].includes(order.status)
  const set = (item, key, value) => setResults((current) => ({ ...current, [item.id]: { ...current[item.id], [key]: value } }))

  const saveResults = async () => {
    setFormError(null)
    const payload = Object.entries(results)
      .map(([itemId, value]) => ({ item_id: Number(itemId), result_value: value.result_value ?? '', result_text: value.result_text ?? '' }))
      .filter((row) => row.result_value !== '' || row.result_text)
    if (!payload.length) {
      setFormError(new Error('Enter at least one result'))
      return
    }
    try {
      await action(() => api.post(`/lab/orders/${order.id}/results`, { results: payload }), 'Results saved')
      setResults({})
    } catch (failure) {
      setFormError(failure)
    }
  }

  return (
    <Modal
      title={`Order ${order.order_no}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {order.status === 'completed' && <button className="btn" onClick={() => window.print()}><Printer /> Print report</button>}
          {order.status === 'ordered' && (can('lab:order') || canProcess) && (
            <button className="btn danger" onClick={() => action(() => api.post(`/lab/orders/${order.id}/cancel`), 'Order cancelled').then(onClose)}>Cancel order</button>
          )}
          {order.status === 'ordered' && canProcess && (
            <button className="btn primary" onClick={() => action(() => api.post(`/lab/orders/${order.id}/collect`), 'Sample collected')}>Mark sample collected</button>
          )}
          {entering && <button className="btn primary" onClick={saveResults}>Save results</button>}
        </>
      }
    >
      <div className="meta">
        <span className="strong">{order.patient_name}</span>
        <span className="num">{order.mrn}</span>
        <span style={{ textTransform: 'capitalize' }}>{age(order.patient_dob)} · {order.patient_gender}</span>
        <span>{order.doctor_name}</span>
      </div>
      <div className="meta">
        <Badge value={order.priority} />
        <Badge value={order.status} />
        <span>Ordered {fmtDateTime(order.created_at)}</span>
        {order.collected_at && <span>Collected {fmtDateTime(order.collected_at)}</span>}
        <span className="no-print">{settings.hospital_name}</span>
      </div>
      {order.notes && <div className="muted">Notes: {order.notes}</div>}
      <ErrorBox error={formError} />
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Test</th><th>Result</th><th>Reference range</th><th>Flag</th></tr>
          </thead>
          <tbody>
            {order.items.map((item) => {
              const done = item.result_value != null || item.result_text
              const numeric = item.category === 'laboratory' && item.ref_high != null
              return (
                <tr key={item.id}>
                  <td>
                    <div className="strong">{item.name}</div>
                    <div className="faint">{item.code}{item.specimen ? ` · ${item.specimen}` : ''}</div>
                  </td>
                  <td style={{ minWidth: 200 }}>
                    {entering && !done ? (
                      <Field>
                        {numeric ? (
                          <div className="actions" style={{ flexWrap: 'nowrap' }}>
                            <input className="input" type="number" step="any" aria-label={`Result for ${item.name}`} style={{ width: 110 }} value={results[item.id]?.result_value ?? ''} onChange={(event) => set(item, 'result_value', event.target.value)} />
                            <span className="muted">{item.unit}</span>
                          </div>
                        ) : (
                          <textarea className="input" rows={2} aria-label={`Findings for ${item.name}`} placeholder="Findings" value={results[item.id]?.result_text ?? ''} onChange={(event) => set(item, 'result_text', event.target.value)} />
                        )}
                      </Field>
                    ) : item.result_value != null ? (
                      <span className="num strong">{item.result_value} {item.unit}</span>
                    ) : (
                      <span className="note-text">{item.result_text || '—'}</span>
                    )}
                  </td>
                  <td className="num">{item.ref_low != null ? `${item.ref_low}–${item.ref_high} ${item.unit ?? ''}` : '—'}</td>
                  <td><FlagBadge flag={item.flag} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function Worklist() {
  const [status, setStatus] = useState('ordered,collected,in_progress')
  const [openId, setOpenId] = useState(null)
  const list = useList('/lab/orders', { filters: { status }, refetchInterval: 30000 })
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search order, patient or MRN"
        onRowClick={(row) => setOpenId(row.id)}
        emptyTitle="No orders here"
        toolbar={
          <select className="input" aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); list.resetPage() }}>
            <option value="ordered,collected,in_progress">Open work</option>
            <option value="">All orders</option>
            {STATUSES.map((value) => <option key={value} value={value}>{words(value)}</option>)}
          </select>
        }
        columns={[
          { key: 'order_no', label: 'Order', render: (row) => <span className="num strong nowrap">{row.order_no}</span> },
          { key: 'priority', label: 'Priority', render: (row) => <Badge value={row.priority} label={row.priority === 'stat' ? 'STAT' : undefined} /> },
          { key: 'patient', label: 'Patient', render: (row) => <><Link to={`/patients/${row.patient_id}`} onClick={(event) => event.stopPropagation()} className="strong">{row.patient_name}</Link><div className="faint num">{row.mrn}</div></> },
          { key: 'test_names', label: 'Tests' },
          { key: 'doctor_name', label: 'Ordered by' },
          { key: 'created_at', label: 'Ordered', render: (row) => <span className="nowrap">{fmtDateTime(row.created_at)}</span> },
          { key: 'status', label: 'Status', render: (row) => (row.critical_count > 0 ? <Badge tone="bad" label="Critical result" /> : <Badge value={row.status} />) },
        ]}
      />
      {openId && <OrderModal orderId={openId} onClose={() => setOpenId(null)} />}
    </Card>
  )
}

const TEST_FIELDS = [
  { name: 'code', label: 'Code', required: true },
  { name: 'name', label: 'Name', required: true },
  { name: 'category', label: 'Category', type: 'select', required: true, defaultValue: 'laboratory', options: [['laboratory', 'Laboratory'], ['radiology', 'Radiology']] },
  { name: 'specimen', label: 'Specimen' },
  { name: 'unit', label: 'Unit' },
  { name: 'turnaround_hours', label: 'Turnaround (hours)', type: 'number' },
  { name: 'ref_low', label: 'Reference low', type: 'number' },
  { name: 'ref_high', label: 'Reference high', type: 'number' },
  { name: 'critical_low', label: 'Critical low', type: 'number', help: 'Results at or below this alert the doctor.' },
  { name: 'critical_high', label: 'Critical high', type: 'number', help: 'Results at or above this alert the doctor.' },
  { name: 'price_cents', label: 'Price', type: 'money', required: true },
]

function Catalog() {
  const can = useCan()
  const money = useMoney()
  const [editing, setEditing] = useState(null)
  const list = useList('/lab/tests', { pageSize: 50 })
  return (
    <Card flush title="Test catalog" actions={can('lab:catalog') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add test</button>}>
      <DataTable
        list={list}
        searchPlaceholder="Search tests"
        onRowClick={can('lab:catalog') ? setEditing : undefined}
        columns={[
          { key: 'code', label: 'Code', render: (row) => <span className="num strong">{row.code}</span> },
          { key: 'name', label: 'Test' },
          { key: 'category', label: 'Category', render: (row) => <span style={{ textTransform: 'capitalize' }}>{row.category}</span> },
          { key: 'specimen', label: 'Specimen' },
          { key: 'range', label: 'Reference', render: (row) => (row.ref_low != null ? <span className="num">{row.ref_low}–{row.ref_high} {row.unit}</span> : '—') },
          { key: 'turnaround_hours', label: 'Turnaround', render: (row) => (row.turnaround_hours ? `${row.turnaround_hours} h` : '—') },
          { key: 'price_cents', label: 'Price', align: 'right', render: (row) => money(row.price_cents) },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add test'}
          fields={TEST_FIELDS}
          initial={editing}
          successMessage="Test saved"
          onSubmit={(body) => (editing.id ? api.patch(`/lab/tests/${editing.id}`, body) : api.post('/lab/tests', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

export default function Laboratory() {
  const [tab, setTab] = useTab('worklist')
  return (
    <>
      <PageHeader title="Laboratory" subtitle="Lab and radiology orders, most urgent first" />
      <Tabs tabs={[{ value: 'worklist', label: 'Worklist' }, { value: 'catalog', label: 'Test catalog' }]} value={tab} onChange={setTab} />
      {tab === 'worklist' ? <Worklist /> : <Catalog />}
    </>
  )
}
