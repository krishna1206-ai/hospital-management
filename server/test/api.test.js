// End-to-end API tests: each one drives real HTTP requests through the full stack
// against a seeded in-memory database.
process.env.NODE_ENV = 'test'

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

const { createApp } = await import('../src/app.js')
const { DEMO_PASSWORD, seed } = await import('../src/db/seed.js')
const { all, get } = await import('../src/db/index.js')
const { availableSlots, localDate, today } = await import('../src/lib/domain.js')

let server
let base
const sessions = {}

async function call(role, method, path, body) {
  const headers = { 'content-type': 'application/json' }
  if (role) headers.cookie = sessions[role]
  const res = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, res }
}

async function login(email, password = DEMO_PASSWORD) {
  const { res, status, body } = await call(null, 'POST', '/auth/login', { email, password })
  return { status, body, cookie: res.headers.get('set-cookie')?.split(';')[0] }
}

const nextWeekday = () => {
  const date = new Date()
  do date.setDate(date.getDate() + 1)
  while (date.getDay() === 0)
  return localDate(date)
}

const newPatient = async (overrides = {}) => {
  const { status, body } = await call('reception', 'POST', '/patients', {
    first_name: 'Test',
    last_name: `Patient${Math.random().toString(36).slice(2, 8)}`,
    dob: '1980-05-05',
    gender: 'female',
    phone: `+1 999 ${Math.floor(Math.random() * 1e7)}`,
    blood_group: 'O+',
    ...overrides,
  })
  assert.equal(status, 201, JSON.stringify(body))
  return body
}

before(async () => {
  await seed()
  server = createApp().listen(0)
  base = `http://127.0.0.1:${server.address().port}`
  const accounts = { admin: 'admin', doctor: 'doctor', nurse: 'nurse', reception: 'reception', pharmacy: 'pharmacy', lab: 'lab', billing: 'billing' }
  for (const [role, local] of Object.entries(accounts)) {
    const { cookie, status } = await login(`${local}@hospital.test`)
    assert.equal(status, 200)
    sessions[role] = cookie
  }
})
after(() => server.close())

describe('auth and access control', () => {
  test('rejects wrong passwords and anonymous requests', async () => {
    assert.equal((await login('admin@hospital.test', 'wrong')).status, 401)
    assert.equal((await call(null, 'GET', '/patients')).status, 401)
  })

  test('session cookie is httpOnly and password hash never leaves the server', async () => {
    const { res, body } = await call(null, 'POST', '/auth/login', { email: 'admin@hospital.test', password: DEMO_PASSWORD })
    assert.match(res.headers.get('set-cookie'), /HttpOnly/)
    assert.match(res.headers.get('set-cookie'), /SameSite=Strict/)
    assert.equal(JSON.stringify(body).includes('password_hash'), false)
    const users = await call('admin', 'GET', '/staff/users')
    assert.equal(JSON.stringify(users.body).includes('password_hash'), false)
  })

  test('enforces roles on the server', async () => {
    assert.equal((await call('reception', 'GET', '/clinical/encounters')).status, 403)
    assert.equal((await call('pharmacy', 'GET', '/billing/invoices')).status, 403)
    assert.equal((await call('billing', 'GET', '/clinical/vitals?patient_id=1')).status, 403)
    assert.equal((await call('nurse', 'POST', '/clinical/prescriptions', {})).status, 403)
    assert.equal((await call('doctor', 'GET', '/audit')).status, 403)
  })

  test('deactivating an account ends its live session', async () => {
    const email = `temp${Date.now()}@hospital.test`
    const created = await call('admin', 'POST', '/staff/users', { name: 'Temp', email, role: 'nurse', password: 'Temporary123' })
    assert.equal(created.status, 201)
    const { cookie } = await login(email, 'Temporary123')
    sessions.temp = cookie
    assert.equal((await call('temp', 'GET', '/patients')).status, 403, 'temporary password must be changed first')
    const change = await call('temp', 'POST', '/auth/change-password', { current_password: 'Temporary123', new_password: 'BrandNewPass99' })
    assert.equal(change.status, 204)
    sessions.temp = change.res.headers.get('set-cookie').split(';')[0]
    assert.equal((await call('temp', 'GET', '/patients')).status, 200)
    await call('admin', 'PATCH', `/staff/users/${created.body.id}`, { active: 0 })
    assert.equal((await call('temp', 'GET', '/patients')).status, 401)
  })

  test('the last admin cannot be removed', async () => {
    const admin = get(`SELECT id FROM users WHERE email = 'admin@hospital.test'`)
    assert.equal((await call('admin', 'PATCH', `/staff/users/${admin.id}`, { active: 0 })).status, 409)
  })
})

