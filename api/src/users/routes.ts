import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1).max(255),
  role: z.enum(['admin', 'operator', 'customer']),
  customer_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional().default(true),
})

const UpdateUserBody = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  full_name: z.string().min(1).max(255).optional(),
  role: z.enum(['admin', 'operator', 'customer']).optional(),
  is_active: z.boolean().optional(),
})

export async function userRoutes(app: FastifyInstance) {
  // GET /users  (admin only)
  app.get('/users', { preHandler: requireAdmin }, async (req) => {
    return query('SELECT id, email, full_name, role, customer_id, is_active, created_at FROM users ORDER BY email')
  })

  // POST /users  (admin only)
  app.post('/users', { preHandler: requireAdmin }, async (req, reply) => {
    const body = CreateUserBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [body.data.email])
    if (existing) return reply.status(409).send({ code: 'EMAIL_TAKEN' })

    const hash = await bcrypt.hash(body.data.password, 12)
    const result = await execute(
      'INSERT INTO users (email, password_hash, full_name, role, customer_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [body.data.email, hash, body.data.full_name, body.data.role, body.data.customer_id ?? null, body.data.is_active ? 1 : 0]
    )
    const created = await queryOne(
      'SELECT id, email, full_name, role, customer_id, is_active, created_at FROM users WHERE id = ?',
      [result.insertId]
    )
    await writeAuditLog({ req, entityType: 'user', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // GET /users/:id  (admin, or own profile)
  app.get<{ Params: { id: string } }>('/users/:id', { preHandler: requireAuth }, async (req, reply) => {
    const targetId = Number(req.params.id)
    if (req.user.role !== 'admin' && req.user.sub !== targetId) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    const row = await queryOne(
      'SELECT id, email, full_name, role, customer_id, is_active, created_at FROM users WHERE id = ?',
      [targetId]
    )
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    return row
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

    // Non-admins can only update their own password and full_name
    if (req.user.role !== 'admin' && (body.data.role || body.data.is_active !== undefined)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const hash = body.data.password ? await bcrypt.hash(body.data.password, 12) : null
    await execute(
      `UPDATE users SET
        email = COALESCE(?, email),
        password_hash = COALESCE(?, password_hash),
        full_name = COALESCE(?, full_name),
        role = COALESCE(?, role),
        is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [body.data.email ?? null, hash, body.data.full_name ?? null, body.data.role ?? null,
       body.data.is_active != null ? (body.data.is_active ? 1 : 0) : null, targetId]
    )
    const updated = await queryOne(
      'SELECT id, email, full_name, role, customer_id, is_active FROM users WHERE id = ?',
      [targetId]
    )
    await writeAuditLog({ req, entityType: 'user', entityId: targetId, action: 'update', newValue: updated })
    return updated
  })
}
