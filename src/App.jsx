import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout.jsx'
import { Empty, Spinner } from './components/ui.jsx'
import { api } from './lib/api.js'
import { AuthContext, ToastContext, useCan } from './lib/hooks.js'
import { ForcePasswordChange, Login } from './pages/Auth.jsx'

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const Patients = lazy(() => import('./pages/Patients.jsx'))
const PatientChart = lazy(() => import('./pages/PatientChart.jsx'))
const Appointments = lazy(() => import('./pages/Appointments.jsx'))
const Queue = lazy(() => import('./pages/Queue.jsx'))
const Encounter = lazy(() => import('./pages/Encounter.jsx'))
const Emergency = lazy(() => import('./pages/Emergency.jsx'))
const Inpatients = lazy(() => import('./pages/Inpatients.jsx'))
const AdmissionDetail = lazy(() => import('./pages/AdmissionDetail.jsx'))
const Surgery = lazy(() => import('./pages/Surgery.jsx'))
const Laboratory = lazy(() => import('./pages/Laboratory.jsx'))
const Pharmacy = lazy(() => import('./pages/Pharmacy.jsx'))
const BloodBank = lazy(() => import('./pages/BloodBank.jsx'))
const Billing = lazy(() => import('./pages/Billing.jsx'))
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail.jsx'))
const Reports = lazy(() => import('./pages/Reports.jsx'))
const AmbulancePage = lazy(() => import('./pages/Ambulance.jsx'))
const Inventory = lazy(() => import('./pages/Inventory.jsx'))
const Staff = lazy(() => import('./pages/Staff.jsx'))
const Roster = lazy(() => import('./pages/Roster.jsx'))
const Departments = lazy(() => import('./pages/Departments.jsx'))
const AuditLog = lazy(() => import('./pages/AuditLog.jsx'))
const SettingsPage = lazy(() => import('./pages/Settings.jsx'))
const Profile = lazy(() => import('./pages/Profile.jsx'))

function Guard({ perm, children }) {
  const can = useCan()
  if (!can(perm)) {
    return (
      <Empty title="You don't have access to this page" icon={ShieldAlert}>
        Ask an administrator if you need this for your role.
      </Empty>
    )
  }
  return children
}

const NotFound = () => <Empty title="Page not found">Check the address, or use the menu to find what you need.</Empty>

function ToastHost({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)
  const toast = useCallback((message, kind = 'ok') => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, message, kind }])
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.kind === 'error' ? 'error' : ''}`}>{item.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export default function App() {
  const client = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['/auth/me'],
    retry: false,
    staleTime: Infinity,
    throwOnError: false,
  })
  const user = data?.user ?? null

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      // Nothing from one person's session may remain visible to the next.
      client.setQueryData(['/auth/me'], null)
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== '/auth/me' })
    }
  }, [client])

  useEffect(() => {
    const onExpired = () => {
      client.setQueryData(['/auth/me'], null)
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== '/auth/me' })
    }
    window.addEventListener('hms:signed-out', onExpired)
    return () => window.removeEventListener('hms:signed-out', onExpired)
  }, [client])

  const auth = useMemo(() => ({ user, signOut }), [user, signOut])

  if (isLoading) return <Spinner />

  return (
    <ToastHost>
      <AuthContext.Provider value={auth}>
        {!user ? (
          <Login />
        ) : user.must_change_password ? (
          <ForcePasswordChange />
        ) : (
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="patients" element={<Guard perm="patients:read"><Patients /></Guard>} />
                <Route path="patients/:id" element={<Guard perm="patients:read"><PatientChart /></Guard>} />
                <Route path="appointments" element={<Guard perm="appointments:read"><Appointments /></Guard>} />
                <Route path="queue" element={<Guard perm="appointments:read"><Queue /></Guard>} />
                <Route path="encounters/:id" element={<Guard perm="clinical:read"><Encounter /></Guard>} />
                <Route path="emergency" element={<Guard perm="er:read"><Emergency /></Guard>} />
                <Route path="inpatients" element={<Guard perm="ipd:read"><Inpatients /></Guard>} />
                <Route path="admissions/:id" element={<Guard perm="ipd:read"><AdmissionDetail /></Guard>} />
                <Route path="surgery" element={<Guard perm="surgery:read"><Surgery /></Guard>} />
                <Route path="laboratory" element={<Guard perm="lab:read"><Laboratory /></Guard>} />
                <Route path="pharmacy" element={<Guard perm="pharmacy:read"><Pharmacy /></Guard>} />
                <Route path="blood-bank" element={<Guard perm="blood:read"><BloodBank /></Guard>} />
                <Route path="billing" element={<Guard perm="billing:read"><Billing /></Guard>} />
                <Route path="billing/invoices/:id" element={<Guard perm="billing:read"><InvoiceDetail /></Guard>} />
                <Route path="reports" element={<Guard perm="reports:read"><Reports /></Guard>} />
                <Route path="ambulance" element={<Guard perm="ambulance:read"><AmbulancePage /></Guard>} />
                <Route path="inventory" element={<Guard perm="inventory:read"><Inventory /></Guard>} />
                <Route path="staff" element={<Guard perm="staff:read"><Staff /></Guard>} />
                <Route path="roster" element={<Roster />} />
                <Route path="departments" element={<Guard perm="departments:write"><Departments /></Guard>} />
                <Route path="audit" element={<Guard perm="audit:read"><AuditLog /></Guard>} />
                <Route path="settings" element={<Guard perm="settings:write"><SettingsPage /></Guard>} />
                <Route path="profile" element={<Profile />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        )}
      </AuthContext.Provider>
    </ToastHost>
  )
}
