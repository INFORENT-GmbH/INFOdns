import { FastifyInstance } from 'fastify'
import { query } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'

// ── MRR-Konvertierung ───────────────────────────────────────

/**
 * Konvertiert ein Item-Intervall in einen monatlichen Cent-Betrag (für MRR).
 * Wochen → 52/12, Tage → 30, Monate → 1, Jahre → 12. Sub-Day-Intervalle
 * (second/minute/hour) liefern null — die werden separat als "estimated" auf
 * Basis der letzten Monatsabrechnung ausgewiesen. Lifetime liefert ebenfalls
 * null (einmalig, kein recurring).
 */
function monthlyCents(unit: string, count: number, unitPrice: number): number | null {
  switch (unit) {
    case 'lifetime':
    case 'second':
    case 'minute':
    case 'hour':
      return null
    case 'day':   return unitPrice / count / 30
    case 'week':  return unitPrice / count / (52 / 12)
    case 'month': return unitPrice / count
    case 'year':  return unitPrice / count / 12
  }
  return null
}

// ── Routes ──────────────────────────────────────────────────

export async function billingDashboardRoutes(app: FastifyInstance) {

  // GET /billing/dashboard/stats
  app.get('/billing/dashboard/stats', { preHandler: requireAdmin }, async () => {
    // ── MRR/ARR aus aktiven billing_items ──
    const items = await query<any>(
      `SELECT unit_price_cents, interval_unit, interval_count, status
       FROM billing_items WHERE status = 'active'`
    )
    let mrr = 0
    let lifetimeCount = 0
    let usageCount = 0
    for (const it of items) {
      const m = monthlyCents(it.interval_unit, Number(it.interval_count), Number(it.unit_price_cents))
      if (m != null) mrr += m
      else if (it.interval_unit === 'lifetime') lifetimeCount++
      else usageCount++
    }
    mrr = Math.round(mrr)
    const arr = mrr * 12

    // ── Outstanding (offene + überfällige Forderungen) ──
    const [outstanding] = await query<any>(
      `SELECT
         COALESCE(SUM(total_cents - paid_cents), 0)                                                AS outstanding_cents,
         COUNT(*)                                                                                  AS open_count,
         COALESCE(SUM(CASE WHEN due_date < CURDATE() THEN total_cents - paid_cents ELSE 0 END),0) AS overdue_cents,
         SUM(CASE WHEN due_date < CURDATE() THEN 1 ELSE 0 END)                                    AS overdue_count
       FROM invoices
       WHERE status IN ('issued','sent','partial','overdue') AND kind = 'invoice'`
    )

    // ── Aktueller Monat: ausgestellt + bezahlt ──
    const [thisMonth] = await query<any>(
      `SELECT
         COUNT(*)                            AS issued_count,
         COALESCE(SUM(total_cents), 0)       AS issued_sum,
         COALESCE(SUM(paid_cents),  0)       AS paid_sum
       FROM invoices
       WHERE invoice_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
         AND status NOT IN ('draft','cancelled')
         AND kind = 'invoice'`
    )

    // ── Letzte 6 Monate (Trend für später, schon mal liefern) ──
    const trend = await query<any>(
      `SELECT DATE_FORMAT(invoice_date, '%Y-%m')        AS bucket,
              COUNT(*)                                  AS count,
              COALESCE(SUM(total_cents), 0)             AS sum_cents
       FROM invoices
       WHERE invoice_date >= DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 5 MONTH)
         AND status NOT IN ('draft','cancelled')
         AND kind = 'invoice'
       GROUP BY bucket
       ORDER BY bucket ASC`
    )

    // ── Top überfällige Tenants ──
    const topOverdue = await query<any>(
      `SELECT t.id          AS tenant_id,
              t.name        AS tenant_name,
              COUNT(i.id)   AS overdue_count,
              COALESCE(SUM(i.total_cents - i.paid_cents), 0) AS overdue_cents,
              MIN(i.due_date)                                AS oldest_due
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       WHERE i.status IN ('issued','sent','partial','overdue')
         AND i.due_date < CURDATE()
         AND i.kind = 'invoice'
       GROUP BY t.id
       ORDER BY overdue_cents DESC
       LIMIT 5`
    )

    // ── Letzte 10 Rechnungen ──
    const recent = await query<any>(
      `SELECT i.id, i.invoice_number, i.tenant_id, t.name AS tenant_name,
              i.invoice_date, i.total_cents, i.status, i.kind
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
       WHERE i.status NOT IN ('draft')
       ORDER BY COALESCE(i.invoice_date, i.created_at) DESC, i.id DESC
       LIMIT 10`
    )

    return {
      mrr_cents: mrr,
      arr_cents: arr,
      lifetime_active_count: lifetimeCount,
      usage_active_count: usageCount,
      outstanding_cents: Number(outstanding?.outstanding_cents ?? 0),
      open_count: Number(outstanding?.open_count ?? 0),
      overdue_cents: Number(outstanding?.overdue_cents ?? 0),
      overdue_count: Number(outstanding?.overdue_count ?? 0),
      this_month: {
        issued_count: Number(thisMonth?.issued_count ?? 0),
        issued_sum:   Number(thisMonth?.issued_sum ?? 0),
        paid_sum:     Number(thisMonth?.paid_sum ?? 0),
      },
      trend,
      top_overdue: topOverdue,
      recent,
    }
  })
}
