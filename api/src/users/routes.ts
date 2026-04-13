import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().max(255).optional().default(''),
  last_name: z.string().min(1).max(255),
  street: z.string().max(255).optional().default(''),
  zip: z.string().max(20).optional().default(''),
  city: z.string().max(100).optional().default(''),
  country: z.string().max(100).optional().default(''),
  phone: z.string().max(50).optional().default(''),
  mobile: z.string().max(50).optional().default(''),
  role: z.enum(['admin', 'operator', 'tenant']),
  tenant_ids: z.array(z.number().int().positive()).optional().default([]),
  is_active: z.boolean().optional().default(true),
  locale: z.enum(['en', 'de']).optional().default('de'),
})

const UpdateUserBody = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  first_name: z.string().max(255).optional(),
  last_name: z.string().min(1).max(255).optional(),
  street: z.string().max(255).optional(),
  zip: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  phone: z.string().max(50).optional(),
  mobile: z.string().max(50).optional(),
  role: z.enum(['admin', 'operator', 'tenant']).optional(),
  tenant_ids: z.array(z.number().int().positive()).optional(),
  is_active: z.boolean().optional(),
  locale: z.enum(['en', 'de']).optional(),
})

export async function userRoutes(app: FastifyInstance) {
  const USER_COLS = 'id, email, first_name, last_name, role, tenant_id, street, zip, city, country, phone, mobile, is_active, locale, created_at'

  // GET /users  (admin only)
  app.get('/users', { preHandler: requireAdmin }, async (req) => {
    const users = await query(`SELECT ${USER_COLS} FROM users ORDER BY email`) as any[]
    const ucRows = await query('SELECT user_id, tenant_id FROM user_tenants ORDER BY user_id, tenant_id') as any[]
    const ucMap = new Map<number, number[]>()
    for (const r of ucRows) {
      if (!ucMap.has(r.user_id)) ucMap.set(r.user_id, [])
      ucMap.get(r.user_id)!.push(r.tenant_id)
    }
    return users.map(u => ({ ...u, tenant_ids: ucMap.get(u.id) ?? [] }))
  })

  // POST /users  (admin only)
  app.post('/users', { preHandler: requireAdmin }, async (req, reply) => {
    const body = CreateUserBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [body.data.email])
    if (existing) return reply.status(409).send({ code: 'EMAIL_TAKEN' })

    const hash = await bcrypt.hash(body.data.password, 12)
    const result = await execute(
      `INSERT INTO users (email, password_hash, first_name, last_name, street, zip, city, country, phone, mobile, role, tenant_id, is_active, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [body.data.email, hash, body.data.first_name, body.data.last_name,
       body.data.street || null, body.data.zip || null, body.data.city || null, body.data.country || null,
       body.data.phone || null, body.data.mobile || null,
       body.data.role, body.data.tenant_ids[0] ?? null, body.data.is_active ? 1 : 0, body.data.locale]
    )
    const userId = result.insertId
    for (const cid of body.data.tenant_ids) {
      await execute('INSERT INTO user_tenants (user_id, tenant_id) VALUES (?, ?)', [userId, cid])
    }
    const created = await queryOne(
      `SELECT ${USER_COLS} FROM users WHERE id = ?`,
      [userId]
    )
    await writeAuditLog({ req, entityType: 'user', entityId: userId, action: 'create', newValue: { ...created, tenant_ids: body.data.tenant_ids } })
    return reply.status(201).send({ ...created, tenant_ids: body.data.tenant_ids })
  })

  // GET /users/:id  (admin, or own profile)
  app.get<{ Params: { id: string } }>('/users/:id', { preHandler: requireAuth }, async (req, reply) => {
    const targetId = Number(req.params.id)
    if (req.user.role !== 'admin' && req.user.sub !== targetId) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    const row = await queryOne(
      `SELECT ${USER_COLS} FROM users WHERE id = ?`,
      [targetId]
    )
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    const cids = (await query('SELECT tenant_id FROM user_tenants WHERE user_id = ? ORDER BY tenant_id', [targetId]) as any[]).map(r => r.tenant_id)
    return { ...row, tenant_ids: cids }
  })

  // PUT /users/:id  (admin, or own profile for password/name/contact only)
  app.put<{ Params: { id: string } }>('/users/:id', { preHandler: requireAuth }, async (req, reply) => {
    const targetId = Number(req.params.id)
    if (req.user.role !== 'admin' && req.user.sub !== targetId) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const old = await queryOne('SELECT * FROM users WHERE id = ?', [targetId])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateUserBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    // Non-admins can only update their own password, name, contact details, and locale
    if (req.user.role !== 'admin' && (body.data.role || body.data.is_active !== undefined || body.data.tenant_ids)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const hash = body.data.password ? await bcrypt.hash(body.data.password, 12) : null
    await execute(
      `UPDATE users SET
        email = COALESCE(?, email),
        password_hash = COALESCE(?, password_hash),
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        street = COALESCE(?, street),
        zip = COALESCE(?, zip),
        city = COALESCE(?, city),
        country = COALESCE(?, country),
        phone = COALESCE(?, phone),
        mobile = COALESCE(?, mobile),
        role = COALESCE(?, role),
        is_active = COALESCE(?, is_active),
        locale = COALESCE(?, locale)
       WHERE id = ?`,
      [body.data.email ?? null, hash, body.data.first_name ?? null, body.data.last_name ?? null,
       body.data.street ?? null, body.data.zip ?? null, body.data.city ?? null, body.data.country ?? null,
       body.data.phone ?? null, body.data.mobile ?? null,
       body.data.role ?? null,
       body.data.is_active != null ? (body.data.is_active ? 1 : 0) : null, body.data.locale ?? null, targetId]
    )
    if (body.data.tenant_ids !== undefined) {
      await execute('DELETE FROM user_tenants WHERE user_id = ?', [targetId])
      for (const cid of body.data.tenant_ids) {
        await execute('INSERT INTO user_tenants (user_id, tenant_id) VALUES (?, ?)', [targetId, cid])
      }
      await execute('UPDATE users SET tenant_id = ? WHERE id = ?', [body.data.tenant_ids[0] ?? null, targetId])
    }
    const updated = await queryOne(
      `SELECT ${USER_COLS} FROM users WHERE id = ?`,
      [targetId]
    )
    const cids = (await query('SELECT tenant_id FROM user_tenants WHERE user_id = ? ORDER BY tenant_id', [targetId]) as any[]).map(r => r.tenant_id)
    await writeAuditLog({ req, entityType: 'user', entityId: targetId, action: 'update', newValue: { ...updated, tenant_ids: cids } })
    return { ...updated, tenant_ids: cids }
  })
}
