import bcrypt from 'bcryptjs'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config.js'
import { get, nowIsoSql, run, update } from '../db/index.js'
import { audit } from '../lib/audit.js'
import { authenticate, clearSession, issueSession } from '../lib/auth.js'
import { HttpError, optionalText, text, validate } from '../lib/http.js'
import { permissionsFor } from '../lib/permissions.js'

export const authRouter = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  // Only failures count: a whole hospital can sit behind one IP address and sign in all morning.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many sign-in attempts. Try again in 15 minutes.' } },
})

const toSessionUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  department_id: user.department_id,
  specialization: user.specialization,
  must_change_password: user.must_change_password,
  permissions: permissionsFor(user.role),
})

// Compared against when the email is unknown, so timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

authRouter.post(
  '/login',
  loginLimiter,
  validate(z.object({ email: z.string().trim().email('Enter a valid email'), password: z.string().min(1, 'Required').max(200) })),
  async (req, res) => {
    const user = get('SELECT * FROM users WHERE email = ?', req.body.email)
    const valid = await bcrypt.compare(req.body.password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !valid || !user.active) {
      req.user = user ? { id: user.id, name: user.name } : { name: req.body.email }
      audit(req, 'login_failed', 'auth', user?.id, 401)
      throw new HttpError(401, 'Incorrect email or password')
    }
    run(`UPDATE users SET last_login_at = ${nowIsoSql} WHERE id = ?`, user.id)
    issueSession(res, user)
    req.user = user
    audit(req, 'login', 'auth', user.id)
    res.json({ user: toSessionUser(user) })
  },
)

authRouter.post('/logout', (req, res) => {
  clearSession(res)
  res.status(204).end()
})

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: toSessionUser(req.user) })
})

authRouter.patch(
  '/me',
  authenticate,
  validate(z.object({ name: text(120).optional(), phone: optionalText(40) })),
  (req, res) => {
    update('users', req.user.id, req.body)
    res.json({ user: toSessionUser({ ...req.user, ...req.body }) })
  },
)

const strongPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[a-zA-Z]/, 'Include a letter')
  .regex(/\d/, 'Include a number')

authRouter.post(
  '/change-password',
  authenticate,
  validate(z.object({ current_password: z.string().min(1, 'Required'), new_password: strongPassword })),
  async (req, res) => {
    const { password_hash: hash, token_version: version } = get('SELECT password_hash, token_version FROM users WHERE id = ?', req.user.id)
    if (!(await bcrypt.compare(req.body.current_password, hash))) {
      throw new HttpError(422, 'Please correct the highlighted fields', { fields: { current_password: 'Current password is incorrect' } })
    }
    if (req.body.new_password === req.body.current_password) {
      throw new HttpError(422, 'Please correct the highlighted fields', { fields: { new_password: 'Choose a different password' } })
    }
    const passwordHash = await bcrypt.hash(req.body.new_password, 10)
    // Bumping the version signs out every other device.
    update('users', req.user.id, { password_hash: passwordHash, token_version: version + 1, must_change_password: 0 })
    issueSession(res, { id: req.user.id, token_version: version + 1 })
    audit(req, 'change_password', 'auth', req.user.id)
    res.status(204).end()
  },
)

export { strongPassword }
