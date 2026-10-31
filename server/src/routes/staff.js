import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, transaction, update } from '../db/index.js'
import { audit } from '../lib/audit.js'
import { requirePermission } from '../lib/auth.js'
import { notify, nowIso } from '../lib/domain.js'
import { HttpError, cents, conflict, dateStr, findOr404, flag, id, idParam, optionalId, optionalText, paginate, registerCrud, text, timeStr, validate } from '../lib/http.js'
import { strongPassword } from './auth.js'

export const staffRouter = Router()

const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_technician', 'accountant']
const PUBLIC_FIELDS = `u.id, u.name, u.email, u.role, u.phone, u.department_id, u.specialization, u.license_no,
  u.consultation_fee_cents, u.active, u.last_login_at, u.created_at, d.name AS department_name`
const FROM = 'users u LEFT JOIN departments d ON d.id = u.department_id'

/* ---------- Departments ---------- */

registerCrud(staffRouter, '/departments', {
  table: 'departments',
  read: 'dashboard:read',
  write: 'departments:write',
  order: 'name',
  search: ['name', 'code'],
  schema: z.object({
    name: text(80),
    code: text(10),
    location: optionalText(120),
    phone: optionalText(40),
    description: optionalText(500),
    active: flag.optional(),
  }),
})

/* ---------- Doctor directory (any signed-in user) ---------- */

staffRouter.get('/doctors', (req, res) => {
  const where = [`u.role = 'doctor'`, 'u.active = 1']
  const params = []
  if (req.query.department_id) {
    where.push('u.department_id = ?')
    params.push(String(req.query.department_id))
  }
  res.json(
    paginate(req, {
      select: `u.id, u.name, u.phone, u.specialization, u.department_id, u.consultation_fee_cents, d.name AS department_name`,
      from: FROM,
      where,
      params,
      search: ['u.name', 'u.specialization', 'd.name'],
      order: 'u.name',
    }),
  )
})

const blockSchema = z
  .object({ weekday: z.coerce.number().int().min(0).max(6), start_time: timeStr, end_time: timeStr, slot_minutes: z.coerce.number().int().min(5).max(120) })
  .refine((block) => block.start_time < block.end_time, { path: ['end_time'], message: 'End time must be after start time' })

staffRouter.get('/doctors/:id/schedule', (req, res) => {
  res.json(all('SELECT * FROM doctor_schedules WHERE doctor_id = ? ORDER BY weekday, start_time', idParam(req)))
})

staffRouter.put('/doctors/:id/schedule', requirePermission('schedules:write'), validate(z.object({ blocks: z.array(blockSchema) })), (req, res) => {
  const doctorId = idParam(req)
  const doctor = findOr404('users', doctorId, 'Doctor')
  if (doctor.role !== 'doctor') throw conflict('Schedules only apply to doctors')
  transaction(() => {
    run('DELETE FROM doctor_schedules WHERE doctor_id = ?', doctorId)
    for (const block of req.body.blocks) insert('doctor_schedules', { ...block, doctor_id: doctorId })
  })
  res.json(all('SELECT * FROM doctor_schedules WHERE doctor_id = ? ORDER BY weekday, start_time', doctorId))
})

/* ---------- Staff accounts ---------- */

staffRouter.get('/users', requirePermission('staff:read'), (req, res) => {
  const where = []
  const params = []
  if (req.query.role) {
    where.push('u.role = ?')
    params.push(String(req.query.role))
  }
  if (req.query.department_id) {
    where.push('u.department_id = ?')
    params.push(String(req.query.department_id))
  }
  res.json(paginate(req, { select: PUBLIC_FIELDS, from: FROM, where, params, search: ['u.name', 'u.email', 'u.specialization'], order: 'u.active DESC, u.name' }))
})

