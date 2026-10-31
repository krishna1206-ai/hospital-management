import { Plus } from 'lucide-react'
import { useState } from 'react'
import { FormModal } from '../components/forms.jsx'
import { Card, DataTable, PageHeader } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { useAction, useList } from '../lib/hooks.js'

export default function Departments() {
  const action = useAction()
  const [editing, setEditing] = useState(null)
  const list = useList('/staff/departments', { pageSize: 50 })
  return (
    <>
      <PageHeader title="Departments" subtitle="Clinical and service departments">
        <button className="btn primary" onClick={() => setEditing({})}><Plus /> Add department</button>
      </PageHeader>
      <Card flush>
        <DataTable
          list={list}
          searchPlaceholder="Search departments"
          onRowClick={setEditing}
          columns={[
            { key: 'code', label: 'Code', render: (row) => <span className="num strong">{row.code}</span> },
            { key: 'name', label: 'Department', render: (row) => <span className="strong">{row.name}</span> },
            { key: 'location', label: 'Location' },
            { key: 'phone', label: 'Phone', render: (row) => <span className="num nowrap">{row.phone ?? '—'}</span> },
            {
              key: 'actions',
              label: '',
              render: (row) => (
                <button className="btn ghost sm" onClick={(event) => { event.stopPropagation(); action(() => api.delete(`/staff/departments/${row.id}`), `${row.name} deactivated`) }}>Deactivate</button>
              ),
            },
          ]}
        />
      </Card>
      {editing && (
        <FormModal
          title={editing.id ? `Edit ${editing.name}` : 'Add department'}
          fields={[
            { name: 'name', label: 'Name', required: true },
            { name: 'code', label: 'Code', required: true },
            { name: 'location', label: 'Location' },
            { name: 'phone', label: 'Phone', type: 'tel' },
            { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
          ]}
          initial={editing}
          successMessage="Department saved"
          onSubmit={(body) => (editing.id ? api.patch(`/staff/departments/${editing.id}`, body) : api.post('/staff/departments', body))}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
