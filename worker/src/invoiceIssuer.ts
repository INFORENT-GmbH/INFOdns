// Worker-Loop: PDF-Generation + Mail-Queue für frisch ausgestellte Rechnungen.
//
// Ablauf:
//   1. API-Endpoint POST /billing/invoices/:id/issue setzt status='issued',
//      vergibt Rechnungsnummer + Snapshots — aber pdf_path bleibt NULL.
//   2. Dieser Poller pickt issued-Rechnungen ohne pdf_path auf, rendert das PDF,
//      schreibt pdf_path und stellt eine Mail in mail_queue ein (falls
//      Empfänger-E-Mail bekannt).

import { query, execute } from './db.js'
import { renderInvoicePdf, type InvoicePdfData } from './pdfGenerator.js'
import { join } from 'path'

const STORAGE_ROOT = process.env.INVOICE_STORAGE_DIR ?? '/storage/invoices'
const BATCH = 5

interface IssuedRow {
  id: number
  invoice_number: string
  invoice_date: string
  due_date: string
  service_period_start: string | null
  service_period_end: string | null
  currency: string
  subtotal_cents: number
  tax_total_cents: number
  total_cents: number
  tax_mode: 'standard' | 'reverse_charge' | 'small_business' | 'non_eu'
  tax_note: string | null
  kind: 'invoice' | 'credit_note' | 'dunning_invoice'
  customer_notes: string | null
  postal_delivery: number
  billing_address_snapshot: string | null
  company_snapshot: string | null
  tenant_id: number
}

interface ItemRow {
  position: number
  description: string
  period_start: string | null
  period_end: string | null
  quantity: number
  unit: string | null
  unit_price_cents: number
  tax_rate_percent: number
  line_subtotal_cents: number
  line_tax_cents: number
  line_total_cents: number
}

export async function pollInvoiceIssuing(): Promise<number> {
  // Issued aber noch ohne PDF — der frisch vergebenen Issue-Aufruf schickt
  // schon eine Antwort an den User; wir generieren asynchron nach.
  const candidates = await query<IssuedRow>(
    `SELECT id, invoice_number,
            DATE_FORMAT(invoice_date, '%Y-%m-%d') AS invoice_date,
            DATE_FORMAT(due_date, '%Y-%m-%d')     AS due_date,
            DATE_FORMAT(service_period_start, '%Y-%m-%d %H:%i:%s') AS service_period_start,
            DATE_FORMAT(service_period_end,   '%Y-%m-%d %H:%i:%s') AS service_period_end,
            currency, subtotal_cents, tax_total_cents, total_cents,
            tax_mode, tax_note, kind, customer_notes, postal_delivery,
            billing_address_snapshot, company_snapshot, tenant_id
     FROM invoices
     WHERE status IN ('issued','sent') AND pdf_path IS NULL
     ORDER BY id ASC
     LIMIT ?`,
    [BATCH]
  )
  if (candidates.length === 0) return 0

  let processed = 0
  for (const inv of candidates) {
    try {
      await renderAndQueue(inv)
      processed++
    } catch (err: any) {
      console.error(`[invoiceIssuer] Invoice ${inv.id} (${inv.invoice_number}) PDF failed:`, err.message)
      // Wir stoppen nicht — andere Rechnungen sollen trotzdem verarbeitet
      // werden. Beim nächsten Poll-Lauf versuchen wir es erneut.
    }
  }
  return processed
}

