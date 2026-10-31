import { all, get, insert, run } from '../db/index.js'
import { badRequest } from './http.js'

/** Hospital wall-clock date, YYYY-MM-DD. */
export const today = () => localDate(new Date())
export const localDate = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export const nowIso = () => new Date().toISOString()

export const toMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}
export const toTime = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
export const weekdayOf = (date) => new Date(`${date}T12:00:00`).getDay()

export function setting(key, fallback = null) {
  return get('SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback
}

export function postCharge({ patientId, admissionId = null, kind, description, quantity = 1, unitPriceCents, sourceType = null, sourceId = null, userId = null }) {
  return insert('charges', {
    patient_id: patientId,
    admission_id: admissionId,
    kind,
    description,
    quantity,
    unit_price_cents: unitPriceCents,
    source_type: sourceType,
    source_id: sourceId,
    created_by: userId,
  })
}

export function notify(userId, { title, body = null, link = null, severity = 'info' }) {
  return insert('notifications', { user_id: userId, title, body, link, severity })
}

export function notifyRole(role, message) {
  for (const { id } of all('SELECT id FROM users WHERE role = ? AND active = 1', role)) notify(id, message)
}

/** Days billed for one bed stay. A same-day transfer rounds to 0 so it isn't charged twice. */
export const billableDays = (startIso, endIso) => Math.round((new Date(endIso) - new Date(startIso)) / 86400000)

/** Re-derives the money fields from payments, so totals can never drift from the ledger. */
export function refreshInvoiceBalance(invoiceId) {
  const { paid } = get('SELECT COALESCE(SUM(amount_cents), 0) AS paid FROM payments WHERE invoice_id = ?', invoiceId)
  const { total_cents: total, status } = get('SELECT total_cents, status FROM invoices WHERE id = ?', invoiceId)
  if (status === 'void') return
  const next = paid >= total && total > 0 ? 'paid' : paid > 0 ? 'partial' : total === 0 ? 'paid' : 'unpaid'
  run('UPDATE invoices SET paid_cents = ?, status = ? WHERE id = ?', paid, next, invoiceId)
}

/** Allergy strings are free text ("Penicillin; shellfish"), so match each listed term. */
export function allergyConflicts(patient, medicines) {
  const terms = (patient.allergies || '')
    .split(/[,;\n]/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 2 && !['none', 'nil', 'nkda', 'n/a'].includes(term))
  const conflicts = []
  for (const medicine of medicines) {
    const haystack = `${medicine.name} ${medicine.generic_name ?? ''} ${medicine.category ?? ''}`.toLowerCase()
    const match = terms.find((term) => haystack.includes(term))
    if (match) conflicts.push({ medicine: medicine.name, allergy: match })
  }
  return conflicts
}

export function assertDoctor(doctorId) {
  const doctor = get(`SELECT * FROM users WHERE id = ? AND role = 'doctor' AND active = 1`, doctorId)
  if (!doctor) throw badRequest('Select an active doctor')
  return doctor
}

export function doctorOnLeave(doctorId, date) {
  return get(
    `SELECT id FROM leave_requests WHERE user_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
    doctorId,
    date,
    date,
  )
}

/** Open slots for a doctor on a date, from the weekly schedule minus bookings and leave. */
export function availableSlots(doctorId, date) {
  if (doctorOnLeave(doctorId, date)) return []
  const blocks = all('SELECT * FROM doctor_schedules WHERE doctor_id = ? AND weekday = ? ORDER BY start_time', doctorId, weekdayOf(date))
  const booked = new Set(
    all(`SELECT start_time FROM appointments WHERE doctor_id = ? AND date = ? AND status NOT IN ('cancelled','no_show')`, doctorId, date).map(
      (row) => row.start_time,
    ),
  )
  const slots = []
  const now = new Date()
  const isToday = date === localDate(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  for (const block of blocks) {
    const end = toMinutes(block.end_time)
    for (let start = toMinutes(block.start_time); start + block.slot_minutes <= end; start += block.slot_minutes) {
      const time = toTime(start)
      if (booked.has(time) || (isToday && start < nowMinutes)) continue
      slots.push({ start_time: time, end_time: toTime(start + block.slot_minutes) })
    }
  }
  return slots
}
