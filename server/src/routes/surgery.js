import { Router } from 'express'
import { z } from 'zod'
import { get, insert, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { assertDoctor, notify, postCharge } from '../lib/domain.js'
import { cents, conflict, dateStr, findOr404, flag, id, idParam, optionalId, optionalText, paginate, registerCrud, text, timeStr, validate } from '../lib/http.js'

export const surgeryRouter = Router()

registerCrud(surgeryRouter, '/theatres', {
  table: 'theatres',
  read: 'surgery:read',
  write: 'surgery:write',
  order: 'name',
  search: ['name'],
  schema: z.object({ name: text(60), location: optionalText(120), active: flag.optional() }),
})

const SELECT = `s.*, p.mrn, p.first_name || ' ' || p.last_name AS patient_name, p.allergies AS patient_allergies, p.blood_group AS patient_blood_group,
  u.name AS surgeon_name, an.name AS anesthetist_name, t.name AS theatre_name`
const FROM = `surgeries s JOIN patients p ON p.id = s.patient_id JOIN users u ON u.id = s.surgeon_id
  LEFT JOIN users an ON an.id = s.anesthetist_id JOIN theatres t ON t.id = s.theatre_id`

surgeryRouter.get('/', requirePermission('surgery:read'), (req, res) => {
  const where = []
  const params = []
  for (const [key, clause] of Object.entries({ date: 's.date = ?', patient_id: 's.patient_id = ?', status: 's.status = ?', from: 's.date >= ?', to: 's.date <= ?' })) {
    if (req.query[key]) {
      where.push(clause)
      params.push(String(req.query[key]))
    }
  }
  res.json(paginate(req, { select: SELECT, from: FROM, where, params, search: ['p.first_name', 'p.last_name', 'p.mrn', 's.procedure_name', 'u.name'], order: 's.date, s.start_time' }))
})

/** Two bookings clash when each starts before the other ends. */
function assertNoClash({ theatre_id: theatreId, surgeon_id: surgeonId, date, start_time: start, end_time: end }, ignoreId = 0) {
  const clash = get(
    `SELECT s.start_time, s.end_time, s.theatre_id, t.name AS theatre_name FROM surgeries s JOIN theatres t ON t.id = s.theatre_id
     WHERE s.date = ? AND s.status IN ('scheduled','in_progress') AND s.id != ?
       AND (s.theatre_id = ? OR s.surgeon_id = ?) AND s.start_time < ? AND s.end_time > ?`,
    date,
    ignoreId,
    theatreId,
    surgeonId,
    end,
    start,
  )
  if (clash) {
    throw conflict(
      clash.theatre_id === theatreId
        ? `${clash.theatre_name} is booked ${clash.start_time}-${clash.end_time}`
        : `The surgeon is in theatre ${clash.start_time}-${clash.end_time}`,
    )
  }
}

const schema = z
  .object({
    patient_id: id,
    surgeon_id: id,
    anesthetist_id: optionalId,
    theatre_id: id,
    procedure_name: text(200),
    date: dateStr,
    start_time: timeStr,
    end_time: timeStr,
    anesthesia_type: optionalText(40),
    price_cents: cents.optional(),
    pre_op_notes: optionalText(4000),
  })
  .refine((value) => value.start_time < value.end_time, { path: ['end_time'], message: 'End time must be after start time' })

surgeryRouter.post('/', requirePermission('surgery:write'), validate(schema), (req, res) => {
  const patient = findOr404('patients', req.body.patient_id, 'Patient')
  assertDoctor(req.body.surgeon_id)
  findOr404('theatres', req.body.theatre_id, 'Theatre')
  assertNoClash(req.body)
  const admission = get(`SELECT id FROM admissions WHERE patient_id = ? AND status = 'admitted'`, patient.id)
  const surgeryId = transaction(() => {
    const newId = insert('surgeries', { ...req.body, admission_id: admission?.id ?? null, created_by: req.user.id })
    notify(req.body.surgeon_id, {
      title: 'Surgery scheduled',
      body: `${req.body.procedure_name}: ${req.body.date} at ${req.body.start_time}`,
      link: '/surgery',
    })
    return newId
  })
  res.status(201).json(get(`SELECT ${SELECT} FROM ${FROM} WHERE s.id = ?`, surgeryId))
})

const TRANSITIONS = { scheduled: ['in_progress', 'cancelled'], in_progress: ['completed'], completed: [], cancelled: [] }

surgeryRouter.post(
  '/:id/status',
  requirePermission('surgery:write'),
  validate(z.object({ status: z.enum(['in_progress', 'completed', 'cancelled']), post_op_notes: optionalText(4000) })),
  (req, res) => {
    const surgeryId = idParam(req)
    const surgery = findOr404('surgeries', surgeryId, 'Surgery')
    if (!TRANSITIONS[surgery.status].includes(req.body.status)) {
      throw conflict(`A ${surgery.status.replace('_', ' ')} surgery cannot be marked ${req.body.status.replace('_', ' ')}`)
    }
    transaction(() => {
      update('surgeries', surgeryId, req.body)
      if (req.body.status === 'completed' && surgery.price_cents > 0) {
        postCharge({
          patientId: surgery.patient_id,
          admissionId: surgery.admission_id,
          kind: 'surgery',
          description: surgery.procedure_name,
          unitPriceCents: surgery.price_cents,
          sourceType: 'surgery',
          sourceId: surgeryId,
          userId: req.user.id,
        })
      }
    })
    res.json(get(`SELECT ${SELECT} FROM ${FROM} WHERE s.id = ?`, surgeryId))
  },
)
