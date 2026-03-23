export interface ParsedRecord {
  name: string
  type: string
  ttl: number | null       // null = no explicit TTL on record line → use domain default
  priority: number | null
  weight: number | null
  port: number | null
  value: string
}

const SUPPORTED_TYPES = new Set([
  'A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SRV', 'CAA', 'PTR', 'NAPTR', 'TLSA', 'SSHFP', 'DS',
])

const SKIP_TYPES = new Set([
  'SOA', 'DNSKEY', 'NSEC', 'NSEC3', 'NSEC3PARAM', 'RRSIG', 'CDS', 'CDNSKEY',
])

const ALL_KNOWN_TYPES = new Set([...SUPPORTED_TYPES, ...SKIP_TYPES])

// ── Helpers ──────────────────────────────────────────────────

function parseTtlStr(s: string): number {
  const m = s.match(/^(\d+)([smhdwSMHDW]?)$/)
  if (!m) return 0
  const n = parseInt(m[1], 10)
  const multipliers: Record<string, number> = { '': 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }
  return n * (multipliers[m[2].toLowerCase()] ?? 1)
}

function isTtlToken(t: string): boolean {
  return /^\d+[smhdwSMHDW]?$/.test(t)
}

function isClassToken(t: string): boolean {
  return ['IN', 'CH', 'HS', 'ANY'].includes(t.toUpperCase())
}

function isTypeToken(t: string): boolean {
  return ALL_KNOWN_TYPES.has(t.toUpperCase())
}

function stripTrailingDot(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1) : s
}

/** Strip inline comment (`;` outside quoted strings) */
function stripComment(line: string): string {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote
    if (!inQuote && line[i] === ';') return line.slice(0, i)
  }
  return line
}

/** Tokenize a line, keeping quoted strings as single tokens (preserving outer quotes) */
function tokenize(line: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < line.length) {
    if (/\s/.test(line[i])) { i++; continue }
    if (line[i] === '"') {
      let s = '"'
      i++
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) { s += line[i + 1]; i += 2 }
        else { s += line[i]; i++ }
      }
      s += '"'; i++
      tokens.push(s)
    } else {
      let s = ''
      while (i < line.length && !/\s/.test(line[i])) { s += line[i]; i++ }
      tokens.push(s)
    }
  }
  return tokens
}

/**
 * Normalize a DNS name to a relative label for this zone.
 * Returns '@' for apex, a relative label for subdomains, null for out-of-zone names.
 */
function normalizeName(name: string, currentOrigin: string, zoneOrigin: string): string | null {
  if (name === '@') return '@'

  if (name.endsWith('.')) {
    // Absolute FQDN
    if (name === zoneOrigin) return '@'
    if (name.endsWith('.' + zoneOrigin)) {
      // e.g. "www.example.com." with zoneOrigin "example.com." → "www"
      return name.slice(0, -(zoneOrigin.length + 1))
    }
    return null // out of zone
  }

  // Relative label — expand with currentOrigin and re-normalize
  return normalizeName(name + '.' + currentOrigin, currentOrigin, zoneOrigin)
}

// ── Per-type rdata parser ─────────────────────────────────────

function parseRdata(type: string, rdata: string[], name: string, ttl: number | null): ParsedRecord | null {
  const base = { name, type, ttl, priority: null as number | null, weight: null as number | null, port: null as number | null }

  switch (type) {
    case 'A':
    case 'AAAA':
    case 'PTR':
      return { ...base, value: rdata[0] ?? '' }

    case 'CNAME':
    case 'NS':
      return { ...base, value: stripTrailingDot(rdata[0] ?? '') }

    case 'MX':
      return { ...base, priority: parseInt(rdata[0] ?? '0', 10), value: stripTrailingDot(rdata[1] ?? '') }

    case 'SRV':
      return {
        ...base,
        priority: parseInt(rdata[0] ?? '0', 10),
        weight: parseInt(rdata[1] ?? '0', 10),
        port: parseInt(rdata[2] ?? '0', 10),
        value: stripTrailingDot(rdata[3] ?? ''),
      }

    case 'TXT': {
      // Concatenate adjacent quoted-string segments, strip outer quotes
      const value = rdata
        .filter(t => t.startsWith('"') && t.endsWith('"'))
        .map(t => t.slice(1, -1))
        .join('')
      return { ...base, value }
    }

    case 'CAA':
    case 'NAPTR':
    case 'TLSA':
    case 'SSHFP':
    case 'DS':
      return { ...base, value: rdata.join(' ') }

    default:
      return null
  }
}

// ── Main parser ───────────────────────────────────────────────

