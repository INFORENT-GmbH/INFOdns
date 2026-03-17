import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireOperatorOrAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

async function enqueueRender(domainId: number) {
  await execute(
    `INSERT INTO zone_render_queue (domain_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'processing', status, 'pending'), updated_at = NOW()`,
    [domainId]
  )
  await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [domainId])
}

const FQDN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

const CreateDomainBody = z.object({
  fqdn: z.string().min(1).max(253).refine(v => FQDN_RE.test(v), 'Invalid FQDN'),
  customer_id: z.number().int().positive(),
  default_ttl: z.number().int().positive().optional().default(3600),
  notes: z.string().optional(),
})

const UpdateDomainBody = z.object({
  status: z.enum(['active', 'pending', 'suspended']).optional(),
  default_ttl: z.number().int().positive().optional(),
  notes: z.string().optional(),
})

const LabelSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_\-.\/]{1,63}$/),
  value: z.string().max(63).default(''),
  color: z.string().max(20).nullable().optional(),
  admin_only: z.boolean().optional().default(false),
})

const UpdateLabelsBody = z.object({
  labels: z.array(LabelSchema),
})

async function fetchLabels(domainIds: number[], isAdmin = false): Promise<Map<number, { id: number; key: string; value: string; color: string | null; admin_only: boolean }[]>> {
  if (domainIds.length === 0) return new Map()
  const adminFilter = isAdmin ? '' : ' AND l.admin_only = 0'
  const rows = await query(
    `SELECT l.id, dl.domain_id, l.label_key AS \`key\`, l.label_value AS \`value\`, l.color, l.admin_only
     FROM domain_labels dl
     JOIN labels l ON l.id = dl.label_id
     WHERE dl.domain_id IN (${domainIds.map(() => '?').join(',')})${adminFilter}
     ORDER BY l.label_key, l.id`,
    domainIds
  ) as any[]
  const map = new Map<number, { id: number; key: string; value: string; color: string | null; admin_only: boolean }[]>()
  for (const r of rows) {
    if (!map.has(r.domain_id)) map.set(r.domain_id, [])
    map.get(r.domain_id)!.push({ id: r.id, key: r.key, value: r.value, color: r.color ?? null, admin_only: !!r.admin_only })
  }
  return map
}

/** Find an existing label row or create it; return its id. */
async function findOrCreateLabel(
  customerIdForLabel: number | null,
  key: string,
  value: string,
  color: string | null | undefined,
  adminOnly: boolean
): Promise<number> {
  const existing = await queryOne(
    adminOnly
      ? 'SELECT id, color FROM labels WHERE label_key = ? AND label_value = ? AND admin_only = 1 AND customer_id IS NULL'
      : 'SELECT id, color FROM labels WHERE label_key = ? AND label_value = ? AND admin_only = 0 AND customer_id = ?',
    adminOnly ? [key, value] : [key, value, customerIdForLabel]
  ) as any
  if (existing) {
    if (color !== undefined && color !== existing.color) {
      await execute('UPDATE labels SET color = ? WHERE id = ?', [color ?? null, existing.id])
    }
    return existing.id
  }
  const result = await execute(
    'INSERT INTO labels (customer_id, label_key, label_value, color, admin_only) VALUES (?, ?, ?, ?, ?)',
    [adminOnly ? null : customerIdForLabel, key, value, color ?? null, adminOnly ? 1 : 0]
  )
  return result.insertId
}

/** Inject ownership filter for customer role */
function ownerFilter(req: any): string {
  return req.user.role === 'customer' ? ` AND d.customer_id = ${Number(req.user.customerId)}` : ''
}

