import { Plus } from 'lucide-react'
import { useState } from 'react'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, PageHeader, Stat } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { fmtDateTime, words } from '../lib/format.js'
import { useAction, useCan, useList } from '../lib/hooks.js'

const TYPES = [['basic', 'Basic life support'], ['advanced', 'Advanced life support'], ['neonatal', 'Neonatal']]

export default function AmbulancePage() {
  const can = useCan()
  const action = useAction()
  const [editing, setEditing] = useState(null)
  const [dispatching, setDispatching] = useState(false)
  const vehicles = useList('/ambulance/vehicles', { pageSize: 50 })
  const trips = useList('/ambulance/trips', { pageSize: 15 })
  const rows = vehicles.data?.rows ?? []
  const available = rows.filter((vehicle) => vehicle.status === 'available')
  return (
    <div className="stack">
      <PageHeader title="Ambulance" subtitle="Fleet status and dispatch">
        {can('ambulance:write') && (
          <>
            <button className="btn" onClick={() => setEditing({})}><Plus /> Add vehicle</button>
            <button className="btn primary" disabled={!available.length} onClick={() => setDispatching(true)}>Dispatch</button>
          </>
        )}
      </PageHeader>
      <div className="stats">
        <Stat label="Available" value={available.length} />
        <Stat label="On a trip" value={rows.filter((vehicle) => vehicle.status === 'on_trip').length} />
        <Stat label="In maintenance" value={rows.filter((vehicle) => vehicle.status === 'maintenance').length} />
      </div>
      <Card title="Fleet" flush>
        <DataTable
          list={vehicles}
          onRowClick={can('ambulance:write') ? (row) => row.status !== 'on_trip' && setEditing(row) : undefined}
          columns={[
            { key: 'vehicle_no', label: 'Vehicle', render: (row) => <span className="strong num">{row.vehicle_no}</span> },
            { key: 'type', label: 'Type', render: (row) => TYPES.find(([value]) => value === row.type)?.[1] },
            { key: 'driver_name', label: 'Driver' },
            { key: 'driver_phone', label: 'Phone', render: (row) => <span className="num nowrap">{row.driver_phone ?? '—'}</span> },
            { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} tone={row.status === 'maintenance' ? 'warn' : undefined} /> },
          ]}
        />
      </Card>
      <Card title="Trips" flush>
        <DataTable
          list={trips}
          searchPlaceholder="Search patient, vehicle or pickup"
          emptyTitle="No trips yet"
          columns={[
            { key: 'dispatched_at', label: 'Dispatched', render: (row) => <span className="nowrap">{fmtDateTime(row.dispatched_at)}</span> },
            { key: 'vehicle_no', label: 'Vehicle', render: (row) => <span className="num nowrap">{row.vehicle_no}</span> },
            { key: 'patient_name', label: 'Patient', render: (row) => <><div className="strong">{row.patient_name}</div>{row.notes && <div className="faint">{row.notes}</div>}</> },
            { key: 'pickup', label: 'Pickup' },
            { key: 'destination', label: 'Destination' },
            { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
            {
              key: 'actions',
              label: '',
              render: (row) => can('ambulance:write') && row.status === 'dispatched' && (
                <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => action(() => api.post(`/ambulance/trips/${row.id}/close`, { status: 'completed' }), 'Trip completed')}>Complete</button>
                  <button className="btn ghost sm" onClick={() => action(() => api.post(`/ambulance/trips/${row.id}/close`, { status: 'cancelled' }), `Trip ${words('cancelled')}`)}>Cancel</button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.vehicle_no}` : 'Add vehicle'}
          fields={[
            { name: 'vehicle_no', label: 'Vehicle number', required: true },
            { name: 'type', label: 'Type', type: 'select', options: TYPES, required: true },
            { name: 'driver_name', label: 'Driver' },
            { name: 'driver_phone', label: 'Driver phone', type: 'tel' },
            ...(editing.id ? [{ name: 'status', label: 'Status', type: 'select', options: [['available', 'Available'], ['maintenance', 'In maintenance']] }] : []),
          ]}
          initial={editing}
          successMessage="Vehicle saved"
          onSubmit={(body) => (editing.id ? api.patch(`/ambulance/vehicles/${editing.id}`, body) : api.post('/ambulance/vehicles', body))}
          onClose={() => setEditing(null)}
        />
      )}
      {dispatching && (
        <FormModal
          title="Dispatch ambulance"
          fields={[
            { name: 'ambulance_id', label: 'Ambulance', type: 'select', required: true, span: 2, options: available.map((vehicle) => [vehicle.id, `${vehicle.vehicle_no} (${vehicle.type}, ${vehicle.driver_name ?? 'no driver'})`]) },
            { name: 'patient_name', label: 'Patient name', required: true },
            { name: 'contact_phone', label: 'Contact phone', type: 'tel' },
            { name: 'pickup', label: 'Pickup address', required: true, span: 2 },
            { name: 'destination', label: 'Destination', required: true, span: 2 },
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
          ]}
          submitLabel="Dispatch"
          successMessage="Ambulance dispatched"
          onSubmit={(body) => api.post('/ambulance/trips', body)}
          onClose={() => setDispatching(false)}
        />
      )}
    </div>
  )
}
