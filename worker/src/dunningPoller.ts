// Täglicher Mahn-Poller: findet überfällige Rechnungen und eskaliert die
// fällige Mahnstufe. Gebührenfrei (Stufe 0): nur Eintrag in dunning_log +
// Mail mit Original-PDF. Gebührenpflichtig (Stufe ≥ 1): erzeugt eigene
// dunning_invoice mit neuer Nummer; das eigentliche PDF generiert der
// invoiceIssuer-Poller.
//
// COPY of api/src/billing/dunning.ts::escalateDunning — keep in sync.

import { query, transaction } from './db.js'
import { resolveTax, computeLineTax, type TaxMode } from './taxRules.js'
import type { PoolConnection } from 'mysql2/promise.js'
import { join } from 'path'

const STORAGE_ROOT = process.env.INVOICE_STORAGE_DIR ?? '/storage/invoices'

interface DueInvoice {
  id: number
  invoice_number: string
  tenant_id: number
  total_cents: number
  paid_cents: number
  due_date: string
  status: string
  pdf_path: string | null
  tax_mode: string
  currency: string
  billing_address_snapshot: string | null
  company_snapshot: string | null
}

// ── Numbering (mini-copy aus api/src/billing/numbering.ts) ────

async function reserveInvoiceNumberWorker(
  conn: PoolConnection,
  year: number,
  formatStr: string,
): Promise<string> {
  const [rows] = await conn.execute<any[]>(
    'SELECT last_number FROM invoice_number_sequence WHERE year = ? FOR UPDATE',
    [year]
  )
  let next: number
  if ((rows as any[]).length === 0) {
    next = 1
    await conn.execute('INSERT INTO invoice_number_sequence (year, last_number) VALUES (?, ?)', [year, next])
  } else {
    next = (rows as any[])[0].last_number + 1
    await conn.execute('UPDATE invoice_number_sequence SET last_number = ? WHERE year = ?', [next, year])
  }
  return formatStr.replace(/\{(year|seq)(?::(\d+)d)?\}/g, (_m, key, width) => {
    const v = key === 'year' ? year : next
    const s = String(v)
    if (!width) return s
    return s.padStart(parseInt(width, 10), '0')
  })
}

// ── Hauptloop ────────────────────────────────────────────────

