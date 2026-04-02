import { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import {
  generateRefreshToken,
  hashToken,
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

const InviteBody = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).max(255),
  role: z.enum(['admin', 'operator', 'tenant']),
  locale: z.enum(['en', 'de']).optional().default('de'),
  tenant_ids: z.array(z.number().int().positive()).optional().default([]),
})

const AcceptInviteBody = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
})

type UserRow = {
  id: number
  email: string
  password_hash: string
  role: 'admin' | 'operator' | 'tenant'
  tenant_id: number | null
  is_active: number
  locale: 'en' | 'de'
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login  (rate-limited: 10/min per IP)
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = LoginBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const user = await queryOne<UserRow>(
      'SELECT id, email, password_hash, role, tenant_id, is_active, locale FROM users WHERE email = ?',
      [body.data.email]
    )
    if (!user || !user.is_active) return reply.status(401).send({ code: 'INVALID_CREDENTIALS' })

    const valid = await bcrypt.compare(body.data.password, user.password_hash)
    if (!valid) return reply.status(401).send({ code: 'INVALID_CREDENTIALS' })

    const payload: JwtPayload = { sub: user.id, role: user.role, tenantId: user.tenant_id }
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

    type UserRow2 = { id: number; role: 'admin' | 'operator' | 'tenant'; tenant_id: number | null; is_active: number }
    const user = await queryOne<UserRow2>(
      'SELECT id, role, tenant_id, is_active FROM users WHERE id = ?',
      [result.userId]
    )
    if (!user || !user.is_active) return reply.status(401).send({ code: 'USER_INACTIVE' })

    const payload: JwtPayload = { sub: user.id, role: user.role, tenantId: user.tenant_id }
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

    type Row = { id: number; role: 'admin' | 'operator' | 'tenant'; tenant_id: number | null; is_active: number }
    const target = await queryOne<Row>('SELECT id, role, tenant_id, is_active FROM users WHERE id = ?', [targetId])
    if (!target || !target.is_active) return reply.status(404).send({ code: 'NOT_FOUND' })

    const payload: JwtPayload = {
      sub: target.id,
      role: target.role,
      tenantId: target.tenant_id,
      impersonatingId: req.user.sub,
    }
    const accessToken = app.jwt.sign(payload, { expiresIn: '15m' })
    return { accessToken }
  })

  // POST /auth/stop-impersonation  (returns access token for the real admin)
  app.post('/auth/stop-impersonation', { preHandler: requireAuth }, async (req, reply) => {
    const realAdminId = req.user.impersonatingId
    if (!realAdminId) return reply.status(400).send({ code: 'NOT_IMPERSONATING' })

    type Row = { id: number; role: 'admin' | 'operator' | 'tenant'; tenant_id: number | null; is_active: number }
    const admin = await queryOne<Row>('SELECT id, role, tenant_id, is_active FROM users WHERE id = ?', [realAdminId])
    if (!admin || !admin.is_active || admin.role !== 'admin') {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const payload: JwtPayload = { sub: admin.id, role: admin.role, tenantId: admin.tenant_id }
    const accessToken = app.jwt.sign(payload, { expiresIn: '15m' })
    return { accessToken }
  })

  // GET /auth/invites  (admin only — list pending invites)
  app.get('/auth/invites', { preHandler: requireAdmin }, async () => {
    type Row = { id: number; email: string; full_name: string; role: string; locale: string; tenant_ids: string | null; expires_at: string; created_at: string }
    const rows = await query(
      'SELECT id, email, full_name, role, locale, tenant_ids, expires_at, created_at FROM user_invites WHERE used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC'
    ) as Row[]
    return rows.map(r => ({
      ...r,
      tenant_ids: r.tenant_ids ? JSON.parse(r.tenant_ids) as number[] : [],
    }))
  })

  // DELETE /auth/invites/:id  (admin only — revoke a pending invite)
  app.delete<{ Params: { id: string } }>('/auth/invites/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return reply.status(400).send({ code: 'INVALID_ID' })
    await execute('DELETE FROM user_invites WHERE id = ? AND used_at IS NULL', [id])
    return { ok: true }
  })

  // POST /auth/invite  (admin only — send an email invitation)
  app.post('/auth/invite', { preHandler: requireAdmin }, async (req, reply) => {
    const body = InviteBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [body.data.email])
    if (existing) return reply.status(409).send({ code: 'EMAIL_TAKEN' })

    // Remove any previous unused invite for this address
    await execute('DELETE FROM user_invites WHERE email = ? AND used_at IS NULL', [body.data.email])

    const token = randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    await execute(
      'INSERT INTO user_invites (email, token_hash, role, full_name, locale, tenant_ids, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        body.data.email, tokenHash, body.data.role, body.data.full_name,
        body.data.locale, JSON.stringify(body.data.tenant_ids), req.user.sub,
        expiresAt.toISOString().slice(0, 19).replace('T', ' '),
      ]
    )

    const appUrl = process.env.APP_URL ?? 'http://localhost:5173'
    const inviteUrl = `${appUrl}/accept-invite?token=${token}`

    execute(
      `INSERT INTO mail_queue (to_email, template, payload) VALUES (?, 'user_invite', ?)`,
      [body.data.email, JSON.stringify({
        _locale: body.data.locale,
        email: body.data.email,
        full_name: body.data.full_name,
        inviteUrl,
      })]
    ).catch(err => console.error('[auth] Failed to enqueue invite email:', err.message))

    return reply.status(201).send({ ok: true })
  })

  // GET /auth/invite/:token  (public — validate token and return invite details)
  app.get<{ Params: { token: string } }>('/auth/invite/:token', async (req, reply) => {
    const tokenHash = hashToken(req.params.token)
    type InviteRow = { email: string; full_name: string; role: string; locale: string; expires_at: string; used_at: string | null }
    const invite = await queryOne<InviteRow>(
      'SELECT email, full_name, role, locale, expires_at, used_at FROM user_invites WHERE token_hash = ?',
      [tokenHash]
    )
    if (!invite) return reply.status(404).send({ code: 'INVITE_NOT_FOUND' })
    if (invite.used_at) return reply.status(410).send({ code: 'INVITE_USED' })
    if (new Date(invite.expires_at) < new Date()) return reply.status(410).send({ code: 'INVITE_EXPIRED' })
    return { email: invite.email, full_name: invite.full_name, role: invite.role, locale: invite.locale }
  })

  // POST /auth/accept-invite  (public — set password and activate account)
  app.post('/auth/accept-invite', async (req, reply) => {
    const body = AcceptInviteBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const tokenHash = hashToken(body.data.token)
    type InviteRow = { id: number; email: string; full_name: string; role: 'admin' | 'operator' | 'tenant'; locale: 'en' | 'de'; tenant_ids: string | null; expires_at: string; used_at: string | null }
    const invite = await queryOne<InviteRow>(
      'SELECT id, email, full_name, role, locale, tenant_ids, expires_at, used_at FROM user_invites WHERE token_hash = ?',
      [tokenHash]
    )
    if (!invite) return reply.status(404).send({ code: 'INVITE_NOT_FOUND' })
    if (invite.used_at) return reply.status(410).send({ code: 'INVITE_USED' })
    if (new Date(invite.expires_at) < new Date()) return reply.status(410).send({ code: 'INVITE_EXPIRED' })

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [invite.email])
    if (existing) return reply.status(409).send({ code: 'EMAIL_TAKEN' })

    const hash = await bcrypt.hash(body.data.password, 12)
    const tenantIds: number[] = invite.tenant_ids ? JSON.parse(invite.tenant_ids) : []

    const result = await execute(
      'INSERT INTO users (email, password_hash, full_name, role, tenant_id, is_active, locale) VALUES (?, ?, ?, ?, ?, 1, ?)',
      [invite.email, hash, invite.full_name, invite.role, tenantIds[0] ?? null, invite.locale]
    )
    const userId = result.insertId
    for (const cid of tenantIds) {
      await execute('INSERT IGNORE INTO user_tenants (user_id, tenant_id) VALUES (?, ?)', [userId, cid])
    }

    await execute('UPDATE user_invites SET used_at = NOW() WHERE id = ?', [invite.id])
    return { ok: true }
  })
}
