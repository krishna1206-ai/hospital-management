import { insert } from '../db/index.js'

/**
 * Records who did what to which record. Bodies are deliberately never stored:
 * the audit trail must not become a second copy of patient data.
 */
export function audit(req, action, entity, entityId, status = 200) {
  insert('audit_logs', {
    user_id: req.user?.id ?? null,
    user_name: req.user?.name ?? null,
    action,
    entity: entity ?? null,
    entity_id: entityId == null ? null : String(entityId),
    status,
    ip: req.ip ?? null,
  })
}

const METHOD_ACTIONS = { POST: 'create', PATCH: 'update', PUT: 'update', DELETE: 'delete' }

/** Automatically logs every API mutation, including rejected ones. */
export function auditMutations(req, res, next) {
  const action = METHOD_ACTIONS[req.method]
  if (!action) return next()
  res.on('finish', () => {
    const [, , entity, entityId, ...rest] = req.originalUrl.split('?')[0].split('/')
    if (entity === 'auth') return // auth routes record their own, more specific, events
    const verb = rest.at(-1)
    audit(req, verb && !/^\d+$/.test(verb) ? verb : action, entity, /^\d+$/.test(entityId ?? '') ? entityId : null, res.statusCode)
  })
  next()
}