export async function pollDunning(): Promise<number> {
  // Konfig laden
  const levels = await query<any>(
    `SELECT level, label, days_after_due, fee_cents, template_key
     FROM dunning_levels ORDER BY level ASC`
  )
  if (levels.length === 0) return 0

  const settingsRows = await query<any>('SELECT * FROM company_settings WHERE id = 1')
  if (settingsRows.length === 0) {
    console.warn('[dunningPoller] company_settings leer — Mahnung übersprungen.')
    return 0
  }
  const settings = settingsRows[0]

  // Überfällige Rechnungen suchen
  const candidates = await query<DueInvoice>(
    `SELECT i.id, i.invoice_number, i.tenant_id, i.total_cents, i.paid_cents,
            DATE_FORMAT(i.due_date, '%Y-%m-%d') AS due_date,
            i.status, i.pdf_path, i.tax_mode, i.currency,
            i.billing_address_snapshot, i.company_snapshot
     FROM invoices i
     JOIN tenants t ON t.id = i.tenant_id
     WHERE i.kind = 'invoice'
       AND i.status IN ('issued','sent','partial','overdue')
       AND i.due_date < CURDATE()
       AND t.dunning_paused = 0
     ORDER BY i.due_date ASC`
  )

  let escalated = 0

  for (const inv of candidates) {
    try {
      const handled = await transaction(async (conn) => {
        // Aktuelle Stufe ermitteln
        const [logs] = await conn.execute<any[]>(
          'SELECT MAX(level) AS max_level FROM dunning_log WHERE invoice_id = ?',
          [inv.id]
        )
        const lastLevel = (logs as any[])[0]?.max_level ?? null

        // Tage überfällig
        const dueMs = new Date(inv.due_date + 'T00:00:00Z').getTime()
        const daysOverdue = Math.floor((Date.now() - dueMs) / 86400_000)

        // Welche Stufe ist als nächstes fällig?
        const nextLevel = lastLevel == null ? 0 : lastLevel + 1
        const cfg = levels.find(l => l.level === nextLevel)
        if (!cfg) return false                                  // alle Stufen durch
        if (daysOverdue < cfg.days_after_due) return false      // noch nicht so weit

        // Status auf overdue setzen falls noch nicht
        if (inv.status === 'issued' || inv.status === 'sent') {
          await conn.execute("UPDATE invoices SET status = 'overdue' WHERE id = ?", [inv.id])
        }

        let dunningInvoiceId: number | null = null
        let pdfPath: string | null = null

        if (cfg.fee_cents > 0) {
          // Eigene dunning_invoice mit neuer Rechnungsnummer
          const resolved = resolveTax(
            { tax_mode: inv.tax_mode as TaxMode, tax_rate_percent_override: null, vat_id: null, country: null },
            { default_tax_rate_percent: Number(settings.default_tax_rate_percent) }
          )
          const taxRate = resolved.mode === 'standard' ? Number(settings.default_tax_rate_percent) : 0
          const subtotal = cfg.fee_cents
          const taxCents = computeLineTax(subtotal, taxRate)
          const total    = subtotal + taxCents

          const year = new Date().getUTCFullYear()
          const number = await reserveInvoiceNumberWorker(
            conn, year, settings.invoice_number_format ?? '{year}-{seq:05d}'
          )
          const today = new Date().toISOString().slice(0, 10)
          const paymentTerms = Number(settings.default_payment_terms_days ?? 14)
          const dueDate = new Date(Date.now() + paymentTerms * 86400_000).toISOString().slice(0, 10)

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
              inv.tenant_id, number, inv.id,
              today, dueDate, inv.currency,
              subtotal, taxCents, total,
              inv.tax_mode, resolved.note,
              inv.billing_address_snapshot, inv.company_snapshot,
              1,                                    // created_by = system user 1 (admin)
              `${cfg.label} zu Rechnung ${inv.invoice_number}`,
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
              `${cfg.label} zu Rechnung ${inv.invoice_number}`,
              subtotal, taxRate, subtotal, taxCents, total,
            ]
          )
          // Das Mahn-PDF wird vom invoiceIssuer-Poller asynchron erzeugt.
        } else {
          // Stufe 0: keine Mahnrechnung, nur Reminder-Mail mit Original-PDF
          pdfPath = inv.pdf_path ? join(STORAGE_ROOT, inv.pdf_path) : null
        }

        // dunning_log Eintrag — UNIQUE (invoice_id, level) ist Schutz vor Doppel
        await conn.execute(
          `INSERT INTO dunning_log (invoice_id, level, fee_added_cents) VALUES (?, ?, ?)`,
          [inv.id, nextLevel, cfg.fee_cents]
        )

        // Reminder-Mail nur für Stufe 0 — die Mahnrechnungen werden vom
        // invoiceIssuer geschickt sobald deren PDF fertig ist.
        if (cfg.fee_cents === 0) {
          const recipient = inv.billing_address_snapshot ? JSON.parse(inv.billing_address_snapshot) : null
          if (recipient?.email) {
            const subject = `Zahlungserinnerung — Rechnung ${inv.invoice_number}`
            const text = [
              'Sehr geehrte Damen und Herren,',
              '',
              `bislang konnten wir keinen Zahlungseingang zu Rechnung ${inv.invoice_number} feststellen.`,
              `Wir bitten Sie, den offenen Betrag zeitnah zu begleichen.`,
              '',
              'Sollte sich Ihre Zahlung mit dieser Erinnerung überschnitten haben, betrachten Sie diese E-Mail bitte als gegenstandslos.',
              '',
              'Mit freundlichen Grüßen',
              settings.company_name ?? 'INFORENT',
            ].join('\n')

            const attachments = pdfPath
              ? JSON.stringify([{ path: pdfPath, filename: `Rechnung_${inv.invoice_number}.pdf`, contentType: 'application/pdf' }])
              : null

            await conn.execute(
              `INSERT INTO mail_queue (to_email, subject, body_text, attachments_json)
               VALUES (?, ?, ?, ?)`,
              [recipient.email, subject, text, attachments]
            )
          }
        }

        return true
      })
      if (handled) escalated++
    } catch (err: any) {
      // ER_DUP_ENTRY heißt: jemand anders hat dieselbe Stufe schon eingetragen.
      if (err?.code === 'ER_DUP_ENTRY') continue
      console.error(`[dunningPoller] Invoice ${inv.id} (${inv.invoice_number}) escalation failed:`, err.message)
    }
  }

  if (escalated > 0) {
    console.log(`[dunningPoller] ${escalated} Mahnstufe(n) eskaliert`)
  }
  return escalated
}

// Verhindert dass der gleiche Tag mehrfach durchläuft.
let lastRunDay: string | null = null
export async function pollDunningOncePerDay(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  if (lastRunDay === today) return 0
  const result = await pollDunning()
  lastRunDay = today
  return result
}
