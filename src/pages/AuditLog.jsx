import { Card, DataTable, PageHeader } from '../components/ui.jsx'
import { fmtDateTime, words } from '../lib/format.js'
import { useList } from '../lib/hooks.js'

export default function AuditLog() {
  const list = useList('/audit', { pageSize: 50 })
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what and when, including who opened each patient record. Clinical details are never stored here." />
      <Card flush>
        <DataTable
          list={list}
          searchPlaceholder="Search user, action, record or IP"
          columns={[
            { key: 'created_at', label: 'When', render: (row) => <span className="nowrap num">{fmtDateTime(row.created_at)}</span> },
            { key: 'user_name', label: 'User' },
            { key: 'action', label: 'Action', render: (row) => <span style={{ textTransform: 'capitalize' }}>{words(row.action)}</span> },
            { key: 'entity', label: 'Area', render: (row) => <span style={{ textTransform: 'capitalize' }}>{words(row.entity)}</span> },
            { key: 'entity_id', label: 'Record', render: (row) => <span className="num">{row.entity_id ?? '—'}</span> },
            { key: 'status', label: 'Result', render: (row) => (row.status < 400 ? <span className="faint">OK</span> : <span className="field-error num">Refused ({row.status})</span>) },
            { key: 'ip', label: 'IP', render: (row) => <span className="num faint">{row.ip ?? '—'}</span> },
          ]}
        />
      </Card>
    </>
  )
}
