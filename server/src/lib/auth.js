import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { get } from '../db/index.js'
import { HttpError } from './http.js'
import { can } from './permissions.js'

export const COOKIE_NAME = 'hms_session'

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, v: user.token_version }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
  })
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  })
}

export const clearSession = (res) => res.clearCookie(COOKIE_NAME, { path: '/' })

/**
 * Loads the user fresh on every request, so deactivating an account or changing a
 * password (which bumps token_version) ends existing sessions immediately.
 */
export function authenticate(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) throw new HttpError(401, 'Please sign in')
  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] })
  } catch {
    throw new HttpError(401, 'Your session has expired')
  }
  const user = get(
    `SELECT id, name, email, role, phone, department_id, specialization, active, token_version, must_change_password
     FROM users WHERE id = ?`,
    Number(payload.sub),
  )
  if (!user || !user.active || user.token_version !== payload.v) throw new HttpError(401, 'Your session has expired')
  req.user = user
  next()
}

export const requirePermission = (...permissions) => (req, _res, next) => {
  if (!permissions.some((permission) => can(req.user.role, permission))) {
    throw new HttpError(403, 'You do not have permission to do this')
  }
  next()
}

export const assertCan = (req, permission) => {
  if (!can(req.user.role, permission)) throw new HttpError(403, 'You do not have permission to do this')
}