async function renderAndQueue(inv: IssuedRow): Promise<void> {
  if (!inv.billing_address_snapshot || !inv.company_snapshot) {
    throw new Error('snapshots missing — issue endpoint did not save them')
  }

  // Items laden
  const items = await query<ItemRow>(
    `SELECT position, description,
            DATE_FORMAT(period_start, '%Y-%m-%d %H:%i:%s') AS period_start,
            DATE_FORMAT(period_end,   '%Y-%m-%d %H:%i:%s') AS period_end,
            quantity, unit, unit_price_cents, tax_rate_percent,
            line_subtotal_cents, line_tax_cents, line_total_cents
     FROM invoice_items
     WHERE invoice_id = ?
     ORDER BY position`,
    [inv.id]
  )

  const recipient = JSON.parse(inv.billing_address_snapshot)
  const company = JSON.parse(inv.company_snapshot)

  const pdfData: InvoicePdfData = {
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    due_date: inv.due_date,
    service_period_start: inv.service_period_start,
    service_period_end: inv.service_period_end,
    currency: inv.currency,
    subtotal_cents: inv.subtotal_cents,
    tax_total_cents: inv.tax_total_cents,
    total_cents: inv.total_cents,
    tax_mode: inv.tax_mode,
    tax_note: inv.tax_note,
    kind: inv.kind,
    customer_notes: inv.customer_notes,
    items: items.map(it => ({
      ...it,
      quantity: Number(it.quantity),
      tax_rate_percent: Number(it.tax_rate_percent),
    })),
    recipient,
    company,
  }

  // Pfad: /storage/invoices/<year>/<invoice_number>.pdf
  const year = inv.invoice_date.slice(0, 4)
  const safeName = inv.invoice_number.replace(/[^A-Za-z0-9_\-]/g, '_')
  const relPath = `${year}/${safeName}.pdf`
  const absPath = join(STORAGE_ROOT, relPath)

  await renderInvoicePdf(pdfData, absPath)

  // pdf_path schreiben (relativ zum STORAGE_ROOT)
  await execute('UPDATE invoices SET pdf_path = ? WHERE id = ?', [relPath, inv.id])

  // Mail queuen, wenn Versandweg "email" und Empfänger-E-Mail bekannt
  if (recipient.email && (inv.postal_delivery !== 1)) {
    const subject = subjectForKind(inv.kind, inv.invoice_number)
    const text = textBodyForKind(inv.kind, inv.invoice_number, recipient.email, company)
    const filename = `${kindFilenameLabel(inv.kind)}_${safeName}.pdf`

    await execute(
      `INSERT INTO mail_queue (to_email, subject, body_text, attachments_json) VALUES (?, ?, ?, ?)`,
      [
        recipient.email, subject, text,
        JSON.stringify([{ path: absPath, filename, contentType: 'application/pdf' }]),
      ]
    )
    await execute(`UPDATE invoices SET sent_via = 'email', sent_at = NOW(), status = 'sent' WHERE id = ?`, [inv.id])
  } else if (inv.postal_delivery === 1) {
    // Postversand: Status bleibt 'issued', das PDF liegt in /storage und wird
    // vom Admin manuell gedruckt + verschickt (Druck-Queue siehe Phase 6).
    await execute(`UPDATE invoices SET sent_via = 'postal' WHERE id = ?`, [inv.id])
  }
  // Sonst: kein Versand-Weg — nur Portal-Download.
}

function subjectForKind(kind: IssuedRow['kind'], number: string): string {
  switch (kind) {
    case 'credit_note':     return `Gutschrift ${number}`
    case 'dunning_invoice': return `Mahnung — Rechnung ${number}`
    case 'invoice':
    default:                return `Rechnung ${number}`
  }
}

function kindFilenameLabel(kind: IssuedRow['kind']): string {
  switch (kind) {
    case 'credit_note':     return 'Gutschrift'
    case 'dunning_invoice': return 'Mahnung'
    case 'invoice':
    default:                return 'Rechnung'
  }
}

function textBodyForKind(kind: IssuedRow['kind'], number: string, _to: string, company: any): string {
  const head = subjectForKind(kind, number)
  const body =
    kind === 'credit_note'
      ? `anbei erhalten Sie unsere Gutschrift ${number} als PDF im Anhang.`
      : kind === 'dunning_invoice'
        ? `anbei erhalten Sie unsere Mahnung zur Rechnung ${number} als PDF im Anhang.`
        : `anbei erhalten Sie unsere Rechnung ${number} als PDF im Anhang.`
  return [
    'Sehr geehrte Damen und Herren,',
    '',
    body,
    '',
    'Mit freundlichen Grüßen',
    company.company_name ?? '',
  ].join('\n')
}
