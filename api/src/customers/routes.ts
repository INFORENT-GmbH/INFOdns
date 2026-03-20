import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

const CustomerBody = z.object({
  name: z.string().min(1).max(255),
  is_active: z.boolean().optional().default(true),
})

export async function customerRoutes(app: FastifyInstance) {
  // GET /customers
  app.get('/customers', { preHandler: requireAuth }, async (req: any, reply) => {
    if (req.user.role === 'admin') {
      return query('SELECT id, name, is_active, created_at FROM customers ORDER BY name')
    }
    return query(
      `SELECT c.id, c.name, c.is_active, c.created_at
       FROM customers c
       JOIN user_customers uc ON uc.customer_id = c.id
       WHERE uc.user_id = ?
       ORDER BY c.name`,
      [req.user.sub]
    )
  })

  // POST /customers  (admin only)
  app.post('/customers', { preHandler: requireAdmin }, async (req, reply) => {
    const body = CustomerBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const result = await execute(
      'INSERT INTO customers (name, is_active) VALUES (?, ?)',
      [body.data.name, body.data.is_active ? 1 : 0]
    )
    const created = await queryOne('SELECT * FROM customers WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'customer', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // GET /customers/:id
  app.get<{ Params: { id: string } }>('/customers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params
    // non-admin users can only see their assigned customers
    if (req.user.role !== 'admin') {
      const assigned = await query('SELECT customer_id FROM user_customers WHERE user_id = ?', [req.user.sub]) as any[]
      if (!assigned.some(r => r.customer_id === Number(id))) {
        return reply.status(403).send({ code: 'FORBIDDEN' })
      }
    }
    const row = await queryOne('SELECT id, name, is_active, created_at FROM customers WHERE id = ?', [id])
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
      'UPDATE customers SET name = COALESCE(?, name), is_active = COALESCE(?, is_active) WHERE id = ?',
      [body.data.name ?? null, body.data.is_active != null ? (body.data.is_active ? 1 : 0) : null, req.params.id]
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
