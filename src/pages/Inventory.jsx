import { Plus } from 'lucide-react'
import { useState } from 'react'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, PageHeader, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDateTime } from '../lib/format.js'
import { useCan, useList, useTab } from '../lib/hooks.js'

function Items() {
  const can = useCan()
  const [low, setLow] = useState(false)
  const [editing, setEditing] = useState(null)
  const [moving, setMoving] = useState(null)
  const list = useList('/inventory/items', { filters: { low: low ? 1 : undefined } })
  return (
    <Card flush title="Supplies and equipment" actions={can('inventory:write') && <button className="btn sm primary" onClick={() => setEditing({})}><Plus /> Add item</button>}>
      <DataTable
        list={list}
        searchPlaceholder="Search item, category or location"
        toolbar={<label className="check"><input type="checkbox" checked={low} onChange={(event) => { setLow(event.target.checked); list.resetPage() }} /> Low stock only</label>}
        onRowClick={can('inventory:write') ? setEditing : undefined}
        columns={[
          { key: 'name', label: 'Item', render: (row) => <span className="strong">{row.name}</span> },
          { key: 'category', label: 'Category' },
          { key: 'location', label: 'Location' },
          { key: 'quantity', label: 'Quantity', align: 'right', render: (row) => <>{row.quantity} <span className="faint">{row.unit}</span></> },
          { key: 'reorder_level', label: 'Reorder at', align: 'right' },
          { key: 'level', label: 'Level', render: (row) => (row.quantity <= row.reorder_level ? <Badge tone="bad" label="Reorder" /> : <Badge tone="good" label="OK" />) },
          {
            key: 'actions',
            label: '',
            render: (row) => can('inventory:write') && (
              <button className="btn ghost sm" onClick={(event) => { event.stopPropagation(); setMoving(row) }}>Update stock</button>
            ),
          },
        ]}
      />
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add item'}
          fields={[
            { name: 'name', label: 'Name', required: true, span: 2 },
            { name: 'category', label: 'Category' },
            { name: 'unit', label: 'Unit', placeholder: 'box, piece' },
            { name: 'location', label: 'Location' },
            { name: 'reorder_level', label: 'Reorder level', type: 'number', required: true, defaultValue: 10 },
          ]}
          initial={editing}
          successMessage="Item saved"
          onSubmit={(body) => (editing.id ? api.patch(`/inventory/items/${editing.id}`, body) : api.post('/inventory/items', body))}
          onClose={() => setEditing(null)}
        />
      )}
      {moving && (
        <FormModal
          title={`Update stock: ${moving.name}`}
          size="narrow"
          intro={<p className="muted">{moving.quantity} {moving.unit} in stock. Enter a positive number for stock in, or negative for stock out.</p>}
          fields={[
            { name: 'quantity', label: 'Change', type: 'number', required: true, span: 2 },
            { name: 'reference', label: 'Reference', required: true, span: 2, placeholder: 'Delivery note, issued to ward' },
          ]}
          submitLabel="Update"
          successMessage="Stock updated"
          onSubmit={(body) => api.post(`/inventory/items/${moving.id}/move`, body)}
          onClose={() => setMoving(null)}
        />
      )}
    </Card>
  )
}

function History() {
  const list = useList('/inventory/movements')
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search item or reference"
        columns={[
          { key: 'created_at', label: 'When', render: (row) => <span className="nowrap">{fmtDateTime(row.created_at)}</span> },
          { key: 'item_name', label: 'Item', render: (row) => <span className="strong">{row.item_name}</span> },
          { key: 'quantity', label: 'Change', align: 'right', render: (row) => (row.quantity > 0 ? `+${row.quantity}` : row.quantity) },
          { key: 'reference', label: 'Reference' },
          { key: 'user_name', label: 'By' },
        ]}
      />
    </Card>
  )
}

export default function Inventory() {
  const [tab, setTab] = useTab('items')
  return (
    <>
      <PageHeader title="Inventory" subtitle="General supplies. Medicines are managed under Pharmacy." />
      <Tabs tabs={[{ value: 'items', label: 'Items' }, { value: 'history', label: 'Stock history' }]} value={tab} onChange={setTab} />
      {tab === 'items' ? <Items /> : <History />}
    </>
  )
}
