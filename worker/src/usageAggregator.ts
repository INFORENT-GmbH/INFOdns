// Aggregiert sub-tag-Verbrauch (second/minute/hour-Items) zu monatlichen
// Rechnungs-Positionen.
//
// Vorgehen:
//   1. Finde alle aktiven sub-day-Items.
//   2. Für jedes Item: gruppiere unconsumed usage_metrics nach Kalender-Monat.
//   3. Wenn ein Monat vollständig abgeschlossen ist (jetzt ist nach Monatsende),
//      schaffe oder erweitere den Draft (kind='invoice', kind-Filter) für
//      (tenant, currency, Monat) und füge eine Position hinzu.
//   4. Markiere die Datenpunkte mit consumed_invoice_id.
//   5. Setze billing_items.last_billed_until und next_due_at auf das Monatsende.
//
// Lifecycle: läuft 1× pro Stunde (idempotent — nur abgeschlossene Monate
// werden bearbeitet, der Status der Datenpunkte verhindert Doppelabrechnung).

import { query, transaction } from './db.js'
import { resolveTax, lineTaxRate, computeLineTax, type TaxMode } from './taxRules.js'

type SubDayUnit = 'second' | 'minute' | 'hour'
const SUB_DAY: ReadonlySet<SubDayUnit> = new Set(['second', 'minute', 'hour'])

interface UsageItem {
  id: number
  tenant_id: number
  description: string
  description_template: string | null
  unit_price_cents: number
  tax_rate_percent: number | null
  currency: string
  interval_unit: string
  interval_count: number
  ref_table: string | null
  ref_id: number | null
}

interface MonthBucket {
  /** Erster Tag des Monats, "YYYY-MM-01 00:00:00". */
  start: string
  /** Letzte Sekunde des Monats, "YYYY-MM-<lastDay> 23:59:59.999". */
  endInclusive: string
  /** Anfang des nächsten Monats — Item.last_billed_until. */
  nextStart: string
  /** Label für Description z.B. "2026-04". */
  label: string
}

function pad(n: number): string { return n < 10 ? `0${n}` : String(n) }

function buildBucketsForMonths(months: string[]): MonthBucket[] {
  return months.map(yyyymm => {
    const [y, m] = yyyymm.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const next = m === 12 ? `${y + 1}-01-01 00:00:00` : `${y}-${pad(m + 1)}-01 00:00:00`
    return {
      start: `${y}-${pad(m)}-01 00:00:00`,
      endInclusive: `${y}-${pad(m)}-${pad(lastDay)} 23:59:59.999`,
      nextStart: next,
      label: `${y}-${pad(m)}`,
    }
  })
}

function bucketIsFinished(bucketEndIso: string, now: Date): boolean {
  return new Date(bucketEndIso.replace(' ', 'T') + 'Z').getTime() < now.getTime()
}

