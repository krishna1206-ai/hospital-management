import { Plus, Siren } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AllergyStrip } from '../components/clinical.jsx'
import { FormModal } from '../components/forms.jsx'
import { Badge, Card, DataTable, Empty, ErrorBox, PageHeader, Spinner, Stat, Tabs } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { age, fmtDateTime, waitingLabel, words } from '../lib/format.js'
import { useAction, useCan, useList, useNow, useTab } from '../lib/hooks.js'

const TRIAGE = [[1, '1: Resuscitation'], [2, '2: Emergent'], [3, '3: Urgent'], [4, '4: Less urgent'], [5, '5: Non-urgent']]
const Triage = ({ level }) => <span className={`triage triage-${level}`} title={TRIAGE[level - 1][1]}>{level}</span>

function Board() {
  const can = useCan()
  const now = useNow()
  const action = useAction()
  const [closing, setClosing] = useState(null)
  const [assigning, setAssigning] = useState(null)
  const list = useList('/emergency', { filters: { board: 1 }, pageSize: 100, refetchInterval: 20000 })
  if (list.isLoading) return <Spinner />
  if (list.isError) return <ErrorBox error={list.error} />
  const rows = list.data.rows
  const move = (row, status) => action(() => api.patch(`/emergency/${row.id}`, { status }), `Moved to ${words(status)}`)

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Waiting" value={rows.filter((row) => row.status === 'waiting').length} />
        <Stat label="In treatment" value={rows.filter((row) => row.status === 'in_treatment').length} />
        <Stat label="Observation" value={rows.filter((row) => row.status === 'observation').length} />
        <Stat label="High acuity (1–2)" value={rows.filter((row) => row.triage_level <= 2).length} />
      </div>
      {rows.length === 0 ? (
        <Card><Empty icon={Siren} title="No active emergency patients" /></Card>
      ) : (
        <Card flush>
          {rows.map((row) => (
            <div key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="queue-row" style={{ borderBottom: 0, flexWrap: 'wrap' }}>
                <Triage level={row.triage_level} />
                <div className="grow" style={{ minWidth: 220 }}>
                  <Link to={`/patients/${row.patient_id}`} className="strong" style={{ color: 'inherit' }}>{row.patient_name}</Link>
                  <span className="faint"> {row.mrn} · {age(row.patient_dob)} · {row.patient_gender}{row.patient_blood_group ? ` · ${row.patient_blood_group}` : ''}</span>
                  <div>{row.chief_complaint}</div>
                  <div className="faint">
                    {words(row.arrival_mode)} · here {waitingLabel(row.arrived_at, now)}
                    {row.doctor_name ? ` · ${row.doctor_name}` : ''}
                  </div>
                </div>
                <Badge value={row.status} />
                {can('er:write') && (
                  <div className="actions">
                    {row.status === 'waiting' && <button className="btn sm primary" onClick={() => setAssigning(row)}>Start treatment</button>}
                    {row.status === 'in_treatment' && <button className="btn sm" onClick={() => move(row, 'observation')}>Observation</button>}
                    {row.status !== 'waiting' && <button className="btn sm" onClick={() => setClosing(row)}>Disposition</button>}
                    {row.status === 'waiting' && <button className="btn ghost sm" onClick={() => move(row, 'left_without_care')}>Left</button>}
                  </div>
                )}
              </div>
              <AllergyStrip allergies={row.patient_allergies} />
            </div>
          ))}
        </Card>
      )}
      {assigning && (
        <FormModal
          title={`Start treatment: ${assigning.patient_name}`}
          size="narrow"
          fields={[{ name: 'doctor_id', label: 'Treating doctor', type: 'remote', endpoint: '/staff/doctors', required: true, span: 2 }]}
          initial={{ doctor_id: assigning.doctor_id }}
          submitLabel="Start treatment"
          successMessage="Treatment started"
          onSubmit={(body) => api.patch(`/emergency/${assigning.id}`, { ...body, status: 'in_treatment' })}
          onClose={() => setAssigning(null)}
        />
      )}
      {closing && (
        <FormModal
          title={`Disposition: ${closing.patient_name}`}
          size="narrow"
          intro={<p className="muted">Choosing Admitted closes this visit. Then admit the patient from their chart or the bed board.</p>}
          fields={[
            { name: 'status', label: 'Outcome', type: 'select', required: true, span: 2, options: [['discharged', 'Discharged home'], ['admitted', 'Admitted'], ['transferred', 'Transferred out']] },
            { name: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
          ]}
          initial={{ notes: closing.notes }}
          submitLabel="Close visit"
          successMessage="Visit closed"
          onSubmit={(body) => api.patch(`/emergency/${closing.id}`, body)}
          onClose={() => setClosing(null)}
        />
      )}
    </div>
  )
}

function History() {
  const list = useList('/emergency', { pageSize: 25 })
  return (
    <Card flush>
      <DataTable
        list={list}
        searchPlaceholder="Search patient or complaint"
        columns={[
          { key: 'triage_level', label: 'Triage', render: (row) => <Triage level={row.triage_level} /> },
          { key: 'patient_name', label: 'Patient', render: (row) => <Link to={`/patients/${row.patient_id}`} className="strong">{row.patient_name}</Link> },
          { key: 'chief_complaint', label: 'Complaint' },
          { key: 'arrived_at', label: 'Arrived', render: (row) => <span className="nowrap">{fmtDateTime(row.arrived_at)}</span> },
          { key: 'doctor_name', label: 'Doctor' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
        ]}
      />
    </Card>
  )
}

export default function Emergency() {
  const can = useCan()
  const [tab, setTab] = useTab('board')
  const [registering, setRegistering] = useState(false)
  return (
    <>
      <PageHeader title="Emergency" subtitle="Sorted by triage level, then longest wait">
        {can('er:write') && <button className="btn primary" onClick={() => setRegistering(true)}><Plus /> Register arrival</button>}
      </PageHeader>
      <Tabs tabs={[{ value: 'board', label: 'Live board' }, { value: 'history', label: 'All visits' }]} value={tab} onChange={setTab} />
      {tab === 'board' ? <Board /> : <History />}
      {registering && (
        <FormModal
          title="Register emergency arrival"
          fields={[
            { name: 'patient_id', label: 'Patient', type: 'patient', required: true, span: 2, allowCreate: true },
            { name: 'triage_level', label: 'Triage level', type: 'select', required: true, options: TRIAGE },
            { name: 'arrival_mode', label: 'Arrived by', type: 'select', defaultValue: 'walk_in', options: [['walk_in', 'Walk-in'], ['ambulance', 'Ambulance'], ['referral', 'Referral'], ['police', 'Police']] },
            { name: 'chief_complaint', label: 'Chief complaint', type: 'textarea', required: true, rows: 2 },
            { name: 'notes', label: 'Triage notes', type: 'textarea', rows: 2 },
          ]}
          submitLabel="Register"
          successMessage="Arrival registered"
          onSubmit={(body) => api.post('/emergency', body)}
          onClose={() => setRegistering(false)}
        />
      )}
    </>
  )
}
