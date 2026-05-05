import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PoolConnection } from 'mysql2/promise.js'
import { query, queryOne, execute, transaction } from '../db.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'
import { reserveInvoiceNumber } from './numbering.js'
import { resolveTax, lineTaxRate, computeLineTax, type TaxMode } from './taxRules.js'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { join } from 'path'

const STORAGE_ROOT = process.env.INVOICE_STORAGE_DIR ?? '/storage/invoices'

// ── Validators ──────────────────────────────────────────────

const ItemBody = z.object({
  billing_item_id:  z.number().int().positive().nullable().optional(),
  position:         z.number().int().min(1).optional(),
  description:      z.string().min(1).max(500),
  period_start:     z.string().nullable().optional(),
  period_end:       z.string().nullable().optional(),
  quantity:         z.number().min(0).default(1),
  unit:             z.string().max(20).nullable().optional(),
  unit_price_cents: z.number().int(),                     // darf negativ (Storno)
  tax_rate_percent: z.number().min(0).max(100),
})

const CreateBody = z.object({
  tenant_id:        z.number().int().positive(),
  kind:             z.enum(['invoice','credit_note','dunning_invoice']).default('invoice'),
  service_period_start: z.string().nullable().optional(),
  service_period_end:   z.string().nullable().optional(),
  customer_notes:   z.string().nullable().optional(),
  notes:            z.string().nullable().optional(),
  postal_delivery:  z.boolean().optional(),
  items:            z.array(ItemBody).default([]),
  original_invoice_id: z.number().int().positive().nullable().optional(),
})

const PatchBody = z.object({
  customer_notes:   z.string().nullable().optional(),
  notes:            z.string().nullable().optional(),
  postal_delivery:  z.boolean().optional(),
  service_period_start: z.string().nullable().optional(),
  service_period_end:   z.string().nullable().optional(),
})

// ── Helpers ─────────────────────────────────────────────────

const INVOICE_COLS = `
  id, invoice_number, tenant_id, status, kind, original_invoice_id,
  invoice_date, service_period_start, service_period_end, due_date,
  currency, subtotal_cents, tax_total_cents, total_cents, paid_cents,
  tax_mode, tax_note,
  postal_delivery, postal_fee_cents, pdf_path, sent_at, sent_via,
  billing_address_snapshot, company_snapshot,
  created_by, cancelled_by, cancelled_at, cancellation_reason, notes, customer_notes,
  created_at, updated_at
`

const ITEM_COLS = `
  id, invoice_id, billing_item_id, position, description,
  period_start, period_end, quantity, unit, unit_price_cents, tax_rate_percent,
  line_subtotal_cents, line_tax_cents, line_total_cents
`

function tenantOwnerWhere(req: any): string {
  if (req.user.role === 'admin') return ''
  return ` AND tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ${Number(req.user.sub)})`
}

function isoOrNullDate(s?: string | null): string | null {
  if (!s) return null
  if (s.includes('T')) return s.slice(0, 19).replace('T', ' ')
  return s
}

interface ItemInput {
  billing_item_id?: number | null
  position?: number
  description: string
  period_start?: string | null
  period_end?: string | null
  quantity: number
  unit?: string | null
  unit_price_cents: number
  tax_rate_percent: number
}

interface ComputedLine {
  line_subtotal_cents: number
  line_tax_cents: number
  line_total_cents: number
}

function computeLine(qty: number, unit_cents: number, tax_pct: number): ComputedLine {
  // Hinweis: Standard-Branche rundet pro Position. Banker's Rounding nicht nötig.
  const subtotal = Math.round(qty * unit_cents)
  const tax = computeLineTax(subtotal, tax_pct)
  return { line_subtotal_cents: subtotal, line_tax_cents: tax, line_total_cents: subtotal + tax }
}

function sumTotals(lines: ComputedLine[]) {
  return {
    subtotal_cents:  lines.reduce((s, l) => s + l.line_subtotal_cents, 0),
    tax_total_cents: lines.reduce((s, l) => s + l.line_tax_cents, 0),
    total_cents:     lines.reduce((s, l) => s + l.line_total_cents, 0),
  }
}

