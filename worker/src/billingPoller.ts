// Billing poller: findet fällige Posten, gruppiert pro (tenant, intervall_unit,
// intervall_count) und legt jeweils EINE Draft-Rechnung an (Hybrid pro Intervall).
//
// Sub-Tag-Intervalle (second/minute/hour) werden hier ignoriert — die laufen
// über usageAggregator (Phase 7).
//
// Erstellt nur Drafts. Issuing (Nummer, PDF, Mail) macht die separate Phase 4.

import { query, transaction } from './db.js'
import { addInterval, type IntervalUnit } from './nextDue.js'
import { prorate, type ProrateLine } from './prorate.js'
import { resolveTax, lineTaxRate, computeLineTax } from './taxRules.js'

export interface BillableItem {
  id: number
  tenant_id: number
  description: string
  description_template: string | null
  unit_price_cents: number
  tax_rate_percent: number | null
  currency: string
  interval_unit: IntervalUnit
  interval_count: number
  started_at: string
  ends_at: string | null
  last_billed_until: string | null
  next_due_at: string | null
  ref_table: string | null
  ref_id: number | null
}

const SUB_DAY: ReadonlySet<IntervalUnit> = new Set(['second', 'minute', 'hour'])

function fmt(d: Date): string {
  const pad = (n: number) => n < 10 ? `0${n}` : String(n)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function parseDt(s: string): Date {
  if (s.includes('T')) return new Date(s)
  if (s.includes(' ')) return new Date(s.replace(' ', 'T') + 'Z')
  return new Date(s + 'T00:00:00Z')
}

function expandTemplate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => ctx[k] ?? `{${k}}`)
}

/**
 * Liefert die nächste Periodengrenze NACH `last`. Mehrere Schritte falls
 * `last` schon weit zurückliegt — die Schleife im Caller produziert dann
 * mehrere Positionen.
 */
function nextBoundary(last: string, unit: IntervalUnit, count: number): string {
  return addInterval(last, unit, count)
}

interface BucketKey {
  tenant_id: number
  interval_unit: IntervalUnit
  interval_count: number
  currency: string
}
function bucketKey(k: BucketKey): string {
  return `${k.tenant_id}|${k.interval_unit}|${k.interval_count}|${k.currency}`
}

interface PreparedItem {
  item: BillableItem
  /** Pro-Rata-Zeilen für diesen Posten — eine pro Periode. */
  lines: ProrateLine[]
  /** Effektives last_billed_until nach Verarbeitung. */
  newLastBilledUntil: string
}

/**
 * Polls billing_items, picks up everything due, and creates draft invoices
 * grouped by tenant + interval. Returns # of drafts created.
 */
