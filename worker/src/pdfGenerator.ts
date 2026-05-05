// Generiert PDF-Rechnung im DIN-A4-Format mit allen §14-UStG-Pflichtangaben.
// Layout orientiert sich grob an DIN 5008 (Adressfeld in der Briefkopf-Position).
//
// Pflichtangaben pro Rechnung:
//   - Vollständiger Name + Anschrift Leistender und Empfänger
//   - Steuernummer ODER USt-IdNr.
//   - Ausstellungsdatum
//   - Fortlaufende Rechnungsnummer
//   - Menge + Art der Leistung pro Position
//   - Leistungszeitraum pro Position
//   - Entgelt aufgeschlüsselt nach Steuersätzen
//   - Steuersatz + Steuerbetrag (oder Hinweis bei Steuerbefreiung)
//   - Bei Reverse-Charge / §19: entsprechender Hinweistext

// pdfkit ist ein CommonJS-Modul ohne saubere ESM-Types in @types/pdfkit für
// alle Aufruf-Patterns. Wir typisieren `doc` lokal als any — die Aufrufe sind
// trivial, der Code wird durch funktionale Tests / Augenschein abgedeckt.
import PDFDocument from 'pdfkit'
import { createWriteStream, mkdirSync } from 'fs'
import { dirname } from 'path'

type Doc = any

export interface InvoicePdfData {
  invoice_number: string
  invoice_date: string                   // YYYY-MM-DD
  due_date: string                       // YYYY-MM-DD
  service_period_start: string | null    // YYYY-MM-DD HH:MM:SS
  service_period_end: string | null
  currency: string
  subtotal_cents: number
  tax_total_cents: number
  total_cents: number
  tax_mode: 'standard' | 'reverse_charge' | 'small_business' | 'non_eu'
  tax_note: string | null
  kind: 'invoice' | 'credit_note' | 'dunning_invoice'
  customer_notes: string | null
  items: Array<{
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
  }>
  /** Snapshot des Tenants (Empfänger). */
  recipient: {
    name: string
    company_name: string | null
    first_name: string | null
    last_name: string | null
    street: string | null
    zip: string | null
    city: string | null
    country: string | null
    vat_id: string | null
    email: string | null
  }
  /** Snapshot der eigenen Firma + Bankdaten. */
  company: {
    company_name: string
    address_line1: string
    address_line2: string | null
    zip: string
    city: string
    country: string
    email: string
    phone: string | null
    website: string | null
    tax_id: string | null
    vat_id: string | null
    commercial_register: string | null
    managing_director: string | null
    bank_name: string
    iban: string
    bic: string
    account_holder: string
    invoice_footer_text: string | null
  }
}

// ── Formatter ────────────────────────────────────────────────

