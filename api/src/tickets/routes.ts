import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAuth, requireOperatorOrAdmin } from '../middleware/auth.js'
import { broadcast } from '../ws/hub.js'

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

// Build the WHERE clause for customer-role ticket scoping
function customerFilter(userId: number, email: string): { clause: string; params: unknown[] } {
  return {
    clause: `(t.requester_email = ? OR t.customer_id IN (
               SELECT customer_id FROM user_customers WHERE user_id = ?
             ))`,
    params: [email, userId],
  }
}

// ── Route plugin ─────────────────────────────────────────────

export async function ticketRoutes(app: FastifyInstance) {

  // GET /tickets
  app.get('/tickets', { preHandler: requireAuth }, async (req: any) => {
    const { status, priority, assigned_to, customer_id, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum  = Math.max(1, Number(page))
    const limitNum = Math.min(200, Math.max(1, Number(limit)))
    const offset   = (pageNum - 1) * limitNum

    const clauses: string[] = []
    const params: unknown[] = []

    if (!isStaff(req.user.role)) {
      const userRow = await queryOne<{ email: string }>('SELECT email FROM users WHERE id = ?', [req.user.sub])
      const f = customerFilter(req.user.sub, userRow?.email ?? '')
      clauses.push(f.clause)
      params.push(...f.params)
    }

    if (status)      { clauses.push('t.status = ?');      params.push(status) }
    if (priority)    { clauses.push('t.priority = ?');    params.push(priority) }
    if (assigned_to) { clauses.push('t.assigned_to = ?'); params.push(Number(assigned_to)) }
    if (customer_id) { clauses.push('t.customer_id = ?'); params.push(Number(customer_id)) }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [rows, countRow] = await Promise.all([
      query(
        `SELECT t.id, t.subject, t.status, t.priority, t.requester_email, t.requester_name,
                t.customer_id, t.assigned_to, u.full_name AS assigned_to_name,
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
    const userRow = await queryOne<{ email: string; full_name: string; customer_id: number | null }>(
      'SELECT email, full_name, customer_id FROM users WHERE id = ?',
      [req.user.sub]
    )
    const requesterEmail = data.requester_email ?? userRow?.email ?? ''
    const requesterName  = data.requester_name  ?? userRow?.full_name ?? ''

    // Resolve customer_id: use from user unless admin override provided
    let customerId: number | null = userRow?.customer_id ?? null
    if (req.user.role === 'customer' && !customerId) {
      const ucRow = await queryOne<{ customer_id: number }>(
        'SELECT customer_id FROM user_customers WHERE user_id = ? LIMIT 1',
        [req.user.sub]
      )
      customerId = ucRow?.customer_id ?? null
    }

    const result = await execute(
      `INSERT INTO support_tickets (subject, priority, requester_email, requester_name, customer_id, source)
       VALUES (?, ?, ?, ?, ?, 'web')`,
      [data.subject, data.priority, requesterEmail, requesterName, customerId]
    )
    const ticketId = result.insertId

    await execute(
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

    return reply.status(201).send({ id: ticketId, subject: data.subject, status: 'open', priority: data.priority })
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

    // RBAC: customers may only see their own tickets
    if (!isStaff(req.user.role)) {
      const userRow = await queryOne<{ email: string }>(
        'SELECT email FROM users WHERE id = ?', [req.user.sub]
      )
      const userEmail = userRow?.email ?? ''
      const isOwned = ticket.requester_email === userEmail || await queryOne(
        'SELECT 1 FROM user_customers WHERE user_id = ? AND customer_id = ?',
        [req.user.sub, ticket.customer_id]
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

    return { ...ticket, messages }
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

    // RBAC check for customers
    if (!isStaff(req.user.role)) {
      const userRow = await queryOne<{ email: string }>(
        'SELECT email FROM users WHERE id = ?', [req.user.sub]
      )
      const userEmail = userRow?.email ?? ''
      const isOwned = ticket.requester_email === userEmail || await queryOne(
        `SELECT 1 FROM user_customers uc
         JOIN support_tickets t ON t.customer_id = uc.customer_id
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
}