export function parseZoneFile(
  text: string,
  zoneFqdn: string,
  defaultTtl: number,
): { records: ParsedRecord[]; skipped: string[] } {
  const zoneOrigin = zoneFqdn.endsWith('.') ? zoneFqdn : zoneFqdn + '.'

  // Step 1: Strip comments and collapse multi-line parenthesized spans
  const logical: Array<{ line: string; startsWithWS: boolean }> = []
  let buffer = ''
  let bufferStartsWithWS = false
  let parenDepth = 0

  for (const rawLine of text.split('\n')) {
    const stripped = stripComment(rawLine)
    const startsWithWS = rawLine.length > 0 && /^\s/.test(rawLine) && stripped.trim().length > 0
    const trimmed = stripped.trim()
    if (!trimmed) continue

    let inQ = false
    for (const ch of stripped) {
      if (ch === '"') inQ = !inQ
      if (!inQ && ch === '(') parenDepth++
      if (!inQ && ch === ')') parenDepth--
    }

    if (buffer === '') {
      buffer = trimmed
      bufferStartsWithWS = startsWithWS
    } else {
      buffer += ' ' + trimmed
    }

    if (parenDepth <= 0) {
      logical.push({
        line: buffer.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(),
        startsWithWS: bufferStartsWithWS,
      })
      buffer = ''
      bufferStartsWithWS = false
      parenDepth = 0
    }
  }
  if (buffer.trim()) {
    logical.push({
      line: buffer.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(),
      startsWithWS: bufferStartsWithWS,
    })
  }

  // Step 2: Parse logical lines
  let currentOrigin = zoneOrigin
  let lastOwner = '@'
  const records: ParsedRecord[] = []
  const skipCounts: Record<string, number> = {}

  for (const { line, startsWithWS } of logical) {
    if (!line) continue

    // Directives
    const upper = line.toUpperCase()
    if (upper.startsWith('$ORIGIN')) {
      const parts = line.split(/\s+/)
      if (parts[1]) currentOrigin = parts[1].endsWith('.') ? parts[1] : parts[1] + '.'
      continue
    }
    if (upper.startsWith('$TTL')) {
      // We intentionally do NOT use $TTL — records without explicit TTL get null (domain default)
      continue
    }
    if (line.startsWith('$')) {
      const directive = line.split(/\s+/)[0]
      skipCounts[directive] = (skipCounts[directive] ?? 0) + 1
      continue
    }

    const tokens = tokenize(line)
    if (!tokens.length) continue

    let i = 0
    let rawOwner: string

    if (startsWithWS) {
      rawOwner = lastOwner
    } else {
      rawOwner = tokens[0]; i++
    }
    lastOwner = rawOwner

    const normalizedName = normalizeName(rawOwner, currentOrigin, zoneOrigin)
    if (normalizedName === null) {
      skipCounts['out-of-zone'] = (skipCounts['out-of-zone'] ?? 0) + 1
      continue
    }

    // Scan for TTL, class, type
    let ttl: number | null = null
    let type: string | null = null

    while (i < tokens.length) {
      const t = tokens[i]
      if (isTtlToken(t)) { ttl = parseTtlStr(t); i++ }
      else if (isClassToken(t)) { i++ }
      else if (isTypeToken(t)) { type = t.toUpperCase(); i++; break }
      else { break }
    }

    if (!type) continue

    const rdata = tokens.slice(i)

    if (SKIP_TYPES.has(type)) {
      skipCounts[type] = (skipCounts[type] ?? 0) + 1
      continue
    }

    if (type === 'NS' && normalizedName === '@') {
      skipCounts['apex NS'] = (skipCounts['apex NS'] ?? 0) + 1
      continue
    }

    const rec = parseRdata(type, rdata, normalizedName, ttl)
    if (rec) records.push(rec)
  }

  // Build human-readable skipped summary
  const skipped: string[] = []
  for (const [key, count] of Object.entries(skipCounts)) {
    if (key === 'SOA') skipped.push('SOA (system-managed)')
    else if (key === 'apex NS') skipped.push(`${count} apex NS record${count > 1 ? 's' : ''} (system-managed)`)
    else if (key === 'DNSKEY' || key === 'NSEC' || key === 'NSEC3' || key === 'NSEC3PARAM' || key === 'RRSIG' || key === 'CDS' || key === 'CDNSKEY')
      skipped.push(`${count} ${key} record${count > 1 ? 's' : ''} (DNSSEC, not supported)`)
    else if (key === 'out-of-zone') skipped.push(`${count} out-of-zone record${count > 1 ? 's' : ''}`)
    else if (key.startsWith('$')) skipped.push(`${key} directive (not supported)`)
    else skipped.push(`${count} ${key} record${count > 1 ? 's' : ''} (unknown type)`)
  }

  return { records, skipped }
}
