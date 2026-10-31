# Meridian HMS

A hospital management system covering outpatient, emergency, inpatient, theatre, laboratory, pharmacy, blood bank, billing and hospital operations. React frontend, Node.js/Express API, SQLite database.

## Run it

Requires Node.js 22.13 or newer. There is no database to install.

```bash
npm install
npm run dev
```

Open http://localhost:5173. On first start, an empty database is filled with demo data, dated relative to today.

### Demo sign-in

Every demo account uses the password **`Hospital@2026`**.

| Role | Email |
|---|---|
| Administrator | `admin@hospital.test` |
| Doctor | `doctor@hospital.test` |
| Nurse | `nurse@hospital.test` |
| Receptionist | `reception@hospital.test` |
| Pharmacist | `pharmacy@hospital.test` |
| Lab technician | `lab@hospital.test` |
| Accountant | `billing@hospital.test` |

To start again with fresh demo data, stop the server and run `npm run db:reset`.

## What's included

| Area | Features |
|---|---|
| Patients | Registration with MRN, duplicate detection, demographics, emergency contact, insurance, allergies, full chart |
| Appointments | Slots generated from doctor schedules, double-booking prevention, reschedule, check-in, live OPD queue with tokens |
| Clinical | SOAP notes that lock when signed, ICD-10 diagnosis, vitals, prescriptions with an allergy check and recorded override |
| Emergency | Five-level triage board ordered by acuity and wait, doctor alerts for high-acuity arrivals, disposition |
| Inpatients | Live bed board, admission, transfer, nursing notes, discharge summary, bed charges per ward rate |
| Surgery | Theatre scheduling with theatre and surgeon clash detection, pre-op and post-op notes |
| Laboratory | Lab and radiology catalog, worklist by priority, sample collection, automatic result flags, critical-value alerts, printable reports |
| Pharmacy | Dispensing queue, batch stock, first-expiry-first-out dispensing, low-stock and expiry alerts, stock history, suppliers |
| Blood bank | Stock by group, donors, unit tracking, red-cell compatibility check at issue |
| Billing | Charges posted automatically by clinical events, invoices, discounts, tax, partial payments, voiding, insurance claims, printable invoices |
| Operations | Ambulance dispatch, general inventory, staff accounts, duty roster, leave that closes a doctor's slots, departments |
| Oversight | Role-based dashboards, reports with CSV export, audit log including patient record views, settings for currency and tax |

## Security

- Seven roles, enforced by the API from one matrix in `server/src/lib/permissions.js`. The menu is only a reflection of it.
- Sessions use an httpOnly, SameSite=Strict cookie. Changing a password or role, or deactivating an account, ends existing sessions immediately.
- Passwords are hashed with bcrypt. Temporary passwords must be changed at first sign-in, and failed sign-ins are rate limited.
- All SQL uses bound parameters, and all input is validated with Zod.
- The audit log stores who, what and when, but never request bodies, so it is not a second copy of patient data.
- Money is stored as integer minor units, and invoice balances are always recalculated from recorded payments.

## Deploying to production

```bash
cp server/.env.example server/.env   # then set JWT_SECRET
npm install
npm run build
NODE_ENV=production npm start
npm run create-admin -- "Full Name" you@yourhospital.org "A-long-password-1"
```

The server then serves the built app and the API on one port (4000 by default). Production never loads demo data and refuses to start without `JWT_SECRET`. Put it behind HTTPS, because session cookies are marked Secure. Set `TRUST_PROXY=1` behind a reverse proxy so audit logs and rate limits see real client IPs. Back up `server/data/` regularly.

## Deploying a demo to Vercel

Import the project or run `npx vercel --prod`. No settings are needed. `api/index.js` runs the API as a serverless function, and the frontend is built with Vite.

Vercel has no permanent disk, so this is **for demos only**. The database lives in temporary storage and returns to the demo data whenever Vercel starts a new instance, and two instances may not see each other's changes. The sign-in page shows public demo accounts, so never enter real patient data. For permanent data, use the production steps above on a host with a persistent disk, such as a VPS, Render or Railway.

## Before using it with real patients

This is a working foundation, not a certified medical product. Before holding real patient data, you still need:

- An independent security review and legal compliance work for your country (for example HIPAA or GDPR), including encrypted disks, backups and data-retention rules.
- Clinical sign-off. The allergy check is a text match against what staff typed, and the demo reference ranges are examples. Neither replaces clinical judgement.
- A larger database if many users write at once. SQLite handles a single site well, but several busy sites should move to PostgreSQL.

Not included: patient self-service portal, SMS or email delivery, online payments, document uploads, HL7/FHIR or device integration, and drug-interaction checking.

## Development

| Command | Purpose |
|---|---|
| `npm run dev` | API on port 4000 and web app on port 5173, with reload |
| `npm test` | API integration tests against an in-memory database |
| `npm run lint` | ESLint for client and server |
| `npm run build` | Production build of the client |
| `npm run db:reset` | Rebuild the demo database (development only) |

```
server/src/
  routes/   one file per hospital domain
  lib/      auth, permissions, audit, validation, shared rules
  db/       schema, connection, demo data
server/test/  integration tests
src/
  pages/       one file per screen
  components/  shared UI, forms, charts, clinical widgets
  lib/         API client, hooks, formatting
```