async function recomputeTotals(invoiceId: number, conn: PoolConnection) {
  const [rows] = await conn.execute<any[]>(
    'SELECT line_subtotal_cents, line_tax_cents, line_total_cents FROM invoice_items WHERE invoice_id = ?',
    [invoiceId]
  )
  const totals = sumTotals(rows as ComputedLine[])
  await conn.execute(
    'UPDATE invoices SET subtotal_cents = ?, tax_total_cents = ?, total_cents = ? WHERE id = ?',
    [totals.subtotal_cents, totals.tax_total_cents, totals.total_cents, invoiceId]
  )
}

async function loadInvoiceFull(id: number) {
  const inv: any = await queryOne(`SELECT ${INVOICE_COLS} FROM invoices WHERE id = ?`, [id])
  if (!inv) return null
  const items = await query(`SELECT ${ITEM_COLS} FROM invoice_items WHERE invoice_id = ? ORDER BY position`, [id])
  return { ...inv, items }
}

// ── Issue (vergibt Nummer, snapshot, sets due_date) ─────────

export async function issueInvoiceTx(
  conn: PoolConnection,
  invoiceId: number,
  formatStr: string,
): Promise<{ invoice_number: string; due_date: string }> {
  // Idempotenz: nur Drafts können issued werden (atomarer Status-Wechsel
  // schützt vor Doppel-Issue).
  const [draftCheck] = await conn.execute<any[]>(
    "SELECT id, tenant_id FROM invoices WHERE id = ? AND status = 'draft' FOR UPDATE",
    [invoiceId]
  )
  if ((draftCheck as any[]).length === 0) {
    throw new Error('INVOICE_NOT_DRAFT')
  }
  const tenantId = (draftCheck as any[])[0].tenant_id

  // Tenant-Snapshot + Settings-Snapshot
  const [tenantRows] = await conn.execute<any[]>(
    `SELECT id, name, company_name, first_name, last_name, street, zip, city, country,
            email, billing_email, vat_id, tax_mode, tax_rate_percent_override,
            payment_terms_days_override, postal_delivery_default, invoice_locale
     FROM tenants WHERE id = ?`, [tenantId]
  )
  if ((tenantRows as any[]).length === 0) throw new Error('TENANT_GONE')
  const tenant = (tenantRows as any[])[0]

  const [settingsRows] = await conn.execute<any[]>('SELECT * FROM company_settings WHERE id = 1 FOR UPDATE')
  if ((settingsRows as any[]).length === 0) throw new Error('SETTINGS_MISSING')
  const settings = (settingsRows as any[])[0]

  const resolved = resolveTax({
    tax_mode: tenant.tax_mode as TaxMode,
    tax_rate_percent_override: tenant.tax_rate_percent_override,
    vat_id: tenant.vat_id,
    country: tenant.country,
  }, { default_tax_rate_percent: Number(settings.default_tax_rate_percent) })

  // Postal-Fee einfügen, falls postal_delivery=1 und noch nicht drauf
  const [invRow] = await conn.execute<any[]>(
    'SELECT postal_delivery, postal_fee_cents FROM invoices WHERE id = ?', [invoiceId]
  )
  const inv0 = (invRow as any[])[0]
  if (inv0.postal_delivery && inv0.postal_fee_cents === 0 && settings.postal_fee_cents > 0) {
    const fee = settings.postal_fee_cents
    const taxRate = resolved.mode === 'standard' ? Number(settings.default_tax_rate_percent) : 0
    const line = computeLine(1, fee, taxRate)
    const [maxPos] = await conn.execute<any[]>('SELECT COALESCE(MAX(position),0)+1 AS p FROM invoice_items WHERE invoice_id = ?', [invoiceId])
    await conn.execute(
      `INSERT INTO invoice_items (invoice_id, position, description, quantity, unit_price_cents, tax_rate_percent, line_subtotal_cents, line_tax_cents, line_total_cents)
       VALUES (?, ?, 'Postversand-Aufpreis', 1, ?, ?, ?, ?, ?)`,
      [invoiceId, (maxPos as any[])[0].p, fee, taxRate, line.line_subtotal_cents, line.line_tax_cents, line.line_total_cents]
    )
    await conn.execute('UPDATE invoices SET postal_fee_cents = ? WHERE id = ?', [fee, invoiceId])
  }

  // Steuersätze auf allen Positionen setzen (in Mode != standard alle auf 0).
  if (resolved.mode !== 'standard') {
    const [items] = await conn.execute<any[]>(
      'SELECT id, quantity, unit_price_cents FROM invoice_items WHERE invoice_id = ?', [invoiceId]
    )
    for (const it of items as any[]) {
      const line = computeLine(Number(it.quantity), it.unit_price_cents, 0)
      await conn.execute(
        `UPDATE invoice_items SET tax_rate_percent = 0, line_subtotal_cents = ?, line_tax_cents = ?, line_total_cents = ? WHERE id = ?`,
        [line.line_subtotal_cents, line.line_tax_cents, line.line_total_cents, it.id]
      )
    }
  }

  // Totals neu rechnen
  await recomputeTotals(invoiceId, conn)

  // Nummer + Datum
  const year = new Date().getUTCFullYear()
  const numbered = await reserveInvoiceNumber(conn, year, settings.invoice_number_format ?? '{year}-{seq:05d}')

  const today = new Date()
  const invoiceDate = today.toISOString().slice(0, 10)
  const paymentTerms = tenant.payment_terms_days_override ?? settings.default_payment_terms_days ?? 14
  const due = new Date(today.getTime() + paymentTerms * 86400_000).toISOString().slice(0, 10)

  const tenantSnapshot = {
    name: tenant.name,
    company_name: tenant.company_name,
    first_name: tenant.first_name,
    last_name: tenant.last_name,
    street: tenant.street,
    zip: tenant.zip,
    city: tenant.city,
    country: tenant.country,
    vat_id: tenant.vat_id,
    email: tenant.billing_email ?? tenant.email,
  }
  const companySnapshot = {
    company_name: settings.company_name,
    address_line1: settings.address_line1,
    address_line2: settings.address_line2,
    zip: settings.zip,
    city: settings.city,
    country: settings.country,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    tax_id: settings.tax_id,
    vat_id: settings.vat_id,
    commercial_register: settings.commercial_register,
    managing_director: settings.managing_director,
    bank_name: settings.bank_name,
    iban: settings.iban,
    bic: settings.bic,
    account_holder: settings.account_holder,
    invoice_footer_text: settings.invoice_footer_text,
  }

  await conn.execute(
    `UPDATE invoices SET
        invoice_number = ?, status = 'issued', invoice_date = ?, due_date = ?,
        tax_mode = ?, tax_note = ?,
        billing_address_snapshot = ?, company_snapshot = ?
     WHERE id = ?`,
    [numbered.number, invoiceDate, due,
     resolved.mode, resolved.note,
     JSON.stringify(tenantSnapshot), JSON.stringify(companySnapshot),
     invoiceId]
  )
  return { invoice_number: numbered.number, due_date: due }
}

