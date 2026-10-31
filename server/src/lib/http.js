import { z } from 'zod'
import { all, get, insert, update } from '../db/index.js'
import { audit } from './audit.js'
import { requirePermission } from './auth.js'

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}
export const badRequest = (message, details) => new HttpError(400, message, details)
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`)
export const conflict = (message, details) => new HttpError(409, message, details)

/** Validates req.body and replaces it with the parsed value. */
export const validate = (schema) => (req, _res, next) => {
  const parsed = schema.safeParse(req.body ?? {})
  if (!parsed.success) {
    const fields = {}
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '_'] = issue.message
    throw new HttpError(422, 'Please correct the highlighted fields', { fields })
  }
  req.body = parsed.data
  next()
}

export const idParam = (req) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) throw notFound()
  return id
}

export function findOr404(table, id, what) {
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, id)
  if (!row) throw notFound(what)
  return row
}

const MAX_PAGE_SIZE = 100

/**
 * Standard list response. `select` and `from` are trusted SQL; user input only ever
 * reaches the query through bound parameters.
 */
export function paginate(req, { select, from, where = [], params = [], order, search, groupBy }) {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 25))
  const clauses = [...where]
  const bound = [...params]
  const term = String(req.query.q || '').trim()
  if (term && search?.length) {
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`
    clauses.push(`(${search.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    bound.push(...search.map(() => like))
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const { total } = get(
    groupBy
      ? `SELECT COUNT(DISTINCT ${groupBy}) AS total FROM ${from} ${whereSql}`
      : `SELECT COUNT(*) AS total FROM ${from} ${whereSql}`,
    ...bound,
  )
  const rows = all(
    `SELECT ${select} FROM ${from} ${whereSql} ${groupBy ? `GROUP BY ${groupBy}` : ''} ${order ? `ORDER BY ${order}` : ''} LIMIT ? OFFSET ?`,
    ...bound,
    pageSize,
    (page - 1) * pageSize,
  )
  return { rows, total, page, pageSize }
}

/** CRUD for simple reference tables. Hospital records are deactivated, never deleted. */
export function registerCrud(router, path, { table, schema, read, write, search, order, softDelete = true, select = '*', from }) {
  router.get(path, requirePermission(read), (req, res) => {
    const where = []
    if (softDelete && req.query.includeInactive !== '1') where.push('active = 1')
    res.json(paginate(req, { select, from: from ?? table, where, search, order }))
  })
  router.post(path, requirePermission(write), validate(schema), (req, res) => {
    const id = insert(table, req.body)
    res.status(201).json(findOr404(table, id))
  })
  router.patch(`${path}/:id`, requirePermission(write), validate(schema.partial()), (req, res) => {
    const id = idParam(req)
    findOr404(table, id)
    update(table, id, req.body)
    res.json(findOr404(table, id))
  })
  router.delete(`${path}/:id`, requirePermission(write), (req, res) => {
    const id = idParam(req)
    findOr404(table, id)
    if (!softDelete) throw conflict('This record cannot be deleted')
    update(table, id, { active: 0 })
    audit(req, 'deactivate', table, id)
    res.status(204).end()
  })
}

// Field types shared by every route schema.
export const text = (max = 500) => z.string().trim().min(1, 'Required').max(max)
// Optional fields keep `undefined` as undefined, so a PATCH that omits a field leaves it
// untouched, while an emptied form field ('') clears it to NULL.
const emptyToNull = (value) => (value === '' ? null : value)
export const optionalText = (max = 2000) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullish())
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a valid time')
export const optionalDate = z.preprocess(emptyToNull, dateStr.nullish())
export const id = z.coerce.number().int().positive('Required')
export const optionalId = z.preprocess(emptyToNull, id.nullish())
export const cents = z.coerce.number().int().min(0, 'Must be zero or more')
export const flag = z.preprocess((value) => (value === true ? 1 : value === false ? 0 : value), z.coerce.number().int().min(0).max(1))
export const optionalNumber = (schema = z.coerce.number()) => z.preprocess(emptyToNull, schema.nullish())
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
