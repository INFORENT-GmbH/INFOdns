import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

const TenantBody = z.object({
  name: z.string().min(1).max(255),
  is_active: z.boolean().optional().default(true),
  company_name: z.string().max(255).nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  street: z.string().max(255).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().length(2).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  fax: z.string().max(50).nullable().optional(),
  email: z.string().email().nullable().optional(),
  vat_id: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
})

export async function tenantRoutes(app: FastifyInstance) {
  // GET /tenants
  app.get('/tenants', { preHandler: requireAuth }, async (req: any, reply) => {
    if (req.user.role === 'admin') {
      return query('SELECT id, name, company_name, first_name, last_name, street, zip, city, country, phone, fax, email, vat_id, notes, is_active, created_at FROM tenants ORDER BY name')
    }
    return query(
      `SELECT c.id, c.name, c.company_name, c.first_name, c.last_name, c.street, c.zip, c.city, c.country, c.phone, c.fax, c.email, c.vat_id, c.notes, c.is_active, c.created_at
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
      'INSERT INTO tenants (name, is_active, company_name, first_name, last_name, street, zip, city, country, phone, fax, email, vat_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [body.data.name, body.data.is_active ? 1 : 0, body.data.company_name ?? null, body.data.first_name ?? null, body.data.last_name ?? null, body.data.street ?? null, body.data.zip ?? null, body.data.city ?? null, body.data.country ?? null, body.data.phone ?? null, body.data.fax ?? null, body.data.email ?? null, body.data.vat_id ?? null, body.data.notes ?? null]
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
    const row = await queryOne('SELECT id, name, company_name, first_name, last_name, street, zip, city, country, phone, fax, email, vat_id, notes, is_active, created_at FROM tenants WHERE id = ?', [id])
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
      `UPDATE tenants SET
        name = COALESCE(?, name),
        is_active = COALESCE(?, is_active),
        company_name = COALESCE(?, company_name),
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        street = COALESCE(?, street),
        zip = COALESCE(?, zip),
        city = COALESCE(?, city),
        country = COALESCE(?, country),
        phone = COALESCE(?, phone),
        fax = COALESCE(?, fax),
        email = COALESCE(?, email),
        vat_id = COALESCE(?, vat_id),
        notes = COALESCE(?, notes)
       WHERE id = ?`,
      [body.data.name ?? null, body.data.is_active != null ? (body.data.is_active ? 1 : 0) : null,
       body.data.company_name ?? null, body.data.first_name ?? null, body.data.last_name ?? null,
       body.data.street ?? null, body.data.zip ?? null, body.data.city ?? null, body.data.country ?? null,
       body.data.phone ?? null, body.data.fax ?? null, body.data.email ?? null,
       body.data.vat_id ?? null, body.data.notes ?? null, req.params.id]
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
