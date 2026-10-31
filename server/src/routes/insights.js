import { Router } from 'express'
import { z } from 'zod'
import { all, get, nowIsoSql, run } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { localDate, today } from '../lib/domain.js'
import { badRequest, dateStr, idParam, optionalText, paginate, validate } from '../lib/http.js'
import { can } from '../lib/permissions.js'

export const insightsRouter = Router()

const count = (sql, ...params) => get(sql, ...params).value

function lastDays(days) {
  const result = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    result.push(localDate(date))
  }
  return result
}

const fillDays = (days, rows, key = 'value') => {
  const lookup = new Map(rows.map((row) => [row.day, row[key]]))
  return days.map((day) => ({ day, value: lookup.get(day) ?? 0 }))
}

/** Each panel is included only for roles allowed to see the underlying data. */
insightsRouter.get('/dashboard', (req, res) => {
  const { role, id: userId } = req.user
  const date = today()
  const response = { stats: {}, alerts: [] }

  if (can(role, 'patients:read')) {
    response.stats.total_patients = count('SELECT COUNT(*) AS value FROM patients WHERE active = 1')
    response.stats.new_patients_today = count(`SELECT COUNT(*) AS value FROM patients WHERE date(created_at, 'localtime') = ?`, date)
  }

  if (can(role, 'appointments:read')) {
    const scope = role === 'doctor' ? 'AND doctor_id = ?' : ''
    const scoped = role === 'doctor' ? [userId] : []
    response.stats.appointments_today = count(`SELECT COUNT(*) AS value FROM appointments WHERE date = ? AND status NOT IN ('cancelled','no_show') ${scope}`, date, ...scoped)
    response.stats.waiting_now = count(`SELECT COUNT(*) AS value FROM appointments WHERE date = ? AND status = 'checked_in' ${scope}`, date, ...scoped)
    response.stats.completed_today = count(`SELECT COUNT(*) AS value FROM appointments WHERE date = ? AND status = 'completed' ${scope}`, date, ...scoped)
    const days = lastDays(14)
    response.appointment_trend = fillDays(
      days,
      all(
        `SELECT date AS day, COUNT(*) AS value FROM appointments WHERE date BETWEEN ? AND ? AND status NOT IN ('cancelled','no_show') ${scope} GROUP BY date`,
        days[0],
        days.at(-1),
        ...scoped,
      ),
    )
    response.todays_schedule = all(
      `SELECT ap.id, ap.start_time, ap.status, ap.token_no, ap.reason, ap.patient_id, p.first_name || ' ' || p.last_name AS patient_name, p.mrn, u.name AS doctor_name
       FROM appointments ap JOIN patients p ON p.id = ap.patient_id JOIN users u ON u.id = ap.doctor_id
       WHERE ap.date = ? AND ap.status NOT IN ('cancelled','no_show','completed') ${role === 'doctor' ? 'AND ap.doctor_id = ?' : ''}
       ORDER BY ap.start_time LIMIT 8`,
      date,
      ...scoped,
    )
    response.department_load = all(
      `SELECT d.name, COUNT(*) AS value FROM appointments ap JOIN departments d ON d.id = ap.department_id
       WHERE ap.date BETWEEN ? AND ? AND ap.status NOT IN ('cancelled','no_show') GROUP BY d.id ORDER BY value DESC LIMIT 7`,
      days[0],
      days.at(-1),
    )
  }

  if (can(role, 'ipd:read')) {
    const beds = get(`SELECT COUNT(*) AS total, COALESCE(SUM(status = 'occupied'), 0) AS occupied, COALESCE(SUM(status = 'available'), 0) AS available FROM beds`)
    response.stats.beds_total = beds.total
    response.stats.beds_occupied = beds.occupied
    response.stats.beds_available = beds.available
    response.ward_occupancy = all(
      `SELECT w.name, COUNT(b.id) AS total, COALESCE(SUM(b.status = 'occupied'), 0) AS occupied FROM wards w LEFT JOIN beds b ON b.ward_id = w.id GROUP BY w.id ORDER BY w.name`,
    )
  }

  if (can(role, 'er:read')) {
    response.stats.er_active = count(`SELECT COUNT(*) AS value FROM er_visits WHERE status IN ('waiting','in_treatment','observation')`)
    const critical = count(`SELECT COUNT(*) AS value FROM er_visits WHERE status = 'waiting' AND triage_level <= 2`)
    if (critical) response.alerts.push({ severity: 'critical', title: `${critical} high-acuity patient${critical === 1 ? '' : 's'} waiting in Emergency`, link: '/emergency' })
  }

  if (can(role, 'pharmacy:read')) {
    const low = count(
      `SELECT COUNT(*) AS value FROM medicines m WHERE m.active = 1 AND
        (SELECT COALESCE(SUM(b.quantity), 0) FROM medicine_batches b WHERE b.medicine_id = m.id AND b.expiry_date >= date('now','localtime')) <= m.reorder_level`,
    )
    const expiring = count(`SELECT COUNT(*) AS value FROM medicine_batches WHERE quantity > 0 AND expiry_date <= date('now','localtime','+60 days')`)
    response.stats.low_stock = low
    if (low) response.alerts.push({ severity: 'warning', title: `${low} medicine${low === 1 ? '' : 's'} at or below reorder level`, link: '/pharmacy?tab=medicines' })
    if (expiring) response.alerts.push({ severity: 'warning', title: `${expiring} batch${expiring === 1 ? '' : 'es'} expired or expiring within 60 days`, link: '/pharmacy?tab=batches' })
  }

  if (can(role, 'prescriptions:read') && role === 'pharmacist') {
    response.stats.rx_pending = count(`SELECT COUNT(*) AS value FROM prescriptions WHERE status IN ('active','partial')`)
  }

  if (can(role, 'lab:read')) {
    response.stats.lab_pending = count(`SELECT COUNT(*) AS value FROM lab_orders WHERE status IN ('ordered','collected','in_progress')`)
    const stat = count(`SELECT COUNT(*) AS value FROM lab_orders WHERE status IN ('ordered','collected','in_progress') AND priority = 'stat'`)
    if (stat) response.alerts.push({ severity: 'critical', title: `${stat} STAT lab order${stat === 1 ? '' : 's'} in progress`, link: '/laboratory' })
  }

  if (can(role, 'billing:read')) {
    response.stats.revenue_today_cents = count(`SELECT COALESCE(SUM(amount_cents), 0) AS value FROM payments WHERE date(created_at, 'localtime') = ?`, date)
    response.stats.outstanding_cents = count(`SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS value FROM invoices WHERE status IN ('unpaid','partial')`)
    response.stats.unbilled_cents = count('SELECT COALESCE(SUM(quantity * unit_price_cents), 0) AS value FROM charges WHERE invoice_id IS NULL')
    const days = lastDays(30)
    response.revenue_trend = fillDays(
      days,
      all(
        `SELECT date(created_at, 'localtime') AS day, SUM(amount_cents) AS value FROM payments WHERE date(created_at, 'localtime') BETWEEN ? AND ? GROUP BY day`,
        days[0],
        days.at(-1),
      ),
    )
  }

  if (can(role, 'blood:read')) {
    const low = all(
      `SELECT g.blood_group FROM (SELECT 'A+' AS blood_group UNION SELECT 'A-' UNION SELECT 'B+' UNION SELECT 'B-' UNION SELECT 'AB+' UNION SELECT 'AB-' UNION SELECT 'O+' UNION SELECT 'O-') g
       WHERE (SELECT COUNT(*) FROM blood_units u WHERE u.blood_group = g.blood_group AND u.status = 'available' AND u.expires_on >= date('now','localtime')) < 2`,
    )
    if (low.length) response.alerts.push({ severity: 'warning', title: `Low blood stock: ${low.map((row) => row.blood_group).join(', ')}`, link: '/blood-bank' })
  }

  res.json(response)
})

