import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PoolConnection } from 'mysql2/promise.js'
import { query, queryOne, execute, transaction } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

// ── Validators ──────────────────────────────────────────────

const PaymentBody = z.object({
  paid_at:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount_cents: z.number().int(),                                  // negativ = Rückbuchung
  method:       z.enum(['transfer','sepa','cash','card','manual','offset']).default('transfer'),
  reference:    z.string().max(255).nullable().optional(),
  notes:        z.string().nullable().optional(),
})

// ── Status-Logik ────────────────────────────────────────────

/**
 * Aktualisiert paid_cents + status anhand aller payments. Wird nach jeder
 * Buchung/Stornierung aufgerufen. Wenn Original storniert war, lassen wir den
 * Status (cancelled bleibt cancelled).
 */
export async function recalcPaymentStatus(invoiceId: number, conn: PoolConnection): Promise<void> {
  const [sums] = await conn.execute<any[]>(
    'SELECT COALESCE(SUM(amount_cents),0) AS paid FROM payments WHERE invoice_id = ?',
    [invoiceId]
  )
  const paid = Number((sums as any[])[0].paid ?? 0)

  const [invs] = await conn.execute<any[]>(
    'SELECT total_cents, status, due_date FROM invoices WHERE id = ?', [invoiceId]
  )
  if ((invs as any[]).length === 0) return
  const inv = (invs as any[])[0]

  if (inv.status === 'cancelled' || inv.status === 'draft' || inv.status === 'credit_note') {
    // Buchungen auf solche Rechnungen sind ungewöhnlich, aber paid_cents
    // pflegen wir trotzdem.
    await conn.execute('UPDATE invoices SET paid_cents = ? WHERE id = ?', [paid, invoiceId])
    return
  }

  let newStatus = inv.status
  if (paid >= inv.total_cents && inv.total_cents > 0) {
    newStatus = 'paid'
  } else if (paid > 0) {
    newStatus = 'partial'
  } else {
    // Nichts bezahlt — wenn überfällig: 'overdue', sonst zurück zum Issued/Sent.
    if (inv.due_date && new Date(inv.due_date) < new Date()) {
      newStatus = 'overdue'
    } else if (inv.status === 'paid' || inv.status === 'partial' || inv.status === 'overdue') {
      // Stornierte Zahlung → zurück auf 'sent'/'issued' je nachdem ob versendet
      // (sent_at gesetzt). Wir picken 'sent' als sinnvollen Default.
      newStatus = 'sent'
    }
  }

  await conn.execute(
    'UPDATE invoices SET paid_cents = ?, status = ? WHERE id = ?',
    [paid, newStatus, invoiceId]
  )
}

// ── Routes ──────────────────────────────────────────────────

export async function billingPaymentsRoutes(app: FastifyInstance) {

  // GET /billing/invoices/:id/payments
  app.get<{ Params: { id: string } }>('/billing/invoices/:id/payments',
    { preHandler: requireAdmin }, async (req: any) => {
    return query(
      `SELECT id, invoice_id, paid_at, amount_cents, method, reference, notes,
              created_by, created_at
       FROM payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC`,
      [req.params.id]
    )
  })

  // POST /billing/invoices/:id/payments
  app.post<{ Params: { id: string } }>('/billing/invoices/:id/payments',
    { preHandler: requireAdmin }, async (req: any, reply) => {
    const body = PaymentBody.safeParse(req.body)
    if (!body.success) {
      const issues = body.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: issues.join('; ') })
    }
    const inv = await queryOne<any>('SELECT id FROM invoices WHERE id = ?', [req.params.id])
    if (!inv) return reply.status(404).send({ code: 'NOT_FOUND' })

    const newId = await transaction(async (conn) => {
      const [r] = await conn.execute<any>(
        `INSERT INTO payments (invoice_id, paid_at, amount_cents, method, reference, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id, body.data.paid_at, body.data.amount_cents,
          body.data.method, body.data.reference ?? null, body.data.notes ?? null,
          req.user.sub,
        ]
      )
      const id = (r as any).insertId
      await recalcPaymentStatus(Number(req.params.id), conn)
      return id
    })

    const created = await queryOne(
      `SELECT id, invoice_id, paid_at, amount_cents, method, reference, notes, created_by, created_at
       FROM payments WHERE id = ?`, [newId]
    )
    await writeAuditLog({ req, entityType: 'payment', entityId: newId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // DELETE /billing/payments/:id — Storno einer Buchung (z.B. bei Tippfehler)
  app.delete<{ Params: { id: string } }>('/billing/payments/:id',
    { preHandler: requireAdmin }, async (req: any, reply) => {
    const old = await queryOne<any>('SELECT * FROM payments WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    await transaction(async (conn) => {
      await conn.execute('DELETE FROM payments WHERE id = ?', [req.params.id])
      await recalcPaymentStatus(old.invoice_id, conn)
    })
    await writeAuditLog({ req, entityType: 'payment', entityId: Number(req.params.id), action: 'delete', oldValue: old })
    return { ok: true }
  })

  // GET /billing/dunning/queue — überfällige Rechnungen mit aktueller Mahnstufe
  app.get('/billing/dunning/queue', { preHandler: requireAdmin }, async () => {
    return query(
      `SELECT i.id, i.invoice_number, i.tenant_id, i.total_cents, i.paid_cents,
              i.due_date, i.status, t.name AS tenant_name, t.dunning_paused,
              DATEDIFF(CURDATE(), i.due_date) AS days_overdue,
              (SELECT COALESCE(MAX(level),-1) FROM dunning_log WHERE invoice_id = i.id) AS last_level
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       WHERE i.status IN ('issued','sent','partial','overdue')
         AND i.due_date < CURDATE()
         AND i.kind = 'invoice'
       ORDER BY i.due_date ASC`
    )
  })

  // GET /billing/postal/queue — Rechnungen mit Postversand, noch nicht gedruckt
  app.get('/billing/postal/queue', { preHandler: requireAdmin }, async () => {
    return query(
      `SELECT i.id, i.invoice_number, i.tenant_id, i.invoice_date, i.due_date,
              i.total_cents, i.pdf_path, t.name AS tenant_name
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       WHERE i.postal_delivery = 1 AND i.sent_at IS NULL AND i.status != 'draft'
       ORDER BY i.invoice_date ASC`
    )
  })

  // POST /billing/invoices/:id/mark-printed — Postversand bestätigen
  app.post<{ Params: { id: string } }>('/billing/invoices/:id/mark-printed',
    { preHandler: requireAdmin }, async (req: any, reply) => {
    const inv = await queryOne<any>('SELECT id, postal_delivery, sent_at FROM invoices WHERE id = ?', [req.params.id])
    if (!inv) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!inv.postal_delivery) return reply.status(409).send({ code: 'NOT_POSTAL', message: 'Diese Rechnung ist nicht für Postversand markiert.' })
    if (inv.sent_at)         return reply.status(409).send({ code: 'ALREADY_SENT' })

    await execute(
      `UPDATE invoices SET sent_at = NOW(), sent_via = 'postal', status = 'sent' WHERE id = ?`,
      [req.params.id]
    )
    await writeAuditLog({ req, entityType: 'invoice', entityId: Number(req.params.id), action: 'mark_printed' })
    const updated = await queryOne('SELECT * FROM invoices WHERE id = ?', [req.params.id])
    return updated
  })
}
