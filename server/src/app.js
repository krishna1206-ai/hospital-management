import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { config } from './config.js'
import { auditMutations } from './lib/audit.js'
import { authenticate } from './lib/auth.js'
import { HttpError } from './lib/http.js'
import { appointmentsRouter } from './routes/appointments.js'
import { authRouter } from './routes/auth.js'
import { billingRouter } from './routes/billing.js'
import { clinicalRouter } from './routes/clinical.js'
import { emergencyRouter } from './routes/emergency.js'
import { insightsRouter } from './routes/insights.js'
import { ipdRouter } from './routes/ipd.js'
import { labRouter } from './routes/lab.js'
import { patientsRouter } from './routes/patients.js'
import { pharmacyRouter } from './routes/pharmacy.js'
import { staffRouter } from './routes/staff.js'
import { ambulanceRouter, bloodRouter, inventoryRouter } from './routes/support.js'
import { surgeryRouter } from './routes/surgery.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', Number(process.env.TRUST_PROXY || 0))

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }))
  if (!config.isProduction) app.use(cors({ origin: config.corsOrigin, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  if (!config.isTest) {
    app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }))
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

  app.use('/api', auditMutations)
  app.use('/api/auth', authRouter)

  const secured = express.Router()
  secured.use(authenticate)
  // A temporary password can only be used to set a real one.
  secured.use((req, _res, next) => {
    if (req.user.must_change_password) throw new HttpError(403, 'Change your temporary password to continue', { code: 'PASSWORD_CHANGE_REQUIRED' })
    next()
  })
  secured.use('/patients', patientsRouter)
  secured.use('/appointments', appointmentsRouter)
  secured.use('/clinical', clinicalRouter)
  secured.use('/pharmacy', pharmacyRouter)
  secured.use('/lab', labRouter)
  secured.use('/ipd', ipdRouter)
  secured.use('/emergency', emergencyRouter)
  secured.use('/surgery', surgeryRouter)
  secured.use('/blood', bloodRouter)
  secured.use('/ambulance', ambulanceRouter)
  secured.use('/inventory', inventoryRouter)
  secured.use('/billing', billingRouter)
  secured.use('/staff', staffRouter)
  secured.use('/', insightsRouter)
  app.use('/api', secured)

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')))

  if (config.isProduction && existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { maxAge: '1h', index: false }))
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(config.clientDist, 'index.html')))
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, _next) => {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: { message: error.message, ...error.details } })
    }
    const message = String(error.message || '')
    if (message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: { message: 'A record with these details already exists' } })
    }
    if (message.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: { message: 'This refers to a record that does not exist' } })
    }
    if (message.includes('CHECK constraint failed')) {
      return res.status(400).json({ error: { message: 'One of the values is not allowed' } })
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { message: 'Invalid request body' } })
    }
    console.error(`[${req.method} ${req.originalUrl}]`, error)
    res.status(500).json({ error: { message: 'Something went wrong on our side' } })
  })

  return app
}