const userFields = {
  name: text(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  role: z.enum(ROLES),
  phone: optionalText(40),
  department_id: optionalId,
  specialization: optionalText(80),
  license_no: optionalText(40),
  consultation_fee_cents: cents.optional(),
}

staffRouter.post('/users', requirePermission('staff:write'), validate(z.object({ ...userFields, password: strongPassword })), async (req, res) => {
  const { password, ...data } = req.body
  const hash = await bcrypt.hash(password, 10)
  const userId = insert('users', { ...data, password_hash: hash, must_change_password: 1 })
  res.status(201).json(get(`SELECT ${PUBLIC_FIELDS} FROM ${FROM} WHERE u.id = ?`, userId))
})

function assertNotLastAdmin(user) {
  if (user.role !== 'admin' || !user.active) return
  const { count } = get(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1`)
  if (count <= 1) throw conflict('The hospital must keep at least one active administrator')
}

staffRouter.patch('/users/:id', requirePermission('staff:write'), validate(z.object({ ...userFields, active: flag.optional() }).partial()), (req, res) => {
  const userId = idParam(req)
  const user = findOr404('users', userId, 'Staff member')
  if ((req.body.role && req.body.role !== 'admin') || req.body.active === 0) assertNotLastAdmin(user)
  update('users', userId, req.body)
  if (req.body.active === 0 || (req.body.role && req.body.role !== user.role)) {
    // A role change or deactivation ends the person's open sessions right away.
    run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', userId)
  }
  res.json(get(`SELECT ${PUBLIC_FIELDS} FROM ${FROM} WHERE u.id = ?`, userId))
})

staffRouter.post('/users/:id/reset-password', requirePermission('staff:write'), async (req, res) => {
  const userId = idParam(req)
  findOr404('users', userId, 'Staff member')
  const temporary = `${randomBytes(6).toString('base64url')}7a`
  const hash = await bcrypt.hash(temporary, 10)
  run('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?', hash, userId)
  audit(req, 'reset_password', 'users', userId)
  res.json({ temporary_password: temporary })
})

/* ---------- Duty roster ---------- */

staffRouter.get('/shifts', requirePermission('dashboard:read'), (req, res) => {
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!from || !to) throw new HttpError(400, 'Provide a date range')
  res.json(
    all(
      `SELECT s.*, u.name AS user_name, u.role, d.name AS department_name FROM shifts s JOIN users u ON u.id = s.user_id
       LEFT JOIN departments d ON d.id = u.department_id WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.shift, u.name`,
      from,
      to,
    ),
  )
})

staffRouter.post(
  '/shifts',
  requirePermission('hr:manage'),
  validate(z.object({ user_id: id, date: dateStr, shift: z.enum(['morning', 'evening', 'night']), notes: optionalText(200) })),
  (req, res) => {
    findOr404('users', req.body.user_id, 'Staff member')
    res.status(201).json(findOr404('shifts', insert('shifts', req.body)))
  },
)

staffRouter.delete('/shifts/:id', requirePermission('hr:manage'), (req, res) => {
  const shiftId = idParam(req)
  findOr404('shifts', shiftId, 'Shift')
  run('DELETE FROM shifts WHERE id = ?', shiftId)
  res.status(204).end()
})

/* ---------- Leave ---------- */

staffRouter.get('/leave', (req, res) => {
  const canManage = req.user.role === 'admin'
  const where = canManage && req.query.mine !== '1' ? [] : ['l.user_id = ?']
  const params = where.length ? [req.user.id] : []
  if (req.query.status) {
    where.push('l.status = ?')
    params.push(String(req.query.status))
  }
  res.json(
    paginate(req, {
      select: `l.*, u.name AS user_name, u.role, dec.name AS decided_by_name`,
      from: 'leave_requests l JOIN users u ON u.id = l.user_id LEFT JOIN users dec ON dec.id = l.decided_by',
      where,
      params,
      order: `CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.start_date DESC`,
    }),
  )
})

staffRouter.post(
  '/leave',
  validate(
    z
      .object({ type: z.enum(['annual', 'sick', 'unpaid', 'other']), start_date: dateStr, end_date: dateStr, reason: optionalText(500) })
      .refine((value) => value.start_date <= value.end_date, { path: ['end_date'], message: 'Must be on or after the start date' }),
  ),
  (req, res) => {
    res.status(201).json(findOr404('leave_requests', insert('leave_requests', { ...req.body, user_id: req.user.id })))
  },
)

staffRouter.post('/leave/:id/decide', requirePermission('hr:manage'), validate(z.object({ status: z.enum(['approved', 'rejected']) })), (req, res) => {
  const leaveId = idParam(req)
  const leave = findOr404('leave_requests', leaveId, 'Leave request')
  if (leave.status !== 'pending') throw conflict('This request has already been decided')
  if (leave.user_id === req.user.id) throw new HttpError(403, 'You cannot decide your own leave request')
  transaction(() => {
    update('leave_requests', leaveId, { status: req.body.status, decided_by: req.user.id, decided_at: nowIso() })
    notify(leave.user_id, { title: `Leave ${req.body.status}`, body: `${leave.start_date} to ${leave.end_date}`, link: '/hr' })
  })
  res.json(findOr404('leave_requests', leaveId))
})
