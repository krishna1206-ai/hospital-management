// Rebuilds the database with fresh demo data, dated relative to today.
import { rmSync } from 'node:fs'
import { config } from '../config.js'

if (config.isProduction) {
  console.error('Refusing to reset the database in production.')
  process.exit(1)
}
for (const suffix of ['', '-wal', '-shm']) rmSync(`${config.dbPath}${suffix}`, { force: true })

const { seed, DEMO_PASSWORD } = await import('./seed.js')
await seed()
console.log(`Demo data loaded. Sign in as admin@hospital.test / ${DEMO_PASSWORD}`)
