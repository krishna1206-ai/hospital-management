import bcrypt from 'bcryptjs'
import { all, db, get, insert, nextNumber, run, transaction, update } from './index.js'
import { localDate, postCharge, refreshInvoiceBalance } from '../lib/domain.js'
import { flagResult } from '../routes/lab.js'

export const DEMO_PASSWORD = 'Hospital@2026'

/** Settings every installation needs, demo or not. Never overwrites existing values. */
export function seedBaseline() {
  const defaults = {
    hospital_name: 'Meridian General Hospital',
    hospital_address: '200 Riverside Avenue, Springfield',
    hospital_phone: '+1 555 010 2000',
    hospital_email: 'info@meridian-general.example',
    currency: 'USD',
    tax_percent: '0',
    tax_label: 'Tax',
    er_fee_cents: '15000',
    blood_unit_fee_cents: '12000',
  }
  for (const [key, value] of Object.entries(defaults)) {
    run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value)
  }
}

// Deterministic, so every fresh demo database looks the same.
let state = 20260101
function random() {
  state = (state * 1664525 + 1013904223) % 4294967296
  return state / 4294967296
}
const pick = (list) => list[Math.floor(random() * list.length)]
const between = (min, max) => min + Math.floor(random() * (max - min + 1))

const daysFrom = (offset) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date
}
const dateFrom = (offset) => localDate(daysFrom(offset))
const isoAt = (offset, hour = 10, minute = 0) => {
  const date = daysFrom(offset)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

const DEPARTMENTS = [
  ['General Medicine', 'GEN', 'Block A, Level 1'],
  ['Cardiology', 'CAR', 'Block B, Level 2'],
  ['Orthopedics', 'ORT', 'Block B, Level 3'],
  ['Pediatrics', 'PED', 'Block A, Level 2'],
  ['Obstetrics & Gynecology', 'OBG', 'Block C, Level 2'],
  ['Neurology', 'NEU', 'Block B, Level 4'],
  ['General Surgery', 'SUR', 'Block D, Level 1'],
  ['Emergency Medicine', 'EME', 'Block A, Ground'],
]

const DOCTORS = [
  ['Dr. Amara Okafor', 'GEN', 'Internal Medicine', 6000],
  ['Dr. Daniel Reyes', 'CAR', 'Interventional Cardiology', 12000],
  ['Dr. Priya Nair', 'CAR', 'Cardiology', 11000],
  ['Dr. Jonas Weber', 'ORT', 'Joint Replacement', 10000],
  ['Dr. Sofia Lindqvist', 'PED', 'Pediatrics', 7000],
  ['Dr. Hassan Malik', 'OBG', 'Obstetrics', 9000],
  ['Dr. Mei Tanaka', 'NEU', 'Neurology', 13000],
  ['Dr. Lucas Moreau', 'SUR', 'General Surgery', 10000],
  ['Dr. Grace Mensah', 'EME', 'Emergency Medicine', 8000],
]

const FIRST_NAMES = ['James', 'Olivia', 'Noah', 'Emma', 'Liam', 'Ava', 'Ethan', 'Mia', 'Lucas', 'Zara', 'Omar', 'Fatima', 'Chen', 'Aisha', 'Mateo', 'Nina', 'Ravi', 'Elena', 'Samuel', 'Leila', 'Kofi', 'Ingrid', 'Diego', 'Hana', 'Peter', 'Yara', 'Marcus', 'Anika', 'Tomas', 'Ruth']
const LAST_NAMES = ['Anderson', 'Bennett', 'Carter', 'Diaz', 'Evans', 'Farah', 'Garcia', 'Hughes', 'Ibrahim', 'Jensen', 'Kumar', 'Lopez', 'Mitchell', 'Nguyen', 'Owens', 'Patel', 'Quinn', 'Rahman', 'Schmidt', 'Turner']
const CITIES = ['Springfield', 'Riverton', 'Fairview', 'Oakdale', 'Lakeside']
const ALLERGIES = [null, null, null, null, 'Penicillin', 'Sulfa drugs', 'Aspirin', 'Peanuts; latex']
const CONDITIONS = [null, null, null, 'Hypertension', 'Type 2 diabetes', 'Asthma', 'Hypothyroidism']
const INSURERS = [null, null, 'BlueShield Health', 'Horizon Mutual', 'Unity Care']
const GROUPS = ['O+', 'O+', 'A+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-']

const DIAGNOSES = [
  ['Essential hypertension', 'I10'],
  ['Type 2 diabetes mellitus', 'E11.9'],
  ['Acute upper respiratory infection', 'J06.9'],
  ['Low back pain', 'M54.5'],
  ['Migraine without aura', 'G43.0'],
  ['Gastroesophageal reflux disease', 'K21.9'],
  ['Osteoarthritis of knee', 'M17.9'],
  ['Asthma, mild persistent', 'J45.3'],
]

const MEDICINES = [
  ['Amoxicillin', 'Amoxicillin (penicillin)', 'Capsule', '500 mg', 'Antibiotic', 45],
  ['Azithromycin', 'Azithromycin', 'Tablet', '250 mg', 'Antibiotic', 120],
  ['Paracetamol', 'Acetaminophen', 'Tablet', '500 mg', 'Analgesic', 8],
  ['Ibuprofen', 'Ibuprofen', 'Tablet', '400 mg', 'Analgesic', 15],
  ['Aspirin', 'Acetylsalicylic acid (aspirin)', 'Tablet', '75 mg', 'Antiplatelet', 10],
  ['Metformin', 'Metformin', 'Tablet', '500 mg', 'Antidiabetic', 18],
  ['Amlodipine', 'Amlodipine', 'Tablet', '5 mg', 'Antihypertensive', 22],
  ['Atorvastatin', 'Atorvastatin', 'Tablet', '20 mg', 'Statin', 35],
  ['Omeprazole', 'Omeprazole', 'Capsule', '20 mg', 'Proton pump inhibitor', 25],
  ['Salbutamol Inhaler', 'Salbutamol', 'Inhaler', '100 mcg', 'Bronchodilator', 850],
  ['Levothyroxine', 'Levothyroxine', 'Tablet', '50 mcg', 'Thyroid', 20],
  ['Ceftriaxone', 'Ceftriaxone', 'Injection', '1 g', 'Antibiotic', 650],
  ['Normal Saline', 'Sodium chloride 0.9%', 'IV Fluid', '500 ml', 'IV Fluid', 300],
  ['Insulin Glargine', 'Insulin glargine', 'Injection', '100 IU/ml', 'Antidiabetic', 2400],
  ['Sulfamethoxazole-Trimethoprim', 'Sulfa combination', 'Tablet', '960 mg', 'Antibiotic', 30],
]

const LAB_TESTS = [
  ['CBC-HB', 'Hemoglobin', 'laboratory', 'Blood', 'g/dL', 12, 17, 7, 20, 900, 4],
  ['CBC-WBC', 'White Blood Cell Count', 'laboratory', 'Blood', '10^9/L', 4, 11, 2, 30, 900, 4],
  ['GLU-F', 'Fasting Blood Glucose', 'laboratory', 'Blood', 'mg/dL', 70, 100, 40, 400, 700, 2],
  ['HBA1C', 'Hemoglobin A1c', 'laboratory', 'Blood', '%', 4, 5.6, null, null, 2200, 24],
  ['CREAT', 'Serum Creatinine', 'laboratory', 'Blood', 'mg/dL', 0.6, 1.3, null, 7, 1100, 6],
  ['K', 'Serum Potassium', 'laboratory', 'Blood', 'mmol/L', 3.5, 5.1, 2.8, 6.2, 1000, 4],
  ['TSH', 'Thyroid Stimulating Hormone', 'laboratory', 'Blood', 'mIU/L', 0.4, 4.5, null, null, 2600, 24],
  ['LIPID', 'Total Cholesterol', 'laboratory', 'Blood', 'mg/dL', 120, 200, null, null, 1800, 12],
  ['UA', 'Urinalysis', 'laboratory', 'Urine', null, null, null, null, null, 800, 4],
  ['XR-CH', 'Chest X-Ray', 'radiology', null, null, null, null, null, null, 4500, 2],
  ['CT-HD', 'CT Head', 'radiology', null, null, null, null, null, null, 28000, 6],
  ['MRI-KN', 'MRI Knee', 'radiology', null, null, null, null, null, null, 42000, 24],
  ['US-AB', 'Ultrasound Abdomen', 'radiology', null, null, null, null, null, null, 9500, 6],
]

const WARDS = [
  ['General Ward A', 'general', '1', 'GEN', 12000, 12],
  ['General Ward B', 'general', '1', 'SUR', 12000, 10],
  ['Cardiac Care Unit', 'icu', '2', 'CAR', 65000, 6],
  ['Intensive Care Unit', 'icu', '3', 'EME', 72000, 8],
  ['Maternity Ward', 'maternity', '2', 'OBG', 22000, 8],
  ['Pediatric Ward', 'general', '2', 'PED', 15000, 8],
  ['Private Rooms', 'private', '4', null, 38000, 6],
]

const SERVICES = [
  ['SVC-ECG', 'Electrocardiogram (ECG)', 'Diagnostics', 3500],
  ['SVC-DRESS', 'Wound dressing', 'Nursing', 1200],
  ['SVC-INJ', 'Injection administration', 'Nursing', 500],
  ['SVC-NEB', 'Nebulization', 'Respiratory', 1500],
  ['SVC-PT', 'Physiotherapy session', 'Rehabilitation', 4000],
  ['SVC-CERT', 'Medical certificate', 'Administrative', 1000],
]

export async function seed() {
  seedBaseline()
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  transaction(() => {
    const departmentIds = {}
    for (const [name, code, location] of DEPARTMENTS) {
      departmentIds[code] = insert('departments', { name, code, location, phone: `+1 555 010 ${between(2100, 2999)}` })
    }

    const addUser = (name, email, role, extra = {}) =>
      insert('users', { name, email, role, password_hash: passwordHash, phone: `+1 555 020 ${between(1000, 9999)}`, ...extra })

    const adminId = addUser('Morgan Hale', 'admin@hospital.test', 'admin')
    const nurseId = addUser('Tessa Brooks', 'nurse@hospital.test', 'nurse', { department_id: departmentIds.GEN })
    const receptionistId = addUser('Ben Adeyemi', 'reception@hospital.test', 'receptionist')
    const pharmacistId = addUser('Rosa Marin', 'pharmacy@hospital.test', 'pharmacist')
    const labTechId = addUser('Ivan Petrov', 'lab@hospital.test', 'lab_technician')
    const accountantId = addUser('Claire Dubois', 'billing@hospital.test', 'accountant')

    const doctors = DOCTORS.map(([name, code, specialization, fee], index) => ({
      id: addUser(name, index === 0 ? 'doctor@hospital.test' : `doctor${index + 1}@hospital.test`, 'doctor', {
        department_id: departmentIds[code],
        specialization,
        license_no: `MD-${10000 + index * 137}`,
        consultation_fee_cents: fee,
      }),
      name,
      fee,
      department_id: departmentIds[code],
    }))

    for (const doctor of doctors) {
      for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
        if (weekday === 0) continue
        insert('doctor_schedules', { doctor_id: doctor.id, weekday, start_time: '09:00', end_time: '13:00', slot_minutes: 20 })
        if (weekday !== 6) insert('doctor_schedules', { doctor_id: doctor.id, weekday, start_time: '14:00', end_time: '17:00', slot_minutes: 20 })
      }
    }

    const staff = [nurseId, receptionistId, pharmacistId, labTechId, ...doctors.map((doctor) => doctor.id)]
    for (let offset = -1; offset <= 6; offset++) {
      staff.forEach((userId, index) => {
        insert('shifts', { user_id: userId, date: dateFrom(offset), shift: ['morning', 'evening', 'night'][(index + offset + 2) % 3] })
      })
    }
    insert('leave_requests', { user_id: nurseId, type: 'annual', start_date: dateFrom(14), end_date: dateFrom(18), reason: 'Family travel' })
    insert('leave_requests', { user_id: doctors[3].id, type: 'annual', start_date: dateFrom(30), end_date: dateFrom(34), reason: 'Conference' })

    const patients = []
    for (let index = 0; index < 60; index++) {
      const first = FIRST_NAMES[index % FIRST_NAMES.length]
      const last = LAST_NAMES[(index * 7) % LAST_NAMES.length]
      const provider = pick(INSURERS)
      const registeredDaysAgo = between(0, 180)
      const id = insert('patients', {
        mrn: nextNumber('MRN', { yearly: false }),
        first_name: first,
        last_name: last,
        dob: `${between(1945, 2020)}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`,
        gender: index % 2 ? 'female' : 'male',
        blood_group: pick(GROUPS),
        phone: `+1 555 030 ${String(1000 + index * 13)}`,
        email: `${first}.${last}${index}@mail.example`.toLowerCase(),
        address: `${between(10, 990)} ${pick(['Oak', 'Maple', 'Cedar', 'Pine', 'Elm'])} Street`,
        city: pick(CITIES),
        emergency_name: `${pick(FIRST_NAMES)} ${last}`,
        emergency_phone: `+1 555 040 ${String(2000 + index * 11)}`,
        emergency_relation: pick(['Spouse', 'Parent', 'Sibling', 'Child']),
        allergies: pick(ALLERGIES),
        chronic_conditions: pick(CONDITIONS),
        insurance_provider: provider,
        insurance_policy: provider ? `POL-${between(100000, 999999)}` : null,
        created_by: receptionistId,
        created_at: isoAt(-registeredDaysAgo),
      })
      patients.push({ id, name: `${first} ${last}` })
    }

    const supplierIds = [
      insert('suppliers', { name: 'MedSupply Partners', contact_person: 'Alan Cooper', phone: '+1 555 050 1100', email: 'orders@medsupply.example' }),
      insert('suppliers', { name: 'CarePharma Distribution', contact_person: 'Lena Fischer', phone: '+1 555 050 2200', email: 'sales@carepharma.example' }),
    ]

    const medicineIds = MEDICINES.map(([name, generic, form, strength, category, price], index) => {
      const medicineId = insert('medicines', { name, generic_name: generic, form, strength, category, manufacturer: pick(['Novara Labs', 'Celtis Pharma', 'Astera']), unit_price_cents: price, reorder_level: 50 })
      // A few medicines are deliberately short or close to expiry so the alerts have something to show.
      const quantity = index % 7 === 3 ? 30 : between(150, 600)
      const expiryOffset = index % 5 === 2 ? 40 : between(180, 700)
      const batchNo = `B${2600 + index}`
      const batchId = insert('medicine_batches', { medicine_id: medicineId, batch_no: batchNo, expiry_date: dateFrom(expiryOffset), quantity, cost_cents: Math.round(price * 0.6), supplier_id: pick(supplierIds), received_at: isoAt(-60) })
      insert('stock_movements', { medicine_id: medicineId, batch_id: batchId, kind: 'receive', quantity, reference: `Batch ${batchNo}`, user_id: pharmacistId, created_at: isoAt(-60) })
      return medicineId
    })

    const testRows = LAB_TESTS.map(([code, name, category, specimen, unit, low, high, critLow, critHigh, price, hours]) => {
      const row = { code, name, category, specimen, unit, ref_low: low, ref_high: high, critical_low: critLow, critical_high: critHigh, price_cents: price, turnaround_hours: hours }
      return { ...row, id: insert('lab_tests', row) }
    })

    const beds = []
    for (const [name, type, floor, code, rate, count] of WARDS) {
      const wardId = insert('wards', { name, type, floor, department_id: code ? departmentIds[code] : null, daily_rate_cents: rate })
      for (let number = 1; number <= count; number++) beds.push({ id: insert('beds', { ward_id: wardId, number: String(number) }), rate, name })
    }

    for (const [code, name, category, price] of SERVICES) insert('services', { code, name, category, price_cents: price })

    // 90 days of outpatient history, plus today and the coming days.
    let appointmentIndex = 0
    for (let offset = -90; offset <= 5; offset++) {
      const day = daysFrom(offset).getDay()
      if (day === 0 && offset !== 0) continue // Closed Sundays, but a demo should never open empty.
      const volume = offset === 0 ? 14 : offset > 0 ? between(3, 7) : between(6, 14)
      for (let slot = 0; slot < volume; slot++) {
        const doctor = doctors[appointmentIndex++ % doctors.length]
        const patient = pick(patients)
        const minutes = 9 * 60 + (slot % 12) * 20
        const start = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
        const endMinutes = minutes + 20
        const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
        const date = dateFrom(offset)
        if (get(`SELECT id FROM appointments WHERE doctor_id = ? AND date = ? AND start_time = ?`, doctor.id, date, start)) continue

        let status = 'scheduled'
        if (offset < 0) status = random() < 0.08 ? 'no_show' : random() < 0.05 ? 'cancelled' : 'completed'
        const reason = pick(['Routine check-up', 'Chest discomfort', 'Follow-up visit', 'Persistent cough', 'Joint pain', 'Headache', 'Medication review', 'Fever'])
        const appointmentId = insert('appointments', {
          patient_id: patient.id,
          doctor_id: doctor.id,
          department_id: doctor.department_id,
          date,
          start_time: start,
          end_time: end,
          type: pick(['consultation', 'consultation', 'follow_up']),
          reason,
          status,
          cancel_reason: status === 'cancelled' ? 'Patient request' : null,
          created_by: receptionistId,
          created_at: isoAt(offset - 3),
        })

        if (status === 'completed') {
          const [diagnosis, icd] = pick(DIAGNOSES)
          run(`UPDATE appointments SET completed_at = ?, checked_in_at = ?, started_at = ? WHERE id = ?`, isoAt(offset, 11), isoAt(offset, 9), isoAt(offset, 10), appointmentId)
          const encounterId = insert('encounters', {
            patient_id: patient.id,
            doctor_id: doctor.id,
            appointment_id: appointmentId,
            chief_complaint: reason,
            subjective: 'Patient reports symptoms for several days. No recent travel.',
            objective: 'Alert and oriented. Vitals stable. Chest clear, heart sounds normal.',
            assessment: diagnosis,
            plan: 'Continue current management and review in clinic.',
            diagnosis,
            icd_code: icd,
            status: 'signed',
            signed_at: isoAt(offset, 11),
            created_at: isoAt(offset, 10),
          })
          insert('vitals', {
            patient_id: patient.id,
            temperature_c: 36 + random() * 1.5,
            pulse: between(60, 98),
            resp_rate: between(12, 20),
            systolic: between(105, 150),
            diastolic: between(65, 95),
            spo2: between(95, 100),
            weight_kg: between(45, 98),
            height_cm: between(150, 190),
            recorded_by: nurseId,
            recorded_at: isoAt(offset, 9, 30),
          })
          const chargeId = insert('charges', {
            patient_id: patient.id,
            kind: 'consultation',
            description: `Consultation: ${doctor.name}`,
            unit_price_cents: doctor.fee,
            source_type: 'appointment',
            source_id: appointmentId,
            created_by: doctor.id,
            created_at: isoAt(offset, 11),
          })
          // Most historic visits were invoiced and paid; some remain open or unbilled.
          const roll = random()
          if (roll < 0.85) {
            const invoiceId = insert('invoices', {
              invoice_no: nextNumber('INV'),
              patient_id: patient.id,
              subtotal_cents: doctor.fee,
              total_cents: doctor.fee,
              created_by: accountantId,
              created_at: isoAt(offset, 12),
            })
            update('charges', chargeId, { invoice_id: invoiceId })
            if (roll < 0.72) {
              insert('payments', { invoice_id: invoiceId, amount_cents: doctor.fee, method: pick(['cash', 'card', 'card', 'mobile', 'bank_transfer']), received_by: receptionistId, created_at: isoAt(offset, 12, 30) })
            } else if (roll < 0.78) {
              insert('payments', { invoice_id: invoiceId, amount_cents: Math.round(doctor.fee / 2), method: 'cash', received_by: receptionistId, created_at: isoAt(offset, 12, 30) })
            }
            refreshInvoiceBalance(invoiceId)
          }
          if (random() < 0.3) {
            const medicineId = pick(medicineIds)
            const rxId = insert('prescriptions', { patient_id: patient.id, doctor_id: doctor.id, encounter_id: encounterId, status: 'dispensed', created_at: isoAt(offset, 11) })
            const quantity = between(10, 30)
            insert('prescription_items', { prescription_id: rxId, medicine_id: medicineId, dose: '1 tablet', frequency: 'Twice daily', route: 'Oral', duration_days: 7, quantity, dispensed_qty: quantity })
            const batch = get('SELECT id FROM medicine_batches WHERE medicine_id = ? LIMIT 1', medicineId)
            insert('stock_movements', { medicine_id: medicineId, batch_id: batch.id, kind: 'dispense', quantity: -quantity, reference: `Prescription #${rxId}`, user_id: pharmacistId, created_at: isoAt(offset, 12) })
          }
          if (random() < 0.25) {
            const test = pick(testRows.filter((row) => row.category === 'laboratory' && row.ref_high))
            const orderId = insert('lab_orders', { order_no: nextNumber('LAB'), patient_id: patient.id, doctor_id: doctor.id, encounter_id: encounterId, status: 'completed', collected_at: isoAt(offset, 11), completed_at: isoAt(offset, 14), created_at: isoAt(offset, 10, 30) })
            const value = Math.round((test.ref_low + (test.ref_high - test.ref_low) * (random() * 1.3)) * 10) / 10
            insert('lab_order_items', { order_id: orderId, test_id: test.id, result_value: value, flag: flagResult(test, value), resulted_by: labTechId, resulted_at: isoAt(offset, 14) })
          }
        }
      }
    }

    // Live work for today: a waiting room, a visit under way, open prescriptions and lab orders.
    const todayRows = all(`SELECT * FROM appointments WHERE date = ? AND status = 'scheduled' ORDER BY start_time`, dateFrom(0))
    todayRows.slice(0, 5).forEach((row, index) => {
      update('appointments', row.id, { status: 'checked_in', token_no: index + 1, checked_in_at: new Date(Date.now() - (6 - index) * 600000).toISOString() })
    })

    const doctorOne = doctors[0]
    for (let index = 0; index < 5; index++) {
      const patient = patients[index + 3]
      const rxId = insert('prescriptions', { patient_id: patient.id, doctor_id: doctorOne.id, notes: index === 0 ? 'Take with food' : null })
      insert('prescription_items', { prescription_id: rxId, medicine_id: medicineIds[2], dose: '1 tablet', frequency: 'Every 6 hours', route: 'Oral', duration_days: 5, quantity: 20, instructions: 'As needed for pain or fever' })
      insert('prescription_items', { prescription_id: rxId, medicine_id: medicineIds[8], dose: '1 capsule', frequency: 'Once daily', route: 'Oral', duration_days: 14, quantity: 14 })
    }
    const labTest = (code) => testRows.find((row) => row.code === code)
    ;[
      ['stat', 'ordered', ['K', 'CREAT']],
      ['urgent', 'ordered', ['CBC-HB', 'CBC-WBC']],
      ['routine', 'collected', ['HBA1C']],
      ['routine', 'ordered', ['XR-CH']],
      ['routine', 'collected', ['LIPID', 'TSH']],
    ].forEach(([priority, status, codes], index) => {
      const patient = patients[index + 10]
      const orderId = insert('lab_orders', {
        order_no: nextNumber('LAB'),
        patient_id: patient.id,
        doctor_id: doctorOne.id,
        priority,
        status,
        collected_at: status === 'collected' ? new Date().toISOString() : null,
      })
      for (const code of codes) {
        const itemId = insert('lab_order_items', { order_id: orderId, test_id: labTest(code).id })
        postCharge({ patientId: patient.id, kind: 'laboratory', description: labTest(code).name, unitPriceCents: labTest(code).price_cents, sourceType: 'lab_order_item', sourceId: itemId, userId: doctorOne.id })
      }
    })

    // Inpatients, including discharged history for length-of-stay reporting.
    const reasons = ['Community-acquired pneumonia', 'Acute coronary syndrome', 'Post-operative care', 'Diabetic ketoacidosis', 'Fractured femur', 'Severe dehydration', 'Stroke observation', 'Labour and delivery']
    const bedPool = [...beds]
    for (let index = 0; index < 28; index++) {
      const bed = bedPool[(index * 3) % bedPool.length]
      if (get(`SELECT id FROM beds WHERE id = ? AND status = 'occupied'`, bed.id)) continue
      const patient = patients[20 + index]
      const doctor = doctors[index % doctors.length]
      const daysAgo = between(1, 8)
      const admissionId = insert('admissions', {
        admission_no: nextNumber('ADM'),
        patient_id: patient.id,
        doctor_id: doctor.id,
        bed_id: bed.id,
        department_id: doctor.department_id,
        reason: reasons[index % reasons.length],
        diagnosis: reasons[index % reasons.length],
        admitted_at: isoAt(-daysAgo, 15),
        expected_discharge: dateFrom(between(1, 4)),
        created_by: receptionistId,
      })
      update('beds', bed.id, { status: 'occupied' })
      insert('bed_stays', { admission_id: admissionId, bed_id: bed.id, daily_rate_cents: bed.rate, started_at: isoAt(-daysAgo, 15), moved_by: receptionistId })
      insert('nursing_notes', { admission_id: admissionId, note: 'Patient settled on the ward. Observations stable, oriented to surroundings.', author_id: nurseId, created_at: isoAt(-daysAgo, 18) })
      insert('vitals', { patient_id: patient.id, admission_id: admissionId, temperature_c: 37.1, pulse: between(70, 100), resp_rate: between(14, 22), systolic: between(110, 145), diastolic: between(70, 90), spo2: between(94, 99), recorded_by: nurseId, recorded_at: isoAt(-1, 8) })
    }
    for (let index = 0; index < 18; index++) {
      const patient = patients[index]
      if (get(`SELECT id FROM admissions WHERE patient_id = ? AND status = 'admitted'`, patient.id)) continue
      const doctor = doctors[index % doctors.length]
      const bed = beds[index]
      const end = -between(2, 70)
      const length = between(2, 9)
      const admissionId = insert('admissions', {
        admission_no: nextNumber('ADM'),
        patient_id: patient.id,
        doctor_id: doctor.id,
        bed_id: bed.id,
        department_id: doctor.department_id,
        reason: reasons[index % reasons.length],
        diagnosis: reasons[index % reasons.length],
        status: 'discharged',
        admitted_at: isoAt(end - length, 14),
        discharged_at: isoAt(end, 11),
        discharge_condition: pick(['recovered', 'improved', 'improved']),
        discharge_summary: 'Responded well to treatment. Discharged in stable condition with outpatient follow-up.',
        discharge_instructions: 'Complete the prescribed medication and return if symptoms worsen.',
        created_by: receptionistId,
      })
      insert('bed_stays', { admission_id: admissionId, bed_id: bed.id, daily_rate_cents: bed.rate, started_at: isoAt(end - length, 14), ended_at: isoAt(end, 11), moved_by: receptionistId })
      const chargeId = insert('charges', { patient_id: patient.id, admission_id: admissionId, kind: 'bed', description: `${bed.name}, bed (${length} days)`, quantity: length, unit_price_cents: bed.rate, source_type: 'bed_stay', created_at: isoAt(end, 11) })
      const total = length * bed.rate
      const invoiceId = insert('invoices', { invoice_no: nextNumber('INV'), patient_id: patient.id, admission_id: admissionId, subtotal_cents: total, total_cents: total, created_by: accountantId, created_at: isoAt(end, 12) })
      update('charges', chargeId, { invoice_id: invoiceId })
      if (index % 3) insert('payments', { invoice_id: invoiceId, amount_cents: total, method: pick(['card', 'bank_transfer']), received_by: accountantId, created_at: isoAt(end + 1, 10) })
      refreshInvoiceBalance(invoiceId)
    }
    // Leave a few rooms mid-turnover so the bed board shows every state.
    const freeBeds = all(`SELECT id FROM beds WHERE status = 'available'`)
    if (freeBeds[1]) update('beds', freeBeds[1].id, { status: 'cleaning' })
    if (freeBeds[4]) update('beds', freeBeds[4].id, { status: 'maintenance' })

    ;[
      [1, 'Severe chest pain, diaphoresis', 'ambulance', 'in_treatment', doctors[8].id, 25],
      [2, 'Shortness of breath, SpO2 89%', 'ambulance', 'waiting', null, 12],
      [3, 'Laceration to forearm, bleeding controlled', 'walk_in', 'waiting', null, 34],
      [3, 'Abdominal pain, vomiting', 'walk_in', 'observation', doctors[8].id, 95],
      [4, 'Ankle sprain after fall', 'walk_in', 'waiting', null, 48],
      [5, 'Prescription refill, mild cough', 'walk_in', 'waiting', null, 62],
    ].forEach(([level, complaint, mode, status, doctorId, minutesAgo], index) => {
      insert('er_visits', {
        patient_id: patients[50 + index].id,
        triage_level: level,
        chief_complaint: complaint,
        arrival_mode: mode,
        status,
        doctor_id: doctorId,
        arrived_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
        seen_at: doctorId ? new Date(Date.now() - (minutesAgo - 8) * 60000).toISOString() : null,
        created_by: receptionistId,
      })
    })

    const theatreIds = ['Theatre 1', 'Theatre 2', 'Theatre 3'].map((name) => insert('theatres', { name, location: 'Block D, Level 1' }))
    ;[
      ['Laparoscopic cholecystectomy', 0, '09:00', '11:00', 7, 0, 'scheduled', 320000],
      ['Total knee replacement', 0, '11:30', '14:00', 3, 1, 'scheduled', 780000],
      ['Inguinal hernia repair', 1, '10:00', '11:30', 7, 0, 'scheduled', 240000],
      ['Coronary angioplasty', 2, '09:00', '11:00', 1, 2, 'scheduled', 950000],
      ['Appendectomy', -2, '13:00', '14:30', 7, 0, 'completed', 280000],
    ].forEach(([name, offset, start, end, doctorIndex, theatreIndex, status, price], index) => {
      insert('surgeries', {
        patient_id: patients[30 + index].id,
        surgeon_id: doctors[doctorIndex].id,
        theatre_id: theatreIds[theatreIndex],
        procedure_name: name,
        date: dateFrom(offset),
        start_time: start,
        end_time: end,
        anesthesia_type: 'General',
        price_cents: price,
        status,
        created_by: adminId,
      })
    })

    const donors = GROUPS.slice(0, 8).map((group, index) => ({
      blood_group: group,
      id: insert('blood_donors', { name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, blood_group: group, phone: `+1 555 060 ${1000 + index}`, last_donation_on: dateFrom(-between(5, 60)) }),
    }))
    const stock = { 'O+': 9, 'A+': 7, 'B+': 4, 'AB+': 3, 'O-': 1, 'A-': 2, 'B-': 2, 'AB-': 0 }
    for (const [group, units] of Object.entries(stock)) {
      for (let index = 0; index < units; index++) {
        insert('blood_units', {
          unit_no: nextNumber('BU'),
          blood_group: group,
          component: pick(['whole_blood', 'packed_rbc', 'packed_rbc', 'plasma', 'platelets']),
          donor_id: donors.find((donor) => donor.blood_group === group)?.id ?? null,
          collected_on: dateFrom(-between(1, 15)),
          expires_on: dateFrom(between(10, 35)),
        })
      }
    }

    const ambulanceIds = [
      insert('ambulances', { vehicle_no: 'AMB-101', type: 'advanced', driver_name: 'Rico Santos', driver_phone: '+1 555 070 1010', status: 'on_trip' }),
      insert('ambulances', { vehicle_no: 'AMB-102', type: 'basic', driver_name: 'Nadia Volkov', driver_phone: '+1 555 070 1020' }),
      insert('ambulances', { vehicle_no: 'AMB-103', type: 'neonatal', driver_name: 'Sam Oduya', driver_phone: '+1 555 070 1030' }),
      insert('ambulances', { vehicle_no: 'AMB-104', type: 'basic', driver_name: 'Elias Berg', driver_phone: '+1 555 070 1040', status: 'maintenance' }),
    ]
    insert('ambulance_trips', { ambulance_id: ambulanceIds[0], patient_name: 'Walter Hughes', contact_phone: '+1 555 080 4411', pickup: '48 Cedar Street, Fairview', destination: 'Meridian General Emergency', notes: 'Suspected stroke, FAST positive', created_by: receptionistId })
    insert('ambulance_trips', { ambulance_id: ambulanceIds[1], patient_name: 'Irene Clarke', pickup: 'Oakdale Care Home', destination: 'Meridian General Emergency', status: 'completed', closed_at: isoAt(-1, 16), dispatched_at: isoAt(-1, 15), created_by: receptionistId })

    ;[
      ['Surgical gloves (box)', 'Consumables', 'box', 'Central Store', 240, 50],
      ['N95 respirators', 'PPE', 'piece', 'Central Store', 120, 150],
      ['IV cannula 20G', 'Consumables', 'piece', 'Ward A Store', 480, 100],
      ['Syringes 5 ml', 'Consumables', 'piece', 'Central Store', 900, 200],
      ['Gauze rolls', 'Consumables', 'roll', 'Ward B Store', 60, 80],
      ['Oxygen cylinders', 'Equipment', 'cylinder', 'Medical Gas Room', 34, 10],
      ['Bed linen sets', 'Linen', 'set', 'Laundry', 150, 40],
      ['Hand sanitizer 500 ml', 'Hygiene', 'bottle', 'Central Store', 75, 30],
    ].forEach(([name, category, unit, location, quantity, reorder]) => {
      const itemId = insert('inventory_items', { name, category, unit, location, quantity, reorder_level: reorder })
      insert('inventory_movements', { item_id: itemId, quantity, reference: 'Opening stock', user_id: adminId })
    })

    insert('notifications', { user_id: doctorOne.id, title: 'Critical result: Elena Rahman', body: 'Serum Potassium: 6.4 mmol/L', link: `/patients/${patients[17].id}`, severity: 'critical' })
    insert('notifications', { user_id: doctorOne.id, title: 'New appointment', body: 'Follow-up booked for tomorrow at 10:00', link: '/appointments' })
  })
  db.exec('PRAGMA optimize')
}
