import { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { queryOne, execute } from '../db.js'
import {
  generateRefreshToken,
  saveRefreshToken,
  rotateRefreshToken,
  revokeAllForUser,
  type JwtPayload,
} from './jwt.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

type UserRow = {
  id: number
  email: string
  password_hash: string
  role: 'admin' | 'operator' | 'customer'
  customer_id: number | null
  is_active: number
  locale: 'en' | 'de'
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login  (rate-limited: 10/min per IP)
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = LoginBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const user = await queryOne<UserRow>(
      'SELECT id, email, password_hash, role, customer_id, is_active, locale FROM users WHERE email = ?',
      [body.data.email]
    )
    if (!user || !user.is_active) return reply.status(401).send({ code: 'INVALID_CREDENTIALS' })

    const valid = await bcrypt.compare(body.data.password, user.password_hash)
    if (!valid) return reply.status(401).send({ code: 'INVALID_CREDENTIALS' })

    const payload: JwtPayload = { sub: user.id, role: user.role, customerId: user.customer_id }
    const accessToken = app.jwt.sign(payload, { expiresIn: '15m' })
    const refreshToken = generateRefreshToken()
    await saveRefreshToken(user.id, refreshToken)

    reply
      .setCookie('refresh_token', refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/v1/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })
      .send({ accessToken })

    // Enqueue login notification email (non-blocking)
    execute(
      `INSERT INTO mail_queue (to_email, template, payload) VALUES (?, 'login_notification', ?)`,
      [user.email, JSON.stringify({
        _locale: user.locale,
        email: user.email,
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? 'unknown',
        timestamp: new Date().toISOString(),
      })]
    ).catch(err => console.error('[auth] Failed to enqueue login notification:', err.message))
  })

  // POST /auth/refresh  (rate-limited: 30/min per IP — silent refresh on every page load)
  app.post('/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.cookies?.refresh_token
    if (!raw) return reply.status(401).send({ code: 'NO_REFRESH_TOKEN' })

    const result = await rotateRefreshToken(raw)
    if (!result) return reply.status(401).send({ code: 'INVALID_REFRESH_TOKEN' })

    type UserRow2 = { id: number; role: 'admin' | 'operator' | 'customer'; customer_id: number | null; is_active: number }
    const user = await queryOne<UserRow2>(
      'SELECT id, role, customer_id, is_active FROM users WHERE id = ?',
      [result.userId]
    )
    if (!user || !user.is_active) return reply.status(401).send({ code: 'USER_INACTIVE' })

    const payload: JwtPayload = { sub: user.id, role: user.role, customerId: user.customer_id }
    const accessToken = app.jwt.sign(payload, { expiresIn: '15m' })
    const newRefresh = generateRefreshToken()
    await saveRefreshToken(user.id, newRefresh)

    reply
      .setCookie('refresh_token', newRefresh, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/v1/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })
      .send({ accessToken })
  })

  // POST /auth/logout
  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies?.refresh_token
    if (raw) {
      const result = await rotateRefreshToken(raw)
      if (result) await revokeAllForUser(result.userId)
    }
    reply.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' }).send({ ok: true })
  })

  // POST /auth/impersonate/:id  (admin only — returns access token acting as target user)
  app.post<{ Params: { id: string } }>('/auth/impersonate/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const targetId = Number(req.params.id)
    if (!Number.isInteger(targetId) || targetId <= 0) return reply.status(400).send({ code: 'INVALID_ID' })
    if (targetId === req.user.sub) return reply.status(400).send({ code: 'CANNOT_IMPERSONATE_SELF' })

    type Row = { id: number; role: 'admin' | 'operator' | 'customer'; customer_id: number | null; is_active: number }
    const target = await queryOne<Row>('SELECT id, role, customer_id, is_active FROM users WHERE id = ?', [targetId])
    if (!target || !target.is_active) return reply.status(404).send({ code: 'NOT_FOUND' })

    const payload: JwtPayload = {
      sub: target.id,
      role: target.role,
      customerId: target.customer_id,
      impersonatingId: req.user.sub,
    }
    const accessToken = app.jwt.sign(payload, { expiresIn: '15m' })
    return { accessToken }
  })

  // POST /auth/stop-impersonation  (returns access token for the real admin)
  app.post('/auth/stop-impersonation', { preHandler: requireAuth }, async (req, reply) => {
    const realAdminId = req.user.impersonatingId
    if (!realAdminId) return reply.status(400).send({ code: 'NOT_IMPERSONATING' })

    type Row = { id: number; role: 'admin' | 'operator' | 'customer'; customer_id: number | null; is_active: number }
    const admin = await queryOne<Row>('SELECT id, role, customer_id, is_active FROM users WHERE id = ?', [realAdminId])
    if (!admin || !admin.is_active || admin.role !== 'admin') {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const payload: JwtPayload = { sub: admin.id, role: admin.role, customerId: admin.customer_id }
    const accessToken = app.jwt.sign(payload, { expiresIn: '15m' })
    return { accessToken }
  })
}