// ── Routes ──────────────────────────────────────────────────

export async function billingInvoicesRoutes(app: FastifyInstance) {

  // GET /billing/invoices?tenant_id=&status=&from=&to=
  app.get('/billing/invoices', { preHandler: requireAuth }, async (req: any) => {
    const q = req.query as Record<string, string>
    const where: string[] = ['1=1']
    const params: any[] = []
    if (q.tenant_id) { where.push('tenant_id = ?'); params.push(Number(q.tenant_id)) }
    if (q.status)    { where.push('status = ?');    params.push(q.status) }
    if (q.kind)      { where.push('kind = ?');      params.push(q.kind) }
    if (q.from)      { where.push('invoice_date >= ?'); params.push(q.from) }
    if (q.to)        { where.push('invoice_date <= ?'); params.push(q.to) }
    return query(
      `SELECT ${INVOICE_COLS} FROM invoices
       WHERE ${where.join(' AND ')}${tenantOwnerWhere(req)}
       ORDER BY COALESCE(invoice_date, created_at) DESC, id DESC
       LIMIT 1000`,
      params
    )
  })

  // GET /billing/invoices/:id
  app.get<{ Params: { id: string } }>('/billing/invoices/:id', { preHandler: requireAuth }, async (req: any, reply) => {
    const inv = await loadInvoiceFull(Number(req.params.id))
    if (!inv) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (req.user.role !== 'admin') {
      const owned = await queryOne(
        'SELECT 1 FROM user_tenants WHERE user_id = ? AND tenant_id = ?',
        [req.user.sub, inv.tenant_id]
      )
      if (!owned) return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    return inv
  })

  // POST /billing/invoices  — neuer Draft
  app.post('/billing/invoices', { preHandler: requireAdmin }, async (req: any, reply) => {
    const body = CreateBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const result = await transaction(async (conn) => {
      // Snapshot fields werden erst beim Issuing gesetzt — hier Steuermodus aus Tenant
      // nur für initiale Berechnung der Zeilen.
      const [t] = await conn.execute<any[]>(
        'SELECT tax_mode, tax_rate_percent_override, vat_id, country FROM tenants WHERE id = ?',
        [body.data.tenant_id]
      )
      if ((t as any[]).length === 0) throw new Error('TENANT_NOT_FOUND')
      const [s] = await conn.execute<any[]>('SELECT default_tax_rate_percent FROM company_settings WHERE id = 1')
      const settings = { default_tax_rate_percent: Number((s as any[])[0]?.default_tax_rate_percent ?? 19) }
      const resolved = resolveTax((t as any[])[0], settings)

      const lines = body.data.items.map((it, idx) => {
        const taxPct = lineTaxRate(it.tax_rate_percent, resolved)
        const line = computeLine(it.quantity, it.unit_price_cents, taxPct)
        return { ...it, position: it.position ?? idx + 1, tax_rate_percent: taxPct, ...line }
      })
      const totals = sumTotals(lines)

      const [r] = await conn.execute<any>(
        `INSERT INTO invoices
           (tenant_id, status, kind, original_invoice_id,
            service_period_start, service_period_end,
            currency, subtotal_cents, tax_total_cents, total_cents,
            tax_mode, postal_delivery, postal_fee_cents,
            customer_notes, notes, created_by)
         VALUES (?, 'draft', ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          body.data.tenant_id, body.data.kind, body.data.original_invoice_id ?? null,
          isoOrNullDate(body.data.service_period_start), isoOrNullDate(body.data.service_period_end),
          totals.subtotal_cents, totals.tax_total_cents, totals.total_cents,
          resolved.mode, body.data.postal_delivery ? 1 : 0,
          body.data.customer_notes ?? null, body.data.notes ?? null, req.user.sub,
        ]
      )
      const newId = (r as any).insertId

      for (const line of lines) {
        await conn.execute(
          `INSERT INTO invoice_items
             (invoice_id, billing_item_id, position, description,
              period_start, period_end, quantity, unit, unit_price_cents, tax_rate_percent,
              line_subtotal_cents, line_tax_cents, line_total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId, line.billing_item_id ?? null, line.position, line.description,
            isoOrNullDate(line.period_start ?? null), isoOrNullDate(line.period_end ?? null),
            line.quantity, line.unit ?? null, line.unit_price_cents, line.tax_rate_percent,
            line.line_subtotal_cents, line.line_tax_cents, line.line_total_cents,
          ]
        )
      }
      return newId
    })

    const created = await loadInvoiceFull(result)
    await writeAuditLog({ req, entityType: 'invoice', entityId: result, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // PATCH /billing/invoices/:id — nur Drafts
  app.patch<{ Params: { id: string } }>('/billing/invoices/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
    const old = await queryOne<any>('SELECT * FROM invoices WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (old.status !== 'draft') return reply.status(409).send({ code: 'NOT_DRAFT', message: 'Nur Drafts editierbar.' })

    const body = PatchBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    await execute(
      `UPDATE invoices SET
        customer_notes = COALESCE(?, customer_notes),
        notes = COALESCE(?, notes),
        postal_delivery = COALESCE(?, postal_delivery),
        service_period_start = COALESCE(?, service_period_start),
        service_period_end = COALESCE(?, service_period_end)
       WHERE id = ?`,
      [
        body.data.customer_notes ?? null, body.data.notes ?? null,
        body.data.postal_delivery != null ? (body.data.postal_delivery ? 1 : 0) : null,
        body.data.service_period_start ? isoOrNullDate(body.data.service_period_start) : null,
        body.data.service_period_end ? isoOrNullDate(body.data.service_period_end) : null,
        req.params.id,
      ]
    )
    const updated = await loadInvoiceFull(Number(req.params.id))
    await writeAuditLog({ req, entityType: 'invoice', entityId: Number(req.params.id), action: 'update', oldValue: old, newValue: updated })
    return updated
  })

  // POST /billing/invoices/:id/items  — Position hinzufügen (Draft)
  app.post<{ Params: { id: string } }>('/billing/invoices/:id/items', { preHandler: requireAdmin }, async (req: any, reply) => {
    const inv = await queryOne<any>('SELECT id, status, tenant_id, tax_mode FROM invoices WHERE id = ?', [req.params.id])
    if (!inv) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (inv.status !== 'draft') return reply.status(409).send({ code: 'NOT_DRAFT' })

    const body = ItemBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const taxPct = inv.tax_mode === 'standard' ? body.data.tax_rate_percent : 0
    const line = computeLine(body.data.quantity, body.data.unit_price_cents, taxPct)

    const result = await transaction(async (conn) => {
      const [maxPos] = await conn.execute<any[]>('SELECT COALESCE(MAX(position),0)+1 AS p FROM invoice_items WHERE invoice_id = ?', [req.params.id])
      const pos = body.data.position ?? (maxPos as any[])[0].p
      const [r] = await conn.execute<any>(
        `INSERT INTO invoice_items
           (invoice_id, billing_item_id, position, description,
            period_start, period_end, quantity, unit, unit_price_cents, tax_rate_percent,
            line_subtotal_cents, line_tax_cents, line_total_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id, body.data.billing_item_id ?? null, pos, body.data.description,
          isoOrNullDate(body.data.period_start ?? null), isoOrNullDate(body.data.period_end ?? null),
          body.data.quantity, body.data.unit ?? null, body.data.unit_price_cents, taxPct,
          line.line_subtotal_cents, line.line_tax_cents, line.line_total_cents,
        ]
      )
      await recomputeTotals(Number(req.params.id), conn)
      return (r as any).insertId
    })

    const updated = await loadInvoiceFull(Number(req.params.id))
    await writeAuditLog({ req, entityType: 'invoice_item', entityId: result, action: 'create', newValue: updated })
    return reply.status(201).send(updated)
  })

  // DELETE /billing/invoices/:id/items/:itemId — Position entfernen (Draft)
  app.delete<{ Params: { id: string, itemId: string } }>(
    '/billing/invoices/:id/items/:itemId', { preHandler: requireAdmin }, async (req: any, reply) => {
    const inv = await queryOne<any>('SELECT id, status FROM invoices WHERE id = ?', [req.params.id])
    if (!inv) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (inv.status !== 'draft') return reply.status(409).send({ code: 'NOT_DRAFT' })

    await transaction(async (conn) => {
      await conn.execute('DELETE FROM invoice_items WHERE id = ? AND invoice_id = ?', [req.params.itemId, req.params.id])
      await recomputeTotals(Number(req.params.id), conn)
    })
    return loadInvoiceFull(Number(req.params.id))
  })

  // POST /billing/invoices/:id/issue
  app.post<{ Params: { id: string } }>('/billing/invoices/:id/issue', { preHandler: requireAdmin }, async (req: any, reply) => {
    try {
      const result = await transaction(async (conn) => {
        const [s] = await conn.execute<any[]>('SELECT invoice_number_format FROM company_settings WHERE id = 1')
        const fmt = (s as any[])[0]?.invoice_number_format ?? '{year}-{seq:05d}'
        return issueInvoiceTx(conn, Number(req.params.id), fmt)
      })
      const issued = await loadInvoiceFull(Number(req.params.id))
      await writeAuditLog({ req, entityType: 'invoice', entityId: Number(req.params.id), action: 'issue', newValue: issued })
      return { ...result, invoice: issued }
    } catch (err: any) {
      if (err.message === 'INVOICE_NOT_DRAFT') return reply.status(409).send({ code: 'NOT_DRAFT' })
      if (err.message === 'TENANT_GONE')       return reply.status(404).send({ code: 'TENANT_GONE' })
      if (err.message === 'SETTINGS_MISSING')  return reply.status(500).send({ code: 'SETTINGS_MISSING', message: 'company_settings ist leer.' })
      throw err
    }
  })

  // POST /billing/invoices/:id/cancel — erzeugt credit_note
  app.post<{ Params: { id: string } }>('/billing/invoices/:id/cancel', { preHandler: requireAdmin }, async (req: any, reply) => {
    const orig = await queryOne<any>('SELECT * FROM invoices WHERE id = ?', [req.params.id])
    if (!orig) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (orig.status === 'draft') {
      // Drafts werden hart gelöscht.
      await execute('DELETE FROM invoices WHERE id = ?', [req.params.id])
      await writeAuditLog({ req, entityType: 'invoice', entityId: Number(req.params.id), action: 'delete_draft', oldValue: orig })
      return { ok: true, hard_deleted: true }
    }
    if (orig.status === 'cancelled') return reply.status(409).send({ code: 'ALREADY_CANCELLED' })

    const reason = (req.body as any)?.reason ?? null
    const newId = await transaction(async (conn) => {
      // Storno-Rechnung als spiegelnde credit_note mit negativen Beträgen
      const [items] = await conn.execute<any[]>(
        `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position`,
        [req.params.id]
      )
      const [r] = await conn.execute<any>(
        `INSERT INTO invoices
           (tenant_id, status, kind, original_invoice_id,
            service_period_start, service_period_end,
            currency, subtotal_cents, tax_total_cents, total_cents,
            tax_mode, tax_note, postal_delivery, postal_fee_cents,
            customer_notes, notes, created_by)
         VALUES (?, 'draft', 'credit_note', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orig.tenant_id, orig.id,
          orig.service_period_start, orig.service_period_end, orig.currency,
          -orig.subtotal_cents, -orig.tax_total_cents, -orig.total_cents,
          orig.tax_mode, orig.tax_note, orig.postal_delivery, orig.postal_fee_cents,
          `Storno zu Rechnung ${orig.invoice_number}`, `Grund: ${reason ?? 'keine Angabe'}`,
          req.user.sub,
        ]
      )
      const creditId = (r as any).insertId
      for (const it of items as any[]) {
        await conn.execute(
          `INSERT INTO invoice_items
             (invoice_id, billing_item_id, position, description,
              period_start, period_end, quantity, unit, unit_price_cents, tax_rate_percent,
              line_subtotal_cents, line_tax_cents, line_total_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            creditId, it.billing_item_id, it.position, `Storno: ${it.description}`,
            it.period_start, it.period_end, it.quantity, it.unit,
            -it.unit_price_cents, it.tax_rate_percent,
            -it.line_subtotal_cents, -it.line_tax_cents, -it.line_total_cents,
          ]
        )
      }
      // Original markieren
      await conn.execute(
        `UPDATE invoices SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW(), cancellation_reason = ? WHERE id = ?`,
        [req.user.sub, reason, req.params.id]
      )
      return creditId
    })

    const credit = await loadInvoiceFull(newId)
    await writeAuditLog({ req, entityType: 'invoice', entityId: Number(req.params.id), action: 'cancel', oldValue: orig, newValue: credit })
    return reply.status(201).send({ ok: true, credit_note: credit })
  })

  // GET /billing/invoices/:id/pdf — Streamt das PDF.
  // Admin sieht alles, Tenant nur eigene. Wenn das PDF noch nicht generiert
  // wurde (Worker hat's noch nicht erfasst), kommt 425 Too Early zurück damit
  // das Frontend "Wird generiert..." anzeigen kann.
  app.get<{ Params: { id: string } }>('/billing/invoices/:id/pdf',
    { preHandler: requireAuth }, async (req: any, reply) => {
    const inv = await queryOne<any>(
      'SELECT id, tenant_id, invoice_number, pdf_path, kind FROM invoices WHERE id = ?',
      [req.params.id]
    )
    if (!inv) return reply.status(404).send({ code: 'NOT_FOUND' })

    if (req.user.role !== 'admin') {
      const owned = await queryOne(
        'SELECT 1 FROM user_tenants WHERE user_id = ? AND tenant_id = ?',
        [req.user.sub, inv.tenant_id]
      )
      if (!owned) return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    if (!inv.pdf_path) {
      // Worker hat noch nicht generiert — Frontend kann polling oder
      // manuellen Reload anbieten.
      return reply.status(425).send({ code: 'PDF_NOT_READY', message: 'PDF wird gerade erzeugt.' })
    }

    const absPath = join(STORAGE_ROOT, inv.pdf_path)
    try {
      await stat(absPath)
    } catch {
      return reply.status(410).send({ code: 'PDF_GONE', message: 'PDF-Datei nicht im Storage gefunden.' })
    }

    const kindLabel = inv.kind === 'credit_note' ? 'Gutschrift'
      : inv.kind === 'dunning_invoice' ? 'Mahnung'
      : 'Rechnung'
    const safeName = inv.invoice_number.replace(/[^A-Za-z0-9_\-]/g, '_')
    reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename="${kindLabel}_${safeName}.pdf"`)
    return reply.send(createReadStream(absPath))
  })
}
