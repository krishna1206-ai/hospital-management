import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, nextNumber, transaction, update } from '../db/index.js'
import { requirePermission } from '../lib/auth.js'
import { nowIso, postCharge, setting, today } from '../lib/domain.js'
import { BLOOD_GROUPS, conflict, dateStr, findOr404, flag, id, idParam, optionalDate, optionalId, optionalText, paginate, registerCrud, text, validate } from '../lib/http.js'

/* ---------- Blood bank ---------- */

export const bloodRouter = Router()

/** Red-cell compatibility: which donor groups each recipient group may receive. */
const COMPATIBLE_DONORS = {
  'O-': ['O-'],
  'O+': ['O-', 'O+'],
  'A-': ['O-', 'A-'],
  'A+': ['O-', 'O+', 'A-', 'A+'],
  'B-': ['O-', 'B-'],
  'B+': ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': BLOOD_GROUPS,
}

bloodRouter.get('/stock', requirePermission('blood:read'), (_req, res) => {
  const rows = all(
    `SELECT blood_group, component, COUNT(*) AS units, MIN(expires_on) AS next_expiry FROM blood_units
     WHERE status = 'available' AND expires_on >= date('now','localtime') GROUP BY blood_group, component`,
  )
  res.json(BLOOD_GROUPS.map((group) => {
    const groupRows = rows.filter((row) => row.blood_group === group)
    return { blood_group: group, units: groupRows.reduce((sum, row) => sum + row.units, 0), components: groupRows }
  }))
})

bloodRouter.get('/units', requirePermission('blood:read'), (req, res) => {
  const where = []
  const params = []
  for (const key of ['status', 'blood_group']) {
    if (req.query[key]) {
      where.push(`bu.${key} = ?`)
      params.push(String(req.query[key]))
    }
  }
  res.json(
    paginate(req, {
      select: `bu.*, d.name AS donor_name, p.first_name || ' ' || p.last_name AS issued_patient_name, p.mrn AS issued_patient_mrn`,
      from: 'blood_units bu LEFT JOIN blood_donors d ON d.id = bu.donor_id LEFT JOIN patients p ON p.id = bu.issued_patient_id',
      where,
      params,
      search: ['bu.unit_no', 'd.name'],
      order: `CASE bu.status WHEN 'available' THEN 0 ELSE 1 END, bu.expires_on`,
    }),
  )
})

bloodRouter.post(
  '/units',
  requirePermission('blood:write'),
  validate(
    z
      .object({
        blood_group: z.enum(BLOOD_GROUPS),
        component: z.enum(['whole_blood', 'packed_rbc', 'plasma', 'platelets']),
        donor_id: optionalId,
        collected_on: dateStr,
        expires_on: dateStr,
      })
      .refine((value) => value.expires_on > value.collected_on, { path: ['expires_on'], message: 'Must be after the collection date' }),
  ),
  (req, res) => {
    const unitId = transaction(() => {
      if (req.body.donor_id) {
        const donor = findOr404('blood_donors', req.body.donor_id, 'Donor')
        if (donor.blood_group !== req.body.blood_group) throw conflict(`Donor is ${donor.blood_group}, but this unit is marked ${req.body.blood_group}`)
        update('blood_donors', donor.id, { last_donation_on: req.body.collected_on })
      }
      return insert('blood_units', { ...req.body, unit_no: nextNumber('BU') })
    })
    res.status(201).json(findOr404('blood_units', unitId))
  },
)

bloodRouter.post('/units/:id/issue', requirePermission('blood:write'), validate(z.object({ patient_id: id })), (req, res) => {
  const unitId = idParam(req)
  const unit = findOr404('blood_units', unitId, 'Unit')
  if (unit.status !== 'available') throw conflict(`This unit is ${unit.status}`)
  if (unit.expires_on < today()) throw conflict('This unit has expired')
  const patient = findOr404('patients', req.body.patient_id, 'Patient')
  if (!patient.blood_group) throw conflict("Record the patient's blood group before issuing blood")
  if (!COMPATIBLE_DONORS[patient.blood_group].includes(unit.blood_group)) {
    throw conflict(`${unit.blood_group} blood is not compatible with a ${patient.blood_group} patient`)
  }
  const admission = get(`SELECT id FROM admissions WHERE patient_id = ? AND status = 'admitted'`, patient.id)
  transaction(() => {
    update('blood_units', unitId, { status: 'issued', issued_patient_id: patient.id, issued_at: nowIso(), issued_by: req.user.id })
    postCharge({
      patientId: patient.id,
      admissionId: admission?.id ?? null,
      kind: 'blood',
      description: `Blood unit ${unit.unit_no} (${unit.blood_group} ${unit.component.replace('_', ' ')})`,
      unitPriceCents: Number(setting('blood_unit_fee_cents', 0)),
      sourceType: 'blood_unit',
      sourceId: unitId,
      userId: req.user.id,
    })
  })
  res.json(findOr404('blood_units', unitId))
})

bloodRouter.post('/units/:id/discard', requirePermission('blood:write'), (req, res) => {
  const unitId = idParam(req)
  const unit = findOr404('blood_units', unitId, 'Unit')
  if (unit.status !== 'available') throw conflict(`This unit is ${unit.status}`)
  update('blood_units', unitId, { status: 'discarded' })
  res.json(findOr404('blood_units', unitId))
})

registerCrud(bloodRouter, '/donors', {
  table: 'blood_donors',
  read: 'blood:read',
  write: 'blood:write',
  softDelete: false,
  order: 'name',
  search: ['name', 'phone', 'blood_group'],
  schema: z.object({ name: text(120), blood_group: z.enum(BLOOD_GROUPS), phone: optionalText(40), last_donation_on: optionalDate }),
})

