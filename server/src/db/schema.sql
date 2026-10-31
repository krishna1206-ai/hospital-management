-- Conventions:
--   *_cents   integer money in minor units, never floats
--   *_at      ISO-8601 UTC timestamps
--   date/time plain 'YYYY-MM-DD' / 'HH:MM' hospital wall-clock values

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  location TEXT,
  phone TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','doctor','nurse','receptionist','pharmacist','lab_technician','accountant')),
  phone TEXT,
  department_id INTEGER REFERENCES departments(id),
  specialization TEXT,
  license_no TEXT,
  consultation_fee_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS doctor_schedules (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 20 CHECK (slot_minutes BETWEEN 5 AND 120),
  CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_schedules_doctor ON doctor_schedules(doctor_id, weekday);

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY,
  mrn TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male','female','other')),
  blood_group TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  national_id TEXT,
  marital_status TEXT,
  occupation TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  emergency_relation TEXT,
  allergies TEXT,
  chronic_conditions TEXT,
  insurance_provider TEXT,
  insurance_policy TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  department_id INTEGER REFERENCES departments(id),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'consultation' CHECK (type IN ('consultation','follow_up','procedure','telehealth')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','checked_in','in_progress','completed','cancelled','no_show')),
  token_no INTEGER,
  cancel_reason TEXT,
  checked_in_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- The database itself refuses double-booking a doctor's slot, even under concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointment_slot ON appointments(doctor_id, date, start_time)
  WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date, status);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);

CREATE TABLE IF NOT EXISTS encounters (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  appointment_id INTEGER REFERENCES appointments(id),
  admission_id INTEGER REFERENCES admissions(id),
  type TEXT NOT NULL DEFAULT 'opd' CHECK (type IN ('opd','ipd','er')),
  chief_complaint TEXT,
  subjective TEXT,
  objective TEXT,
  assessment TEXT,
  plan TEXT,
  diagnosis TEXT,
  icd_code TEXT,
  follow_up_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed')),
  signed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id);

CREATE TABLE IF NOT EXISTS vitals (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  admission_id INTEGER REFERENCES admissions(id),
  temperature_c REAL,
  pulse INTEGER,
  resp_rate INTEGER,
  systolic INTEGER,
  diastolic INTEGER,
  spo2 INTEGER,
  weight_kg REAL,
  height_cm REAL,
  pain_score INTEGER,
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_vitals_patient ON vitals(patient_id, recorded_at);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  generic_name TEXT,
  form TEXT,
  strength TEXT,
  category TEXT,
  manufacturer TEXT,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 20,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (name, form, strength)
);

