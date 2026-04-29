import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import { query, queryOne, execute } from '../db.js'
import { hashToken } from '../auth/jwt.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1).max(255),
  role: z.enum(['admin', 'operator', 'tenant']),
  tenant_ids: z.array(z.number().int().positive()).optional().default([]),
  is_active: z.boolean().optional().default(true),
  locale: z.enum(['en', 'de']).optional().default('de'),
  phone: z.string().max(50).nullable().optional(),
  street: z.string().max(255).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().length(2).nullable().optional(),
})

const UpdateUserBody = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  current_password: z.string().min(1).optional(),
  full_name: z.string().min(1).max(255).optional(),
  role: z.enum(['admin', 'operator', 'tenant']).optional(),
  tenant_ids: z.array(z.number().int().positive()).optional(),
  is_active: z.boolean().optional(),
  locale: z.enum(['en', 'de']).optional(),
  phone: z.string().max(50).nullable().optional(),
  street: z.string().max(255).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().length(2).nullable().optional(),
})

export async function userRoutes(app: FastifyInstance) {
  // GET /users  (admin only)
  app.get('/users', { preHandler: requireAdmin }, async (req) => {
    const users = await query('SELECT id, email, full_name, role, tenant_id, is_active, locale, phone, street, zip, city, country, created_at FROM users ORDER BY email') as any[]
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
      'INSERT INTO users (email, password_hash, full_name, role, tenant_id, is_active, locale, phone, street, zip, city, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [body.data.email, hash, body.data.full_name, body.data.role, body.data.tenant_ids[0] ?? null, body.data.is_active ? 1 : 0, body.data.locale, body.data.phone ?? null, body.data.street ?? null, body.data.zip ?? null, body.data.city ?? null, body.data.country ?? null]
    )
    const userId = result.insertId
    for (const cid of body.data.tenant_ids) {
      await execute('INSERT INTO user_tenants (user_id, tenant_id) VALUES (?, ?)', [userId, cid])
    }
    const created = await queryOne(
      'SELECT id, email, full_name, role, tenant_id, is_active, locale, phone, street, zip, city, country, created_at FROM users WHERE id = ?',
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
      'SELECT id, email, full_name, role, tenant_id, is_active, locale, phone, street, zip, city, country, created_at FROM users WHERE id = ?',
      [targetId]
    )
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    const cids = (await query('SELECT tenant_id FROM user_tenants WHERE user_id = ? ORDER BY tenant_id', [targetId]) as any[]).map(r => r.tenant_id)
    return { ...row, tenant_ids: cids }
  })

  // PUT /users/:id  (admin, or own profile for password/name only)
  app.put<{ Params: { id: string } }>('/users/:id', { preHandler: requireAuth }, async (req, reply) => {
    const targetId = Number(req.params.id)
    if (req.user.role !== 'admin' && req.user.sub !== targetId) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const old = await queryOne('SELECT * FROM users WHERE id = ?', [targetId])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateUserBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    // Non-admins can only update their own password, full_name, and locale
    if (req.user.role !== 'admin' && (body.data.role || body.data.is_active !== undefined || body.data.tenant_ids)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    // Require current_password when a non-admin changes their own password
    if (body.data.password && req.user.role !== 'admin') {
      if (!body.data.current_password) {
        return reply.status(400).send({ code: 'CURRENT_PASSWORD_REQUIRED' })
      }
      const valid = await bcrypt.compare(body.data.current_password, (old as any).password_hash)
      if (!valid) return reply.status(401).send({ code: 'CURRENT_PASSWORD_INVALID' })
    }

    const hash = body.data.password ? await bcrypt.hash(body.data.password, 12) : null
    await execute(
      `UPDATE users SET
        email = COALESCE(?, email),
        password_hash = COALESCE(?, password_hash),
        full_name = COALESCE(?, full_name),
        role = COALESCE(?, role),
        is_active = COALESCE(?, is_active),
        locale = COALESCE(?, locale),
        phone = COALESCE(?, phone),
        street = COALESCE(?, street),
        zip = COALESCE(?, zip),
        city = COALESCE(?, city),
        country = COALESCE(?, country)
       WHERE id = ?`,
      [body.data.email ?? null, hash, body.data.full_name ?? null, body.data.role ?? null,
       body.data.is_active != null ? (body.data.is_active ? 1 : 0) : null, body.data.locale ?? null,
       body.data.phone ?? null, body.data.street ?? null, body.data.zip ?? null,
       body.data.city ?? null, body.data.country ?? null, targetId]
    )
    if (body.data.tenant_ids !== undefined) {
      await execute('DELETE FROM user_tenants WHERE user_id = ?', [targetId])
      for (const cid of body.data.tenant_ids) {
        await execute('INSERT INTO user_tenants (user_id, tenant_id) VALUES (?, ?)', [targetId, cid])
      }
      await execute('UPDATE users SET tenant_id = ? WHERE id = ?', [body.data.tenant_ids[0] ?? null, targetId])
    }
    const updated = await queryOne(
      'SELECT id, email, full_name, role, tenant_id, is_active, locale, phone, street, zip, city, country FROM users WHERE id = ?',
      [targetId]
    )
    const cids = (await query('SELECT tenant_id FROM user_tenants WHERE user_id = ? ORDER BY tenant_id', [targetId]) as any[]).map(r => r.tenant_id)
    await writeAuditLog({ req, entityType: 'user', entityId: targetId, action: 'update', newValue: { ...updated, tenant_ids: cids } })
    return { ...updated, tenant_ids: cids }
  })

  // POST /users/:id/reset-password  (admin only — sends a password reset email to the user)
  app.post<{ Params: { id: string } }>('/users/:id/reset-password', { preHandler: requireAdmin }, async (req, reply) => {
    const targetId = Number(req.params.id)
    if (!Number.isInteger(targetId) || targetId <= 0) return reply.status(400).send({ code: 'INVALID_ID' })

    type Row = { id: number; email: string; full_name: string; locale: 'en' | 'de'; is_active: number }
    const user = await queryOne<Row>(
      'SELECT id, email, full_name, locale, is_active FROM users WHERE id = ?',
      [targetId]
    )
    if (!user) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!user.is_active) return reply.status(400).send({ code: 'USER_INACTIVE' })

    await execute('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id])

    const token = randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await execute(
      'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
    )

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173'
    const resetUrl = `${appUrl}/reset-password?token=${token}`

    execute(
      `INSERT INTO mail_queue (to_email, template, payload) VALUES (?, 'password_reset', ?)`,
      [user.email, JSON.stringify({
        _locale: user.locale,
        email: user.email,
        full_name: user.full_name,
        resetUrl,
      })]
    ).catch(err => console.error('[users] Failed to enqueue password reset email:', err.message))

    await writeAuditLog({ req, entityType: 'user', entityId: user.id, action: 'reset_password', newValue: { email: user.email } })

    return reply.send({ ok: true })
  })
}