/* ---------- Ambulance ---------- */

export const ambulanceRouter = Router()

const vehicleSchema = z.object({
  vehicle_no: text(30),
  type: z.enum(['basic', 'advanced', 'neonatal']),
  driver_name: optionalText(120),
  driver_phone: optionalText(40),
  status: z.enum(['available', 'maintenance']).optional(),
})

ambulanceRouter.get('/vehicles', requirePermission('ambulance:read'), (req, res) => {
  res.json(paginate(req, { select: '*', from: 'ambulances', search: ['vehicle_no', 'driver_name'], order: 'vehicle_no' }))
})

ambulanceRouter.post('/vehicles', requirePermission('ambulance:write'), validate(vehicleSchema), (req, res) => {
  res.status(201).json(findOr404('ambulances', insert('ambulances', req.body)))
})

ambulanceRouter.patch('/vehicles/:id', requirePermission('ambulance:write'), validate(vehicleSchema.partial()), (req, res) => {
  const vehicleId = idParam(req)
  const vehicle = findOr404('ambulances', vehicleId, 'Ambulance')
  if (req.body.status && vehicle.status === 'on_trip') throw conflict('This ambulance is on a trip')
  update('ambulances', vehicleId, req.body)
  res.json(findOr404('ambulances', vehicleId))
})

ambulanceRouter.get('/trips', requirePermission('ambulance:read'), (req, res) => {
  res.json(
    paginate(req, {
      select: 't.*, a.vehicle_no, a.driver_name',
      from: 'ambulance_trips t JOIN ambulances a ON a.id = t.ambulance_id',
      search: ['t.patient_name', 'a.vehicle_no', 't.pickup'],
      order: `CASE t.status WHEN 'dispatched' THEN 0 ELSE 1 END, t.dispatched_at DESC`,
    }),
  )
})

ambulanceRouter.post(
  '/trips',
  requirePermission('ambulance:write'),
  validate(
    z.object({
      ambulance_id: id,
      patient_name: text(120),
      contact_phone: optionalText(40),
      pickup: text(300),
      destination: text(300),
      notes: optionalText(500),
    }),
  ),
  (req, res) => {
    const vehicle = findOr404('ambulances', req.body.ambulance_id, 'Ambulance')
    if (vehicle.status !== 'available') throw conflict(`${vehicle.vehicle_no} is not available`)
    const tripId = transaction(() => {
      update('ambulances', vehicle.id, { status: 'on_trip' })
      return insert('ambulance_trips', { ...req.body, created_by: req.user.id })
    })
    res.status(201).json(findOr404('ambulance_trips', tripId))
  },
)

ambulanceRouter.post('/trips/:id/close', requirePermission('ambulance:write'), validate(z.object({ status: z.enum(['completed', 'cancelled']) })), (req, res) => {
  const tripId = idParam(req)
  const trip = findOr404('ambulance_trips', tripId, 'Trip')
  if (trip.status !== 'dispatched') throw conflict('This trip is already closed')
  transaction(() => {
    update('ambulance_trips', tripId, { status: req.body.status, closed_at: nowIso() })
    update('ambulances', trip.ambulance_id, { status: 'available' })
  })
  res.json(findOr404('ambulance_trips', tripId))
})

/* ---------- General inventory ---------- */

export const inventoryRouter = Router()

inventoryRouter.get('/items', requirePermission('inventory:read'), (req, res) => {
  const where = ['active = 1']
  if (req.query.low === '1') where.push('quantity <= reorder_level')
  res.json(paginate(req, { select: '*', from: 'inventory_items', where, search: ['name', 'category', 'location'], order: 'name' }))
})

const itemSchema = z.object({
  name: text(120),
  category: optionalText(60),
  unit: optionalText(30),
  location: optionalText(80),
  reorder_level: z.coerce.number().int().min(0),
  active: flag.optional(),
})

inventoryRouter.post('/items', requirePermission('inventory:write'), validate(itemSchema), (req, res) => {
  res.status(201).json(findOr404('inventory_items', insert('inventory_items', req.body)))
})

inventoryRouter.patch('/items/:id', requirePermission('inventory:write'), validate(itemSchema.partial()), (req, res) => {
  const itemId = idParam(req)
  findOr404('inventory_items', itemId, 'Item')
  update('inventory_items', itemId, req.body)
  res.json(findOr404('inventory_items', itemId))
})

inventoryRouter.post(
  '/items/:id/move',
  requirePermission('inventory:write'),
  validate(z.object({ quantity: z.coerce.number().int().refine((value) => value !== 0, 'Enter a non-zero quantity'), reference: text(200) })),
  (req, res) => {
    const itemId = idParam(req)
    const item = findOr404('inventory_items', itemId, 'Item')
    if (item.quantity + req.body.quantity < 0) throw conflict(`Only ${item.quantity} in stock`)
    transaction(() => {
      update('inventory_items', itemId, { quantity: item.quantity + req.body.quantity })
      insert('inventory_movements', { item_id: itemId, ...req.body, user_id: req.user.id })
    })
    res.json(findOr404('inventory_items', itemId))
  },
)

inventoryRouter.get('/movements', requirePermission('inventory:read'), (req, res) => {
  res.json(
    paginate(req, {
      select: 'm.*, i.name AS item_name, i.unit, u.name AS user_name',
      from: 'inventory_movements m JOIN inventory_items i ON i.id = m.item_id LEFT JOIN users u ON u.id = m.user_id',
      search: ['i.name', 'm.reference'],
      order: 'm.created_at DESC, m.id DESC',
    }),
  )
})
