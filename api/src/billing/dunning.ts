import { FastifyInstance } from 'fastify'
import type { PoolConnection } from 'mysql2/promise.js'
import { query, queryOne, execute, transaction } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'
import { reserveInvoiceNumber } from './numbering.js'
import { resolveTax, computeLineTax, type TaxMode } from './taxRules.js'

interface DunningLevel {
  level: number
  label: string
  days_after_due: number
  fee_cents: number
  template_key: string
}

/**
 * Eskaliert eine überfällige Rechnung um eine Mahnstufe. Stufe 0 (Erinnerung)
 * ist gebührenfrei: nur Eintrag in dunning_log + Mail im Worker. Stufe ≥ 1
 * erzeugt eine eigenständige `dunning_invoice` mit Mahngebühr und neuer
 * Rechnungsnummer (Variante B aus dem Plan — sauberer als die Original-
 * Rechnung nachträglich zu manipulieren).
 *
 * Idempotent über UNIQUE KEY (invoice_id, level) auf dunning_log — doppeltes
 * Auslösen derselben Stufe wirft DUP_ENTRY und der Caller fängt das ab.
 */
export async function escalateDunning(
  invoiceId: number,
  levelToApply: number | null,
  createdBy: number,
  conn: PoolConnection,
): Promise<{ level: number; dunning_invoice_id: number | null }> {
  // Original laden
  const [invs] = await conn.execute<any[]>(
    `SELECT * FROM invoices WHERE id = ? FOR UPDATE`, [invoiceId]
  )
  if ((invs as any[]).length === 0) throw new Error('INVOICE_NOT_FOUND')
  const orig = (invs as any[])[0]
  if (orig.kind !== 'invoice') throw new Error('NOT_DUNNABLE_KIND')
  if (!['issued','sent','partial','overdue'].includes(orig.status)) {
    throw new Error('NOT_OPEN')
  }

  // Tenant pause-flag
  const [tenants] = await conn.execute<any[]>(
    'SELECT dunning_paused FROM tenants WHERE id = ?', [orig.tenant_id]
  )
  if ((tenants as any[]).length > 0 && (tenants as any[])[0].dunning_paused) {
    throw new Error('TENANT_PAUSED')
  }

  // Aktuelle / nächste Stufe ermitteln
  const [logRows] = await conn.execute<any[]>(
    'SELECT MAX(level) AS max_level FROM dunning_log WHERE invoice_id = ?',
    [invoiceId]
  )
  const lastLevel = (logRows as any[])[0]?.max_level ?? null
  const nextLevel = levelToApply ?? (lastLevel == null ? 0 : lastLevel + 1)

  if (lastLevel != null && nextLevel <= lastLevel) {
    throw new Error('LEVEL_ALREADY_SENT')
  }

  // Stufenkonfig holen
  const [lvlRows] = await conn.execute<any[]>(
    'SELECT level, label, days_after_due, fee_cents, template_key FROM dunning_levels WHERE level = ?',
    [nextLevel]
  )
  if ((lvlRows as any[]).length === 0) throw new Error('NO_SUCH_LEVEL')
  const cfg = (lvlRows as any[])[0] as DunningLevel

  let dunningInvoiceId: number | null = null

  if (cfg.fee_cents > 0) {
    // Eigene dunning_invoice anlegen + sofort issuen.
    // Steuersatz aus Original-Tax-Mode übernehmen damit Reverse-Charge etc. greift.
    const [setRows] = await conn.execute<any[]>('SELECT * FROM company_settings WHERE id = 1 FOR UPDATE')
    if ((setRows as any[]).length === 0) throw new Error('SETTINGS_MISSING')
    const settings = (setRows as any[])[0]

    const resolved = resolveTax(
      { tax_mode: orig.tax_mode as TaxMode, tax_rate_percent_override: null, vat_id: null, country: null },
      { default_tax_rate_percent: Number(settings.default_tax_rate_percent) }
    )
    const taxRate = resolved.mode === 'standard' ? Number(settings.default_tax_rate_percent) : 0
    const subtotal = cfg.fee_cents
    const taxCents = computeLineTax(subtotal, taxRate)
    const total    = subtotal + taxCents

    const year = new Date().getUTCFullYear()
    const numbered = await reserveInvoiceNumber(conn, year, settings.invoice_number_format ?? '{year}-{seq:05d}')
    const today = new Date().toISOString().slice(0, 10)
    const paymentTerms = Number(settings.default_payment_terms_days ?? 14)
    const due = new Date(Date.now() + paymentTerms * 86400_000).toISOString().slice(0, 10)

    const [r] = await conn.execute<any>(
      `INSERT INTO invoices
         (tenant_id, invoice_number, status, kind, original_invoice_id,
          invoice_date, due_date, currency,
          subtotal_cents, tax_total_cents, total_cents,
          tax_mode, tax_note,
          billing_address_snapshot, company_snapshot,
          created_by, customer_notes)
       VALUES (?, ?, 'issued', 'dunning_invoice', ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orig.tenant_id, numbered.number, orig.id,
        today, due, orig.currency,
        subtotal, taxCents, total,
        orig.tax_mode, resolved.note,
        orig.billing_address_snapshot, orig.company_snapshot,
        createdBy,
        `${cfg.label} zu Rechnung ${orig.invoice_number}`,
      ]
    )
    dunningInvoiceId = (r as any).insertId

    await conn.execute(
      `INSERT INTO invoice_items
         (invoice_id, position, description,
          quantity, unit_price_cents, tax_rate_percent,
          line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, 1, ?, 1, ?, ?, ?, ?, ?)`,
      [
        dunningInvoiceId,
        `${cfg.label} zu Rechnung ${orig.invoice_number}`,
        subtotal, taxRate, subtotal, taxCents, total,
      ]
    )
  }

  // dunning_log Eintrag — UNIQUE-Key schützt vor Doppelmahnung
  await conn.execute(
    `INSERT INTO dunning_log (invoice_id, level, fee_added_cents) VALUES (?, ?, ?)`,
    [invoiceId, nextLevel, cfg.fee_cents]
  )

  // Original auf overdue, falls noch nicht
  if (orig.status === 'issued' || orig.status === 'sent') {
    await conn.execute("UPDATE invoices SET status = 'overdue' WHERE id = ?", [invoiceId])
  }

  return { level: nextLevel, dunning_invoice_id: dunningInvoiceId }
}

// ── Routes ──────────────────────────────────────────────────

export async function billingDunningRoutes(app: FastifyInstance) {
  // POST /billing/invoices/:id/dunning  — manuell nächste Mahnstufe auslösen
  app.post<{ Params: { id: string }, Body?: { level?: number } }>(
    '/billing/invoices/:id/dunning',
    { preHandler: requireAdmin }, async (req: any, reply) => {
    try {
      const result = await transaction(async (conn) => {
        return escalateDunning(
          Number(req.params.id),
          (req.body as any)?.level ?? null,
          req.user.sub,
          conn,
        )
      })
      const orig = await queryOne('SELECT * FROM invoices WHERE id = ?', [req.params.id])
      const dunningInv = result.dunning_invoice_id
        ? await queryOne('SELECT * FROM invoices WHERE id = ?', [result.dunning_invoice_id])
        : null
      await writeAuditLog({ req, entityType: 'invoice', entityId: Number(req.params.id), action: `dunning_level_${result.level}`, newValue: dunningInv })
      return { ok: true, level: result.level, dunning_invoice: dunningInv, original: orig }
    } catch (err: any) {
      const map: Record<string, [number, string]> = {
        INVOICE_NOT_FOUND:    [404, 'NOT_FOUND'],
        NOT_DUNNABLE_KIND:    [409, 'NOT_DUNNABLE'],
        NOT_OPEN:             [409, 'NOT_OPEN'],
        TENANT_PAUSED:        [409, 'TENANT_DUNNING_PAUSED'],
        LEVEL_ALREADY_SENT:   [409, 'LEVEL_ALREADY_SENT'],
        NO_SUCH_LEVEL:        [404, 'NO_SUCH_LEVEL'],
        SETTINGS_MISSING:     [500, 'SETTINGS_MISSING'],
      }
      const [status, code] = map[err.message] ?? [500, 'INTERNAL']
      if (err.code === 'ER_DUP_ENTRY') return reply.status(409).send({ code: 'LEVEL_ALREADY_SENT' })
      return reply.status(status).send({ code, message: err.message })
    }
  })

  // GET /billing/invoices/:id/dunning — Mahn-Historie
  app.get<{ Params: { id: string } }>('/billing/invoices/:id/dunning',
    { preHandler: requireAdmin }, async (req: any) => {
    return query(
      `SELECT dl.id, dl.level, dl.sent_at, dl.fee_added_cents, dl.mail_queue_id,
              dl.pdf_path, l.label, l.template_key
       FROM dunning_log dl
       LEFT JOIN dunning_levels l ON l.level = dl.level
       WHERE dl.invoice_id = ? ORDER BY dl.level ASC`,
      [req.params.id]
    )
  })
}

// Re-export for worker (gleicher Code-Pfad, Worker importiert nicht aus api/)
export { reserveInvoiceNumber }
