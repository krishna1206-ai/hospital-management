import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, nextNumber, nowIsoSql, run, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { postCharge, refreshInvoiceBalance, setting } from '../lib/domain.js'
import { badRequest, cents, conflict, findOr404, flag, id, idParam, notFound, optionalDate, optionalId, optionalText, paginate, registerCrud, text, validate } from '../lib/http.js'

export const billingRouter = Router()

registerCrud(billingRouter, '/services', {
  table: 'services',
  read: 'billing:read',
  write: 'services:write',
  order: 'category, name',
  search: ['name', 'code', 'category'],
  schema: z.object({ code: text(20), name: text(120), category: optionalText(60), price_cents: cents, active: flag.optional() }),
})

/* ---------- Charges ---------- */

billingRouter.get('/charges', requirePermission('billing:read'), (req, res) => {
  const where = []
  const params = []
  if (req.query.patient_id) {
    where.push('c.patient_id = ?')
    params.push(String(req.query.patient_id))
  }
  if (req.query.unbilled === '1') where.push('c.invoice_id IS NULL')
  res.json(
    paginate(req, {
      select: `c.*, c.quantity * c.unit_price_cents AS amount_cents, p.first_name || ' ' || p.last_name AS patient_name, p.mrn`,
      from: 'charges c JOIN patients p ON p.id = c.patient_id',
      where,
      params,
      search: ['p.first_name', 'p.last_name', 'p.mrn', 'c.description'],
      order: 'c.created_at DESC, c.id DESC',
    }),
  )
})

/** Patients with charges waiting to be invoiced. */
billingRouter.get('/unbilled', requirePermission('billing:read'), (req, res) => {
  res.json(
    paginate(req, {
      select: `p.id AS patient_id, p.mrn, p.first_name || ' ' || p.last_name AS patient_name, COUNT(c.id) AS charge_count,
        SUM(c.quantity * c.unit_price_cents) AS amount_cents, MIN(c.created_at) AS oldest_at,
        (SELECT a.id FROM admissions a WHERE a.patient_id = p.id AND a.status = 'admitted') AS admission_id`,
      from: 'charges c JOIN patients p ON p.id = c.patient_id',
      where: ['c.invoice_id IS NULL'],
      search: ['p.first_name', 'p.last_name', 'p.mrn'],
      order: 'oldest_at',
      groupBy: 'p.id',
    }),
  )
})

const adHocCharge = z.object({
  patient_id: id,
  service_id: optionalId,
  description: optionalText(200),
  quantity: z.coerce.number().int().positive().optional(),
  unit_price_cents: cents.optional(),
})

billingRouter.post('/charges', requirePermission('billing:write'), validate(adHocCharge), (req, res) => {
  findOr404('patients', req.body.patient_id, 'Patient')
  const service = req.body.service_id ? findOr404('services', req.body.service_id, 'Service') : null
  const description = req.body.description ?? service?.name
  const unitPrice = req.body.unit_price_cents ?? service?.price_cents
  if (!description || unitPrice == null) throw badRequest('Choose a service, or enter a description and price')
  const chargeId = postCharge({
    patientId: req.body.patient_id,
    kind: service ? 'service' : 'other',
    description,
    quantity: req.body.quantity ?? 1,
    unitPriceCents: unitPrice,
    sourceType: service ? 'service' : null,
    sourceId: service?.id ?? null,
    userId: req.user.id,
  })
  res.status(201).json(findOr404('charges', chargeId))
})

billingRouter.delete('/charges/:id', requirePermission('billing:write'), (req, res) => {
  const chargeId = idParam(req)
  const charge = findOr404('charges', chargeId, 'Charge')
  if (charge.invoice_id) throw conflict('This charge is on an invoice. Void the invoice first.')
  if (charge.source_type && charge.source_type !== 'service') {
    throw conflict('This charge came from a clinical record and cannot be removed here')
  }
  run('DELETE FROM charges WHERE id = ?', chargeId)
  res.status(204).end()
})

/* ---------- Invoices ---------- */

const INVOICE_SELECT = `i.*, p.first_name || ' ' || p.last_name AS patient_name, p.mrn, p.phone AS patient_phone, p.address AS patient_address,
  p.insurance_provider, p.insurance_policy, i.total_cents - i.paid_cents AS balance_cents`
const INVOICE_FROM = 'invoices i JOIN patients p ON p.id = i.patient_id'

