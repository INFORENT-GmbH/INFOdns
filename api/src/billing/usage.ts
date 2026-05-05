import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

// ── Validators ──────────────────────────────────────────────

const UsageBody = z.object({
  billing_item_id: z.number().int().positive(),
  /** Optional: ISO 8601 oder "YYYY-MM-DD HH:MM:SS". Default = jetzt. */
  recorded_at:     z.string().optional(),
  quantity:        z.number(),                  // Sekunden, Requests, MB...
  metadata:        z.record(z.string(), z.any()).nullable().optional(),
})

function isoOrNow(s?: string | null): string {
  if (!s) {
    const d = new Date()
    return d.toISOString().slice(0, 23).replace('T', ' ')   // millisek-Genauigkeit
  }
  if (s.includes('T')) return s.slice(0, 23).replace('T', ' ')
  return s
}

// ── Routes ──────────────────────────────────────────────────

export async function billingUsageRoutes(app: FastifyInstance) {

  // POST /billing/usage  — Datenpunkt schreiben (admin oder Service-Token)
  app.post('/billing/usage', { preHandler: requireAdmin }, async (req: any, reply) => {
    const body = UsageBody.safeParse(req.body)
    if (!body.success) {
      const issues = body.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: issues.join('; ') })
    }

    const item = await queryOne<any>(
      `SELECT id, tenant_id, status, interval_unit
       FROM billing_items WHERE id = ?`, [body.data.billing_item_id]
    )
    if (!item) return reply.status(404).send({ code: 'ITEM_NOT_FOUND' })
    if (item.status !== 'active') {
      return reply.status(409).send({ code: 'ITEM_INACTIVE',
        message: `Item ist ${item.status} — Verbrauch wird nicht akzeptiert.` })
    }

    const result = await execute(
      `INSERT INTO usage_metrics (billing_item_id, recorded_at, quantity, metadata)
       VALUES (?, ?, ?, ?)`,
      [
        body.data.billing_item_id,
        isoOrNow(body.data.recorded_at),
        body.data.quantity,
        body.data.metadata != null ? JSON.stringify(body.data.metadata) : null,
      ]
    )
    const created = await queryOne(
      `SELECT id, billing_item_id,
              DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s.%f') AS recorded_at,
              quantity, metadata, consumed_invoice_id
       FROM usage_metrics WHERE id = ?`, [result.insertId]
    )
    await writeAuditLog({ req, entityType: 'usage_metric', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // GET /billing/items/:id/usage  — Historie eines Items
  app.get<{ Params: { id: string }, Querystring: { from?: string; to?: string; limit?: string } }>(
    '/billing/items/:id/usage', { preHandler: requireAdmin }, async (req) => {
    const { from, to, limit = '500' } = req.query
    const where: string[] = ['billing_item_id = ?']
    const params: any[] = [req.params.id]
    if (from) { where.push('recorded_at >= ?'); params.push(from) }
    if (to)   { where.push('recorded_at <= ?'); params.push(to) }
    params.push(Math.min(Number(limit) || 500, 5000))
    return query(
      `SELECT id, billing_item_id,
              DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') AS recorded_at,
              quantity, metadata, consumed_invoice_id
       FROM usage_metrics
       WHERE ${where.join(' AND ')}
       ORDER BY recorded_at DESC
       LIMIT ?`, params
    )
  })

  // GET /billing/items/:id/usage/summary  — Aggregate pro Monat (für Charts)
  app.get<{ Params: { id: string } }>('/billing/items/:id/usage/summary',
    { preHandler: requireAdmin }, async (req) => {
    return query(
      `SELECT DATE_FORMAT(recorded_at, '%Y-%m') AS bucket,
              SUM(quantity)                       AS total_quantity,
              COUNT(*)                            AS data_points,
              MAX(consumed_invoice_id)            AS sample_invoice_id,
              SUM(consumed_invoice_id IS NOT NULL) AS consumed_count
       FROM usage_metrics
       WHERE billing_item_id = ?
       GROUP BY bucket
       ORDER BY bucket DESC
       LIMIT 24`,
      [req.params.id]
    )
  })

  // DELETE /billing/usage/:id  — Datenpunkt löschen (nur falls nicht consumed)
  app.delete<{ Params: { id: string } }>('/billing/usage/:id',
    { preHandler: requireAdmin }, async (req: any, reply) => {
    const old = await queryOne<any>('SELECT * FROM usage_metrics WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (old.consumed_invoice_id) {
      return reply.status(409).send({
        code: 'ALREADY_BILLED',
        message: 'Datenpunkt wurde bereits in eine Rechnung übernommen — nicht mehr löschbar.',
      })
    }
    await execute('DELETE FROM usage_metrics WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'usage_metric', entityId: Number(req.params.id), action: 'delete', oldValue: old })
    return { ok: true }
  })
}
