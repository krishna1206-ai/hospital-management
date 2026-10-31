import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, nextNumber, nowIsoSql, run, update } from '../db/index.js'
import { audit } from '../lib/audit.js'
import { requirePermission } from '../lib/auth.js'
import { BLOOD_GROUPS, conflict, dateStr, findOr404, idParam, optionalText, paginate, text, validate } from '../lib/http.js'
import { can } from '../lib/permissions.js'
import { today } from '../lib/domain.js'

export const patientsRouter = Router()

const patientFields = {
  first_name: text(80),
  last_name: text(80),
  dob: dateStr.refine((value) => value <= today(), 'Date of birth cannot be in the future'),
  gender: z.enum(['male', 'female', 'other'], { message: 'Required' }),
  blood_group: z.preprocess((value) => (value === '' ? null : value), z.enum(BLOOD_GROUPS).nullish()),
  phone: text(40),
  email: z.preprocess((value) => (value === '' ? null : value), z.string().trim().email('Enter a valid email').nullish()),
  address: optionalText(300),
  city: optionalText(80),
  national_id: optionalText(40),
  marital_status: optionalText(30),
  occupation: optionalText(80),
  emergency_name: optionalText(120),
  emergency_phone: optionalText(40),
  emergency_relation: optionalText(40),
  allergies: optionalText(500),
  chronic_conditions: optionalText(500),
  insurance_provider: optionalText(120),
  insurance_policy: optionalText(80),
}
const patientSchema = z.object(patientFields)
const createSchema = patientSchema.extend({ allow_duplicate: z.boolean().optional() })

const SEARCH = ['mrn', 'first_name', 'last_name', `first_name || ' ' || last_name`, 'phone', 'national_id']

patientsRouter.get('/', requirePermission('patients:read'), (req, res) => {
  const where = []
  const params = []
  if (req.query.includeInactive !== '1') where.push('p.active = 1')
  if (req.query.gender) {
    where.push('p.gender = ?')
    params.push(String(req.query.gender))
  }
  res.json(
    paginate(req, {
      select: `p.id, p.mrn, p.first_name, p.last_name, p.dob, p.gender, p.blood_group, p.phone, p.city, p.allergies,
        p.insurance_provider, p.active, p.created_at,
        (SELECT a.id FROM admissions a WHERE a.patient_id = p.id AND a.status = 'admitted') AS admission_id,
        (SELECT MAX(ap.date) FROM appointments ap WHERE ap.patient_id = p.id AND ap.status = 'completed') AS last_visit`,
      from: 'patients p',
      where,
      params,
      search: SEARCH.map((column) => (column.includes(' ') ? `p.first_name || ' ' || p.last_name` : `p.${column}`)),
      order: 'p.created_at DESC, p.id DESC',
    }),
  )
})

patientsRouter.post('/', requirePermission('patients:write'), validate(createSchema), (req, res) => {
  const { allow_duplicate: allowDuplicate, ...data } = req.body
  if (!allowDuplicate) {
    const existing = get(
      `SELECT id, mrn, first_name, last_name, phone, dob FROM patients
       WHERE dob = ? AND (phone = ? OR (lower(first_name) = lower(?) AND lower(last_name) = lower(?)))`,
      data.dob,
      data.phone,
      data.first_name,
      data.last_name,
    )
    if (existing) throw conflict('A patient with matching details is already registered', { duplicate: existing })
  }
  const id = insert('patients', { ...data, mrn: nextNumber('MRN', { yearly: false }), created_by: req.user.id })
  res.status(201).json(findOr404('patients', id))
})

patientsRouter.get('/:id', requirePermission('patients:read'), (req, res) => {
  const id = idParam(req)
  const patient = findOr404('patients', id, 'Patient')
  audit(req, 'view', 'patients', id) // Access to a patient's record is itself part of the audit trail.
  const admission = get(
    `SELECT a.id, a.admission_no, a.admitted_at, b.number AS bed_number, w.name AS ward_name
     FROM admissions a JOIN beds b ON b.id = a.bed_id JOIN wards w ON w.id = b.ward_id
     WHERE a.patient_id = ? AND a.status = 'admitted'`,
    id,
  )
  const latestVitals = can(req.user.role, 'clinical:read')
    ? get('SELECT * FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 1', id)
    : null
  const canSeeBilling = can(req.user.role, 'billing:read')
  const balance = canSeeBilling
    ? get(`SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS due FROM invoices WHERE patient_id = ? AND status IN ('unpaid','partial')`, id).due
    : null
  const nextAppointment = get(
    `SELECT ap.id, ap.date, ap.start_time, u.name AS doctor_name FROM appointments ap JOIN users u ON u.id = ap.doctor_id
     WHERE ap.patient_id = ? AND ap.status = 'scheduled' AND ap.date >= ? ORDER BY ap.date, ap.start_time LIMIT 1`,
    id,
    today(),
  )
  res.json({ ...patient, current_admission: admission ?? null, latest_vitals: latestVitals ?? null, balance_due_cents: balance, next_appointment: nextAppointment ?? null })
})

patientsRouter.patch('/:id', requirePermission('patients:write'), validate(patientSchema.partial()), (req, res) => {
  const id = idParam(req)
  findOr404('patients', id, 'Patient')
  update('patients', id, req.body)
  run(`UPDATE patients SET updated_at = ${nowIsoSql} WHERE id = ?`, id)
  res.json(findOr404('patients', id))
})

patientsRouter.get('/:id/appointments', requirePermission('appointments:read'), (req, res) => {
  res.json(
    all(
      `SELECT ap.*, u.name AS doctor_name, d.name AS department_name FROM appointments ap
       JOIN users u ON u.id = ap.doctor_id LEFT JOIN departments d ON d.id = ap.department_id
       WHERE ap.patient_id = ? ORDER BY ap.date DESC, ap.start_time DESC LIMIT 100`,
      idParam(req),
    ),
  )
})
