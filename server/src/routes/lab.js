import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, nextNumber, run, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { notify, nowIso, postCharge } from '../lib/domain.js'
import { badRequest, cents, conflict, findOr404, flag, id, idParam, notFound, optionalId, optionalNumber, optionalText, paginate, registerCrud, text, validate } from '../lib/http.js'

export const labRouter = Router()

registerCrud(labRouter, '/tests', {
  table: 'lab_tests',
  read: 'lab:read',
  write: 'lab:catalog',
  order: 'category, name',
  search: ['name', 'code'],
  schema: z.object({
    code: text(20),
    name: text(120),
    category: z.enum(['laboratory', 'radiology']),
    specimen: optionalText(60),
    unit: optionalText(30),
    ref_low: optionalNumber(),
    ref_high: optionalNumber(),
    critical_low: optionalNumber(),
    critical_high: optionalNumber(),
    price_cents: cents,
    turnaround_hours: optionalNumber(z.coerce.number().int().positive()),
    active: flag.optional(),
  }),
})

const SELECT = `o.*, p.first_name || ' ' || p.last_name AS patient_name, p.mrn, p.dob AS patient_dob, p.gender AS patient_gender, u.name AS doctor_name,
  (SELECT GROUP_CONCAT(t.name, ', ') FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id WHERE i.order_id = o.id) AS test_names,
  (SELECT COUNT(*) FROM lab_order_items i WHERE i.order_id = o.id AND i.flag = 'critical') AS critical_count`
const FROM = `lab_orders o JOIN patients p ON p.id = o.patient_id JOIN users u ON u.id = o.doctor_id`

const orderItems = (orderId) =>
  all(
    `SELECT i.*, t.code, t.name, t.category, t.specimen, t.unit, t.ref_low, t.ref_high, t.critical_low, t.critical_high, r.name AS resulted_by_name
     FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id LEFT JOIN users r ON r.id = i.resulted_by WHERE i.order_id = ?`,
    orderId,
  )

