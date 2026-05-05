// Atomare Vergabe lückenloser Rechnungsnummern pro Jahr (GoBD).
// Muss innerhalb derselben Transaktion wie das Issuing ausgeführt werden,
// damit ein Rollback (z.B. PDF-Generation fehlgeschlagen) auch die Nummer
// freigibt. SELECT … FOR UPDATE serialisiert konkurrente Issues.

import type { PoolConnection } from 'mysql2/promise.js'

/**
 * Reserviert die nächste Rechnungsnummer für das gegebene Jahr und gibt sie
 * formatiert zurück. Wirft, falls die Sequence-Tabelle nicht existiert.
 *
 * @param year       Kalenderjahr (z.B. 2026)
 * @param formatStr  Format-String mit Tokens {year}, {seq}, {seq:NNd}.
 *                   Default `{year}-{seq:05d}` ergibt z.B. "2026-00042".
 */
export async function reserveInvoiceNumber(
  conn: PoolConnection,
  year: number,
  formatStr = '{year}-{seq:05d}',
): Promise<{ number: string; year: number; seq: number }> {
  // FOR UPDATE blockiert parallele Issues bis zur Transaktion-Ende.
  const [rows] = await conn.execute<any[]>(
    'SELECT last_number FROM invoice_number_sequence WHERE year = ? FOR UPDATE',
    [year]
  )
  let next: number
  if ((rows as any[]).length === 0) {
    next = 1
    await conn.execute(
      'INSERT INTO invoice_number_sequence (year, last_number) VALUES (?, ?)',
      [year, next]
    )
  } else {
    next = (rows as any[])[0].last_number + 1
    await conn.execute(
      'UPDATE invoice_number_sequence SET last_number = ? WHERE year = ?',
      [next, year]
    )
  }
  return { number: formatInvoiceNumber(formatStr, year, next), year, seq: next }
}

/**
 * Wendet einen Format-String auf Jahr + Sequence an.
 * Tokens:
 *   {year}        → "2026"
 *   {seq}         → "42"
 *   {seq:05d}     → "00042"  (zero-padded auf 5 Stellen)
 *   {seq:Nd}      → padded auf N Stellen
 */
export function formatInvoiceNumber(formatStr: string, year: number, seq: number): string {
  return formatStr.replace(/\{(year|seq)(?::(\d+)d)?\}/g, (_m, key, width) => {
    const v = key === 'year' ? year : seq
    const s = String(v)
    if (!width) return s
    const w = parseInt(width, 10)
    return s.padStart(w, '0')
  })
}
