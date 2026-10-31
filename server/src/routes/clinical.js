import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, nowIsoSql, run, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { allergyConflicts, notifyRole } from '../lib/domain.js'
import { HttpError, conflict, findOr404, id, idParam, optionalDate, optionalId, optionalNumber, optionalText, paginate, text, validate } from '../lib/http.js'
import { completeAppointment } from './appointments.js'

export const clinicalRouter = Router()

/* ---------- Encounters (SOAP notes) ---------- */

const noteFields = {
  chief_complaint: optionalText(500),
  subjective: optionalText(5000),
  objective: optionalText(5000),
  assessment: optionalText(5000),
  plan: optionalText(5000),
  diagnosis: optionalText(300),
  icd_code: optionalText(20),
  follow_up_date: optionalDate,
}

const ENCOUNTER_SELECT = `e.*, u.name AS doctor_name, p.first_name || ' ' || p.last_name AS patient_name, p.mrn`
const ENCOUNTER_FROM = `encounters e JOIN users u ON u.id = e.doctor_id JOIN patients p ON p.id = e.patient_id`

clinicalRouter.get('/encounters', requirePermission('clinical:read'), (req, res) => {
  const where = []
  const params = []
  for (const key of ['patient_id', 'doctor_id', 'admission_id', 'status']) {
    if (req.query[key]) {
      where.push(`e.${key} = ?`)
      params.push(String(req.query[key]))
    }
  }
  res.json(paginate(req, { select: ENCOUNTER_SELECT, from: ENCOUNTER_FROM, where, params, order: 'e.created_at DESC', search: ['e.diagnosis', 'p.last_name', 'p.mrn'] }))
})

clinicalRouter.get('/encounters/:id', requirePermission('clinical:read'), (req, res) => {
  const encounter = get(`SELECT ${ENCOUNTER_SELECT} FROM ${ENCOUNTER_FROM} WHERE e.id = ?`, idParam(req))
  if (!encounter) throw new HttpError(404, 'Encounter not found')
  res.json(encounter)
})

/** Opening a visit is idempotent: re-opening an appointment returns its existing note. */
clinicalRouter.post(
  '/encounters',
  requirePermission('clinical:write'),
  validate(z.object({ patient_id: id, appointment_id: optionalId, admission_id: optionalId, type: z.enum(['opd', 'ipd', 'er']).optional(), ...noteFields })),
  (req, res) => {
    findOr404('patients', req.body.patient_id, 'Patient')
    if (req.body.appointment_id) {
      const existing = get('SELECT * FROM encounters WHERE appointment_id = ?', req.body.appointment_id)
      if (existing) return res.json(existing)
      const appointment = findOr404('appointments', req.body.appointment_id, 'Appointment')
      if (appointment.patient_id !== req.body.patient_id) throw conflict('Appointment belongs to a different patient')
      if (!req.body.chief_complaint) req.body.chief_complaint = appointment.reason
    }
    const encounterId = insert('encounters', { ...req.body, doctor_id: req.user.id })
    res.status(201).json(findOr404('encounters', encounterId))
  },
)

function assertEditable(req, encounter) {
  if (encounter.status === 'signed') throw conflict('A signed note cannot be changed')
  if (encounter.doctor_id !== req.user.id) throw new HttpError(403, 'Only the authoring doctor can edit this note')
}

clinicalRouter.patch('/encounters/:id', requirePermission('clinical:write'), validate(z.object(noteFields).partial()), (req, res) => {
  const encounterId = idParam(req)
  assertEditable(req, findOr404('encounters', encounterId, 'Encounter'))
  update('encounters', encounterId, req.body)
  run(`UPDATE encounters SET updated_at = ${nowIsoSql} WHERE id = ?`, encounterId)
  res.json(findOr404('encounters', encounterId))
})

clinicalRouter.post('/encounters/:id/sign', requirePermission('clinical:write'), (req, res) => {
  const encounterId = idParam(req)
  const encounter = findOr404('encounters', encounterId, 'Encounter')
  assertEditable(req, encounter)
  if (!encounter.assessment && !encounter.diagnosis) {
    throw new HttpError(422, 'Please correct the highlighted fields', { fields: { diagnosis: 'Add a diagnosis or assessment before signing' } })
  }
  transaction(() => {
    run(`UPDATE encounters SET status = 'signed', signed_at = ${nowIsoSql} WHERE id = ?`, encounterId)
    if (encounter.appointment_id) {
      const appointment = findOr404('appointments', encounter.appointment_id)
      if (appointment.status === 'in_progress' || appointment.status === 'checked_in') completeAppointment(appointment, req.user.id)
    }
  })
  res.json(findOr404('encounters', encounterId))
})

/* ---------- Vitals ---------- */

const range = (min, max, label) => optionalNumber(z.coerce.number().min(min, `${label} looks too low`).max(max, `${label} looks too high`))

