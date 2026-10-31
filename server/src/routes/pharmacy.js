import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { postCharge, today } from '../lib/domain.js'
import { badRequest, cents, conflict, dateStr, findOr404, flag, id, idParam, optionalId, optionalText, paginate, registerCrud, text, validate } from '../lib/http.js'

export const pharmacyRouter = Router()

registerCrud(pharmacyRouter, '/suppliers', {
  table: 'suppliers',
  read: 'pharmacy:read',
  write: 'pharmacy:write',
  order: 'name',
  search: ['name', 'contact_person'],
  schema: z.object({
    name: text(120),
    contact_person: optionalText(120),
    phone: optionalText(40),
    email: optionalText(120),
    address: optionalText(300),
    active: flag.optional(),
  }),
})

// Stock counts only batches that are still in date.
const STOCK_SQL = `(SELECT COALESCE(SUM(b.quantity), 0) FROM medicine_batches b WHERE b.medicine_id = m.id AND b.expiry_date >= date('now','localtime'))`

const medicineSchema = z.object({
  name: text(120),
  generic_name: optionalText(120),
  form: optionalText(40),
  strength: optionalText(40),
  category: optionalText(60),
  manufacturer: optionalText(120),
  unit_price_cents: cents,
  reorder_level: z.coerce.number().int().min(0),
  active: flag.optional(),
})

// Prescribers need to pick medicines, so this list reads with prescribing rights too.
pharmacyRouter.get('/medicines', requirePermission('pharmacy:read', 'prescriptions:write'), (req, res) => {
  const where = ['m.active = 1']
  if (req.query.low === '1') where.push(`${STOCK_SQL} <= m.reorder_level`)
  res.json(
    paginate(req, {
      select: `m.*, ${STOCK_SQL} AS in_stock,
        (SELECT MIN(b.expiry_date) FROM medicine_batches b WHERE b.medicine_id = m.id AND b.quantity > 0 AND b.expiry_date >= date('now','localtime')) AS next_expiry`,
      from: 'medicines m',
      where,
      search: ['m.name', 'm.generic_name', 'm.category'],
      order: 'm.name',
    }),
  )
})

pharmacyRouter.post('/medicines', requirePermission('pharmacy:write'), validate(medicineSchema), (req, res) => {
  res.status(201).json(findOr404('medicines', insert('medicines', req.body)))
})

pharmacyRouter.patch('/medicines/:id', requirePermission('pharmacy:write'), validate(medicineSchema.partial()), (req, res) => {
  const medicineId = idParam(req)
  findOr404('medicines', medicineId, 'Medicine')
  update('medicines', medicineId, req.body)
  res.json(findOr404('medicines', medicineId))
})

pharmacyRouter.get('/batches', requirePermission('pharmacy:read'), (req, res) => {
  const where = ['b.quantity > 0']
  const params = []
  if (req.query.medicine_id) {
    where.push('b.medicine_id = ?')
    params.push(String(req.query.medicine_id))
  }
  if (req.query.expiring_days) {
    where.push(`b.expiry_date <= date('now','localtime', ?)`)
    params.push(`+${Number(req.query.expiring_days) || 90} days`)
  }
  res.json(
    paginate(req, {
      select: `b.*, m.name AS medicine_name, m.strength, m.form, s.name AS supplier_name`,
      from: 'medicine_batches b JOIN medicines m ON m.id = b.medicine_id LEFT JOIN suppliers s ON s.id = b.supplier_id',
      where,
      params,
      search: ['m.name', 'b.batch_no'],
      order: 'b.expiry_date',
    }),
  )
})

pharmacyRouter.post(
  '/batches',
  requirePermission('pharmacy:write'),
  validate(
    z.object({
      medicine_id: id,
      batch_no: text(40),
      expiry_date: dateStr,
      quantity: z.coerce.number().int().positive('Enter a quantity'),
      cost_cents: cents.optional(),
      supplier_id: optionalId,
    }),
  ),
  (req, res) => {
    findOr404('medicines', req.body.medicine_id, 'Medicine')
    if (req.body.expiry_date <= today()) throw badRequest('This batch has already expired')
    const batchId = transaction(() => {
      const newId = insert('medicine_batches', req.body)
      insert('stock_movements', {
        medicine_id: req.body.medicine_id,
        batch_id: newId,
        kind: 'receive',
        quantity: req.body.quantity,
        reference: `Batch ${req.body.batch_no}`,
        user_id: req.user.id,
      })
      return newId
    })
    res.status(201).json(findOr404('medicine_batches', batchId))
  },
)

