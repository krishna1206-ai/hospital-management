import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FormModal } from '../components/forms.jsx'
import { Card, PageHeader } from '../components/ui.jsx'
import { api } from '../lib/api.js'
import { words } from '../lib/format.js'
import { useAuth, useToast } from '../lib/hooks.js'
import { PasswordForm } from './Auth.jsx'

export default function Profile() {
  const { user } = useAuth()
  const client = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHeader title="My profile" />
      <Card title="Account" actions={<button className="btn ghost sm" onClick={() => setEditing(true)}>Edit</button>}>
        <dl className="dl">
          <dt>Name</dt><dd>{user.name}</dd>
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Phone</dt><dd>{user.phone || '—'}</dd>
          <dt>Role</dt><dd style={{ textTransform: 'capitalize' }}>{words(user.role)}</dd>
          {user.specialization && <><dt>Specialization</dt><dd>{user.specialization}</dd></>}
        </dl>
      </Card>
      <Card title="Change password" subtitle="This signs you out on your other devices.">
        <PasswordForm onDone={() => toast('Password changed')} />
      </Card>
      <p className="muted">Need time off? <Link to="/roster?tab=leave">Request leave</Link>.</p>
      {editing && (
        <FormModal
          title="Edit account"
          size="narrow"
          fields={[
            { name: 'name', label: 'Name', required: true, span: 2 },
            { name: 'phone', label: 'Phone', type: 'tel', span: 2 },
          ]}
          initial={user}
          successMessage="Account updated"
          onSubmit={(body) => api.patch('/auth/me', body).then((result) => client.setQueryData(['/auth/me'], result))}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