describe('patients', () => {
  test('registers with an MRN, validates input, and flags duplicates', async () => {
    const patient = await newPatient({ first_name: 'Dup', last_name: 'Check', phone: '+1 999 000 1234' })
    assert.match(patient.mrn, /^MRN-\d{6}$/)
    const again = await call('reception', 'POST', '/patients', { first_name: 'Dup', last_name: 'Check', dob: '1980-05-05', gender: 'female', phone: '+1 999 000 1234' })
    assert.equal(again.status, 409)
    assert.equal(again.body.error.duplicate.id, patient.id)
    const invalid = await call('reception', 'POST', '/patients', { first_name: '', dob: '2999-01-01', gender: 'x', phone: '' })
    assert.equal(invalid.status, 422)
    assert.ok(invalid.body.error.fields.first_name && invalid.body.error.fields.dob)
  })

  test('a partial update leaves other fields alone, and searching treats % literally', async () => {
    const patient = await newPatient({ allergies: 'Latex', city: 'Riverton' })
    const updated = await call('reception', 'PATCH', `/patients/${patient.id}`, { city: 'Oakdale' })
    assert.equal(updated.body.city, 'Oakdale')
    assert.equal(updated.body.allergies, 'Latex')
    const cleared = await call('reception', 'PATCH', `/patients/${patient.id}`, { city: '' })
    assert.equal(cleared.body.city, null)
    assert.equal((await call('reception', 'GET', `/patients?q=${encodeURIComponent('%')}`)).body.total, 0)
    assert.equal((await call('reception', 'GET', `/patients?q=${encodeURIComponent(`' OR 1=1 --`)}`)).body.total, 0)
  })

  test('viewing a chart is audited without storing patient data', async () => {
    const patient = await newPatient({ allergies: 'SecretAllergyValue' })
    await call('reception', 'GET', `/patients/${patient.id}`)
    const log = get(`SELECT * FROM audit_logs WHERE action = 'view' AND entity = 'patients' AND entity_id = ?`, String(patient.id))
    assert.ok(log)
    assert.equal(JSON.stringify(all('SELECT * FROM audit_logs')).includes('SecretAllergyValue'), false)
  })
})

describe('outpatient workflow', () => {
  test('booking through signed note: no double booking, token, fee charged once', async () => {
    const patient = await newPatient()
    const doctor = get(`SELECT id, consultation_fee_cents FROM users WHERE email = 'doctor@hospital.test'`)
    const date = nextWeekday()
    const [slot] = availableSlots(doctor.id, date)
    assert.ok(slot)
    const booking = { patient_id: patient.id, doctor_id: doctor.id, date, start_time: slot.start_time, reason: 'Checkup' }
    const created = await call('reception', 'POST', '/appointments', booking)
    assert.equal(created.status, 201)
    assert.equal((await call('reception', 'POST', '/appointments', booking)).status, 409)
    const invalidTime = await call('reception', 'POST', '/appointments', { ...booking, start_time: '03:17' })
    assert.equal(invalidTime.status, 409)

    // Checking in early is refused; only today's appointments check in.
    assert.equal((await call('reception', 'POST', `/appointments/${created.body.id}/status`, { status: 'checked_in' })).status, 409)
    assert.equal((await call('reception', 'POST', `/appointments/${created.body.id}/status`, { status: 'completed' })).status, 409)

    const todays = get(`SELECT id, patient_id, doctor_id FROM appointments WHERE date = ? AND status = 'scheduled' AND doctor_id = ? LIMIT 1`, today(), doctor.id)
    assert.ok(todays)
    const checkedIn = await call('reception', 'POST', `/appointments/${todays.id}/status`, { status: 'checked_in' })
    assert.equal(checkedIn.status, 200)
    assert.ok(checkedIn.body.token_no > 0)
    assert.equal((await call('doctor', 'POST', `/appointments/${todays.id}/status`, { status: 'in_progress' })).status, 200)

    const encounter = await call('doctor', 'POST', '/clinical/encounters', { patient_id: todays.patient_id, appointment_id: todays.id })
    assert.equal(encounter.status, 201)
    const reopened = await call('doctor', 'POST', '/clinical/encounters', { patient_id: todays.patient_id, appointment_id: todays.id })
    assert.equal(reopened.body.id, encounter.body.id, 'opening twice returns the same note')

    assert.equal((await call('doctor', 'POST', `/clinical/encounters/${encounter.body.id}/sign`)).status, 422, 'cannot sign an empty note')
    await call('doctor', 'PATCH', `/clinical/encounters/${encounter.body.id}`, { diagnosis: 'Migraine', assessment: 'Stable' })
    assert.equal((await call('doctor', 'POST', `/clinical/encounters/${encounter.body.id}/sign`)).status, 200)
    assert.equal((await call('doctor', 'PATCH', `/clinical/encounters/${encounter.body.id}`, { plan: 'tamper' })).status, 409, 'signed notes are immutable')

    const appointment = get('SELECT status FROM appointments WHERE id = ?', todays.id)
    assert.equal(appointment.status, 'completed')
    const charges = all(`SELECT * FROM charges WHERE source_type = 'appointment' AND source_id = ?`, todays.id)
    assert.equal(charges.length, 1)
    assert.equal(charges[0].unit_price_cents, doctor.consultation_fee_cents)
  })

  test('approved leave closes the doctor calendar', async () => {
    const doctor = get(`SELECT id FROM users WHERE email = 'doctor2@hospital.test'`)
    const date = nextWeekday()
    const doctorSession = await login('doctor2@hospital.test')
    sessions.doctor2 = doctorSession.cookie
    const leave = await call('doctor2', 'POST', '/staff/leave', { type: 'sick', start_date: date, end_date: date })
    assert.equal(leave.status, 201)
    assert.equal((await call('doctor2', 'POST', `/staff/leave/${leave.body.id}/decide`, { status: 'approved' })).status, 403)
    assert.equal((await call('admin', 'POST', `/staff/leave/${leave.body.id}/decide`, { status: 'approved' })).status, 200)
    const slots = await call('reception', 'GET', `/appointments/slots?doctor_id=${doctor.id}&date=${date}`)
    assert.equal(slots.body.on_leave, true)
    assert.equal(slots.body.slots.length, 0)
  })
})

describe('pharmacy', () => {
  test('allergy check, first-expiry-first-out dispensing, and atomic failure', async () => {
    const patient = await newPatient({ allergies: 'Penicillin; dust' })
    const amoxicillin = get(`SELECT id FROM medicines WHERE name = 'Amoxicillin'`)
    const line = { medicine_id: amoxicillin.id, dose: '1 cap', frequency: 'TID', quantity: 10 }
    const blocked = await call('doctor', 'POST', '/clinical/prescriptions', { patient_id: patient.id, items: [line] })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.body.error.allergy_conflicts[0].allergy, 'penicillin')
    const overridden = await call('doctor', 'POST', '/clinical/prescriptions', { patient_id: patient.id, allergy_override: true, items: [line] })
    assert.equal(overridden.status, 201)
    assert.equal(overridden.body.allergy_override, 1)

    const medicine = await call('pharmacy', 'POST', '/pharmacy/medicines', { name: `FefoTest${Date.now()}`, unit_price_cents: 100, reorder_level: 5 })
    const later = await call('pharmacy', 'POST', '/pharmacy/batches', { medicine_id: medicine.body.id, batch_no: 'LATE', expiry_date: '2099-01-01', quantity: 10 })
    const sooner = await call('pharmacy', 'POST', '/pharmacy/batches', { medicine_id: medicine.body.id, batch_no: 'SOON', expiry_date: '2090-01-01', quantity: 10 })
    assert.equal(sooner.status, 201)
    const rx = await call('doctor', 'POST', '/clinical/prescriptions', { patient_id: patient.id, items: [{ medicine_id: medicine.body.id, dose: '1', frequency: 'OD', quantity: 18 }] })
    const itemId = rx.body.items[0].id

    const tooMany = await call('pharmacy', 'POST', `/pharmacy/prescriptions/${rx.body.id}/dispense`, { items: [{ item_id: itemId, quantity: 19 }] })
    assert.equal(tooMany.status, 409)
    assert.equal(get('SELECT quantity FROM medicine_batches WHERE id = ?', later.body.id).quantity, 10, 'failed dispense changes nothing')

    const partial = await call('pharmacy', 'POST', `/pharmacy/prescriptions/${rx.body.id}/dispense`, { items: [{ item_id: itemId, quantity: 12 }] })
    assert.equal(partial.body.status, 'partial')
    assert.equal(get('SELECT quantity FROM medicine_batches WHERE id = ?', sooner.body.id).quantity, 0, 'soonest expiry used first')
    assert.equal(get('SELECT quantity FROM medicine_batches WHERE id = ?', later.body.id).quantity, 8)
    const charge = get(`SELECT * FROM charges WHERE source_type = 'prescription_item' AND source_id = ?`, itemId)
    assert.equal(charge.quantity, 12)
    const done = await call('pharmacy', 'POST', `/pharmacy/prescriptions/${rx.body.id}/dispense`, { items: [{ item_id: itemId, quantity: 6 }] })
    assert.equal(done.body.status, 'dispensed')
    assert.equal((await call('pharmacy', 'POST', `/pharmacy/prescriptions/${rx.body.id}/dispense`, { items: [{ item_id: itemId, quantity: 1 }] })).status, 409)
  })
})

describe('laboratory', () => {
  test('flags results, alerts on critical values, and cancelling removes charges', async () => {
    const patient = await newPatient()
    const potassium = get(`SELECT id FROM lab_tests WHERE code = 'K'`)
    const hemoglobin = get(`SELECT id FROM lab_tests WHERE code = 'CBC-HB'`)
    const order = await call('doctor', 'POST', '/lab/orders', { patient_id: patient.id, test_ids: [potassium.id, hemoglobin.id], priority: 'stat' })
    assert.equal(order.status, 201)
    const [first, second] = order.body.items
    assert.equal(all(`SELECT id FROM charges WHERE patient_id = ? AND kind = 'laboratory'`, patient.id).length, 2)
    const early = await call('lab', 'POST', `/lab/orders/${order.body.id}/results`, { results: [{ item_id: first.id, result_value: 7 }] })
    assert.equal(early.status, 409, 'must collect first')
    await call('lab', 'POST', `/lab/orders/${order.body.id}/collect`)
    const partial = await call('lab', 'POST', `/lab/orders/${order.body.id}/results`, { results: [{ item_id: first.id, result_value: 7 }] })
    assert.equal(partial.body.status, 'in_progress')
    assert.equal(partial.body.items.find((item) => item.id === first.id).flag, 'critical')
    const alert = get(`SELECT * FROM notifications WHERE severity = 'critical' AND title LIKE ? ORDER BY id DESC`, `%${patient.last_name}%`)
    assert.ok(alert)
    const final = await call('lab', 'POST', `/lab/orders/${order.body.id}/results`, { results: [{ item_id: second.id, result_value: 13 }] })
    assert.equal(final.body.status, 'completed')
    assert.equal(final.body.items.find((item) => item.id === second.id).flag, 'normal')

    const other = await call('doctor', 'POST', '/lab/orders', { patient_id: patient.id, test_ids: [hemoglobin.id] })
    const before = all(`SELECT id FROM charges WHERE patient_id = ?`, patient.id).length
    assert.equal((await call('doctor', 'POST', `/lab/orders/${other.body.id}/cancel`)).status, 200)
    assert.equal(all(`SELECT id FROM charges WHERE patient_id = ?`, patient.id).length, before - 1)
  })
})

describe('inpatient care', () => {
  test('admit, transfer, discharge: beds stay consistent and bed days bill at each ward rate', async () => {
    const patient = await newPatient()
    const doctor = get(`SELECT id FROM users WHERE email = 'doctor@hospital.test'`)
    const free = all(`SELECT b.id, w.daily_rate_cents, w.id AS ward_id FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.status = 'available' ORDER BY w.daily_rate_cents`)
    const bedA = free[0]
    const bedB = free.find((bed) => bed.ward_id !== bedA.ward_id)
    const admitted = await call('reception', 'POST', '/ipd/admissions', { patient_id: patient.id, doctor_id: doctor.id, bed_id: bedA.id, reason: 'Observation' })
    assert.equal(admitted.status, 201)
    assert.equal(get('SELECT status FROM beds WHERE id = ?', bedA.id).status, 'occupied')
    const other = await newPatient()
    assert.equal((await call('reception', 'POST', '/ipd/admissions', { patient_id: other.id, doctor_id: doctor.id, bed_id: bedA.id, reason: 'x' })).status, 409, 'bed is taken')
    assert.equal((await call('reception', 'POST', '/ipd/admissions', { patient_id: patient.id, doctor_id: doctor.id, bed_id: bedB.id, reason: 'x' })).status, 409, 'already admitted')

    assert.equal((await call('nurse', 'POST', `/ipd/admissions/${admitted.body.id}/transfer`, { bed_id: bedB.id, reason: 'Needs monitoring' })).status, 200)
    assert.equal(get('SELECT status FROM beds WHERE id = ?', bedA.id).status, 'cleaning')
    assert.equal(get('SELECT status FROM beds WHERE id = ?', bedB.id).status, 'occupied')

    assert.equal((await call('nurse', 'POST', `/ipd/admissions/${admitted.body.id}/discharge`, {})).status, 403)
    const discharged = await call('doctor', 'POST', `/ipd/admissions/${admitted.body.id}/discharge`, { discharge_condition: 'recovered', discharge_summary: 'Well' })
    assert.equal(discharged.status, 200)
    assert.equal(get('SELECT status FROM beds WHERE id = ?', bedB.id).status, 'cleaning')
    const bedCharges = all(`SELECT * FROM charges WHERE admission_id = ? AND kind = 'bed'`, admitted.body.id)
    assert.equal(bedCharges.length, 1, 'same-day transfer is one billable day')
    assert.equal(bedCharges[0].unit_price_cents, bedB.daily_rate_cents)
    assert.equal((await call('doctor', 'POST', `/ipd/admissions/${admitted.body.id}/discharge`, { discharge_condition: 'recovered', discharge_summary: 'Again' })).status, 409)
  })
})

describe('billing', () => {
  test('invoice, tax, partial payment, overpayment refusal, void releases charges', async () => {
    await call('admin', 'PATCH', '/settings', { tax_percent: 10 })
    const patient = await newPatient({ insurance_provider: 'Unity Care', insurance_policy: 'P-1' })
    const first = await call('billing', 'POST', '/billing/charges', { patient_id: patient.id, description: 'Item A', unit_price_cents: 10000, quantity: 2 })
    const second = await call('billing', 'POST', '/billing/charges', { patient_id: patient.id, description: 'Item B', unit_price_cents: 5000 })
    const chargeIds = [first.body.id, second.body.id]
    const invoice = await call('billing', 'POST', '/billing/invoices', { patient_id: patient.id, charge_ids: chargeIds, discount_cents: 5000 })
    assert.equal(invoice.status, 201)
    assert.equal(invoice.body.subtotal_cents, 25000)
    assert.equal(invoice.body.tax_cents, 2000)
    assert.equal(invoice.body.total_cents, 22000)
    assert.equal((await call('billing', 'POST', '/billing/invoices', { patient_id: patient.id, charge_ids: chargeIds })).status, 409, 'charges cannot be billed twice')

    const pay = (amount) => call('billing', 'POST', `/billing/invoices/${invoice.body.id}/payments`, { amount_cents: amount, method: 'card' })
    assert.equal((await pay(30000)).status, 400)
    assert.equal((await pay(2000)).status, 201)
    const partial = await call('billing', 'GET', `/billing/invoices/${invoice.body.id}`)
    assert.equal(partial.body.status, 'partial')
    assert.equal(partial.body.balance_cents, 20000)
    assert.equal((await call('billing', 'POST', `/billing/invoices/${invoice.body.id}/void`, { reason: 'x' })).status, 409, 'paid invoices cannot be voided')

    const claim = await call('billing', 'POST', '/billing/claims', { invoice_id: invoice.body.id, claimed_cents: 20000 })
    assert.equal(claim.status, 201)
    assert.equal(claim.body.provider, 'Unity Care')
    assert.equal((await call('billing', 'POST', `/billing/claims/${claim.body.id}/settle`, {})).status, 409, 'must be approved first')
    await call('billing', 'POST', `/billing/claims/${claim.body.id}/decide`, { status: 'approved', approved_cents: 20000 })
    assert.equal((await call('billing', 'POST', `/billing/claims/${claim.body.id}/settle`, {})).status, 200)
    assert.equal((await call('billing', 'GET', `/billing/invoices/${invoice.body.id}`)).body.status, 'paid')

    const third = await call('billing', 'POST', '/billing/charges', { patient_id: patient.id, description: 'Item C', unit_price_cents: 700 })
    const toVoid = await call('billing', 'POST', '/billing/invoices', { patient_id: patient.id, charge_ids: [third.body.id] })
    assert.equal((await call('reception', 'POST', `/billing/invoices/${toVoid.body.id}/void`, { reason: 'Mistake' })).status, 403)
    assert.equal((await call('billing', 'POST', `/billing/invoices/${toVoid.body.id}/void`, { reason: 'Mistake' })).status, 200)
    assert.equal(get('SELECT invoice_id FROM charges WHERE id = ?', third.body.id).invoice_id, null)
    await call('admin', 'PATCH', '/settings', { tax_percent: 0 })
  })
})

describe('other departments', () => {
  test('surgery clashes are refused for the theatre and the surgeon', async () => {
    const patient = await newPatient()
    const surgeon = get(`SELECT id FROM users WHERE email = 'doctor5@hospital.test'`)
    const theatre = get('SELECT id FROM theatres LIMIT 1')
    const otherTheatre = get('SELECT id FROM theatres WHERE id != ? LIMIT 1', theatre.id)
    const booking = { patient_id: patient.id, surgeon_id: surgeon.id, theatre_id: theatre.id, procedure_name: 'Test', date: '2099-03-03', start_time: '09:00', end_time: '10:00', price_cents: 5000 }
    const created = await call('doctor', 'POST', '/surgery', booking)
    assert.equal(created.status, 201)
    assert.equal((await call('doctor', 'POST', '/surgery', { ...booking, start_time: '09:30', end_time: '10:30', theatre_id: otherTheatre.id })).status, 409)
    const backToBack = await call('doctor', 'POST', '/surgery', { ...booking, start_time: '10:00', end_time: '11:00' })
    assert.equal(backToBack.status, 201, 'adjacent bookings do not clash')
    await call('doctor', 'POST', `/surgery/${created.body.id}/status`, { status: 'in_progress' })
    await call('doctor', 'POST', `/surgery/${created.body.id}/status`, { status: 'completed', post_op_notes: 'Uneventful' })
    assert.equal(all(`SELECT id FROM charges WHERE source_type = 'surgery' AND source_id = ?`, created.body.id).length, 1)
  })

  test('blood is only issued to compatible patients', async () => {
    const negative = await newPatient({ blood_group: 'O-' })
    const unit = await call('lab', 'POST', '/blood/units', { blood_group: 'A+', component: 'packed_rbc', collected_on: today(), expires_on: '2099-01-01' })
    assert.equal(unit.status, 201)
    assert.equal((await call('lab', 'POST', `/blood/units/${unit.body.id}/issue`, { patient_id: negative.id })).status, 409)
    const compatible = await newPatient({ blood_group: 'AB+' })
    assert.equal((await call('lab', 'POST', `/blood/units/${unit.body.id}/issue`, { patient_id: compatible.id })).status, 200)
    assert.equal((await call('lab', 'POST', `/blood/units/${unit.body.id}/issue`, { patient_id: compatible.id })).status, 409)
  })

  test('an emergency patient is billed only once care starts, and critical arrivals alert doctors', async () => {
    const patient = await newPatient()
    const visit = await call('nurse', 'POST', '/emergency', { patient_id: patient.id, triage_level: 1, chief_complaint: 'Collapse' })
    assert.equal(visit.status, 201)
    assert.equal(all(`SELECT id FROM charges WHERE patient_id = ?`, patient.id).length, 0)
    assert.ok(get(`SELECT id FROM notifications WHERE severity = 'critical' AND title LIKE 'Emergency%'`))
    assert.equal((await call('nurse', 'PATCH', `/emergency/${visit.body.id}`, { status: 'in_treatment' })).status, 422, 'needs a doctor')
    const doctor = get(`SELECT id FROM users WHERE role = 'doctor' LIMIT 1`)
    await call('nurse', 'PATCH', `/emergency/${visit.body.id}`, { status: 'in_treatment', doctor_id: doctor.id })
    assert.equal(all(`SELECT id FROM charges WHERE patient_id = ?`, patient.id).length, 1)
    await call('nurse', 'PATCH', `/emergency/${visit.body.id}`, { status: 'discharged' })
    assert.equal((await call('nurse', 'PATCH', `/emergency/${visit.body.id}`, { status: 'waiting' })).status, 409)
  })

  test('ambulance availability and inventory stock floors hold', async () => {
    const vehicle = await call('reception', 'POST', '/ambulance/vehicles', { vehicle_no: `AMB-T${Date.now()}`, type: 'basic' })
    const trip = await call('reception', 'POST', '/ambulance/trips', { ambulance_id: vehicle.body.id, patient_name: 'A', pickup: 'B', destination: 'C' })
    assert.equal(trip.status, 201)
    assert.equal((await call('reception', 'POST', '/ambulance/trips', { ambulance_id: vehicle.body.id, patient_name: 'A', pickup: 'B', destination: 'C' })).status, 409)
    await call('reception', 'POST', `/ambulance/trips/${trip.body.id}/close`, { status: 'completed' })
    assert.equal(get('SELECT status FROM ambulances WHERE id = ?', vehicle.body.id).status, 'available')

    const item = await call('nurse', 'POST', '/inventory/items', { name: `Item${Date.now()}`, reorder_level: 1 })
    assert.equal((await call('nurse', 'POST', `/inventory/items/${item.body.id}/move`, { quantity: -1, reference: 'x' })).status, 409)
    assert.equal((await call('nurse', 'POST', `/inventory/items/${item.body.id}/move`, { quantity: 5, reference: 'Delivery' })).body.quantity, 5)
  })

  test('dashboards and reports return data shaped for each role', async () => {
    const admin = await call('admin', 'GET', '/dashboard')
    assert.ok(admin.body.stats.total_patients > 0)
    assert.equal(admin.body.revenue_trend.length, 30)
    const nurse = await call('nurse', 'GET', '/dashboard')
    assert.equal(nurse.body.revenue_trend, undefined, 'nurses do not see finance')
    const reports = await call('billing', 'GET', `/reports/summary?from=2000-01-01&to=${today()}`)
    assert.equal(reports.status, 200)
    assert.ok(reports.body.collections_cents > 0)
    assert.equal((await call('nurse', 'GET', '/reports/summary?from=2000-01-01&to=2001-01-01')).status, 403)
    assert.equal((await call('billing', 'GET', '/reports/summary?from=bad&to=worse')).status, 400)
  })
})