const vitalsSchema = z.object({
  patient_id: id,
  admission_id: optionalId,
  temperature_c: range(25, 45, 'Temperature'),
  pulse: range(10, 300, 'Pulse'),
  resp_rate: range(2, 90, 'Respiratory rate'),
  systolic: range(40, 300, 'Systolic'),
  diastolic: range(20, 200, 'Diastolic'),
  spo2: range(30, 100, 'SpO2'),
  weight_kg: range(0.2, 500, 'Weight'),
  height_cm: range(20, 260, 'Height'),
  pain_score: range(0, 10, 'Pain score'),
  notes: optionalText(500),
})

clinicalRouter.get('/vitals', requirePermission('clinical:read'), (req, res) => {
  if (!req.query.patient_id) return res.json({ rows: [], total: 0, page: 1, pageSize: 25 })
  res.json(
    paginate(req, {
      select: 'v.*, u.name AS recorded_by_name',
      from: 'vitals v LEFT JOIN users u ON u.id = v.recorded_by',
      where: ['v.patient_id = ?'],
      params: [String(req.query.patient_id)],
      order: 'v.recorded_at DESC',
    }),
  )
})

clinicalRouter.post('/vitals', requirePermission('vitals:write'), validate(vitalsSchema), (req, res) => {
  findOr404('patients', req.body.patient_id, 'Patient')
  res.status(201).json(findOr404('vitals', insert('vitals', { ...req.body, recorded_by: req.user.id })))
})

/* ---------- Prescriptions ---------- */

const RX_SELECT = `rx.*, p.first_name || ' ' || p.last_name AS patient_name, p.mrn, p.allergies AS patient_allergies,
  u.name AS doctor_name, (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = rx.id) AS item_count`
const RX_FROM = `prescriptions rx JOIN patients p ON p.id = rx.patient_id JOIN users u ON u.id = rx.doctor_id`

export const prescriptionItems = (prescriptionId) =>
  all(
    `SELECT i.*, m.name AS medicine_name, m.strength, m.form, m.unit_price_cents,
       (SELECT COALESCE(SUM(b.quantity), 0) FROM medicine_batches b
        WHERE b.medicine_id = i.medicine_id AND b.expiry_date >= date('now','localtime')) AS in_stock
     FROM prescription_items i JOIN medicines m ON m.id = i.medicine_id WHERE i.prescription_id = ?`,
    prescriptionId,
  )

clinicalRouter.get('/prescriptions', requirePermission('prescriptions:read'), (req, res) => {
  const where = []
  const params = []
  if (req.query.patient_id) {
    where.push('rx.patient_id = ?')
    params.push(String(req.query.patient_id))
  }
  if (req.query.encounter_id) {
    where.push('rx.encounter_id = ?')
    params.push(String(req.query.encounter_id))
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',')
    where.push(`rx.status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  const page = paginate(req, { select: RX_SELECT, from: RX_FROM, where, params, order: 'rx.created_at DESC', search: ['p.first_name', 'p.last_name', 'p.mrn'] })
  res.json({ ...page, rows: page.rows.map((row) => ({ ...row, items: prescriptionItems(row.id) })) })
})

const prescriptionSchema = z.object({
  patient_id: id,
  encounter_id: optionalId,
  notes: optionalText(500),
  allergy_override: z.boolean().optional(),
  items: z
    .array(
      z.object({
        medicine_id: id,
        dose: text(60),
        frequency: text(60),
        route: optionalText(40),
        duration_days: optionalNumber(z.coerce.number().int().positive()),
        quantity: z.coerce.number().int().positive('Enter a quantity'),
        instructions: optionalText(300),
      }),
    )
    .min(1, 'Add at least one medicine'),
})

clinicalRouter.post('/prescriptions', requirePermission('prescriptions:write'), validate(prescriptionSchema), (req, res) => {
  const { items, allergy_override: override, ...data } = req.body
  const patient = findOr404('patients', data.patient_id, 'Patient')
  const medicines = items.map((item) => findOr404('medicines', item.medicine_id, 'Medicine'))
  const conflicts = allergyConflicts(patient, medicines)
  if (conflicts.length && !override) {
    throw conflict('This patient has a recorded allergy to a prescribed medicine', { allergy_conflicts: conflicts })
  }
  const prescriptionId = transaction(() => {
    const newId = insert('prescriptions', { ...data, doctor_id: req.user.id, allergy_override: conflicts.length ? 1 : 0 })
    for (const item of items) insert('prescription_items', { ...item, prescription_id: newId })
    notifyRole('pharmacist', { title: 'New prescription', body: `${patient.first_name} ${patient.last_name} (${patient.mrn})`, link: '/pharmacy' })
    return newId
  })
  res.status(201).json({ ...findOr404('prescriptions', prescriptionId), items: prescriptionItems(prescriptionId) })
})

clinicalRouter.post('/prescriptions/:id/cancel', requirePermission('prescriptions:write'), (req, res) => {
  const prescriptionId = idParam(req)
  const prescription = findOr404('prescriptions', prescriptionId, 'Prescription')
  if (prescription.status !== 'active') throw conflict('Only prescriptions that have not been dispensed can be cancelled')
  update('prescriptions', prescriptionId, { status: 'cancelled' })
  res.json(findOr404('prescriptions', prescriptionId))
})
