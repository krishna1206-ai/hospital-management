import { Router } from 'express'
import { z } from 'zod'
import { get, insert, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { notifyRole, nowIso, postCharge, setting } from '../lib/domain.js'
import { HttpError, conflict, findOr404, id, idParam, optionalId, optionalText, paginate, text, validate } from '../lib/http.js'

export const emergencyRouter = Router()

const SELECT = `v.*, p.mrn, p.first_name || ' ' || p.last_name AS patient_name, p.dob AS patient_dob, p.gender AS patient_gender,
  p.blood_group AS patient_blood_group, p.allergies AS patient_allergies, u.name AS doctor_name`
const FROM = `er_visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN users u ON u.id = v.doctor_id`
const ACTIVE = ['waiting', 'in_treatment', 'observation']
const CLOSED = ['admitted', 'discharged', 'transferred', 'left_without_care']

emergencyRouter.get('/', requirePermission('er:read'), (req, res) => {
  const where = []
  if (req.query.board === '1') where.push(`v.status IN (${ACTIVE.map((status) => `'${status}'`).join(',')})`)
  res.json(
    paginate(req, {
      select: SELECT,
      from: FROM,
      where,
      search: ['p.first_name', 'p.last_name', 'p.mrn', 'v.chief_complaint'],
      // Most urgent first; within a triage level, whoever has waited longest.
      order: req.query.board === '1' ? 'v.triage_level, v.arrived_at' : 'v.arrived_at DESC',
    }),
  )
})

emergencyRouter.post(
  '/',
  requirePermission('er:write'),
  validate(
    z.object({
      patient_id: id,
      triage_level: z.coerce.number().int().min(1).max(5),
      chief_complaint: text(500),
      arrival_mode: z.enum(['walk_in', 'ambulance', 'referral', 'police']).optional(),
      doctor_id: optionalId,
      notes: optionalText(2000),
    }),
  ),
  (req, res) => {
    const patient = findOr404('patients', req.body.patient_id, 'Patient')
    if (get(`SELECT id FROM er_visits WHERE patient_id = ? AND status IN ('waiting','in_treatment','observation')`, patient.id)) {
      throw conflict('This patient already has an open emergency visit')
    }
    const visitId = transaction(() => {
      const newId = insert('er_visits', { ...req.body, created_by: req.user.id })
      if (req.body.triage_level <= 2) {
        notifyRole('doctor', {
          title: `Emergency: triage level ${req.body.triage_level}`,
          body: `${patient.first_name} ${patient.last_name}: ${req.body.chief_complaint}`,
          link: '/emergency',
          severity: 'critical',
        })
      }
      return newId
    })
    res.status(201).json(get(`SELECT ${SELECT} FROM ${FROM} WHERE v.id = ?`, visitId))
  },
)

emergencyRouter.patch(
  '/:id',
  requirePermission('er:write'),
  validate(
    z.object({
      status: z.enum([...ACTIVE, ...CLOSED]).optional(),
      triage_level: z.coerce.number().int().min(1).max(5).optional(),
      doctor_id: optionalId,
      notes: optionalText(2000),
    }),
  ),
  (req, res) => {
    const visitId = idParam(req)
    const visit = findOr404('er_visits', visitId, 'Visit')
    if (CLOSED.includes(visit.status)) throw conflict('This visit is closed')
    const changes = { ...req.body }
    const { status } = req.body
    if (status === 'in_treatment' && !(req.body.doctor_id ?? visit.doctor_id)) {
      throw new HttpError(422, 'Please correct the highlighted fields', { fields: { doctor_id: 'Assign a doctor to start treatment' } })
    }
    transaction(() => {
      if (status === 'in_treatment' && !visit.seen_at) {
        changes.seen_at = nowIso()
        // The fee is posted when care starts, so patients who leave unseen aren't billed.
        postCharge({
          patientId: visit.patient_id,
          kind: 'service',
          description: 'Emergency department attendance',
          unitPriceCents: Number(setting('er_fee_cents', 0)),
          sourceType: 'er_visit',
          sourceId: visitId,
          userId: req.user.id,
        })
      }
      if (status && CLOSED.includes(status)) changes.closed_at = nowIso()
      update('er_visits', visitId, changes)
    })
    res.json(get(`SELECT ${SELECT} FROM ${FROM} WHERE v.id = ?`, visitId))
  },
)
