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
})

const UpdateLabelsBody = z.object({
  labels: z.array(LabelSchema),
})

async function fetchLabels(domainIds: number[]): Promise<Map<number, { id: number; key: string; value: string; color: string | null }[]>> {
  if (domainIds.length === 0) return new Map()
  const rows = await query(
    `SELECT id, domain_id, label_key AS \`key\`, label_value AS \`value\`, color
     FROM domain_labels WHERE domain_id IN (${domainIds.map(() => '?').join(',')})
     ORDER BY label_key, id`,
    domainIds
  ) as any[]
  const map = new Map<number, { id: number; key: string; value: string; color: string | null }[]>()
  for (const r of rows) {
    if (!map.has(r.domain_id)) map.set(r.domain_id, [])
    map.get(r.domain_id)!.push({ id: r.id, key: r.key, value: r.value, color: r.color ?? null })
  }
  return map
}

/** Inject ownership filter for customer role */
function ownerFilter(req: any): string {
  return req.user.role === 'customer' ? ` AND d.customer_id = ${Number(req.user.customerId)}` : ''
}

export async function domainRoutes(app: FastifyInstance) {
  // GET /domains/labels  — distinct label keys + values visible to this user
  app.get('/domains/labels', { preHandler: requireAuth }, async (req: any, reply) => {
    const ownerJoin = req.user.role === 'customer'
      ? ` JOIN domains d ON d.id = dl.domain_id AND d.customer_id = ${Number(req.user.customerId)}`
      : ''
    const rows = await query(
      `SELECT dl.label_key AS \`key\`, dl.label_value AS \`value\`
       FROM domain_labels dl${ownerJoin}
       GROUP BY dl.label_key, dl.label_value
       ORDER BY dl.label_key, dl.label_value`,
      []
    ) as any[]
    // Group into { key, values: string[] }[]
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
        where += ` AND EXISTS (SELECT 1 FROM domain_labels _lf WHERE _lf.domain_id = d.id AND _lf.label_key = ? AND _lf.label_value = ?)`
        params.push(lKey, lVal)
      } else {
        where += ` AND EXISTS (SELECT 1 FROM domain_labels _lf WHERE _lf.domain_id = d.id AND _lf.label_key = ?)`
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
    const labelMap = await fetchLabels(rows.map((r: any) => r.id))
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
    const labelMap = await fetchLabels([row.id])
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
      `SELECT id FROM domains WHERE id = ? AND status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    )
    if (!domain) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateLabelsBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const domainId = Number(req.params.id)
    await execute('DELETE FROM domain_labels WHERE domain_id = ?', [domainId])
    for (const { key, value, color } of body.data.labels) {
      await execute(
        'INSERT INTO domain_labels (domain_id, label_key, label_value, color) VALUES (?, ?, ?, ?)',
        [domainId, key, value, color ?? null]
      )
    }
    const labels = await query(
      'SELECT id, label_key AS `key`, label_value AS `value`, color FROM domain_labels WHERE domain_id = ? ORDER BY label_key, id',
      [domainId]
    )
    return labels
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
