import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.js'

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true })

export const db = new DatabaseSync(config.dbPath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
db.exec(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8'))

export const nowIsoSql = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`

const statements = new Map()
function prepare(sql) {
  let statement = statements.get(sql)
  if (!statement) {
    statement = db.prepare(sql)
    statements.set(sql, statement)
  }
  return statement
}

export const all = (sql, ...params) => prepare(sql).all(...params)
export const get = (sql, ...params) => prepare(sql).get(...params)
export const run = (sql, ...params) => prepare(sql).run(...params)

let depth = 0
/** Runs fn atomically. Nested calls join the outer transaction. */
export function transaction(fn) {
  if (depth > 0) return fn()
  db.exec('BEGIN IMMEDIATE')
  depth++
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    depth--
  }
}

const clean = (data) =>
  Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value])

/** Column names must come from validated schemas, never directly from a request. */
export function insert(table, data) {
  const entries = clean(data)
  const columns = entries.map(([key]) => key).join(', ')
  const marks = entries.map(() => '?').join(', ')
  const result = run(`INSERT INTO ${table} (${columns}) VALUES (${marks})`, ...entries.map(([, value]) => value))
  return Number(result.lastInsertRowid)
}

export function update(table, id, data) {
  const entries = clean(data)
  if (!entries.length) return 0
  const sets = entries.map(([key]) => `${key} = ?`).join(', ')
  return Number(run(`UPDATE ${table} SET ${sets} WHERE id = ?`, ...entries.map(([, value]) => value), id).changes)
}

/** Issues the next human-readable document number, e.g. INV-2026-000042. */
export function nextNumber(prefix, { yearly = true, pad = 6 } = {}) {
  const year = new Date().getFullYear()
  const name = yearly ? `${prefix}-${year}` : prefix
  const { value } = get(
    `INSERT INTO counters (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
    name,
  )
  return `${name}-${String(value).padStart(pad, '0')}`
}
