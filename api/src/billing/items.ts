import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PoolConnection } from 'mysql2/promise.js'
import { query, queryOne, execute } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'
import { computeNextDueAt } from './nextDue.js'

// ── Validators ──────────────────────────────────────────────

const IntervalUnit = z.enum([
  'second','minute','hour','day','week','month','year','lifetime',
])
const ItemType = z.enum(['domain','dnssec','mail_forward','manual','usage'])
const Status = z.enum(['active','paused','cancelled'])

const ItemBody = z.object({
  tenant_id:            z.number().int().positive(),
  item_type:            ItemType,
  ref_table:            z.string().max(64).nullable().optional(),
  ref_id:               z.number().int().positive().nullable().optional(),
  description:          z.string().min(1).max(500),
  description_template: z.string().max(500).nullable().optional(),
  unit_price_cents:     z.number().int().min(0),
  tax_rate_percent:     z.number().min(0).max(100).nullable().optional(),
  currency:             z.string().length(3).default('EUR'),
  interval_unit:        IntervalUnit,
  interval_count:       z.number().int().min(1).default(1),
  started_at:           z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/))
                         .optional(),
  ends_at:              z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/))
                         .nullable().optional(),
  status:               Status.default('active'),
  notes:                z.string().nullable().optional(),
})

const PatchBody = ItemBody.partial()

// ── Helpers ─────────────────────────────────────────────────

const SELECT_COLS = `
  id, tenant_id, item_type, ref_table, ref_id, description, description_template,
  unit_price_cents, tax_rate_percent, currency,
  interval_unit, interval_count,
  started_at, ends_at, last_billed_until, next_due_at, status,
  notes, created_by, created_at, updated_at
`

function isoOrNow(dt?: string | null): string {
  if (!dt) return new Date().toISOString().slice(0, 19).replace('T', ' ')
  // Accept both ISO 8601 and "YYYY-MM-DD HH:MM:SS"
  if (dt.includes('T')) return dt.slice(0, 19).replace('T', ' ')
  return dt
}

function ownerWhere(req: any, alias = ''): string {
  const a = alias ? `${alias}.` : ''
  if (req.user.role === 'admin') return ''
  return ` AND ${a}tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ${Number(req.user.sub)})`
}

// ── Public helper used from domains/routes.ts ───────────────

interface CreateForDomainArgs {
  domainId: number
  tenantId: number
  fqdn: string
  createdBy: number
  conn?: PoolConnection
}

/**
 * Creates a default annual `billing_items` row for a freshly inserted domain.
 * Price is taken from `tld_pricing.cost` for the longest matching TLD suffix
 * (e.g. "co.uk" before "uk"), plus the domain's `add_fee` if set. If no price
 * is found we still create the row with 0 cents so the admin can fill it in.
 */
export async function createBillingItemForDomain(args: CreateForDomainArgs): Promise<number | null> {
  const { domainId, tenantId, fqdn, createdBy, conn } = args
  const exec = conn ? conn.execute.bind(conn) : (sql: string, p?: unknown[]) => execute(sql, p)
  const sel = conn
    ? async (sql: string, p?: unknown[]) => { const [r] = await conn.execute<any[]>(sql, p as any); return r as any[] }
    : async (sql: string, p?: unknown[]) => query<any>(sql, p)

  // Idempotent: skip if there is already an item linked to this domain.
  const existing = await sel(
    "SELECT id FROM billing_items WHERE ref_table = 'domains' AND ref_id = ? LIMIT 1",
    [domainId]
  )
  if (existing.length > 0) return existing[0].id

  // TLD lookup: longest suffix wins.
  const parts = fqdn.split('.')
  let tldCost = 0
  for (let i = 1; i < parts.length; i++) {
    const zone = parts.slice(i).join('.')
    const rows = await sel(
      'SELECT cost FROM tld_pricing WHERE zone = ?', [zone]
    )
    if (rows.length > 0 && rows[0].cost != null) {
      tldCost = Number(rows[0].cost)
      break
    }
  }

  // Domain-level add_fee on top of TLD cost.
  const dom = await sel('SELECT add_fee FROM domains WHERE id = ?', [domainId])
  const addFee = dom.length > 0 && dom[0].add_fee != null ? Number(dom[0].add_fee) : 0

  const unitPriceCents = Math.round((tldCost + addFee) * 100)
  const startedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const nextDueAt = computeNextDueAt(startedAt, 'year', 1)

  const result: any = await exec(
    `INSERT INTO billing_items
       (tenant_id, item_type, ref_table, ref_id, description, description_template,
        unit_price_cents, currency, interval_unit, interval_count,
        started_at, next_due_at, status, created_by)
     VALUES (?, 'domain', 'domains', ?, ?, ?, ?, 'EUR', 'year', 1, ?, ?, 'active', ?)`,
    [
      tenantId, domainId, `Domain ${fqdn}`,
      'Domain {fqdn} ({period_start} – {period_end})',
      unitPriceCents, startedAt, nextDueAt, createdBy,
    ]
  )
  // mysql2 returns [ResultSetHeader, fields] when via conn.execute, just ResultSetHeader from execute()
  return Array.isArray(result) ? (result[0] as any).insertId : result.insertId
}

