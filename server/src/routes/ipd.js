import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, nextNumber, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { assertDoctor, billableDays, notify, nowIso, postCharge } from '../lib/domain.js'
import { HttpError, badRequest, cents, conflict, findOr404, id, idParam, optionalDate, optionalId, optionalText, paginate, text, validate } from '../lib/http.js'

export const ipdRouter = Router()

const WARD_TYPES = ['general', 'private', 'semi_private', 'icu', 'nicu', 'maternity', 'isolation']

const wardSchema = z.object({
  name: text(80),
  type: z.enum(WARD_TYPES),
  floor: optionalText(20),
  department_id: optionalId,
  daily_rate_cents: cents,
})

ipdRouter.get('/wards', requirePermission('ipd:read'), (_req, res) => {
  res.json(
    all(
      `SELECT w.*, d.name AS department_name,
        (SELECT COUNT(*) FROM beds b WHERE b.ward_id = w.id) AS bed_count,
        (SELECT COUNT(*) FROM beds b WHERE b.ward_id = w.id AND b.status = 'occupied') AS occupied_count
       FROM wards w LEFT JOIN departments d ON d.id = w.department_id ORDER BY w.name`,
    ),
  )
})

ipdRouter.post('/wards', requirePermission('ipd:config'), validate(wardSchema.extend({ bed_count: z.coerce.number().int().min(0).max(100).optional() })), (req, res) => {
  const { bed_count: bedCount = 0, ...data } = req.body
  const wardId = transaction(() => {
    const newId = insert('wards', data)
    for (let number = 1; number <= bedCount; number++) insert('beds', { ward_id: newId, number: String(number) })
    return newId
  })
  res.status(201).json(findOr404('wards', wardId))
})

ipdRouter.patch('/wards/:id', requirePermission('ipd:config'), validate(wardSchema.partial()), (req, res) => {
  const wardId = idParam(req)
  findOr404('wards', wardId, 'Ward')
  update('wards', wardId, req.body)
  res.json(findOr404('wards', wardId))
})

ipdRouter.post('/wards/:id/beds', requirePermission('ipd:config'), validate(z.object({ number: text(20) })), (req, res) => {
  const wardId = idParam(req)
  findOr404('wards', wardId, 'Ward')
  res.status(201).json(findOr404('beds', insert('beds', { ward_id: wardId, number: req.body.number })))
})

/** The whole hospital floor plan: every ward, every bed, and who is in it. */
ipdRouter.get('/bed-board', requirePermission('ipd:read'), (_req, res) => {
  const beds = all(
    `SELECT b.*, a.id AS admission_id, a.admitted_at, a.reason, a.expected_discharge, p.id AS patient_id, p.mrn,
       p.first_name || ' ' || p.last_name AS patient_name, u.name AS doctor_name
     FROM beds b
     LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'admitted'
     LEFT JOIN patients p ON p.id = a.patient_id
     LEFT JOIN users u ON u.id = a.doctor_id
     ORDER BY b.ward_id, CAST(b.number AS INTEGER), b.number`,
  )
  const wards = all('SELECT * FROM wards ORDER BY name').map((ward) => ({ ...ward, beds: beds.filter((bed) => bed.ward_id === ward.id) }))
  res.json({ wards })
})

ipdRouter.patch(
  '/beds/:id/status',
  requirePermission('ipd:care', 'ipd:config'),
  validate(z.object({ status: z.enum(['available', 'cleaning', 'maintenance']) })),
  (req, res) => {
    const bedId = idParam(req)
    const bed = findOr404('beds', bedId, 'Bed')
    if (bed.status === 'occupied') throw conflict('This bed is occupied. Transfer or discharge the patient first.')
    update('beds', bedId, { status: req.body.status })
    res.json(findOr404('beds', bedId))
  },
)

const SELECT = `a.*, p.mrn, p.first_name || ' ' || p.last_name AS patient_name, p.dob AS patient_dob, p.gender AS patient_gender,
  p.allergies AS patient_allergies, u.name AS doctor_name, b.number AS bed_number, w.name AS ward_name, w.type AS ward_type`
const FROM = `admissions a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = a.doctor_id
  JOIN beds b ON b.id = a.bed_id JOIN wards w ON w.id = b.ward_id`

ipdRouter.get('/admissions', requirePermission('ipd:read'), (req, res) => {
  const where = []
  const params = []
  for (const key of ['status', 'patient_id', 'doctor_id']) {
    if (req.query[key]) {
      where.push(`a.${key} = ?`)
      params.push(String(req.query[key]))
    }
  }
  res.json(paginate(req, { select: SELECT, from: FROM, where, params, search: ['a.admission_no', 'p.first_name', 'p.last_name', 'p.mrn'], order: 'a.admitted_at DESC' }))
})

ipdRouter.get('/admissions/:id', requirePermission('ipd:read'), (req, res) => {
  const admissionId = idParam(req)
  const admission = get(`SELECT ${SELECT} FROM ${FROM} WHERE a.id = ?`, admissionId)
  if (!admission) throw new HttpError(404, 'Admission not found')
  res.json({
    ...admission,
    stays: all(
      `SELECT s.*, b.number AS bed_number, w.name AS ward_name, u.name AS moved_by_name FROM bed_stays s
       JOIN beds b ON b.id = s.bed_id JOIN wards w ON w.id = b.ward_id LEFT JOIN users u ON u.id = s.moved_by
       WHERE s.admission_id = ? ORDER BY s.started_at DESC`,
      admissionId,
    ),
    notes: all(
      `SELECT n.*, u.name AS author_name, u.role AS author_role FROM nursing_notes n LEFT JOIN users u ON u.id = n.author_id
       WHERE n.admission_id = ? ORDER BY n.created_at DESC`,
      admissionId,
    ),
  })
})

