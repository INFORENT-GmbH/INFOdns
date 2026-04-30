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

const ForgotPasswordBody = z.object({
  email: z.string().email(),
})

const ResetPasswordBody = z.object({
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
  failed_login_count: number
  locked_until: string | null
}

const LOGIN_LOCKOUT_THRESHOLD = 5
const LOGIN_LOCKOUT_MINUTES = 15

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth/refresh',
  maxAge: 7 * 24 * 60 * 60,
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login  (rate-limited: 10/min per IP)
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = LoginBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const user = await queryOne<UserRow>(
      'SELECT id, email, password_hash, role, tenant_id, is_active, locale, failed_login_count, locked_until FROM users WHERE email = ?',
      [body.data.email]
    )
    if (!user || !user.is_active) return reply.status(401).send({ code: 'INVALID_CREDENTIALS' })

    // Per-account lockout — defends against distributed brute force where the
    // IP rate-limit (10/min per IP) doesn't apply because attempts span IPs.
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return reply.status(423).send({
        code: 'ACCOUNT_LOCKED',
        message: `Too many failed attempts. Try again after ${user.locked_until}.`,
      })
    }

    const valid = await bcrypt.compare(body.data.password, user.password_hash)
    if (!valid) {
      const newCount = user.failed_login_count + 1
      const shouldLock = newCount >= LOGIN_LOCKOUT_THRESHOLD
      await execute(
        shouldLock
          ? 'UPDATE users SET failed_login_count = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?'
          : 'UPDATE users SET failed_login_count = ? WHERE id = ?',
        shouldLock ? [newCount, LOGIN_LOCKOUT_MINUTES, user.id] : [newCount, user.id]
      )
      if (shouldLock) {
        console.warn(`[auth] Account locked for ${LOGIN_LOCKOUT_MINUTES}min after ${newCount} failed logins: ${user.email}`)
      }
      return reply.status(401).send({ code: 'INVALID_CREDENTIALS' })
    }

    // Success — clear failure counters
    if (user.failed_login_count > 0 || user.locked_until) {
      await execute('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [user.id])
    }

    const payload: JwtPayload = { sub: user.id, role: user.role, tenantId: user.tenant_id }
    const accessToken = app.jwt.sign(payload, { expiresIn: '15m' })
    const refreshToken = generateRefreshToken()
    await saveRefreshToken(user.id, refreshToken)

    reply
      .setCookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS)
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
      .setCookie('refresh_token', newRefresh, REFRESH_COOKIE_OPTIONS)
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

  // POST /auth/forgot-password  (public, rate-limited — always returns 200 to avoid user enumeration)
  app.post('/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = ForgotPasswordBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    type Row = { id: number; email: string; full_name: string; locale: 'en' | 'de'; is_active: number }
    const user = await queryOne<Row>(
      'SELECT id, email, full_name, locale, is_active FROM users WHERE email = ?',
      [body.data.email]
    )

    if (user && user.is_active) {
      // Invalidate any prior unused tokens for this user so only the latest link works
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
      ).catch(err => console.error('[auth] Failed to enqueue password reset email:', err.message))
    }

    return reply.send({ ok: true })
  })

  // GET /auth/reset-password/:token  (public — validate token before showing the form)
  app.get<{ Params: { token: string } }>('/auth/reset-password/:token', async (req, reply) => {
    const tokenHash = hashToken(req.params.token)
    type Row = { email: string; expires_at: string; used_at: string | null }
    const row = await queryOne<Row>(
      `SELECT u.email, pr.expires_at, pr.used_at
         FROM password_resets pr
         JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash = ?`,
      [tokenHash]
    )
    if (!row) return reply.status(404).send({ code: 'RESET_NOT_FOUND' })
    if (row.used_at) return reply.status(410).send({ code: 'RESET_USED' })
    if (new Date(row.expires_at) < new Date()) return reply.status(410).send({ code: 'RESET_EXPIRED' })
    return { email: row.email }
  })

  // POST /auth/reset-password  (public — set new password using a valid reset token)
  app.post('/auth/reset-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = ResetPasswordBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const tokenHash = hashToken(body.data.token)
    type Row = { id: number; user_id: number; expires_at: string; used_at: string | null }
    const row = await queryOne<Row>(
      'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?',
      [tokenHash]
    )
    if (!row) return reply.status(404).send({ code: 'RESET_NOT_FOUND' })
    if (row.used_at) return reply.status(410).send({ code: 'RESET_USED' })
    if (new Date(row.expires_at) < new Date()) return reply.status(410).send({ code: 'RESET_EXPIRED' })

    // Atomic claim: only the request that flips used_at NULL→NOW() is allowed
    // to proceed. Two parallel resets with the same token would otherwise both
    // pass the `if (row.used_at)` check above before either marked the row used.
    const claim = await execute(
      'UPDATE password_resets SET used_at = NOW() WHERE id = ? AND used_at IS NULL',
      [row.id]
    )
    if (claim.affectedRows === 0) return reply.status(410).send({ code: 'RESET_USED' })

    const hash = await bcrypt.hash(body.data.password, 12)
    await execute(
      'UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [hash, row.user_id]
    )
    // Invalidate any other live sessions — a reset means previous credentials are no longer trusted
    await revokeAllForUser(row.user_id)

    return { ok: true }
  })
}
