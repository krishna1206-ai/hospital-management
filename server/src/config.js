import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const envFile = resolve(serverRoot, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const dataDir = resolve(serverRoot, 'data')

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (isProduction) throw new Error('JWT_SECRET must be set in production')
  if (isTest) return 'test-secret'
  // Development only: keep sessions alive across restarts without a committed secret.
  mkdirSync(dataDir, { recursive: true })
  const secretFile = resolve(dataDir, '.dev-secret')
  if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString('hex'))
  return readFileSync(secretFile, 'utf8')
}

export const config = {
  isProduction,
  isTest,
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || (isTest ? ':memory:' : resolve(dataDir, 'hospital.db')),
  jwtSecret: resolveJwtSecret(),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  clientDist: resolve(serverRoot, '..', 'dist'),
}