/**
 * Marks the matching billing_item as cancelled when a domain is soft-deleted.
 * The pro-rated final invoice is generated by the next billingPoller run.
 */
export async function endBillingItemForDomain(domainId: number, deletedAt: string | Date): Promise<void> {
  const ts = typeof deletedAt === 'string' ? deletedAt : deletedAt.toISOString().slice(0, 19).replace('T', ' ')
  await execute(
    `UPDATE billing_items
     SET ends_at = COALESCE(ends_at, ?), status = IF(status = 'active', 'cancelled', status)
     WHERE ref_table = 'domains' AND ref_id = ?`,
    [ts, domainId]
  )
}

/** Re-activates the billing_item when a domain is restored within the purge window. */
export async function restoreBillingItemForDomain(domainId: number): Promise<void> {
  await execute(
    `UPDATE billing_items
     SET ends_at = NULL, status = 'active'
     WHERE ref_table = 'domains' AND ref_id = ?`,
    [domainId]
  )
}

// ── Routes ──────────────────────────────────────────────────

export async function billingItemsRoutes(app: FastifyInstance) {
  // GET /billing/items?tenant_id=&status=&item_type=
  app.get('/billing/items', { preHandler: requireAdmin }, async (req: any) => {
    const q = req.query as Record<string, string>
    const where: string[] = ['1=1']
    const params: any[] = []
    if (q.tenant_id) { where.push('tenant_id = ?'); params.push(Number(q.tenant_id)) }
    if (q.status)    { where.push('status = ?');    params.push(q.status) }
    if (q.item_type) { where.push('item_type = ?'); params.push(q.item_type) }
    if (q.ref_table) { where.push('ref_table = ?'); params.push(q.ref_table) }
    if (q.ref_id)    { where.push('ref_id = ?');    params.push(Number(q.ref_id)) }
    return query(
      `SELECT ${SELECT_COLS} FROM billing_items
       WHERE ${where.join(' AND ')}${ownerWhere(req)}
       ORDER BY status, tenant_id, id DESC`,
      params
    )
  })

  // GET /billing/items/:id
  app.get<{ Params: { id: string } }>('/billing/items/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
    const row = await queryOne(`SELECT ${SELECT_COLS} FROM billing_items WHERE id = ?${ownerWhere(req)}`, [req.params.id])
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    return row
  })

  // POST /billing/items
  app.post('/billing/items', { preHandler: requireAdmin }, async (req: any, reply) => {
    const body = ItemBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const startedAt = isoOrNow(body.data.started_at)
    const nextDueAt = body.data.interval_unit === 'lifetime'
      ? startedAt
      : computeNextDueAt(startedAt, body.data.interval_unit, body.data.interval_count)

    const result = await execute(
      `INSERT INTO billing_items
         (tenant_id, item_type, ref_table, ref_id, description, description_template,
          unit_price_cents, tax_rate_percent, currency,
          interval_unit, interval_count,
          started_at, ends_at, next_due_at, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.data.tenant_id, body.data.item_type,
        body.data.ref_table ?? null, body.data.ref_id ?? null,
        body.data.description, body.data.description_template ?? null,
        body.data.unit_price_cents, body.data.tax_rate_percent ?? null, body.data.currency,
        body.data.interval_unit, body.data.interval_count,
        startedAt, body.data.ends_at ?? null, nextDueAt, body.data.status,
        body.data.notes ?? null, req.user.sub,
      ]
    )
    const created = await queryOne(`SELECT ${SELECT_COLS} FROM billing_items WHERE id = ?`, [result.insertId])
    await writeAuditLog({ req, entityType: 'billing_item', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // PATCH /billing/items/:id
  app.patch<{ Params: { id: string } }>('/billing/items/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
    const old = await queryOne<any>('SELECT * FROM billing_items WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = PatchBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const f = body.data
    // If interval changed, recompute next_due_at from last_billed_until OR started_at.
    let nextDueAt: string | null | undefined = undefined
    const newUnit = f.interval_unit ?? old.interval_unit
    const newCount = f.interval_count ?? old.interval_count
    if (f.interval_unit != null || f.interval_count != null) {
      const anchor = old.last_billed_until
        ? new Date(old.last_billed_until).toISOString().slice(0, 19).replace('T', ' ')
        : (f.started_at ?? new Date(old.started_at).toISOString().slice(0, 19).replace('T', ' '))
      nextDueAt = newUnit === 'lifetime' ? anchor : computeNextDueAt(anchor, newUnit, newCount)
    }

    await execute(
      `UPDATE billing_items SET
        item_type = COALESCE(?, item_type),
        description = COALESCE(?, description),
        description_template = COALESCE(?, description_template),
        unit_price_cents = COALESCE(?, unit_price_cents),
        tax_rate_percent = COALESCE(?, tax_rate_percent),
        currency = COALESCE(?, currency),
        interval_unit = COALESCE(?, interval_unit),
        interval_count = COALESCE(?, interval_count),
        started_at = COALESCE(?, started_at),
        ends_at = COALESCE(?, ends_at),
        next_due_at = COALESCE(?, next_due_at),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
       WHERE id = ?`,
      [
        f.item_type ?? null,
        f.description ?? null, f.description_template ?? null,
        f.unit_price_cents ?? null, f.tax_rate_percent ?? null, f.currency ?? null,
        f.interval_unit ?? null, f.interval_count ?? null,
        f.started_at ? isoOrNow(f.started_at) : null,
        f.ends_at !== undefined ? (f.ends_at ? isoOrNow(f.ends_at) : null) : null,
        nextDueAt ?? null,
        f.status ?? null, f.notes ?? null,
        req.params.id,
      ]
    )
    const updated = await queryOne(`SELECT ${SELECT_COLS} FROM billing_items WHERE id = ?`, [req.params.id])
    await writeAuditLog({ req, entityType: 'billing_item', entityId: Number(req.params.id), action: 'update', oldValue: old, newValue: updated })
    return updated
  })

  // DELETE /billing/items/:id  — only if never billed
  app.delete<{ Params: { id: string } }>('/billing/items/:id', { preHandler: requireAdmin }, async (req: any, reply) => {
    const old = await queryOne<any>('SELECT * FROM billing_items WHERE id = ?', [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const billed = await queryOne<any>(
      'SELECT 1 FROM invoice_items WHERE billing_item_id = ? LIMIT 1', [req.params.id]
    )
    if (billed) {
      return reply.status(409).send({
        code: 'ALREADY_BILLED',
        message: 'Posten wurde bereits abgerechnet — bitte stattdessen pausieren oder kündigen (status=cancelled).',
      })
    }

    await execute('DELETE FROM billing_items WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'billing_item', entityId: Number(req.params.id), action: 'delete', oldValue: old })
    return { ok: true }
  })
}
