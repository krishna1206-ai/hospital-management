import { useQuery } from '@tanstack/react-query'
import {
  Ambulance, BedDouble, Bell, Building2, CalendarClock, CalendarDays, ChartColumn, Droplets, FlaskConical, LayoutDashboard, ListOrdered,
  LogOut, Menu, Moon, Package, Pill, Receipt, Scissors, Search, Settings, ShieldCheck, Siren, Sun, UserCog, UserRound, Users,
} from 'lucide-react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { age, fmtDateTime, initials, words } from '../lib/format.js'
import { useAuth, useCan, useDebounced, useSettings } from '../lib/hooks.js'
import { Spinner } from './ui.jsx'

const NAV = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: 'dashboard:read' }] },
  {
    title: 'Patient care',
    items: [
      { to: '/patients', label: 'Patients', icon: Users, perm: 'patients:read' },
      { to: '/appointments', label: 'Appointments', icon: CalendarDays, perm: 'appointments:read' },
      { to: '/queue', label: 'OPD queue', icon: ListOrdered, perm: 'appointments:read' },
      { to: '/emergency', label: 'Emergency', icon: Siren, perm: 'er:read' },
      { to: '/inpatients', label: 'Inpatients', icon: BedDouble, perm: 'ipd:read' },
      { to: '/surgery', label: 'Surgery', icon: Scissors, perm: 'surgery:read' },
    ],
  },
  {
    title: 'Clinical services',
    items: [
      { to: '/laboratory', label: 'Laboratory', icon: FlaskConical, perm: 'lab:read' },
      { to: '/pharmacy', label: 'Pharmacy', icon: Pill, perm: 'pharmacy:read' },
      { to: '/blood-bank', label: 'Blood bank', icon: Droplets, perm: 'blood:read' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/billing', label: 'Billing', icon: Receipt, perm: 'billing:read' },
      { to: '/reports', label: 'Reports', icon: ChartColumn, perm: 'reports:read' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/ambulance', label: 'Ambulance', icon: Ambulance, perm: 'ambulance:read' },
      { to: '/inventory', label: 'Inventory', icon: Package, perm: 'inventory:read' },
      { to: '/staff', label: 'Staff', icon: UserCog, perm: 'staff:read' },
      { to: '/roster', label: 'Roster & leave', icon: CalendarClock, perm: 'dashboard:read' },
      { to: '/departments', label: 'Departments', icon: Building2, perm: 'departments:write' },
      { to: '/audit', label: 'Audit log', icon: ShieldCheck, perm: 'audit:read' },
      { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings:write' },
    ],
  },
]

export const BrandMark = () => (
  <span className="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></svg>
  </span>
)

function useDismiss(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return ref
}

function GlobalSearch() {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const q = useDebounced(text)
  const navigate = useNavigate()
  const ref = useDismiss(open, setOpen)
  const { data = [], isFetching } = useQuery({ queryKey: ['/search', { q }], enabled: q.length > 0 })
  const go = (id) => {
    setOpen(false)
    setText('')
    navigate(`/patients/${id}`)
  }
  return (
    <div className="global-search" ref={ref} role="search">
      <Search />
      <input
        className="input"
        type="search"
        aria-label="Find a patient"
        placeholder="Find a patient by name, MRN or phone"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && data[0]) go(data[0].id)
        }}
      />
      {open && q && (
        <div className="popover search-results">
          {data.map((patient) => (
            <button key={patient.id} type="button" className="search-item" onClick={() => go(patient.id)}>
              <div className="strong">{patient.first_name} {patient.last_name}</div>
              <div className="faint num">{patient.mrn} · {age(patient.dob)} · {patient.phone}</div>
            </button>
          ))}
          {!data.length && !isFetching && <div className="search-item faint">No matching patients</div>}
        </div>
      )}
    </div>
  )
}

function Notifications() {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, setOpen)
  const navigate = useNavigate()
  const { data, refetch } = useQuery({ queryKey: ['/notifications'], refetchInterval: 30000 })
  const rows = data?.rows ?? []
  const openOne = async (notification) => {
    setOpen(false)
    if (!notification.read_at) await api.post(`/notifications/${notification.id}/read`)
    refetch()
    if (notification.link) navigate(notification.link)
  }
  const readAll = async () => {
    await api.post('/notifications/read-all')
    refetch()
  }
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" className="icon-btn" aria-label={`Notifications, ${data?.unread ?? 0} unread`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell />
        {data?.unread > 0 && <span className="count-dot">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="popover notif-panel">
          <div className="notif-head">
            Notifications
            {data?.unread > 0 && <button type="button" className="btn ghost sm" onClick={readAll}>Mark all read</button>}
          </div>
          {rows.length === 0 && <div className="empty">You're all caught up.</div>}
          {rows.map((notification) => (
            <button key={notification.id} type="button" className={`notif ${notification.read_at ? '' : 'unread'} ${notification.severity}`} onClick={() => openOne(notification)}>
              <div className="strong">{notification.title}</div>
              {notification.body && <div className="muted">{notification.body}</div>}
              <div className="faint">{fmtDateTime(notification.created_at)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('hms-theme', next)
    } catch {
      // The choice still applies for this visit.
    }
    setTheme(next)
  }
  return (
    <button type="button" className="icon-btn" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggle}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </button>
  )
}

function UserMenu() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, setOpen)
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" className="user-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="avatar">{initials(user.name)}</span>
        <div>
          <div className="user-name">{user.name}</div>
          <div className="user-role">{words(user.role)}</div>
        </div>
      </button>
      {open && (
        <div className="popover user-menu">
          <Link className="menu-item" to="/profile" onClick={() => setOpen(false)}><UserRound /> My profile</Link>
          <button type="button" className="menu-item" onClick={signOut}><LogOut /> Sign out</button>
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const can = useCan()
  const settings = useSettings()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setNavOpen(false)
  }
  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
          <BrandMark />
          <span>
            <div className="brand-name">{settings.hospital_name || 'Hospital'}</div>
            <div className="brand-sub">Hospital management</div>
          </span>
        </Link>
        <nav aria-label="Main">
          {NAV.map((group) => {
            const items = group.items.filter((item) => can(item.perm))
            if (!items.length) return null
            return (
              <div className="nav-group" key={group.title}>
                <div className="nav-title">{group.title}</div>
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <item.icon /> {item.label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-button" aria-label="Open menu" onClick={() => setNavOpen(!navOpen)}><Menu /></button>
          {can('patients:read') ? <GlobalSearch /> : <div className="spacer" />}
          <div className="spacer" />
          <ThemeToggle />
          <Notifications />
          <UserMenu />
        </header>
        <main className="content">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
