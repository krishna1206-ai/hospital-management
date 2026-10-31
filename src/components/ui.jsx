import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { words } from '../lib/format.js'

export function PageHeader({ title, subtitle, children, back }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link className="back-link no-print" to={back.to}>
            <ChevronLeft size={14} /> {back.label}
          </Link>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {children && <div className="actions no-print">{children}</div>}
    </div>
  )
}

export function Card({ title, subtitle, actions, children, className = '', flush }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            <h2 className="card-title">{title}</h2>
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {actions && <div className="actions no-print">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className="card-body">{children}</div>}
    </section>
  )
}

const TONES = {
  good: ['active', 'available', 'completed', 'paid', 'dispensed', 'normal', 'approved', 'signed', 'recovered', 'discharged_ok'],
  info: ['scheduled', 'in_progress', 'in_treatment', 'admitted', 'collected', 'occupied', 'on_trip', 'dispatched', 'submitted', 'morning'],
  warn: ['checked_in', 'waiting', 'partial', 'pending', 'cleaning', 'observation', 'low', 'high', 'urgent', 'draft', 'ordered', 'unpaid'],
  bad: ['cancelled', 'no_show', 'critical', 'stat', 'rejected', 'void', 'left_without_care', 'discarded', 'deceased', 'expired'],
}
const toneFor = (value) => Object.keys(TONES).find((tone) => TONES[tone].includes(value)) ?? ''

export const Badge = ({ value, tone, label, plain }) => (
  <span className={`badge ${tone ?? toneFor(value)} ${plain ? 'plain' : ''}`}>{label ?? words(value)}</span>
)

export const Spinner = () => (
  <div className="loading" role="status" aria-label="Loading">
    <div className="spinner" />
  </div>
)

export const ErrorBox = ({ error }) => (error ? <div className="error-box" role="alert">{error.message || String(error)}</div> : null)

export const Empty = ({ title = 'Nothing here yet', children, icon: Icon = Inbox }) => (
  <div className="empty">
    <Icon />
    <div className="empty-title">{title}</div>
    {children && <div>{children}</div>}
  </div>
)

export const Warn = ({ children }) => (
  <div className="warn-box">
    <AlertTriangle />
    <div>{children}</div>
  </div>
)

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs no-print" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} className={`tab ${value === tab.value ? 'active' : ''}`} onClick={() => onChange(tab.value)}>
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value, note, icon: Icon, to }) {
  const body = (
    <>
      <div className="stat-label">
        {Icon && <Icon />}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </>
  )
  return to ? (
    <Link to={to} className="card stat stat-link">
      {body}
    </Link>
  ) : (
    <div className="card stat">{body}</div>
  )
}

export function Modal({ title, onClose, children, footer, size = '', onSubmit }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = (event) => {
      // With stacked dialogs, Escape closes only the top one.
      const open = document.querySelectorAll('.modal')
      if (event.key === 'Escape' && open[open.length - 1] === ref.current) onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector('input:not([type=hidden]), select, textarea')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const Wrapper = onSubmit ? 'form' : 'div'
  // Portaled to <body> so a dialog opened from another dialog is never a nested <form>.
  // React still bubbles events through portals, so a submit must stop at its own dialog.
  const submit = onSubmit
    ? (event) => {
        event.stopPropagation()
        onSubmit(event)
      }
    : undefined
  return createPortal(
    <div className="modal-back" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Wrapper ref={ref} className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} onSubmit={submit} noValidate={onSubmit ? true : undefined}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="icon-btn no-print" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot no-print">{footer}</div>}
      </Wrapper>
    </div>,
    document.body,
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search' }) {
  return (
    <div className="search">
      <Search />
      <input className="input" type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

export function Pager({ page, pageSize, total, onPage }) {
  const last = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return total ? <div className="pager">{total} record{total === 1 ? '' : 's'}</div> : null
  return (
    <div className="pager">
      <span className="num">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="actions">
        <button type="button" className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft /> Previous
        </button>
        <button type="button" className="btn sm" disabled={page >= last} onClick={() => onPage(page + 1)}>
          Next <ChevronRight />
        </button>
      </div>
    </div>
  )
}

/**
 * The standard records table. `list` comes from useList; columns are
 * { key, label, render?, align? }.
 */
export function DataTable({ list, columns, rows: staticRows, onRowClick, toolbar, searchPlaceholder, emptyTitle, emptyText, rowKey = 'id' }) {
  const rows = staticRows ?? list?.data?.rows ?? []
  const showSearch = list && searchPlaceholder
  return (
    <>
      {(showSearch || toolbar) && (
        <div className="toolbar no-print">
          {showSearch && <SearchBox value={list.search} onChange={list.setSearch} placeholder={searchPlaceholder} />}
          {toolbar}
        </div>
      )}
      {list?.isError ? (
        <div className="card-body">
          <ErrorBox error={list.error} />
        </div>
      ) : list?.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty title={emptyTitle ?? 'No records found'}>{emptyText}</Empty>
      ) : (
        <div className={`table-wrap ${list?.isPlaceholderData ? 'is-fetching' : ''}`}>
          <table className="table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} className={column.align === 'right' ? 'right' : ''}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[rowKey]} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map((column) => (
                    <td key={column.key} className={column.align === 'right' ? 'right num' : ''}>
                      {column.render ? column.render(row) : (row[column.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list?.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </>
  )
}