function requireRange(req) {
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  const check = z.object({ from: dateStr, to: dateStr }).safeParse({ from, to })
  if (!check.success || from > to) throw badRequest('Choose a valid date range')
  return { from, to }
}

insightsRouter.get('/reports/summary', requirePermission('reports:read'), (req, res) => {
  const { from, to } = requireRange(req)
  const localDay = `date(created_at, 'localtime')`
  res.json({
    from,
    to,
    collections_cents: count(`SELECT COALESCE(SUM(amount_cents), 0) AS value FROM payments WHERE ${localDay} BETWEEN ? AND ?`, from, to),
    invoiced_cents: count(`SELECT COALESCE(SUM(total_cents), 0) AS value FROM invoices WHERE status != 'void' AND ${localDay} BETWEEN ? AND ?`, from, to),
    new_patients: count(`SELECT COUNT(*) AS value FROM patients WHERE ${localDay} BETWEEN ? AND ?`, from, to),
    appointments: count(`SELECT COUNT(*) AS value FROM appointments WHERE date BETWEEN ? AND ? AND status != 'cancelled'`, from, to),
    admissions: count(`SELECT COUNT(*) AS value FROM admissions WHERE date(admitted_at, 'localtime') BETWEEN ? AND ?`, from, to),
    er_visits: count(`SELECT COUNT(*) AS value FROM er_visits WHERE date(arrived_at, 'localtime') BETWEEN ? AND ?`, from, to),
    surgeries: count(`SELECT COUNT(*) AS value FROM surgeries WHERE date BETWEEN ? AND ? AND status = 'completed'`, from, to),
    avg_length_of_stay_days: get(
      `SELECT ROUND(AVG(julianday(discharged_at) - julianday(admitted_at)), 1) AS value FROM admissions
       WHERE status = 'discharged' AND date(discharged_at, 'localtime') BETWEEN ? AND ?`,
      from,
      to,
    ).value,
    revenue_by_kind: all(
      `SELECT c.kind AS name, SUM(c.quantity * c.unit_price_cents) AS value FROM charges c JOIN invoices i ON i.id = c.invoice_id
       WHERE i.status != 'void' AND date(i.created_at, 'localtime') BETWEEN ? AND ? GROUP BY c.kind ORDER BY value DESC`,
      from,
      to,
    ),
    collections_by_method: all(
      `SELECT method AS name, SUM(amount_cents) AS value FROM payments WHERE ${localDay} BETWEEN ? AND ? GROUP BY method ORDER BY value DESC`,
      from,
      to,
    ),
    appointments_by_status: all(`SELECT status AS name, COUNT(*) AS value FROM appointments WHERE date BETWEEN ? AND ? GROUP BY status ORDER BY value DESC`, from, to),
    doctor_performance: all(
      `SELECT u.name, d.name AS department_name, COUNT(*) AS visits, COALESCE(SUM(ap.status = 'no_show'), 0) AS no_shows, COALESCE(SUM(ap.status = 'completed'), 0) AS completed
       FROM appointments ap JOIN users u ON u.id = ap.doctor_id LEFT JOIN departments d ON d.id = u.department_id
       WHERE ap.date BETWEEN ? AND ? GROUP BY u.id ORDER BY completed DESC LIMIT 15`,
      from,
      to,
    ),
    top_diagnoses: all(
      `SELECT diagnosis AS name, COUNT(*) AS value FROM encounters WHERE diagnosis IS NOT NULL AND date(created_at, 'localtime') BETWEEN ? AND ?
       GROUP BY lower(diagnosis) ORDER BY value DESC LIMIT 10`,
      from,
      to,
    ),
    top_medicines: all(
      `SELECT m.name, SUM(-sm.quantity) AS value FROM stock_movements sm JOIN medicines m ON m.id = sm.medicine_id
       WHERE sm.kind = 'dispense' AND ${'date(sm.created_at, \'localtime\')'} BETWEEN ? AND ? GROUP BY m.id ORDER BY value DESC LIMIT 10`,
      from,
      to,
    ),
    top_tests: all(
      `SELECT t.name, COUNT(*) AS value FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id JOIN lab_orders o ON o.id = i.order_id
       WHERE o.status != 'cancelled' AND date(o.created_at, 'localtime') BETWEEN ? AND ? GROUP BY t.id ORDER BY value DESC LIMIT 10`,
      from,
      to,
    ),
    // Receivables aging is a point-in-time view and isn't limited to the date range.
    aging: get(
      `SELECT
        COALESCE(SUM(CASE WHEN age <= 30 THEN due END), 0) AS d0_30,
        COALESCE(SUM(CASE WHEN age > 30 AND age <= 60 THEN due END), 0) AS d31_60,
        COALESCE(SUM(CASE WHEN age > 60 AND age <= 90 THEN due END), 0) AS d61_90,
        COALESCE(SUM(CASE WHEN age > 90 THEN due END), 0) AS d90_plus
       FROM (SELECT total_cents - paid_cents AS due, julianday('now') - julianday(created_at) AS age FROM invoices WHERE status IN ('unpaid','partial'))`,
    ),
  })
})

