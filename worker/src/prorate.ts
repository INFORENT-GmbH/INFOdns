// COPY — keep in sync with api/src/billing/prorate.ts
// Sekundengenaues Pro-Rating für Abrechnungs-Posten.
// Pure functions — leicht testbar.

import { addInterval, type IntervalUnit } from './nextDue.js'

export interface ProrateInput {
  unit_price_cents: number
  interval_unit: IntervalUnit
  interval_count: number
  /** Anfang des abzurechnenden Zeitraums (= last_billed_until oder started_at). */
  period_start: Date
  /** Ende des abzurechnenden Zeitraums (= jetzt, oder ends_at falls Item gekündigt). */
  period_end: Date
}

export interface ProrateLine {
  /** Zeitraum, der mit dieser Position abgedeckt wird. */
  period_start: Date
  period_end: Date
  /** 1.0 für volle Periode, < 1 für anteilig, > 1 für Mehr-Perioden-Posten möglich. */
  quantity: number
  /** Cent-Betrag, gerundet. */
  amount_cents: number
}

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

/**
 * Berechnet ein oder mehrere Rechnungs-Positionen aus einem Posten zwischen
 * `period_start` und `period_end`. Gibt eine Position pro voller Periode + ggf.
 * eine anteilige am Ende zurück.
 *
 * Beispiele:
 * - Jahresposten 100€, period_start=01.01., period_end=15.07. → 1 Position mit
 *   quantity ≈ 0.5343..., amount = 53€ (anteilig).
 * - Monatsposten 10€, period_start=01.01., period_end=15.03. → 2 volle Positionen
 *   (Jan, Feb) à 10€ + 1 anteilige (1.-15.März) à ~4,84€.
 *
 * `lifetime`: gibt immer genau eine Position mit quantity=1 zurück.
 */
export function prorate(input: ProrateInput): ProrateLine[] {
  if (input.interval_unit === 'lifetime') {
    return [{
      period_start: input.period_start,
      period_end: input.period_end,
      quantity: 1,
      amount_cents: input.unit_price_cents,
    }]
  }

  if (input.period_end <= input.period_start) return []

  const lines: ProrateLine[] = []
  let cursor = input.period_start
  const startStr = fmt(cursor)
  let nextStr = addInterval(startStr, input.interval_unit, input.interval_count)
  let next = parseDt(nextStr)

  // Volle Perioden, die komplett vor period_end liegen
  while (next <= input.period_end) {
    lines.push({
      period_start: cursor,
      period_end: next,
      quantity: 1,
      amount_cents: input.unit_price_cents,
    })
    cursor = next
    nextStr = addInterval(fmt(cursor), input.interval_unit, input.interval_count)
    next = parseDt(nextStr)
  }

  // Anteiliger Rest, falls cursor < period_end
  if (cursor < input.period_end) {
    const fullPeriodSeconds = (next.getTime() - cursor.getTime()) / 1000
    const partialSeconds = (input.period_end.getTime() - cursor.getTime()) / 1000
    const quantity = partialSeconds / fullPeriodSeconds
    lines.push({
      period_start: cursor,
      period_end: input.period_end,
      quantity,
      amount_cents: Math.round(quantity * input.unit_price_cents),
    })
  }

  return lines
}

/**
 * Aggregiert mehrere Positionen aus prorate() in eine Summe — z.B. wenn alle
 * Perioden auf einer einzelnen Rechnungs-Zeile zusammengefasst werden sollen.
 */
export function aggregateProrate(lines: ProrateLine[]): ProrateLine | null {
  if (lines.length === 0) return null
  return {
    period_start: lines[0].period_start,
    period_end: lines[lines.length - 1].period_end,
    quantity: lines.reduce((s, l) => s + l.quantity, 0),
    amount_cents: lines.reduce((s, l) => s + l.amount_cents, 0),
  }
}