billingRouter.get('/invoices', requirePermission('billing:read'), (req, res) => {
  const where = []
  const params = []
  if (req.query.patient_id) {
    where.push('i.patient_id = ?')
    params.push(String(req.query.patient_id))
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',')
    where.push(`i.status IN (${statuses.map(() => '?').join(',')})`)
    params.push(...statuses)
  }
  res.json(paginate(req, { select: INVOICE_SELECT, from: INVOICE_FROM, where, params, search: ['i.invoice_no', 'p.first_name', 'p.last_name', 'p.mrn'], order: 'i.created_at DESC, i.id DESC' }))
})

billingRouter.get('/invoices/:id', requirePermission('billing:read'), (req, res) => {
  const invoiceId = idParam(req)
  const invoice = get(`SELECT ${INVOICE_SELECT} FROM ${INVOICE_FROM} WHERE i.id = ?`, invoiceId)
  if (!invoice) throw notFound('Invoice')
  res.json({
    ...invoice,
    items: all('SELECT *, quantity * unit_price_cents AS amount_cents FROM charges WHERE invoice_id = ? ORDER BY kind, id', invoiceId),
    payments: all(
      `SELECT pay.*, u.name AS received_by_name FROM payments pay LEFT JOIN users u ON u.id = pay.received_by WHERE pay.invoice_id = ? ORDER BY pay.created_at`,
      invoiceId,
    ),
    claims: all('SELECT * FROM insurance_claims WHERE invoice_id = ? ORDER BY created_at DESC', invoiceId),
  })
})

billingRouter.post(
  '/invoices',
  requirePermission('billing:write'),
  validate(
    z.object({
      patient_id: id,
      charge_ids: z.array(id).min(1, 'Select at least one charge'),
      discount_cents: cents.optional(),
      due_date: optionalDate,
      notes: optionalText(500),
    }),
  ),
  (req, res) => {
    const { patient_id: patientId, charge_ids: chargeIds, discount_cents: discount = 0, due_date: dueDate, notes } = req.body
    findOr404('patients', patientId, 'Patient')
    const invoiceId = transaction(() => {
      const charges = chargeIds.map((chargeId) => findOr404('charges', chargeId, 'Charge'))
      if (charges.some((charge) => charge.patient_id !== patientId)) throw badRequest('Every charge must belong to this patient')
      if (charges.some((charge) => charge.invoice_id)) throw conflict('A selected charge is already on an invoice')
      const subtotal = charges.reduce((sum, charge) => sum + charge.quantity * charge.unit_price_cents, 0)
      if (discount > subtotal) throw badRequest('Discount cannot exceed the subtotal')
      const taxPercent = Number(setting('tax_percent', 0))
      const tax = Math.round(((subtotal - discount) * taxPercent) / 100)
      const newId = insert('invoices', {
        invoice_no: nextNumber('INV'),
        patient_id: patientId,
        admission_id: charges.find((charge) => charge.admission_id)?.admission_id ?? null,
        subtotal_cents: subtotal,
        discount_cents: discount,
        tax_cents: tax,
        total_cents: subtotal - discount + tax,
        due_date: dueDate,
        notes,
        created_by: req.user.id,
      })
      run(`UPDATE charges SET invoice_id = ? WHERE id IN (${chargeIds.map(() => '?').join(',')})`, newId, ...chargeIds)
      refreshInvoiceBalance(newId)
      return newId
    })
    res.status(201).json(findOr404('invoices', invoiceId))
  },
)

function addPayment(invoice, amount, method, reference, userId) {
  if (invoice.status === 'void') throw conflict('This invoice has been voided')
  const balance = invoice.total_cents - invoice.paid_cents
  if (amount > balance) throw badRequest(`Payment exceeds the balance due`)
  const paymentId = insert('payments', { invoice_id: invoice.id, amount_cents: amount, method, reference, received_by: userId })
  refreshInvoiceBalance(invoice.id)
  return paymentId
}

billingRouter.post(
  '/invoices/:id/payments',
  requirePermission('billing:write'),
  validate(
    z.object({
      amount_cents: z.coerce.number().int().positive('Enter an amount'),
      method: z.enum(['cash', 'card', 'bank_transfer', 'mobile', 'insurance']),
      reference: optionalText(80),
    }),
  ),
  (req, res) => {
    const invoiceId = idParam(req)
    const paymentId = transaction(() =>
      addPayment(findOr404('invoices', invoiceId, 'Invoice'), req.body.amount_cents, req.body.method, req.body.reference, req.user.id),
    )
    res.status(201).json(findOr404('payments', paymentId))
  },
)

