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

/** Inject ownership filter for customer role */
function ownerFilter(req: any): string {
  return req.user.role === 'customer' ? ` AND d.customer_id = ${Number(req.user.customerId)}` : ''
}

export async function domainRoutes(app: FastifyInstance) {
  // GET /domains
  app.get('/domains', { preHandler: requireAuth }, async (req: any, reply) => {
    const { search, customer_id, page = '1', limit = '50' } = req.query as Record<string, string>
    const offset = (Number(page) - 1) * Number(limit)
    const params: unknown[] = []
    let where = "WHERE d.status != 'deleted'"

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
       FROM domains d JOIN customers c ON c.id = d.customer_id
       ${where}
       ORDER BY d.fqdn
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    )
    return rows
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
    )
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    return row
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

  // DELETE /domains/:id  (soft delete)
  app.delete<{ Params: { id: string } }>('/domains/:id', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const old = await queryOne("SELECT * FROM domains WHERE id = ? AND status != 'deleted'", [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })
    await execute("UPDATE domains SET status = 'deleted' WHERE id = ?", [req.params.id])
    await writeAuditLog({ req, entityType: 'domain', entityId: Number(req.params.id), domainId: Number(req.params.id), action: 'delete', oldValue: old })
    return { ok: true }
  })
}