insightsRouter.get('/audit', requirePermission('audit:read'), (req, res) => {
  const where = []
  const params = []
  for (const key of ['action', 'entity', 'user_id']) {
    if (req.query[key]) {
      where.push(`${key} = ?`)
      params.push(String(req.query[key]))
    }
  }
  res.json(paginate(req, { select: '*', from: 'audit_logs', where, params, search: ['user_name', 'action', 'entity', 'entity_id', 'ip'], order: 'id DESC' }))
})

/* ---------- Settings ---------- */

const PUBLIC_SETTINGS = ['hospital_name', 'hospital_address', 'hospital_phone', 'hospital_email', 'currency', 'tax_percent', 'tax_label', 'er_fee_cents', 'blood_unit_fee_cents']

insightsRouter.get('/settings', (_req, res) => {
  const rows = all('SELECT key, value FROM settings')
  res.json(Object.fromEntries(rows.filter((row) => PUBLIC_SETTINGS.includes(row.key)).map((row) => [row.key, row.value])))
})

insightsRouter.patch(
  '/settings',
  requirePermission('settings:write'),
  validate(
    z.object({
      hospital_name: optionalText(120),
      hospital_address: optionalText(300),
      hospital_phone: optionalText(40),
      hospital_email: optionalText(120),
      currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').optional(),
      tax_percent: z.coerce.number().min(0).max(100).optional(),
      tax_label: optionalText(30),
      er_fee_cents: z.coerce.number().int().min(0).optional(),
      blood_unit_fee_cents: z.coerce.number().int().min(0).optional(),
    }),
  ),
  (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      if (value === undefined) continue
      run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value === null ? null : String(value))
    }
    const rows = all('SELECT key, value FROM settings')
    res.json(Object.fromEntries(rows.filter((row) => PUBLIC_SETTINGS.includes(row.key)).map((row) => [row.key, row.value])))
  },
)