billingRouter.post('/invoices/:id/void', requirePermission('billing:void'), validate(z.object({ reason: text(300) })), (req, res) => {
  const invoiceId = idParam(req)
  const invoice = findOr404('invoices', invoiceId, 'Invoice')
  if (invoice.status === 'void') throw conflict('This invoice is already void')
  if (invoice.paid_cents > 0) throw conflict('An invoice with payments cannot be voided')
  transaction(() => {
    update('invoices', invoiceId, { status: 'void', void_reason: req.body.reason })
    // Charges return to the unbilled pool so they can be invoiced correctly.
    run('UPDATE charges SET invoice_id = NULL WHERE invoice_id = ?', invoiceId)
  })
  res.json(findOr404('invoices', invoiceId))
})

/* ---------- Insurance claims ---------- */

billingRouter.get('/claims', requirePermission('billing:read'), (req, res) => {
  const where = []
  const params = []
  if (req.query.status) {
    where.push('c.status = ?')
    params.push(String(req.query.status))
  }
  res.json(
    paginate(req, {
      select: `c.*, i.invoice_no, i.total_cents, p.first_name || ' ' || p.last_name AS patient_name, p.mrn`,
      from: 'insurance_claims c JOIN invoices i ON i.id = c.invoice_id JOIN patients p ON p.id = i.patient_id',
      where,
      params,
      search: ['c.claim_no', 'c.provider', 'i.invoice_no', 'p.last_name'],
      order: 'c.created_at DESC',
    }),
  )
})

billingRouter.post(
  '/claims',
  requirePermission('claims:write'),
  validate(z.object({ invoice_id: id, provider: optionalText(120), policy_no: optionalText(80), claimed_cents: z.coerce.number().int().positive('Enter an amount'), notes: optionalText(500) })),
  (req, res) => {
    const invoice = findOr404('invoices', req.body.invoice_id, 'Invoice')
    if (invoice.status === 'void') throw conflict('This invoice has been voided')
    const patient = findOr404('patients', invoice.patient_id)
    const provider = req.body.provider ?? patient.insurance_provider
    if (!provider) throw badRequest('This patient has no insurance provider on file')
    if (req.body.claimed_cents > invoice.total_cents - invoice.paid_cents) throw badRequest('Claim exceeds the balance due')
    const { open } = get(`SELECT COUNT(*) AS open FROM insurance_claims WHERE invoice_id = ? AND status IN ('submitted','approved')`, invoice.id)
    if (open) throw conflict('This invoice already has an open claim')
    const claimId = insert('insurance_claims', {
      ...req.body,
      provider,
      policy_no: req.body.policy_no ?? patient.insurance_policy,
      claim_no: nextNumber('CLM'),
      created_by: req.user.id,
    })
    res.status(201).json(findOr404('insurance_claims', claimId))
  },
)

billingRouter.post(
  '/claims/:id/decide',
  requirePermission('claims:write'),
  validate(z.object({ status: z.enum(['approved', 'rejected']), approved_cents: cents.optional(), notes: optionalText(500) })),
  (req, res) => {
    const claimId = idParam(req)
    const claim = findOr404('insurance_claims', claimId, 'Claim')
    if (claim.status !== 'submitted') throw conflict('This claim has already been decided')
    const approved = req.body.status === 'approved' ? (req.body.approved_cents ?? claim.claimed_cents) : 0
    if (approved > claim.claimed_cents) throw badRequest('Approved amount cannot exceed the amount claimed')
    if (req.body.status === 'approved' && approved === 0) throw badRequest('Enter the approved amount')
    update('insurance_claims', claimId, { status: req.body.status, approved_cents: approved, notes: req.body.notes ?? claim.notes })
    run(`UPDATE insurance_claims SET decided_at = ${nowIsoSql} WHERE id = ?`, claimId)
    res.json(findOr404('insurance_claims', claimId))
  },
)

/** Records the insurer's remittance as a real payment on the invoice. */
billingRouter.post('/claims/:id/settle', requirePermission('claims:write'), validate(z.object({ reference: optionalText(80) })), (req, res) => {
  const claimId = idParam(req)
  const claim = findOr404('insurance_claims', claimId, 'Claim')
  if (claim.status !== 'approved') throw conflict('Only approved claims can be settled')
  transaction(() => {
    addPayment(findOr404('invoices', claim.invoice_id), claim.approved_cents, 'insurance', req.body.reference ?? claim.claim_no, req.user.id)
    update('insurance_claims', claimId, { status: 'paid' })
  })
  res.json(findOr404('insurance_claims', claimId))
})
