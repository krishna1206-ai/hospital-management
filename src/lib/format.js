export const moneyFormatter = (currency) => {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  return (cents) => formatter.format((cents ?? 0) / 100)
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const shortDateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const longDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

// Plain 'YYYY-MM-DD' values are parsed as local dates so they never shift a day across timezones.
const parse = (value) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)

export const fmtDate = (value) => (value ? dateFormat.format(parse(value)) : '—')
export const fmtShortDate = (value) => (value ? shortDateFormat.format(parse(value)) : '—')
export const fmtLongDate = (value) => (value ? longDateFormat.format(parse(value)) : '—')
export const fmtDateTime = (value) => (value ? dateTimeFormat.format(parse(value)) : '—')

export const toDateInput = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export const addDays = (value, days) => {
  const date = parse(value)
  date.setDate(date.getDate() + days)
  return toDateInput(date)
}

export function age(dob) {
  if (!dob) return ''
  const birth = parse(dob)
  const now = new Date()
  let years = now.getFullYear() - birth.getFullYear()
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) years--
  if (years >= 2) return `${years}y`
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth()
  return `${Math.max(0, months)}m`
}

export const words = (value) => (value ? String(value).replaceAll('_', ' ') : '—')
export const initials = (name = '') =>
  name
    .replace(/^Dr\.?\s+/, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

export function waitingLabel(iso, now) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Downloads rows as a CSV. Values are neutralized so spreadsheets don't run them as formulas. */
export function downloadCsv(filename, columns, rows) {
  const escape = (value) => {
    let text = value == null ? '' : String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [columns.map((column) => escape(column.label)), ...rows.map((row) => columns.map((column) => escape(column.value(row))))]
  const url = URL.createObjectURL(new Blob([lines.map((line) => line.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
