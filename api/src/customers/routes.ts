import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireAdmin, requireOperatorOrAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

const CustomerBody = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  is_active: z.boolean().optional().default(true),
})

export async function customerRoutes(app: FastifyInstance) {
  // GET /customers
  app.get('/customers', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const rows = await query('SELECT id, name, slug, is_active, created_at FROM customers ORDER BY name')
    return rows
  })

  // POST /customers  (admin only)
  app.post('/customers', { preHandler: requireAdmin }, async (req, reply) => {
    const body = CustomerBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const existing = await queryOne('SELECT id FROM customers WHERE slug = ?', [body.data.slug])
    if (existing) return reply.status(409).send({ code: 'SLUG_TAKEN' })

    const result = await execute(
      'INSERT INTO customers (name, slug, is_active) VALUES (?, ?, ?)',
      [body.data.name, body.data.slug, body.data.is_active ? 1 : 0]
    )
    const created = await queryOne('SELECT * FROM customers WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'customer', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // GET /customers/:id
  app.get<{ Params: { id: string } }>('/customers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params
    // customers can only see their own
    if (req.user.role === 'customer' && req.user.customerId !== Number(id)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    const row = await queryOne('SELECT id, name, slug, is_active, created_at FROM customers WHERE id = ?', [id])
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    return row
  })

  // PUT /customers/:id  (admin only)
  app.put<{ Params: { id: string } }>('/customers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const old = await queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = CustomerBody.partial().safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    await execute(
      'UPDATE customers SET name = COALESCE(?, name), slug = COALESCE(?, slug), is_active = COALESCE(?, is_active) WHERE id = ?',
      [body.data.name ?? null, body.data.slug ?? null, body.data.is_active != null ? (body.data.is_active ? 1 : 0) : null, req.params.id]
    )
    const updated = await queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'customer', entityId: Number(req.params.id), action: 'update', oldValue: old, newValue: updated })
    return updated
  })

  // DELETE /customers/:id  (admin only)
  app.delete<{ Params: { id: string } }>('/customers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const old = await queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })
    await execute('DELETE FROM customers WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'customer', entityId: Number(req.params.id), action: 'delete', oldValue: old })
    return { ok: true }
  })
}
