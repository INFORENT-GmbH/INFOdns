// Pure helpers for advancing/computing billing periods.
// All datetimes use the "YYYY-MM-DD HH:MM:SS" string format that MariaDB
// expects in DATETIME columns. UTC throughout — see note in CLAUDE.md.

export type IntervalUnit = 'second'|'minute'|'hour'|'day'|'week'|'month'|'year'|'lifetime'

function pad(n: number): string { return n < 10 ? `0${n}` : String(n) }

function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function parse(s: string): Date {
  // Accept "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DD", or ISO 8601.
  if (s.includes('T')) return new Date(s)
  if (s.includes(' ')) return new Date(s.replace(' ', 'T') + 'Z')
  return new Date(s + 'T00:00:00Z')
}

/**
 * Advance an anchor timestamp by `count` units. Calendar-aware for month/year:
 * Feb 29 + 1 year → Feb 28 of the next non-leap year (clamped). Sub-day units
 * use millisecond arithmetic.
 */
export function addInterval(anchor: string, unit: IntervalUnit, count: number): string {
  if (unit === 'lifetime') return anchor
  const d = parse(anchor)
  switch (unit) {
    case 'second': d.setUTCSeconds(d.getUTCSeconds() + count); break
    case 'minute': d.setUTCMinutes(d.getUTCMinutes() + count); break
    case 'hour':   d.setUTCHours(d.getUTCHours()     + count); break
    case 'day':    d.setUTCDate(d.getUTCDate()       + count); break
    case 'week':   d.setUTCDate(d.getUTCDate()       + count * 7); break
    case 'month': {
      const day = d.getUTCDate()
      d.setUTCDate(1)
      d.setUTCMonth(d.getUTCMonth() + count)
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
      d.setUTCDate(Math.min(day, lastDay))
      break
    }
    case 'year': {
      const day = d.getUTCDate()
      const targetYear = d.getUTCFullYear() + count
      d.setUTCDate(1)
      d.setUTCFullYear(targetYear)
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
      d.setUTCDate(Math.min(day, lastDay))
      break
    }
  }
  return fmt(d)
}

/**
 * Convenience: when does the *next* invoice covering this item become due?
 * For new items this is `started_at + interval`. The poller uses the same
 * function with `last_billed_until` as anchor.
 */
export function computeNextDueAt(anchor: string, unit: IntervalUnit, count: number): string {
  return addInterval(anchor, unit, count)
}