function claimBed(bedId) {
  const bed = findOr404('beds', bedId, 'Bed')
  if (bed.status !== 'available') throw conflict(`Bed ${bed.number} is ${bed.status}`)
  update('beds', bedId, { status: 'occupied' })
  return { bed, ward: findOr404('wards', bed.ward_id) }
}

ipdRouter.post(
  '/admissions',
  requirePermission('ipd:admit'),
  validate(
    z.object({
      patient_id: id,
      doctor_id: id,
      bed_id: id,
      department_id: optionalId,
      reason: text(500),
      diagnosis: optionalText(300),
      expected_discharge: optionalDate,
    }),
  ),
  (req, res) => {
    const patient = findOr404('patients', req.body.patient_id, 'Patient')
    const doctor = assertDoctor(req.body.doctor_id)
    if (get(`SELECT id FROM admissions WHERE patient_id = ? AND status = 'admitted'`, patient.id)) {
      throw conflict('This patient is already admitted')
    }
    const admissionId = transaction(() => {
      const { bed, ward } = claimBed(req.body.bed_id)
      const newId = insert('admissions', {
        ...req.body,
        department_id: req.body.department_id ?? ward.department_id ?? doctor.department_id,
        admission_no: nextNumber('ADM'),
        created_by: req.user.id,
      })
      insert('bed_stays', { admission_id: newId, bed_id: bed.id, daily_rate_cents: ward.daily_rate_cents, started_at: nowIso(), moved_by: req.user.id })
      notify(doctor.id, {
        title: 'New admission under your care',
        body: `${patient.first_name} ${patient.last_name}: ${ward.name}, bed ${bed.number}`,
        link: `/admissions/${newId}`,
      })
      return newId
    })
    res.status(201).json(findOr404('admissions', admissionId))
  },
)

function openAdmission(admissionId) {
  const admission = findOr404('admissions', admissionId, 'Admission')
  if (admission.status !== 'admitted') throw conflict('This patient has already been discharged')
  return admission
}

ipdRouter.post(
  '/admissions/:id/transfer',
  requirePermission('ipd:care', 'ipd:admit'),
  validate(z.object({ bed_id: id, reason: optionalText(300) })),
  (req, res) => {
    const admissionId = idParam(req)
    const admission = openAdmission(admissionId)
    if (admission.bed_id === req.body.bed_id) throw badRequest('The patient is already in this bed')
    transaction(() => {
      const now = nowIso()
      const { bed, ward } = claimBed(req.body.bed_id)
      update('beds', admission.bed_id, { status: 'cleaning' })
      const stay = get('SELECT id FROM bed_stays WHERE admission_id = ? AND ended_at IS NULL', admissionId)
      update('bed_stays', stay.id, { ended_at: now })
      insert('bed_stays', {
        admission_id: admissionId,
        bed_id: bed.id,
        daily_rate_cents: ward.daily_rate_cents,
        started_at: now,
        reason: req.body.reason,
        moved_by: req.user.id,
      })
      update('admissions', admissionId, { bed_id: bed.id })
    })
    res.json(findOr404('admissions', admissionId))
  },
)

ipdRouter.post('/admissions/:id/notes', requirePermission('ipd:care'), validate(z.object({ note: text(4000) })), (req, res) => {
  const admissionId = idParam(req)
  openAdmission(admissionId)
  res.status(201).json(findOr404('nursing_notes', insert('nursing_notes', { admission_id: admissionId, note: req.body.note, author_id: req.user.id })))
})

ipdRouter.post(
  '/admissions/:id/discharge',
  requirePermission('ipd:discharge'),
  validate(
    z.object({
      discharge_condition: z.enum(['recovered', 'improved', 'unchanged', 'referred', 'against_advice', 'deceased']),
      discharge_summary: text(8000),
      discharge_instructions: optionalText(4000),
    }),
  ),
  (req, res) => {
    const admissionId = idParam(req)
    const admission = openAdmission(admissionId)
    transaction(() => {
      const now = nowIso()
      const openStay = get('SELECT id FROM bed_stays WHERE admission_id = ? AND ended_at IS NULL', admissionId)
      update('bed_stays', openStay.id, { ended_at: now })
      update('admissions', admissionId, { ...req.body, status: 'discharged', discharged_at: now })
      update('beds', admission.bed_id, { status: 'cleaning' })

      // Bed charges roll up per ward so transfers bill at each ward's own rate.
      const stays = all(
        `SELECT s.*, w.name AS ward_name, b.number AS bed_number FROM bed_stays s JOIN beds b ON b.id = s.bed_id JOIN wards w ON w.id = b.ward_id
         WHERE s.admission_id = ? ORDER BY s.started_at`,
        admissionId,
      )
      const lines = stays.map((stay) => ({ stay, days: billableDays(stay.started_at, stay.ended_at) }))
      if (lines.every((line) => line.days === 0)) lines.at(-1).days = 1 // A same-day stay is still one billable day.
      for (const { stay, days } of lines) {
        if (days === 0) continue
        postCharge({
          patientId: admission.patient_id,
          admissionId,
          kind: 'bed',
          description: `${stay.ward_name}, bed ${stay.bed_number} (${days} day${days === 1 ? '' : 's'})`,
          quantity: days,
          unitPriceCents: stay.daily_rate_cents,
          sourceType: 'bed_stay',
          sourceId: stay.id,
          userId: req.user.id,
        })
      }
    })
    res.json(findOr404('admissions', admissionId))
  },
)
