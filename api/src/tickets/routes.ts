import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireOperatorOrAdmin } from '../middleware/auth.js'
import { broadcast } from '../ws/hub.js'

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '/app/uploads'

// ── Helpers ───────────────────────────────────────────────────

async function queueMail(to: string, template: string, payload: unknown): Promise<void> {
  await execute(
    `INSERT INTO mail_queue (to_email, template, payload) VALUES (?, ?, ?)`,
    [to, template, JSON.stringify(payload)]
  )
}

function isStaff(role: string) {
  return role === 'admin' || role === 'operator'
}

// Build the WHERE clause for tenant-role ticket scoping
function tenantFilter(userId: number, email: string): { clause: string; params: unknown[] } {
  return {
    clause: `(t.requester_email = ? OR t.tenant_id IN (
               SELECT tenant_id FROM user_tenants WHERE user_id = ?
             ))`,
    params: [email, userId],
  }
}

// ── Route plugin ─────────────────────────────────────────────

export async function ticketRoutes(app: FastifyInstance) {

  // GET /tickets
  app.get('/tickets', { preHandler: requireAuth }, async (req: any) => {
    const { status, priority, assigned_to, tenant_id, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum  = Math.max(1, Number(page))
    const limitNum = Math.min(200, Math.max(1, Number(limit)))
    const offset   = (pageNum - 1) * limitNum

    const clauses: string[] = []
    const params: unknown[] = []

    if (!isStaff(req.user.role)) {
      const userRow = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = ?', [req.user.sub])
      const f = tenantFilter(req.user.sub, userRow?.email ?? '')
      clauses.push(f.clause)
      params.push(...f.params)
    }

    if (status)      { clauses.push('t.status = ?');      params.push(status) }
    if (priority)    { clauses.push('t.priority = ?');    params.push(priority) }
    if (assigned_to) { clauses.push('t.assigned_to = ?'); params.push(Number(assigned_to)) }
    if (tenant_id) { clauses.push('t.tenant_id = ?'); params.push(Number(tenant_id)) }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [rows, countRow] = await Promise.all([
      query(
        `SELECT t.id, t.subject, t.status, t.priority, t.requester_email, t.requester_name,
                t.tenant_id, t.assigned_to, u.full_name AS assigned_to_name,
                t.source, t.created_at, t.updated_at,
                (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count
         FROM support_tickets t
         LEFT JOIN users u ON u.id = t.assigned_to
         ${where}
         ORDER BY t.updated_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM support_tickets t ${where}`,
        params
      ),
    ])

    return {
      data: rows,
      total: countRow?.total ?? 0,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil((countRow?.total ?? 0) / limitNum),
    }
  })

  // POST /tickets
  const createSchema = z.object({
    subject:         z.string().min(1).max(500),
    body:            z.string().min(1),
    priority:        z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
    requester_email: z.string().email().optional(),
    requester_name:  z.string().optional(),
  })

  app.post('/tickets', { preHandler: requireAuth }, async (req: any, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: JSON.stringify(parsed.error.flatten().fieldErrors) })
    }
    const data = parsed.data

    // Resolve requester info
    const userRow = await queryOne<{ email: string; full_name: string; tenant_id: number | null }>(
      'SELECT email, full_name, tenant_id FROM users WHERE id = ?',
      [req.user.sub]
    )
    const requesterEmail = data.requester_email ?? userRow?.email ?? ''
    const requesterName  = data.requester_name  ?? userRow?.full_name ?? ''

    // Resolve tenant_id: use from user unless admin override provided
    let tenantId: number | null = userRow?.tenant_id ?? null
    if (req.user.role === 'tenant' && !tenantId) {
      const ucRow = await queryOne<{ tenant_id: number }>(
        'SELECT tenant_id FROM user_tenants WHERE user_id = ? LIMIT 1',
        [req.user.sub]
      )
      tenantId = ucRow?.tenant_id ?? null
    }

    const result = await execute(
      `INSERT INTO support_tickets (subject, priority, requester_email, requester_name, tenant_id, source)
       VALUES (?, ?, ?, ?, ?, 'web')`,
      [data.subject, data.priority, requesterEmail, requesterName, tenantId]
    )
    const ticketId = result.insertId

    const msgResult = await execute(
      `INSERT INTO ticket_messages (ticket_id, author_user_id, author_name, author_email, body, source)
       VALUES (?, ?, ?, ?, ?, 'web')`,
      [ticketId, req.user.sub, requesterName, requesterEmail, data.body]
    )

    broadcast({ type: 'ticket_created', ticketId })

    if (requesterEmail) {
      await queueMail(requesterEmail, 'ticket_created', {
        ticketId,
        subject: data.subject,
        requesterName,
        portalUrl: process.env.APP_PUBLIC_URL ?? '',
      })
    }

    // Notify all admins
    const admins = await query<{ email: string }>(`SELECT email FROM users WHERE role = 'admin'`)
    for (const admin of admins) {
      await queueMail(admin.email, 'ticket_new_admin', {
        ticketId,
        subject: data.subject,
        requesterName,
        requesterEmail,
        priority: data.priority,
        source: 'web',
        portalUrl: process.env.APP_PUBLIC_URL ?? '',
      })
    }

    return reply.status(201).send({ id: ticketId, messageId: msgResult.insertId, subject: data.subject, status: 'open', priority: data.priority })
  })

  // GET /tickets/:id
  app.get<{ Params: { id: string } }>('/tickets/:id', { preHandler: requireAuth }, async (req: any, reply) => {
    const id = Number(req.params.id)

    const ticket = await queryOne<any>(
      `SELECT t.*, u.full_name AS assigned_to_name
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = ?`,
      [id]
    )
    if (!ticket) return reply.status(404).send({ code: 'NOT_FOUND' })

    // RBAC: tenants may only see their own tickets
    if (!isStaff(req.user.role)) {
      const userRow = await queryOne<{ email: string }>(
        'SELECT email FROM users WHERE id = ?', [req.user.sub]
      )
      const userEmail = userRow?.email ?? ''
      const isOwned = ticket.requester_email === userEmail || await queryOne(
        'SELECT 1 FROM user_tenants WHERE user_id = ? AND tenant_id = ?',
        [req.user.sub, ticket.tenant_id]
      )
      if (!isOwned) return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const internalFilter = isStaff(req.user.role) ? '' : 'AND m.is_internal = 0'
    const messages = await query(
      `SELECT m.id, m.ticket_id, m.author_user_id, m.author_name, m.author_email,
              m.body, m.is_internal, m.source, m.created_at
       FROM ticket_messages m
       WHERE m.ticket_id = ? ${internalFilter}
       ORDER BY m.created_at ASC`,
      [id]
    )

    const attachments = await query<any>(
      `SELECT id, ticket_id, message_id, original_name, mime_type, size, created_by, created_at
       FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC`,
      [id]
    )
    const attByMsg: Record<number, any[]> = {}
    for (const a of attachments) {
      const mid = a.message_id ?? 0
      ;(attByMsg[mid] ??= []).push(a)
    }
    const messagesWithAtt = (messages as any[]).map(m => ({ ...m, attachments: attByMsg[m.id] ?? [] }))

    return { ...ticket, messages: messagesWithAtt }
  })

  // PUT /tickets/:id  (staff only)
  const updateSchema = z.object({
    status:      z.enum(['open', 'in_progress', 'waiting', 'closed']).optional(),
    priority:    z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    assigned_to: z.number().int().positive().nullable().optional(),
  })

  app.put<{ Params: { id: string } }>('/tickets/:id', { preHandler: requireOperatorOrAdmin }, async (req: any, reply) => {
    const id = Number(req.params.id)
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: JSON.stringify(parsed.error.flatten().fieldErrors) })
    }
    const data = parsed.data

    const ticket = await queryOne<any>(
      'SELECT id, subject, assigned_to, requester_email FROM support_tickets WHERE id = ?', [id]
    )
    if (!ticket) return reply.status(404).send({ code: 'NOT_FOUND' })

    const sets: string[] = []
    const params: unknown[] = []

    if (data.status      !== undefined) { sets.push('status = ?');      params.push(data.status) }
    if (data.priority    !== undefined) { sets.push('priority = ?');    params.push(data.priority) }
    if ('assigned_to' in data)          { sets.push('assigned_to = ?'); params.push(data.assigned_to) }

    if (sets.length === 0) return reply.status(400).send({ code: 'NO_CHANGES' })

    await execute(
      `UPDATE support_tickets SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`,
      [...params, id]
    )

    broadcast({ type: 'ticket_updated', ticketId: id })

    // Notify newly assigned staff member
    if ('assigned_to' in data && data.assigned_to && data.assigned_to !== ticket.assigned_to) {
      const assignee = await queryOne<{ email: string; full_name: string }>(
        'SELECT email, full_name FROM users WHERE id = ?', [data.assigned_to]
      )
      if (assignee) {
        await queueMail(assignee.email, 'ticket_assigned', {
          ticketId: id,
          subject: ticket.subject,
          requesterEmail: ticket.requester_email,
          priority: data.priority ?? 'normal',
          portalUrl: process.env.APP_PUBLIC_URL ?? '',
        })
      }
    }

    return { ok: true }
  })

  // POST /tickets/:id/messages
  const messageSchema = z.object({
    body:        z.string().min(1),
    is_internal: z.boolean().optional().default(false),
  })

  app.post<{ Params: { id: string } }>('/tickets/:id/messages', { preHandler: requireAuth }, async (req: any, reply) => {
    const id = Number(req.params.id)
    const parsed = messageSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: JSON.stringify(parsed.error.flatten().fieldErrors) })
    }
    const data = parsed.data

    if (data.is_internal && !isStaff(req.user.role)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const ticket = await queryOne<any>(
      'SELECT id, subject, requester_email FROM support_tickets WHERE id = ?', [id]
    )
    if (!ticket) return reply.status(404).send({ code: 'NOT_FOUND' })

    // RBAC check for tenants
    if (!isStaff(req.user.role)) {
      const userRow = await queryOne<{ email: string }>(
        'SELECT email FROM users WHERE id = ?', [req.user.sub]
      )
      const userEmail = userRow?.email ?? ''
      const isOwned = ticket.requester_email === userEmail || await queryOne(
        `SELECT 1 FROM user_tenants uc
         JOIN support_tickets t ON t.tenant_id = uc.tenant_id
         WHERE uc.user_id = ? AND t.id = ?`,
        [req.user.sub, id]
      )
      if (!isOwned) return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const userRow = await queryOne<{ email: string; full_name: string }>(
      'SELECT email, full_name FROM users WHERE id = ?', [req.user.sub]
    )

    const result = await execute(
      `INSERT INTO ticket_messages (ticket_id, author_user_id, author_name, author_email, body, is_internal, source)
       VALUES (?, ?, ?, ?, ?, ?, 'web')`,
      [id, req.user.sub, userRow?.full_name ?? '', userRow?.email ?? '', data.body, data.is_internal ? 1 : 0]
    )

    await execute('UPDATE support_tickets SET updated_at = NOW() WHERE id = ?', [id])
    broadcast({ type: 'ticket_message_added', ticketId: id })

    // Notify requester if this is a staff reply (not internal)
    if (!data.is_internal && isStaff(req.user.role) && ticket.requester_email) {
      await queueMail(ticket.requester_email, 'ticket_reply', {
        ticketId: id,
        subject: ticket.subject,
        staffName: userRow?.full_name ?? 'Support',
        messageBody: data.body,
        portalUrl: process.env.APP_PUBLIC_URL ?? '',
      })
    }

    return reply.status(201).send({ id: result.insertId })
  })

  // ── Attachment helpers ────────────────────────────────────────

  async function ticketAccessCheck(req: any, reply: any, ticketId: number): Promise<boolean> {
    const ticket = await queryOne<any>('SELECT id, requester_email, tenant_id FROM support_tickets WHERE id = ?', [ticketId])
    if (!ticket) { reply.status(404).send({ code: 'NOT_FOUND' }); return false }
    if (isStaff(req.user.role)) return true
    const userRow = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = ?', [req.user.sub])
    const userEmail = userRow?.email ?? ''
    const owned = ticket.requester_email === userEmail || await queryOne(
      'SELECT 1 FROM user_tenants WHERE user_id = ? AND tenant_id = ?',
      [req.user.sub, ticket.tenant_id]
    )
    if (!owned) { reply.status(403).send({ code: 'FORBIDDEN' }); return false }
    return true
  }

  // POST /tickets/:id/messages/:msgId/attachments
  app.post<{ Params: { id: string; msgId: string } }>(
    '/tickets/:id/messages/:msgId/attachments',
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const ticketId = Number(req.params.id)
      const msgId    = Number(req.params.msgId)
      if (!await ticketAccessCheck(req, reply, ticketId)) return

      // Verify message belongs to ticket
      const msg = await queryOne<{ id: number }>('SELECT id FROM ticket_messages WHERE id = ? AND ticket_id = ?', [msgId, ticketId])
      if (!msg) return reply.status(404).send({ code: 'NOT_FOUND' })

      const dir = path.join(UPLOAD_DIR, 'tickets', String(ticketId))
      await mkdir(dir, { recursive: true })

      const saved: any[] = []
      let fileCount = 0

      try {
        for await (const part of req.files()) {
          if (fileCount >= 20) { part.file.resume(); continue }
          fileCount++

          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk as Buffer)
          const buf = Buffer.concat(chunks)

          const ext      = path.extname(part.filename || '').slice(0, 16)
          const stored   = `${randomUUID()}${ext}`
          const filePath = path.join(dir, stored)
          await writeFile(filePath, buf)

          const result = await execute(
            `INSERT INTO ticket_attachments (ticket_id, message_id, filename, original_name, mime_type, size, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [ticketId, msgId, stored, part.filename || stored, part.mimetype || 'application/octet-stream', buf.length, req.user.sub]
          )
          saved.push({ id: result.insertId, original_name: part.filename, mime_type: part.mimetype, size: buf.length })
        }
      } catch (err: any) {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(413).send({ code: 'FILE_TOO_LARGE', message: 'Max file size is 20 MB' })
        }
        throw err
      }

      return reply.status(201).send(saved)
    }
  )

  // GET /tickets/:id/attachments
  app.get<{ Params: { id: string } }>('/tickets/:id/attachments', { preHandler: requireAuth }, async (req: any, reply) => {
    const ticketId = Number(req.params.id)
    if (!await ticketAccessCheck(req, reply, ticketId)) return
    const rows = await query(
      `SELECT id, ticket_id, message_id, original_name, mime_type, size, created_by, created_at
       FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC`,
      [ticketId]
    )
    return rows
  })

  // GET /tickets/:id/attachments/:fileId  (download)
  app.get<{ Params: { id: string; fileId: string } }>(
    '/tickets/:id/attachments/:fileId',
    { preHandler: requireAuth },
    async (req: any, reply) => {
      const ticketId = Number(req.params.id)
      const fileId   = Number(req.params.fileId)
      if (!await ticketAccessCheck(req, reply, ticketId)) return

      const att = await queryOne<any>(
        'SELECT filename, original_name, mime_type FROM ticket_attachments WHERE id = ? AND ticket_id = ?',
        [fileId, ticketId]
      )
      if (!att) return reply.status(404).send({ code: 'NOT_FOUND' })

      const filePath = path.join(UPLOAD_DIR, 'tickets', String(ticketId), att.filename)
      try {
        const s = await stat(filePath)
        reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.original_name)}`)
        reply.header('Content-Type', att.mime_type)
        reply.header('Content-Length', s.size)
        return reply.send(createReadStream(filePath))
      } catch {
        return reply.status(404).send({ code: 'FILE_NOT_FOUND' })
      }
    }
  )
}