CREATE TABLE IF NOT EXISTS medicine_batches (
  id INTEGER PRIMARY KEY,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_no TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  cost_cents INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (medicine_id, batch_no)
);
CREATE INDEX IF NOT EXISTS idx_batches_fefo ON medicine_batches(medicine_id, expiry_date);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  batch_id INTEGER REFERENCES medicine_batches(id),
  kind TEXT NOT NULL CHECK (kind IN ('receive','dispense','adjust','expire')),
  quantity INTEGER NOT NULL,
  reference TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  encounter_id INTEGER REFERENCES encounters(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','partial','dispensed','cancelled')),
  notes TEXT,
  allergy_override INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_status ON prescriptions(status);

CREATE TABLE IF NOT EXISTS prescription_items (
  id INTEGER PRIMARY KEY,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id INTEGER NOT NULL REFERENCES medicines(id),
  dose TEXT NOT NULL,
  frequency TEXT NOT NULL,
  route TEXT,
  duration_days INTEGER,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  dispensed_qty INTEGER NOT NULL DEFAULT 0,
  instructions TEXT
);

CREATE TABLE IF NOT EXISTS lab_tests (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'laboratory' CHECK (category IN ('laboratory','radiology')),
  specimen TEXT,
  unit TEXT,
  ref_low REAL,
  ref_high REAL,
  critical_low REAL,
  critical_high REAL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  turnaround_hours INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lab_orders (
  id INTEGER PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  encounter_id INTEGER REFERENCES encounters(id),
  admission_id INTEGER REFERENCES admissions(id),
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent','stat')),
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','collected','in_progress','completed','cancelled')),
  notes TEXT,
  collected_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(status, priority);
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id);

CREATE TABLE IF NOT EXISTS lab_order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
  test_id INTEGER NOT NULL REFERENCES lab_tests(id),
  result_value REAL,
  result_text TEXT,
  flag TEXT CHECK (flag IN ('normal','low','high','critical')),
  resulted_by INTEGER REFERENCES users(id),
  resulted_at TEXT
);

CREATE TABLE IF NOT EXISTS wards (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('general','private','semi_private','icu','nicu','maternity','isolation')),
  floor TEXT,
  department_id INTEGER REFERENCES departments(id),
  daily_rate_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS beds (
  id INTEGER PRIMARY KEY,
  ward_id INTEGER NOT NULL REFERENCES wards(id),
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','cleaning','maintenance')),
  UNIQUE (ward_id, number)
);

CREATE TABLE IF NOT EXISTS admissions (
  id INTEGER PRIMARY KEY,
  admission_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  doctor_id INTEGER NOT NULL REFERENCES users(id),
  bed_id INTEGER NOT NULL REFERENCES beds(id),
  department_id INTEGER REFERENCES departments(id),
  reason TEXT NOT NULL,
  diagnosis TEXT,
  status TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted','discharged')),
  admitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expected_discharge TEXT,
  discharged_at TEXT,
  discharge_condition TEXT,
  discharge_summary TEXT,
  discharge_instructions TEXT,
  created_by INTEGER REFERENCES users(id)
);
-- A patient holds at most one open admission, and a bed at most one patient.
CREATE UNIQUE INDEX IF NOT EXISTS ux_admission_patient ON admissions(patient_id) WHERE status = 'admitted';
CREATE UNIQUE INDEX IF NOT EXISTS ux_admission_bed ON admissions(bed_id) WHERE status = 'admitted';

CREATE TABLE IF NOT EXISTS bed_stays (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admissions(id),
  bed_id INTEGER NOT NULL REFERENCES beds(id),
  daily_rate_cents INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  reason TEXT,
  moved_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_bed_stays_admission ON bed_stays(admission_id);

CREATE TABLE IF NOT EXISTS nursing_notes (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admissions(id),
  note TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS er_visits (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  triage_level INTEGER NOT NULL CHECK (triage_level BETWEEN 1 AND 5),
  chief_complaint TEXT NOT NULL,
  arrival_mode TEXT NOT NULL DEFAULT 'walk_in' CHECK (arrival_mode IN ('walk_in','ambulance','referral','police')),
  doctor_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','in_treatment','observation','admitted','discharged','transferred','left_without_care')),
  notes TEXT,
  arrived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  seen_at TEXT,
  closed_at TEXT,
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_er_status ON er_visits(status, triage_level);

CREATE TABLE IF NOT EXISTS theatres (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS surgeries (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  surgeon_id INTEGER NOT NULL REFERENCES users(id),
  anesthetist_id INTEGER REFERENCES users(id),
  theatre_id INTEGER NOT NULL REFERENCES theatres(id),
  admission_id INTEGER REFERENCES admissions(id),
  procedure_name TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  anesthesia_type TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  pre_op_notes TEXT,
  post_op_notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_time < end_time)
);
CREATE INDEX IF NOT EXISTS idx_surgeries_date ON surgeries(date, theatre_id);

CREATE TABLE IF NOT EXISTS blood_donors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  blood_group TEXT NOT NULL,
  phone TEXT,
  last_donation_on TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS blood_units (
  id INTEGER PRIMARY KEY,
  unit_no TEXT NOT NULL UNIQUE,
  blood_group TEXT NOT NULL,
  component TEXT NOT NULL DEFAULT 'whole_blood' CHECK (component IN ('whole_blood','packed_rbc','plasma','platelets')),
  donor_id INTEGER REFERENCES blood_donors(id),
  collected_on TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','issued','discarded')),
  issued_patient_id INTEGER REFERENCES patients(id),
  issued_at TEXT,
  issued_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_blood_status ON blood_units(status, blood_group);

CREATE TABLE IF NOT EXISTS ambulances (
  id INTEGER PRIMARY KEY,
  vehicle_no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'basic' CHECK (type IN ('basic','advanced','neonatal')),
  driver_name TEXT,
  driver_phone TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_trip','maintenance'))
);

CREATE TABLE IF NOT EXISTS ambulance_trips (
  id INTEGER PRIMARY KEY,
  ambulance_id INTEGER NOT NULL REFERENCES ambulances(id),
  patient_name TEXT NOT NULL,
  contact_phone TEXT,
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'dispatched' CHECK (status IN ('dispatched','completed','cancelled')),
  dispatched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT,
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  unit TEXT,
  location TEXT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 10,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  quantity INTEGER NOT NULL,
  reference TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  admission_id INTEGER REFERENCES admissions(id),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','void')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  notes TEXT,
  void_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_patient ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- A charge is posted by the clinical event that caused it and sits unbilled until
-- it is rolled onto an invoice. Voiding an invoice releases its charges again.
CREATE TABLE IF NOT EXISTS charges (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  admission_id INTEGER REFERENCES admissions(id),
  kind TEXT NOT NULL CHECK (kind IN ('consultation','laboratory','pharmacy','bed','surgery','blood','ambulance','service','other')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  source_type TEXT,
  source_id INTEGER,
  invoice_id INTEGER REFERENCES invoices(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_charges_patient ON charges(patient_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_charges_invoice ON charges(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card','bank_transfer','mobile','insurance')),
  reference TEXT,
  received_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(created_at);

CREATE TABLE IF NOT EXISTS insurance_claims (
  id INTEGER PRIMARY KEY,
  claim_no TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  provider TEXT NOT NULL,
  policy_no TEXT,
  claimed_cents INTEGER NOT NULL CHECK (claimed_cents > 0),
  approved_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','paid')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('morning','evening','night')),
  notes TEXT,
  UNIQUE (user_id, date, shift)
);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('annual','sick','unpaid','other')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  status INTEGER,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);