pharmacyRouter.post(
  '/batches/:id/adjust',
  requirePermission('pharmacy:write'),
  validate(
    z.object({
      delta: z.coerce.number().int().refine((value) => value !== 0, 'Enter a non-zero change'),
      reason: text(200),
      kind: z.enum(['adjust', 'expire']).optional(),
    }),
  ),
  (req, res) => {
    const batchId = idParam(req)
    const batch = findOr404('medicine_batches', batchId, 'Batch')
    const quantity = batch.quantity + req.body.delta
    if (quantity < 0) throw conflict(`Only ${batch.quantity} units are in this batch`)
    transaction(() => {
      update('medicine_batches', batchId, { quantity })
      insert('stock_movements', {
        medicine_id: batch.medicine_id,
        batch_id: batchId,
        kind: req.body.kind ?? 'adjust',
        quantity: req.body.delta,
        reference: req.body.reason,
        user_id: req.user.id,
      })
    })
    res.json(findOr404('medicine_batches', batchId))
  },
)

pharmacyRouter.get('/movements', requirePermission('pharmacy:read'), (req, res) => {
  res.json(
    paginate(req, {
      select: `sm.*, m.name AS medicine_name, b.batch_no, u.name AS user_name`,
      from: 'stock_movements sm JOIN medicines m ON m.id = sm.medicine_id LEFT JOIN medicine_batches b ON b.id = sm.batch_id LEFT JOIN users u ON u.id = sm.user_id',
      search: ['m.name', 'b.batch_no', 'sm.reference'],
      order: 'sm.created_at DESC, sm.id DESC',
    }),
  )
})

/**
 * Dispenses first-expired-first-out across in-date batches. The whole request is one
 * transaction: if any line can't be filled, nothing is deducted or charged.
 */
pharmacyRouter.post(
  '/prescriptions/:id/dispense',
  requirePermission('pharmacy:dispense'),
  validate(z.object({ items: z.array(z.object({ item_id: id, quantity: z.coerce.number().int().min(0) })).min(1) })),
  (req, res) => {
    const prescriptionId = idParam(req)
    const prescription = findOr404('prescriptions', prescriptionId, 'Prescription')
    if (!['active', 'partial'].includes(prescription.status)) throw conflict(`This prescription is ${prescription.status}`)
    const admission = get(`SELECT id FROM admissions WHERE patient_id = ? AND status = 'admitted'`, prescription.patient_id)

    transaction(() => {
      let dispensedAny = false
      for (const line of req.body.items) {
        if (line.quantity === 0) continue
        const item = get('SELECT * FROM prescription_items WHERE id = ? AND prescription_id = ?', line.item_id, prescriptionId)
        if (!item) throw badRequest('Item does not belong to this prescription')
        const medicine = findOr404('medicines', item.medicine_id, 'Medicine')
        if (item.dispensed_qty + line.quantity > item.quantity) {
          throw conflict(`${medicine.name}: only ${item.quantity - item.dispensed_qty} left to dispense`)
        }
        let remaining = line.quantity
        const batches = all(
          `SELECT * FROM medicine_batches WHERE medicine_id = ? AND quantity > 0 AND expiry_date >= date('now','localtime') ORDER BY expiry_date, id`,
          item.medicine_id,
        )
        for (const batch of batches) {
          if (remaining === 0) break
          const take = Math.min(remaining, batch.quantity)
          run('UPDATE medicine_batches SET quantity = quantity - ? WHERE id = ?', take, batch.id)
          insert('stock_movements', {
            medicine_id: item.medicine_id,
            batch_id: batch.id,
            kind: 'dispense',
            quantity: -take,
            reference: `Prescription #${prescriptionId}`,
            user_id: req.user.id,
          })
          remaining -= take
        }
        if (remaining > 0) throw conflict(`${medicine.name}: not enough in-date stock (short by ${remaining})`)
        run('UPDATE prescription_items SET dispensed_qty = dispensed_qty + ? WHERE id = ?', line.quantity, item.id)
        postCharge({
          patientId: prescription.patient_id,
          admissionId: admission?.id ?? null,
          kind: 'pharmacy',
          description: `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
          quantity: line.quantity,
          unitPriceCents: medicine.unit_price_cents,
          sourceType: 'prescription_item',
          sourceId: item.id,
          userId: req.user.id,
        })
        dispensedAny = true
      }
      if (!dispensedAny) throw badRequest('Enter a quantity to dispense')
      const { outstanding } = get(
        'SELECT COUNT(*) AS outstanding FROM prescription_items WHERE prescription_id = ? AND dispensed_qty < quantity',
        prescriptionId,
      )
      update('prescriptions', prescriptionId, { status: outstanding ? 'partial' : 'dispensed' })
    })
    res.json(findOr404('prescriptions', prescriptionId))
  },
)