function fmtEuro(cents: number, currency = 'EUR'): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const remainder = abs % 100
  // Tausenderpunkte für Eurobetrag
  const eurosStr = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}${eurosStr},${String(remainder).padStart(2, '0')} ${currency === 'EUR' ? '€' : currency}`
}

function fmtQty(q: number): string {
  if (Number.isInteger(q)) return String(q)
  return q.toFixed(4).replace('.', ',').replace(/0+$/, '').replace(/,$/, '')
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  const d = s.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

function fmtDateTime(s: string | null): string {
  return fmtDate(s)
}

// ── Layout-Konstanten ────────────────────────────────────────

const PAGE = { width: 595.28, height: 841.89 } // A4 in pt
const MARGIN = { top: 60, bottom: 80, left: 60, right: 60 }
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right

// DIN 5008 Adressfeld: links 25mm vom Rand, oben 45mm
const ADDRESS_WINDOW = { x: 70, y: 130, width: 240, height: 100 }

// Spaltenbreiten der Positions-Tabelle (Summe ≈ CONTENT_WIDTH)
const COL = {
  pos:   { x: MARGIN.left,                       w:  25 },
  desc:  { x: MARGIN.left +  25,                 w: 200 },
  qty:   { x: MARGIN.left + 225,                 w:  45, align: 'right' as const },
  unit:  { x: MARGIN.left + 270,                 w:  60, align: 'right' as const },
  tax:   { x: MARGIN.left + 330,                 w:  35, align: 'right' as const },
  total: { x: MARGIN.left + 365,                 w: CONTENT_WIDTH - 365, align: 'right' as const },
}

// ── Kern: PDF rendern ────────────────────────────────────────

export async function renderInvoicePdf(data: InvoicePdfData, outPath: string): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true })
  const doc = new PDFDocument({
    size: 'A4',
    margins: MARGIN,
    info: {
      Title: `${kindLabel(data.kind)} ${data.invoice_number}`,
      Author: data.company.company_name,
      Subject: `${kindLabel(data.kind)} ${data.invoice_number}`,
      Creator: 'INFORENT Prisma',
    },
  })
  const stream = createWriteStream(outPath)
  doc.pipe(stream)

  // Header rechts: Firmenname + kompakte Anschrift
  drawSenderHeader(doc, data.company)

  // Adressfeld-Briefkopf (DIN 5008): kleiner Absender als 1-Zeile + Empfänger-Block
  drawAddressBlock(doc, data.company, data.recipient)

  // Rechnungsnummer + Datum rechts neben Adressfeld
  drawMetaBlock(doc, data)

  // Trennlinie + Betreff
  let cursorY = ADDRESS_WINDOW.y + ADDRESS_WINDOW.height + 60
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#1e293b')
    .text(subjectFor(data), MARGIN.left, cursorY)
  cursorY += 20

  // Anrede / kurzer Einleitungssatz
  doc.font('Helvetica').fontSize(10).fillColor('#1e293b')
    .text(introLineFor(data), MARGIN.left, cursorY, { width: CONTENT_WIDTH })
  cursorY += 35

  // Positions-Tabelle
  cursorY = drawTable(doc, data, cursorY)

  // Summen
  cursorY = drawTotals(doc, data, cursorY + 10)

  // Tax-Note
  if (data.tax_note) {
    cursorY += 15
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#374151')
      .text(data.tax_note, MARGIN.left, cursorY, { width: CONTENT_WIDTH })
    cursorY += 25
  }

  // Zahlungshinweis
  if (data.kind === 'invoice') {
    cursorY = drawPaymentInstructions(doc, data, cursorY + 10)
  } else if (data.kind === 'credit_note') {
    cursorY += 10
    doc.font('Helvetica').fontSize(10).fillColor('#1e293b')
      .text('Der Betrag wird auf das uns bekannte Konto erstattet bzw. mit der nächsten Rechnung verrechnet.',
        MARGIN.left, cursorY, { width: CONTENT_WIDTH })
    cursorY += 20
  }

  // Customer-Notiz
  if (data.customer_notes) {
    cursorY += 15
    doc.font('Helvetica').fontSize(9).fillColor('#374151')
      .text(data.customer_notes, MARGIN.left, cursorY, { width: CONTENT_WIDTH })
  }

  // Footer auf jeder Seite
  drawFooter(doc, data.company)
  doc.on('pageAdded', () => drawFooter(doc, data.company))

  doc.end()

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve())
    stream.on('error', reject)
  })
}

// ── Sub-Renderer ─────────────────────────────────────────────

function drawSenderHeader(doc: Doc, c: InvoicePdfData['company']) {
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#1e293b')
    .text(c.company_name, MARGIN.left, MARGIN.top, {
      width: CONTENT_WIDTH, align: 'right',
    })
  doc.font('Helvetica').fontSize(8).fillColor('#64748b')
  const lines = [
    c.address_line1 + (c.address_line2 ? ' · ' + c.address_line2 : ''),
    `${c.zip} ${c.city}`,
    c.email + (c.phone ? ' · ' + c.phone : ''),
  ].filter(Boolean)
  doc.text(lines.join('\n'), MARGIN.left, MARGIN.top + 18, {
    width: CONTENT_WIDTH, align: 'right',
  })
}

function drawAddressBlock(doc: Doc, c: InvoicePdfData['company'], r: InvoicePdfData['recipient']) {
  // 1-zeiliger Absender oben (klein, oberhalb Empfänger im Briefkopf-Fenster)
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
    .text(
      `${c.company_name} · ${c.address_line1} · ${c.zip} ${c.city}`,
      ADDRESS_WINDOW.x, ADDRESS_WINDOW.y - 12,
      { width: ADDRESS_WINDOW.width },
    )

  // Empfänger-Block
  doc.font('Helvetica').fontSize(11).fillColor('#1e293b')
  const recipientLines = recipientAddressLines(r)
  doc.text(recipientLines.join('\n'), ADDRESS_WINDOW.x, ADDRESS_WINDOW.y, {
    width: ADDRESS_WINDOW.width, lineGap: 2,
  })
}

function recipientAddressLines(r: InvoicePdfData['recipient']): string[] {
  const lines: string[] = []
  if (r.company_name) lines.push(r.company_name)
  const personLine = [r.first_name, r.last_name].filter(Boolean).join(' ')
  if (personLine) lines.push(personLine)
  if (!lines.length) lines.push(r.name)
  if (r.street) lines.push(r.street)
  const cityLine = [r.zip, r.city].filter(Boolean).join(' ')
  if (cityLine) lines.push(cityLine)
  if (r.country && r.country !== 'DE') lines.push(r.country)
  return lines
}

function drawMetaBlock(doc: Doc, data: InvoicePdfData) {
  const x = PAGE.width - MARGIN.right - 200
  const y = ADDRESS_WINDOW.y
  const rows: [string, string][] = [
    [`${kindLabel(data.kind)}-Nr.`, data.invoice_number],
    ['Datum',        fmtDate(data.invoice_date)],
    ['Fällig',       fmtDate(data.due_date)],
  ]
  if (data.service_period_start && data.service_period_end) {
    rows.push(['Leistungszeitraum',
      `${fmtDateTime(data.service_period_start)} – ${fmtDateTime(data.service_period_end)}`])
  }
  doc.font('Helvetica').fontSize(9).fillColor('#1e293b')
  let cy = y
  for (const [k, v] of rows) {
    doc.fillColor('#64748b').text(k, x, cy, { width: 90 })
    doc.fillColor('#1e293b').text(v, x + 90, cy, { width: 110, align: 'right' })
    cy += 14
  }
}

function drawTable(doc: Doc, data: InvoicePdfData, startY: number): number {
  // Header
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#1e293b')
  doc.rect(MARGIN.left, startY, CONTENT_WIDTH, 18).fill('#f1f5f9').fillColor('#1e293b')
  let y = startY + 4
  doc.text('Pos.',         COL.pos.x + 4,   y, { width: COL.pos.w   })
  doc.text('Beschreibung', COL.desc.x,      y, { width: COL.desc.w  })
  doc.text('Menge',        COL.qty.x,       y, { width: COL.qty.w,  align: COL.qty.align })
  doc.text('Einzel',       COL.unit.x,      y, { width: COL.unit.w, align: COL.unit.align })
  doc.text('USt%',         COL.tax.x,       y, { width: COL.tax.w,  align: COL.tax.align })
  doc.text('Summe',        COL.total.x,     y, { width: COL.total.w, align: COL.total.align })
  y = startY + 20

  // Rows
  doc.font('Helvetica').fontSize(9).fillColor('#1e293b')
  for (const it of data.items) {
    if (y > PAGE.height - MARGIN.bottom - 100) {
      doc.addPage()
      y = MARGIN.top
    }
    const descLines: string[] = [it.description]
    if (it.period_start && it.period_end) {
      descLines.push(`Leistungszeitraum: ${fmtDateTime(it.period_start)} – ${fmtDateTime(it.period_end)}`)
    }
    const desc = descLines.join('\n')
    const descHeight = doc.heightOfString(desc, { width: COL.desc.w })
    const rowHeight = Math.max(14, descHeight + 4)

    doc.fillColor('#1e293b').text(String(it.position), COL.pos.x + 4, y, { width: COL.pos.w })
    doc.text(desc, COL.desc.x, y, { width: COL.desc.w })
    const qtyText = it.unit ? `${fmtQty(it.quantity)} ${it.unit}` : fmtQty(it.quantity)
    doc.text(qtyText,                          COL.qty.x,   y, { width: COL.qty.w,   align: COL.qty.align })
    doc.text(fmtEuro(it.unit_price_cents),     COL.unit.x,  y, { width: COL.unit.w,  align: COL.unit.align })
    doc.text(`${Number(it.tax_rate_percent)}%`, COL.tax.x,   y, { width: COL.tax.w,   align: COL.tax.align })
    doc.text(fmtEuro(it.line_subtotal_cents),  COL.total.x, y, { width: COL.total.w, align: COL.total.align })

    y += rowHeight
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(MARGIN.left, y).lineTo(MARGIN.left + CONTENT_WIDTH, y).stroke()
    y += 4
  }
  return y
}

function drawTotals(doc: Doc, data: InvoicePdfData, startY: number): number {
  const labelX = MARGIN.left + CONTENT_WIDTH - 200
  const valueX = MARGIN.left + CONTENT_WIDTH - 100
  let y = startY
  doc.font('Helvetica').fontSize(10).fillColor('#1e293b')

  doc.fillColor('#64748b').text('Netto', labelX, y, { width: 90 })
  doc.fillColor('#1e293b').text(fmtEuro(data.subtotal_cents, data.currency), valueX, y, { width: 100, align: 'right' })
  y += 14

  doc.fillColor('#64748b').text('Umsatzsteuer', labelX, y, { width: 90 })
  doc.fillColor('#1e293b').text(fmtEuro(data.tax_total_cents, data.currency), valueX, y, { width: 100, align: 'right' })
  y += 4

  // Trennlinie + Total
  y += 8
  doc.strokeColor('#1e293b').lineWidth(1).moveTo(labelX, y).lineTo(MARGIN.left + CONTENT_WIDTH, y).stroke()
  y += 6
  doc.font('Helvetica-Bold').fontSize(11)
  doc.text('Gesamt', labelX, y, { width: 90 })
  doc.text(fmtEuro(data.total_cents, data.currency), valueX, y, { width: 100, align: 'right' })
  y += 16
  return y
}

function drawPaymentInstructions(doc: Doc, data: InvoicePdfData, startY: number): number {
  const c = data.company
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e293b')
    .text('Zahlungshinweis', MARGIN.left, startY)
  let y = startY + 14
  doc.font('Helvetica').fontSize(9).fillColor('#1e293b')
  const text =
    `Bitte überweisen Sie den Gesamtbetrag von ${fmtEuro(data.total_cents, data.currency)} bis zum ${fmtDate(data.due_date)} ` +
    `unter Angabe der ${kindLabel(data.kind)}-Nummer ${data.invoice_number} auf folgendes Konto:`
  doc.text(text, MARGIN.left, y, { width: CONTENT_WIDTH })
  y += doc.heightOfString(text, { width: CONTENT_WIDTH }) + 8

  const bankLines = [
    `Empfänger: ${c.account_holder}`,
    `IBAN: ${c.iban}`,
    `BIC: ${c.bic}`,
    `Bank: ${c.bank_name}`,
    `Verwendungszweck: ${data.invoice_number}`,
  ]
  doc.font('Helvetica').fontSize(9).fillColor('#1e293b')
  doc.rect(MARGIN.left, y, CONTENT_WIDTH, bankLines.length * 13 + 10).fill('#f8fafc').fillColor('#1e293b')
  let by = y + 6
  for (const l of bankLines) {
    doc.text(l, MARGIN.left + 10, by, { width: CONTENT_WIDTH - 20 })
    by += 13
  }
  y += bankLines.length * 13 + 16
  return y
}

function drawFooter(doc: Doc, c: InvoicePdfData['company']) {
  const y = PAGE.height - MARGIN.bottom + 20
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8')
  const blocks: string[][] = [
    [
      c.company_name,
      c.address_line1,
      c.address_line2 ?? '',
      `${c.zip} ${c.city}`,
    ].filter(Boolean),
    [
      c.email,
      c.phone ?? '',
      c.website ?? '',
    ].filter(Boolean),
    [
      c.tax_id    ? `Steuernr.: ${c.tax_id}` : '',
      c.vat_id    ? `USt-IdNr.: ${c.vat_id}` : '',
      c.commercial_register ?? '',
      c.managing_director   ? `GF: ${c.managing_director}` : '',
    ].filter(Boolean),
    [
      `Bank: ${c.bank_name}`,
      `IBAN: ${c.iban}`,
      `BIC: ${c.bic}`,
    ],
  ]
  const colWidth = CONTENT_WIDTH / blocks.length
  for (let i = 0; i < blocks.length; i++) {
    doc.text(blocks[i].join('\n'), MARGIN.left + i * colWidth, y, {
      width: colWidth - 8, lineGap: 1,
    })
  }
  if (c.invoice_footer_text) {
    doc.font('Helvetica-Oblique').fontSize(7).fillColor('#94a3b8')
      .text(c.invoice_footer_text, MARGIN.left, PAGE.height - 30, { width: CONTENT_WIDTH, align: 'center' })
  }
}

function kindLabel(kind: InvoicePdfData['kind']): string {
  switch (kind) {
    case 'credit_note':     return 'Gutschrift'
    case 'dunning_invoice': return 'Mahn-Rechnung'
    case 'invoice':
    default:                return 'Rechnung'
  }
}

function subjectFor(data: InvoicePdfData): string {
  return `${kindLabel(data.kind)} ${data.invoice_number}`
}

function introLineFor(data: InvoicePdfData): string {
  if (data.kind === 'credit_note') {
    return 'wir erstellen Ihnen folgende Gutschrift:'
  }
  if (data.kind === 'dunning_invoice') {
    return 'leider haben wir noch keinen Zahlungseingang feststellen können.'
  }
  return 'wir erlauben uns, Ihnen folgende Leistungen in Rechnung zu stellen:'
}