/* ---------- Notifications ---------- */

insightsRouter.get('/notifications', (req, res) => {
  res.json({
    rows: all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30', req.user.id),
    unread: count('SELECT COUNT(*) AS value FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id),
  })
})

insightsRouter.post('/notifications/read-all', (req, res) => {
  run(`UPDATE notifications SET read_at = ${nowIsoSql} WHERE user_id = ? AND read_at IS NULL`, req.user.id)
  res.status(204).end()
})

insightsRouter.post('/notifications/:id/read', (req, res) => {
  run(`UPDATE notifications SET read_at = ${nowIsoSql} WHERE id = ? AND user_id = ?`, idParam(req), req.user.id)
  res.status(204).end()
})

/* ---------- Global search ---------- */

insightsRouter.get('/search', requirePermission('patients:read'), (req, res) => {
  const page = paginate(
    { query: { q: req.query.q, pageSize: 8 } },
    {
      select: `id, mrn, first_name, last_name, dob, gender, phone, blood_group, allergies, insurance_provider, insurance_policy`,
      from: 'patients',
      where: ['active = 1'],
      search: ['mrn', 'first_name', 'last_name', `first_name || ' ' || last_name`, 'phone', 'national_id'],
      order: 'last_name, first_name',
    },
  )
  res.json(page.rows)
})