labRouter.get('/orders', requirePermission('lab:read'), (req, res) => {
  const where = []
  const params = []
  for (const key of ['patient_id', 'doctor_id', 'priority', 'encounter_id']) {
    if (req.query[key]) {
      where.push(`o.${key} = ?`)
      params.push(String(req.query[key]))
    }
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',')
    where.push(`o.status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  res.json(
    paginate(req, {
      select: SELECT,
      from: FROM,
      where,
      params,
      search: ['o.order_no', 'p.first_name', 'p.last_name', 'p.mrn'],
      order: `CASE WHEN o.status IN ('completed','cancelled') THEN 1 ELSE 0 END,
              CASE o.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END, o.created_at DESC`,
    }),
  )
})

labRouter.get('/orders/:id', requirePermission('lab:read'), (req, res) => {
  const orderId = idParam(req)
  const order = get(`SELECT ${SELECT} FROM ${FROM} WHERE o.id = ?`, orderId)
  if (!order) throw notFound('Order')
  res.json({ ...order, items: orderItems(orderId) })
})

labRouter.post(
  '/orders',
  requirePermission('lab:order'),
  validate(
    z.object({
      patient_id: id,
      test_ids: z.array(id).min(1, 'Select at least one test'),
      priority: z.enum(['routine', 'urgent', 'stat']).optional(),
      notes: optionalText(500),
      encounter_id: optionalId,
    }),
  ),
  (req, res) => {
    const { test_ids: rawTestIds, ...data } = req.body
    findOr404('patients', data.patient_id, 'Patient')
    const admission = get(`SELECT id FROM admissions WHERE patient_id = ? AND status = 'admitted'`, data.patient_id)
    const tests = [...new Set(rawTestIds)].map((testId) => findOr404('lab_tests', testId, 'Test'))
    const orderId = transaction(() => {
      const newId = insert('lab_orders', {
        ...data,
        order_no: nextNumber('LAB'),
        doctor_id: req.user.id,
        admission_id: admission?.id ?? null,
      })
      for (const test of tests) {
        const itemId = insert('lab_order_items', { order_id: newId, test_id: test.id })
        postCharge({
          patientId: data.patient_id,
          admissionId: admission?.id ?? null,
          kind: 'laboratory',
          description: test.name,
          unitPriceCents: test.price_cents,
          sourceType: 'lab_order_item',
          sourceId: itemId,
          userId: req.user.id,
        })
      }
      return newId
    })
    res.status(201).json({ ...findOr404('lab_orders', orderId), items: orderItems(orderId) })
  },
)

labRouter.post('/orders/:id/collect', requirePermission('lab:process'), (req, res) => {
  const orderId = idParam(req)
  const order = findOr404('lab_orders', orderId, 'Order')
  if (order.status !== 'ordered') throw conflict('The sample has already been collected')
  update('lab_orders', orderId, { status: 'collected', collected_at: nowIso() })
  res.json(findOr404('lab_orders', orderId))
})

export function flagResult(test, value) {
  if (value == null) return null
  if ((test.critical_low != null && value <= test.critical_low) || (test.critical_high != null && value >= test.critical_high)) return 'critical'
  if (test.ref_low != null && value < test.ref_low) return 'low'
  if (test.ref_high != null && value > test.ref_high) return 'high'
  return 'normal'
}

labRouter.post(
  '/orders/:id/results',
  requirePermission('lab:process'),
  validate(
    z.object({
      results: z
        .array(z.object({ item_id: id, result_value: optionalNumber(), result_text: optionalText(4000) }))
        .min(1, 'Enter at least one result'),
    }),
  ),
  (req, res) => {
    const orderId = idParam(req)
    const order = findOr404('lab_orders', orderId, 'Order')
    if (!['collected', 'in_progress'].includes(order.status)) throw conflict('Collect the sample before entering results')
    transaction(() => {
      const critical = []
      for (const result of req.body.results) {
        if (result.result_value == null && !result.result_text) continue
        const item = get(
          `SELECT i.id, t.* , i.id AS item_id FROM lab_order_items i JOIN lab_tests t ON t.id = i.test_id WHERE i.id = ? AND i.order_id = ?`,
          result.item_id,
          orderId,
        )
        if (!item) throw badRequest('Result does not belong to this order')
        const resultFlag = flagResult(item, result.result_value)
        update('lab_order_items', result.item_id, {
          result_value: result.result_value ?? null,
          result_text: result.result_text ?? null,
          flag: resultFlag,
          resulted_by: req.user.id,
          resulted_at: nowIso(),
        })
        if (resultFlag === 'critical') critical.push(`${item.name}: ${result.result_value} ${item.unit ?? ''}`.trim())
      }
      const { pending } = get(
        `SELECT COUNT(*) AS pending FROM lab_order_items WHERE order_id = ? AND result_value IS NULL AND result_text IS NULL`,
        orderId,
      )
      update('lab_orders', orderId, pending ? { status: 'in_progress' } : { status: 'completed', completed_at: nowIso() })
      const patient = findOr404('patients', order.patient_id)
      const name = `${patient.first_name} ${patient.last_name}`
      if (critical.length) {
        // Critical values must reach the ordering clinician immediately.
        notify(order.doctor_id, {
          title: `Critical result: ${name}`,
          body: critical.join('; '),
          link: `/patients/${patient.id}`,
          severity: 'critical',
        })
      } else if (!pending) {
        notify(order.doctor_id, { title: 'Results ready', body: `${order.order_no} for ${name}`, link: `/patients/${patient.id}` })
      }
    })
    res.json({ ...findOr404('lab_orders', orderId), items: orderItems(orderId) })
  },
)

labRouter.post('/orders/:id/cancel', requirePermission('lab:order', 'lab:process'), (req, res) => {
  const orderId = idParam(req)
  const order = findOr404('lab_orders', orderId, 'Order')
  if (order.status !== 'ordered') throw conflict('Only orders awaiting collection can be cancelled')
  const itemIds = all('SELECT id FROM lab_order_items WHERE order_id = ?', orderId).map((row) => row.id)
  const billed = itemIds.length
    ? get(
        `SELECT COUNT(*) AS count FROM charges WHERE source_type = 'lab_order_item' AND invoice_id IS NOT NULL AND source_id IN (${itemIds.map(() => '?').join(',')})`,
        ...itemIds,
      ).count
    : 0
  if (billed) throw conflict('This order is already on an invoice. Void the invoice first.')
  transaction(() => {
    run(`DELETE FROM charges WHERE source_type = 'lab_order_item' AND source_id IN (${itemIds.map(() => '?').join(',')})`, ...itemIds)
    update('lab_orders', orderId, { status: 'cancelled' })
  })
  res.json(findOr404('lab_orders', orderId))
})
