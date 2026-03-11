import { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { queryOne } from '../db.js'
import {
  generateRefreshToken,
  saveRefreshToken,
  rotateRefreshToken,
  revokeAllForUser,
  type JwtPayload,
} from './jwt.js'

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
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login  (rate-limited: 10/min per IP)
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = LoginBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const user = await queryOne<UserRow>(
      'SELECT id, email, password_hash, role, customer_id, is_active FROM users WHERE email = ?',
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
        sameSite: 'strict',
        path: '/api/v1/auth/refresh',
        maxAge: 7 * 24 * 60 * 60,
      })
      .send({ accessToken })
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
        sameSite: 'strict',
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
}