export async function domainRoutes(app: FastifyInstance) {
  // GET /domains/labels  — distinct label keys + values scoped to a customer
  app.get('/domains/labels', { preHandler: requireAuth }, async (req: any, reply) => {
    const isAdmin = req.user.role === 'admin'
    const { customer_id } = req.query as Record<string, string>

    const params: unknown[] = []
    let where: string
    if (req.user.role === 'customer') {
      where = 'WHERE l.customer_id = ? AND l.admin_only = 0'
      params.push(req.user.customerId)
    } else if (customer_id) {
      where = isAdmin
        ? 'WHERE (l.customer_id = ? AND l.admin_only = 0) OR (l.admin_only = 1 AND l.customer_id IS NULL)'
        : 'WHERE l.customer_id = ? AND l.admin_only = 0'
      params.push(Number(customer_id))
    } else {
      where = isAdmin ? '' : 'WHERE l.admin_only = 0'
    }

    const rows = await query(
      `SELECT l.label_key AS \`key\`, l.label_value AS \`value\`
       FROM labels l ${where}
       GROUP BY l.label_key, l.label_value
       ORDER BY l.label_key, l.label_value`,
      params
    ) as any[]
    const map = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!map.has(r.key)) map.set(r.key, new Set())
      if (r.value !== '') map.get(r.key)!.add(r.value)
    }
    return Array.from(map.entries()).map(([key, vals]) => ({ key, values: Array.from(vals) }))
  })

  // GET /domains
  app.get('/domains', { preHandler: requireAuth }, async (req: any, reply) => {
    const { search, customer_id, label, page = '1', limit = '50' } = req.query as Record<string, string>
    const offset = (Number(page) - 1) * Number(limit)
    const params: unknown[] = []
    let join = ''
    let where = "WHERE d.status != 'deleted'"

    if (label) {
      const eqIdx = label.indexOf('=')
      const lKey = eqIdx >= 0 ? label.slice(0, eqIdx) : label
      const lVal = eqIdx >= 0 ? label.slice(eqIdx + 1) : null
      if (lVal !== null) {
        where += ` AND EXISTS (SELECT 1 FROM domain_labels _dl JOIN labels _l ON _l.id = _dl.label_id WHERE _dl.domain_id = d.id AND _l.label_key = ? AND _l.label_value = ?)`
        params.push(lKey, lVal)
      } else {
        where += ` AND EXISTS (SELECT 1 FROM domain_labels _dl JOIN labels _l ON _l.id = _dl.label_id WHERE _dl.domain_id = d.id AND _l.label_key = ?)`
        params.push(lKey)
      }
    }

    if (req.user.role === 'customer') {
      where += ` AND d.customer_id = ?`
      params.push(req.user.customerId)
    } else if (customer_id) {
      where += ` AND d.customer_id = ?`
      params.push(Number(customer_id))
    }
    if (search) {
      where += ` AND d.fqdn LIKE ?`
      params.push(`%${search}%`)
    }

    const rows = await query(
      `SELECT d.id, d.fqdn, d.status, d.zone_status, d.last_serial, d.last_rendered_at,
              d.default_ttl, d.customer_id, c.name AS customer_name, d.created_at
       FROM domains d JOIN customers c ON c.id = d.customer_id${join}
       ${where}
       ORDER BY d.fqdn
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    ) as any[]
    const labelMap = await fetchLabels(rows.map((r: any) => r.id), (req as any).user.role === 'admin')
    return rows.map((r: any) => ({ ...r, labels: labelMap.get(r.id) ?? [] }))
  })

  // POST /domains  (operator/admin; customer creates via operator)
  app.post('/domains', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const body = CreateDomainBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const existing = await queryOne('SELECT id FROM domains WHERE fqdn = ?', [body.data.fqdn])
    if (existing) return reply.status(409).send({ code: 'FQDN_TAKEN' })

    const result = await execute(
      'INSERT INTO domains (fqdn, customer_id, default_ttl, notes, status, zone_status) VALUES (?, ?, ?, ?, ?, ?)',
      [body.data.fqdn, body.data.customer_id, body.data.default_ttl, body.data.notes ?? null, 'active', 'dirty']
    )
    const created = await queryOne('SELECT * FROM domains WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'domain', entityId: result.insertId, domainId: result.insertId, action: 'create', newValue: created })
    await enqueueRender(result.insertId)
    return reply.status(201).send(created)
  })

  // GET /domains/:id
  app.get<{ Params: { id: string } }>('/domains/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = await queryOne(
      `SELECT d.*, c.name AS customer_name,
              q.error AS zone_error, q.retries AS zone_retries
       FROM domains d
       JOIN customers c ON c.id = d.customer_id
       LEFT JOIN zone_render_queue q ON q.domain_id = d.id AND q.id = (
         SELECT MAX(id) FROM zone_render_queue WHERE domain_id = d.id
       )
       WHERE d.id = ? AND d.status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    ) as any
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    const isAdmin = (req as any).user.role === 'admin'
    const labelMap = await fetchLabels([row.id], isAdmin)
    return { ...row, labels: labelMap.get(row.id) ?? [] }
  })

  // PUT /domains/:id
  app.put<{ Params: { id: string } }>('/domains/:id', { preHandler: requireAuth }, async (req, reply) => {
    const old = await queryOne(
      `SELECT * FROM domains WHERE id = ? AND status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    )
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateDomainBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    await execute(
      `UPDATE domains SET
         status = COALESCE(?, status),
         default_ttl = COALESCE(?, default_ttl),
         notes = COALESCE(?, notes)
       WHERE id = ?`,
      [body.data.status ?? null, body.data.default_ttl ?? null, body.data.notes ?? null, req.params.id]
    )
    const updated = await queryOne('SELECT * FROM domains WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'domain', entityId: Number(req.params.id), domainId: Number(req.params.id), action: 'update', oldValue: old, newValue: updated })
    await enqueueRender(Number(req.params.id))
    return updated
  })

  // PUT /domains/:id/labels
  app.put<{ Params: { id: string } }>('/domains/:id/labels', { preHandler: requireAuth }, async (req: any, reply) => {
    const domain = await queryOne(
      `SELECT id, customer_id FROM domains WHERE id = ? AND status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    ) as any
    if (!domain) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateLabelsBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const domainId = Number(req.params.id)
    const isAdmin = req.user.role === 'admin'
    const customerIdForLabel = domain.customer_id as number

    // Resolve (or create) a labels row for each requested label
    const labelIds: number[] = []
    for (const { key, value, color, admin_only } of body.data.labels) {
      const useAdminOnly = isAdmin && !!admin_only
      const id = await findOrCreateLabel(customerIdForLabel, key, value, color, useAdminOnly)
      labelIds.push(id)
    }

    // Full-replace assignments, preserving admin-only ones for non-admins
    if (isAdmin) {
      await execute('DELETE FROM domain_labels WHERE domain_id = ?', [domainId])
    } else {
      await execute(
        `DELETE dl FROM domain_labels dl
         JOIN labels l ON l.id = dl.label_id
         WHERE dl.domain_id = ? AND l.admin_only = 0`,
        [domainId]
      )
    }
    for (const labelId of labelIds) {
      await execute('INSERT IGNORE INTO domain_labels (domain_id, label_id) VALUES (?, ?)', [domainId, labelId])
    }

    const labelMap = await fetchLabels([domainId], isAdmin)
    return labelMap.get(domainId) ?? []
  })

  // DELETE /domains/:id  (soft delete)
  app.delete<{ Params: { id: string } }>('/domains/:id', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const old = await queryOne("SELECT * FROM domains WHERE id = ? AND status != 'deleted'", [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })
    await execute("UPDATE domains SET status = 'deleted' WHERE id = ?", [req.params.id])
    await writeAuditLog({ req, entityType: 'domain', entityId: Number(req.params.id), domainId: Number(req.params.id), action: 'delete', oldValue: old })
    return { ok: true }
  })
}
