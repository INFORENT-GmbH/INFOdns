import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

const TenantBody = z.object({
  name: z.string().min(1).max(255),
  is_active: z.boolean().optional().default(true),
})

export async function tenantRoutes(app: FastifyInstance) {
  // GET /tenants
  app.get('/tenants', { preHandler: requireAuth }, async (req: any, reply) => {
    if (req.user.role === 'admin') {
      return query('SELECT id, name, is_active, created_at FROM tenants ORDER BY name')
    }
    return query(
      `SELECT c.id, c.name, c.is_active, c.created_at
       FROM tenants c
       JOIN user_tenants uc ON uc.tenant_id = c.id
       WHERE uc.user_id = ?
       ORDER BY c.name`,
      [req.user.sub]
    )
  })

  // POST /tenants  (admin only)
  app.post('/tenants', { preHandler: requireAdmin }, async (req, reply) => {
    const body = TenantBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const result = await execute(
      'INSERT INTO tenants (name, is_active) VALUES (?, ?)',
      [body.data.name, body.data.is_active ? 1 : 0]
    )
    const created = await queryOne('SELECT * FROM tenants WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'tenant', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // GET /tenants/:id
  app.get<{ Params: { id: string } }>('/tenants/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params
    // non-admin users can only see their assigned tenants
    if (req.user.role !== 'admin') {
      const assigned = await query('SELECT tenant_id FROM user_tenants WHERE user_id = ?', [req.user.sub]) as any[]
      if (!assigned.some(r => r.tenant_id === Number(id))) {
        return reply.status(403).send({ code: 'FORBIDDEN' })
      }
    }
    const row = await queryOne('SELECT id, name, is_active, created_at FROM tenants WHERE id = ?', [id])
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    return row
  })

  // PUT /tenants/:id  (admin only)
  app.put<{ Params: { id: string } }>('/tenants/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const old = await queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = TenantBody.partial().safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    await execute(
      'UPDATE tenants SET name = COALESCE(?, name), is_active = COALESCE(?, is_active) WHERE id = ?',
      [body.data.name ?? null, body.data.is_active != null ? (body.data.is_active ? 1 : 0) : null, req.params.id]
    )
    const updated = await queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'tenant', entityId: Number(req.params.id), action: 'update', oldValue: old, newValue: updated })
    return updated
  })

  // DELETE /tenants/:id  (admin only)
  app.delete<{ Params: { id: string } }>('/tenants/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const old = await queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })
    await execute('DELETE FROM tenants WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'tenant', entityId: Number(req.params.id), action: 'delete', oldValue: old })
    return { ok: true }
  })
}