export async function pollUsageAggregation(now: Date = new Date()): Promise<number> {
  const items = await query<UsageItem>(
    `SELECT id, tenant_id, description, description_template,
            unit_price_cents, tax_rate_percent, currency,
            interval_unit, interval_count, ref_table, ref_id
     FROM billing_items
     WHERE status = 'active'
       AND interval_unit IN ('second','minute','hour')`
  )
  if (items.length === 0) return 0

  // Settings + Tenant-Tax-Profile holen
  const settingsRows = await query<any>('SELECT * FROM company_settings WHERE id = 1')
  if (settingsRows.length === 0) return 0
  const settings = settingsRows[0]

  const tenantIds = Array.from(new Set(items.map(i => i.tenant_id)))
  const tenants = await query<any>(
    `SELECT id, tax_mode, tax_rate_percent_override, vat_id, country
     FROM tenants WHERE id IN (${tenantIds.map(() => '?').join(',')})`,
    tenantIds
  )
  const tenantById = new Map<number, any>(tenants.map(t => [t.id, t]))

  let positionsCreated = 0

  for (const item of items) {
    if (!SUB_DAY.has(item.interval_unit as SubDayUnit)) continue

    // Welche Monate haben unconsumed Metriken?
    const months = await query<{ ym: string }>(
      `SELECT DISTINCT DATE_FORMAT(recorded_at, '%Y-%m') AS ym
       FROM usage_metrics
       WHERE billing_item_id = ? AND consumed_invoice_id IS NULL
       ORDER BY ym ASC`,
      [item.id]
    )
    if (months.length === 0) continue

    const buckets = buildBucketsForMonths(months.map(r => r.ym))

    for (const bucket of buckets) {
      if (!bucketIsFinished(bucket.endInclusive, now)) continue        // Monat noch offen

      const tenant = tenantById.get(item.tenant_id)
      if (!tenant) continue
      const resolved = resolveTax(tenant, { default_tax_rate_percent: Number(settings.default_tax_rate_percent) })
      const itemTaxRate = lineTaxRate(item.tax_rate_percent, resolved)

      try {
        await transaction(async (conn) => {
          // Summe der unconsumed Metriken in diesem Monat (FOR UPDATE schützt
          // gegen parallele Aggregations-Läufe).
          const [sumRows] = await conn.execute<any[]>(
            `SELECT COALESCE(SUM(quantity), 0) AS qty,
                    COUNT(*) AS n
             FROM usage_metrics
             WHERE billing_item_id = ?
               AND consumed_invoice_id IS NULL
               AND recorded_at >= ?
               AND recorded_at <= ?
             FOR UPDATE`,
            [item.id, bucket.start, bucket.endInclusive]
          )
          const totalQty = Number((sumRows as any[])[0].qty)
          const dataPoints = Number((sumRows as any[])[0].n)
          if (dataPoints === 0 || totalQty <= 0) return

          // Zielrechnung: existierender Draft des Tenants in derselben Periode
          // wiederverwenden, sonst neu anlegen.
          const [existingDraftRows] = await conn.execute<any[]>(
            `SELECT id FROM invoices
             WHERE tenant_id = ? AND status = 'draft' AND kind = 'invoice'
               AND service_period_start = ? AND service_period_end = ?
             ORDER BY id ASC LIMIT 1`,
            [item.tenant_id, bucket.start, bucket.endInclusive]
          )

          let invoiceId: number
          if ((existingDraftRows as any[]).length > 0) {
            invoiceId = (existingDraftRows as any[])[0].id
          } else {
            const [r] = await conn.execute<any>(
              `INSERT INTO invoices
                 (tenant_id, status, kind, currency,
                  service_period_start, service_period_end,
                  subtotal_cents, tax_total_cents, total_cents,
                  tax_mode, tax_note, postal_delivery, postal_fee_cents,
                  customer_notes, notes, created_by)
               VALUES (?, 'draft', 'invoice', ?, ?, ?, 0, 0, 0, ?, ?, 0, 0, NULL,
                       'Auto-generiert vom usageAggregator', 1)`,
              [
                item.tenant_id, item.currency, bucket.start, bucket.endInclusive,
                resolved.mode, resolved.note,
              ]
            )
            invoiceId = (r as any).insertId
          }

          // Beschreibung mit Template-Expansion
          let desc = item.description
          if (item.description_template) {
            const ctx: Record<string, string> = {
              fqdn: '',
              period_start: bucket.start.slice(0, 10),
              period_end:   bucket.endInclusive.slice(0, 10),
              month: bucket.label,
            }
            if (item.ref_table === 'domains' && item.ref_id) {
              const [d] = await conn.execute<any[]>('SELECT fqdn FROM domains WHERE id = ?', [item.ref_id])
              if ((d as any[]).length > 0) ctx.fqdn = (d as any[])[0].fqdn
            }
            desc = item.description_template.replace(/\{(\w+)\}/g, (_m, k) => ctx[k] ?? `{${k}}`)
          } else {
            desc = `${item.description} (${bucket.label})`
          }

          const subtotal = Math.round(totalQty * item.unit_price_cents)
          const taxCents = computeLineTax(subtotal, itemTaxRate)
          const total = subtotal + taxCents

          // Position einfügen
          const [posRow] = await conn.execute<any[]>(
            'SELECT COALESCE(MAX(position),0)+1 AS p FROM invoice_items WHERE invoice_id = ?',
            [invoiceId]
          )
          const position = (posRow as any[])[0].p
          await conn.execute(
            `INSERT INTO invoice_items
               (invoice_id, billing_item_id, position, description,
                period_start, period_end, quantity, unit, unit_price_cents,
                tax_rate_percent, line_subtotal_cents, line_tax_cents, line_total_cents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              invoiceId, item.id, position, desc,
              bucket.start, bucket.endInclusive,
              totalQty, item.interval_unit, item.unit_price_cents,
              itemTaxRate, subtotal, taxCents, total,
            ]
          )

          // Totals der Rechnung neu berechnen
          await conn.execute(
            `UPDATE invoices i
             SET subtotal_cents = (SELECT COALESCE(SUM(line_subtotal_cents),0) FROM invoice_items WHERE invoice_id = i.id),
                 tax_total_cents = (SELECT COALESCE(SUM(line_tax_cents),0) FROM invoice_items WHERE invoice_id = i.id),
                 total_cents    = (SELECT COALESCE(SUM(line_total_cents),0) FROM invoice_items WHERE invoice_id = i.id)
             WHERE i.id = ?`,
            [invoiceId]
          )

          // Datenpunkte als consumed markieren
          await conn.execute(
            `UPDATE usage_metrics
             SET consumed_invoice_id = ?
             WHERE billing_item_id = ?
               AND consumed_invoice_id IS NULL
               AND recorded_at >= ?
               AND recorded_at <= ?`,
            [invoiceId, item.id, bucket.start, bucket.endInclusive]
          )

          // billing_items.last_billed_until + next_due_at fortschreiben
          await conn.execute(
            `UPDATE billing_items
             SET last_billed_until = ?,
                 next_due_at       = ?
             WHERE id = ?`,
            [bucket.endInclusive, bucket.nextStart, item.id]
          )

          positionsCreated++
        })
      } catch (err: any) {
        console.error(`[usageAggregator] Item ${item.id} bucket ${bucket.label} failed:`, err.message)
      }
    }
  }

  if (positionsCreated > 0) {
    console.log(`[usageAggregator] ${positionsCreated} Position(en) erzeugt/erweitert`)
  }
  return positionsCreated
}
