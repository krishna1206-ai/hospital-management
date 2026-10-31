// Vercel entry point: runs the whole Express API as one serverless function.
//
// DEMO ONLY. Vercel has no permanent disk, so the database lives in /tmp, is filled with
// demo data on each cold start, and is lost when the instance shuts down. Keeping real
// data requires a host with a disk (see README).
import { randomBytes } from 'node:crypto'

process.env.DB_PATH = '/tmp/hospital-demo.db'
process.env.TRUST_PROXY ??= '1'
// Sessions can't outlive this instance's database anyway, so a secret isn't required.
process.env.JWT_SECRET ||= randomBytes(48).toString('hex')

// Imported only now because config reads the environment when it loads.
const { createApp } = await import('../server/src/app.js')
const { get } = await import('../server/src/db/index.js')
const { seed, seedBaseline } = await import('../server/src/db/seed.js')

seedBaseline()
if (!get('SELECT id FROM users LIMIT 1')) await seed()

export default createApp()
