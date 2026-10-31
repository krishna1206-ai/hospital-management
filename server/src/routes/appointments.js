import { Router } from 'express'
import { z } from 'zod'
import { get, insert, nowIsoSql, run, transaction, update } from '../db/index.js'
import { assertCan, requirePermission } from '../lib/auth.js'
import { availableSlots, assertDoctor, doctorOnLeave, notify, postCharge, today } from '../lib/domain.js'
import { badRequest, conflict, dateStr, findOr404, id, idParam, optionalText, paginate, timeStr, validate } from '../lib/http.js'

export const appointmentsRouter = Router()

const TYPES = ['consultation', 'follow_up', 'procedure', 'telehealth']

const SELECT = `ap.*, p.mrn, p.first_name || ' ' || p.last_name AS patient_name, p.phone AS patient_phone,
  p.dob AS patient_dob, p.gender AS patient_gender, p.allergies AS patient_allergies,
  u.name AS doctor_name, d.name AS department_name,
  (SELECT e.id FROM encounters e WHERE e.appointment_id = ap.id) AS encounter_id`
const FROM = `appointments ap JOIN patients p ON p.id = ap.patient_id JOIN users u ON u.id = ap.doctor_id
  LEFT JOIN departments d ON d.id = ap.department_id`

/** Allowed moves through the outpatient workflow. */
const TRANSITIONS = {
  scheduled: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
}

appointmentsRouter.get('/', requirePermission('appointments:read'), (req, res) => {
  const where = []
  const params = []
  const filters = {
    date: 'ap.date = ?',
    doctor_id: 'ap.doctor_id = ?',
    patient_id: 'ap.patient_id = ?',
    department_id: 'ap.department_id = ?',
    from: 'ap.date >= ?',
    to: 'ap.date <= ?',
  }
  for (const [key, clause] of Object.entries(filters)) {
    if (req.query[key]) {
      where.push(clause)
      params.push(String(req.query[key]))
    }
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',')
    where.push(`ap.status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  res.json(
    paginate(req, {
      select: SELECT,
      from: FROM,
      where,
      params,
      search: ['p.first_name', 'p.last_name', 'p.mrn', 'u.name'],
      order: req.query.order === 'queue' ? 'ap.token_no, ap.start_time' : 'ap.date, ap.start_time',
    }),
  )
})

appointmentsRouter.get('/slots', requirePermission('appointments:read'), (req, res) => {
  const doctorId = Number(req.query.doctor_id)
  const date = String(req.query.date || '')
  if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Choose a doctor and date')
  res.json({ slots: availableSlots(doctorId, date), on_leave: Boolean(doctorOnLeave(doctorId, date)) })
})

function assertBookable(doctorId, date, startTime) {
  if (date < today()) throw badRequest('Appointments cannot be booked in the past')
  if (doctorOnLeave(doctorId, date)) throw conflict('The doctor is on leave on this date')
  const slot = availableSlots(doctorId, date).find((candidate) => candidate.start_time === startTime)
  if (!slot) throw conflict('This time slot is no longer available')
  return slot
}

const bookSchema = z.object({
  patient_id: id,
  doctor_id: id,
  date: dateStr,
  start_time: timeStr,
  type: z.enum(TYPES).optional(),
  reason: optionalText(500),
})

appointmentsRouter.post('/', requirePermission('appointments:write'), validate(bookSchema), (req, res) => {
  const { patient_id: patientId, doctor_id: doctorId, date, start_time: startTime } = req.body
  const patient = findOr404('patients', patientId, 'Patient')
  const doctor = assertDoctor(doctorId)
  const slot = assertBookable(doctorId, date, startTime)
  const appointmentId = transaction(() => {
    const newId = insert('appointments', {
      ...req.body,
      department_id: doctor.department_id,
      end_time: slot.end_time,
      created_by: req.user.id,
    })
    notify(doctorId, {
      title: 'New appointment',
      body: `${patient.first_name} ${patient.last_name} on ${date} at ${startTime}`,
      link: '/appointments',
    })
    return newId
  })
  res.status(201).json(get(`SELECT ${SELECT} FROM ${FROM} WHERE ap.id = ?`, appointmentId))
})

appointmentsRouter.post(
  '/:id/reschedule',
  requirePermission('appointments:write'),
  validate(z.object({ date: dateStr, start_time: timeStr, doctor_id: id.optional() })),
  (req, res) => {
    const appointmentId = idParam(req)
    const appointment = findOr404('appointments', appointmentId, 'Appointment')
    if (appointment.status !== 'scheduled') throw conflict('Only scheduled appointments can be rescheduled')
    const doctorId = req.body.doctor_id ?? appointment.doctor_id
    const doctor = assertDoctor(doctorId)
    const slot = assertBookable(doctorId, req.body.date, req.body.start_time)
    update('appointments', appointmentId, {
      doctor_id: doctorId,
      department_id: doctor.department_id,
      date: req.body.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
    })
    res.json(get(`SELECT ${SELECT} FROM ${FROM} WHERE ap.id = ?`, appointmentId))
  },
)

/** Moves an appointment to completed and posts the consultation fee exactly once. */
export function completeAppointment(appointment, userId) {
  run(`UPDATE appointments SET status = 'completed', completed_at = ${nowIsoSql} WHERE id = ?`, appointment.id)
  const doctor = get('SELECT name, consultation_fee_cents FROM users WHERE id = ?', appointment.doctor_id)
  if (doctor.consultation_fee_cents > 0) {
    postCharge({
      patientId: appointment.patient_id,
      kind: 'consultation',
      description: `Consultation: ${doctor.name}`,
      unitPriceCents: doctor.consultation_fee_cents,
      sourceType: 'appointment',
      sourceId: appointment.id,
      userId,
    })
  }
}

appointmentsRouter.post(
  '/:id/status',
  validate(z.object({ status: z.enum(['checked_in', 'in_progress', 'completed', 'cancelled', 'no_show']), cancel_reason: optionalText(300) })),
  (req, res) => {
    // Doctors and front desk manage the workflow; nurses may check patients in and start triage.
    if (req.body.status === 'checked_in') assertCan(req, 'appointments:read')
    else assertCan(req, 'appointments:write')
    const appointmentId = idParam(req)
    const appointment = findOr404('appointments', appointmentId, 'Appointment')
    const { status } = req.body
    if (!TRANSITIONS[appointment.status].includes(status)) {
      throw conflict(`A ${appointment.status.replace('_', ' ')} appointment cannot be marked ${status.replace('_', ' ')}`)
    }
    if (status === 'cancelled' && !req.body.cancel_reason) {
      throw badRequest('Give a reason for cancelling')
    }
    if (status === 'checked_in' && appointment.date !== today()) {
      throw conflict('Patients can only be checked in on the day of their appointment')
    }
    transaction(() => {
      if (status === 'completed') return completeAppointment(appointment, req.user.id)
      const changes = { status }
      if (status === 'checked_in') {
        const { next } = get(
          'SELECT COALESCE(MAX(token_no), 0) + 1 AS next FROM appointments WHERE doctor_id = ? AND date = ?',
          appointment.doctor_id,
          appointment.date,
        )
        changes.token_no = next
        changes.checked_in_at = new Date().toISOString()
      }
      if (status === 'in_progress') changes.started_at = new Date().toISOString()
      if (status === 'cancelled') changes.cancel_reason = req.body.cancel_reason
      update('appointments', appointmentId, changes)
    })
    res.json(get(`SELECT ${SELECT} FROM ${FROM} WHERE ap.id = ?`, appointmentId))
  },
)