export async function pollBilling(now: Date = new Date()): Promise<number> {
  const nowStr = fmt(now)

  // Hole fällige Items in einem Schwung.
  const due = await query<BillableItem>(
    `SELECT id, tenant_id, description, description_template,
            unit_price_cents, tax_rate_percent, currency,
            interval_unit, interval_count,
            DATE_FORMAT(started_at, '%Y-%m-%d %H:%i:%s') AS started_at,
            DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at,
            DATE_FORMAT(last_billed_until, '%Y-%m-%d %H:%i:%s') AS last_billed_until,
            DATE_FORMAT(next_due_at, '%Y-%m-%d %H:%i:%s') AS next_due_at,
            ref_table, ref_id
     FROM billing_items
     WHERE status = 'active'
       AND interval_unit NOT IN ('second','minute','hour')
       AND (next_due_at IS NULL OR next_due_at <= ?)
     ORDER BY tenant_id, interval_unit, interval_count, id`,
    [nowStr]
  )
  if (due.length === 0) return 0

  // Settings + Tenant-Profile auf einen Schlag holen
  const settingsRow = await query<any>('SELECT * FROM company_settings WHERE id = 1')
  if (settingsRow.length === 0) {
    console.warn('[billingPoller] company_settings leer — Abrechnung ausgesetzt.')
    return 0
  }
  const settings = settingsRow[0]
  const formatStr = settings.invoice_number_format ?? '{year}-{seq:05d}'
  void formatStr  // Issuing ist eine separate Phase

  const tenantIds = Array.from(new Set(due.map(d => d.tenant_id)))
  const tenants = await query<any>(
    `SELECT id, name, tax_mode, tax_rate_percent_override, vat_id, country
     FROM tenants WHERE id IN (${tenantIds.map(() => '?').join(',')})`,
    tenantIds
  )
  const tenantById = new Map(tenants.map(t => [t.id, t]))

  // Bucket: pro (tenant, interval_unit, interval_count, currency) eine Draft-Rechnung
  const buckets = new Map<string, { key: BucketKey; items: PreparedItem[] }>()

  for (const item of due) {
    if (SUB_DAY.has(item.interval_unit)) continue

    // Anker für diesen Lauf: das letzte abgerechnete Ende, sonst started_at.
    const anchor = item.last_billed_until ?? item.started_at
    const periodEnd = item.ends_at && parseDt(item.ends_at) < now ? parseDt(item.ends_at) : now

    if (item.interval_unit === 'lifetime') {
      // Lifetime nur einmal abrechnen.
      if (item.last_billed_until) continue
      const lines: ProrateLine[] = [{
        period_start: parseDt(item.started_at),
        period_end: parseDt(item.started_at),
        quantity: 1,
        amount_cents: item.unit_price_cents,
      }]
      const key: BucketKey = { tenant_id: item.tenant_id, interval_unit: 'lifetime', interval_count: 1, currency: item.currency }
      const bucket = buckets.get(bucketKey(key)) ?? { key, items: [] }
      bucket.items.push({ item, lines, newLastBilledUntil: item.started_at })
      buckets.set(bucketKey(key), bucket)
      continue
    }

    const lines = prorate({
      unit_price_cents: item.unit_price_cents,
      interval_unit: item.interval_unit,
      interval_count: item.interval_count,
      period_start: parseDt(anchor),
      period_end: periodEnd,
    })
    if (lines.length === 0) continue

    // Wir berechnen bis zum Ende der letzten kompletten Periode (oder bis ends_at).
    // newLastBilledUntil = letzte period_end aus Pro-Rate-Output.
    const newLastBilledUntil = fmt(lines[lines.length - 1].period_end)

    const key: BucketKey = {
      tenant_id: item.tenant_id, interval_unit: item.interval_unit,
      interval_count: item.interval_count, currency: item.currency,
    }
    const bucket = buckets.get(bucketKey(key)) ?? { key, items: [] }
    bucket.items.push({ item, lines, newLastBilledUntil })
    buckets.set(bucketKey(key), bucket)
  }

  let createdDrafts = 0
  for (const { key, items } of buckets.values()) {
    const tenant = tenantById.get(key.tenant_id)
    if (!tenant) {
      console.warn(`[billingPoller] tenant ${key.tenant_id} verschwunden — Bucket übersprungen.`)
      continue
    }
    const resolved = resolveTax(tenant, { default_tax_rate_percent: Number(settings.default_tax_rate_percent) })

    await transaction(async (conn) => {
      // Service-Periode = min(period_start) .. max(period_end)
      const allLines = items.flatMap(p => p.lines)
      const periodStart = fmt(new Date(Math.min(...allLines.map(l => l.period_start.getTime()))))
      const periodEnd = fmt(new Date(Math.max(...allLines.map(l => l.period_end.getTime()))))

      // Insert Draft-Invoice (Totals werden nach Items recompute)
      const [invRes] = await conn.execute<any>(
        `INSERT INTO invoices
           (tenant_id, status, kind, currency,
            service_period_start, service_period_end,
            subtotal_cents, tax_total_cents, total_cents,
            tax_mode, tax_note, postal_delivery, postal_fee_cents,
            customer_notes, notes, created_by)
         VALUES (?, 'draft', 'invoice', ?, ?, ?, 0, 0, 0, ?, ?, 0, 0, NULL,
                 'Auto-generiert vom billingPoller', 1)`,
        [key.tenant_id, key.currency, periodStart, periodEnd, resolved.mode, resolved.note]
      )
      const invoiceId = (invRes as any).insertId

      let pos = 0
      let subtotal = 0, taxTotal = 0, total = 0

      for (const prep of items) {
        const itemTaxRate = lineTaxRate(prep.item.tax_rate_percent, resolved)

        for (const line of prep.lines) {
          pos++
          // description-Template expandieren, falls vorhanden
          let desc = prep.item.description
          if (prep.item.description_template) {
            const ctx: Record<string, string> = {
              fqdn: '', // wird unten ggf. überschrieben
              period_start: fmt(line.period_start).slice(0, 10),
              period_end:   fmt(line.period_end).slice(0, 10),
            }
            // FQDN für Domain-Posten nachladen
            if (prep.item.ref_table === 'domains' && prep.item.ref_id) {
              const [d] = await conn.execute<any[]>('SELECT fqdn FROM domains WHERE id = ?', [prep.item.ref_id])
              if ((d as any[]).length > 0) ctx.fqdn = (d as any[])[0].fqdn
            }
            desc = expandTemplate(prep.item.description_template, ctx)
          }

          const subtotalCents = line.amount_cents
          const taxCents = computeLineTax(subtotalCents, itemTaxRate)
          const totalCents = subtotalCents + taxCents
          subtotal += subtotalCents
          taxTotal += taxCents
          total += totalCents

          await conn.execute(
            `INSERT INTO invoice_items
               (invoice_id, billing_item_id, position, description,
                period_start, period_end, quantity, unit_price_cents, tax_rate_percent,
                line_subtotal_cents, line_tax_cents, line_total_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              invoiceId, prep.item.id, pos, desc,
              fmt(line.period_start), fmt(line.period_end),
              line.quantity, prep.item.unit_price_cents, itemTaxRate,
              subtotalCents, taxCents, totalCents,
            ]
          )
        }

        // billing_items anpassen: last_billed_until + next_due_at
        let newNextDue: string | null
        if (prep.item.interval_unit === 'lifetime') {
          newNextDue = null
          // status bleibt 'active' — admin kann manuell auf 'cancelled' setzen
        } else {
          newNextDue = addInterval(prep.newLastBilledUntil, prep.item.interval_unit, prep.item.interval_count)
        }
        await conn.execute(
          `UPDATE billing_items SET last_billed_until = ?, next_due_at = ?,
                                    status = IF(ends_at IS NOT NULL AND ends_at <= ?, 'cancelled', status)
           WHERE id = ?`,
          [prep.newLastBilledUntil, newNextDue, prep.newLastBilledUntil, prep.item.id]
        )
      }

      await conn.execute(
        `UPDATE invoices SET subtotal_cents = ?, tax_total_cents = ?, total_cents = ? WHERE id = ?`,
        [subtotal, taxTotal, total, invoiceId]
      )
      createdDrafts++
    })
  }

  if (createdDrafts > 0) {
    console.log(`[billingPoller] ${createdDrafts} Draft-Rechnung(en) erstellt`)
  }
  return createdDrafts
}
