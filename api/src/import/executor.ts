import type { PoolConnection } from 'mysql2/promise.js'
import { createBillingItemForDomain } from '../billing/items.js'

// ── Source row types (read from isp.*) ───────────────────────

export interface IspCompany {
  id: number
  name: string
}

export interface IspDomain {
  fqdn: string
  tenant_id: number
  publish: number
  notes: string | null
  notes_internal: string | null
  cost_center: string | null
  brand: string | null
  ns_reference: string | null
  smtp_to: string | null
  spam_to: string | null
  add_fee: number | null
  we_registered: number
  flag: string | null
}

export interface IspTldPricing {
  zone: string
  tld: string
  description: string | null
  cost: number | null
  fee: number | null
  default_registrar: string | null
  note: string | null
  price_udr: number | null
  price_cn: number | null
  price_marcaria: number | null
  price_ud: number | null
}

export interface IspNsRecord {
  domain_fqdn: string
  name: string
  type: string
  priority: number | null
  value: string
  ttl: number | null
}

// ── Results ──────────────────────────────────────────────────

export interface ImportCounts {
  inserted: number
  updated: number
  skipped: number
  deleted: number
}

// ── Tenant import ─────────────────────────────────────────────

export async function importTenants(
  rows: IspCompany[],
  conn: PoolConnection
): Promise<Pick<ImportCounts, 'inserted' | 'updated'>> {
  let inserted = 0
  let updated = 0

  for (const row of rows) {
    const [existing] = await conn.execute<any[]>(
      'SELECT id FROM tenants WHERE id = ?',
      [row.id]
    )
    if ((existing as any[]).length > 0) {
      await conn.execute('UPDATE tenants SET name = ? WHERE id = ?', [row.name, row.id])
      updated++
    } else {
      await conn.execute(
        'INSERT INTO tenants (id, name, is_active) VALUES (?, ?, 1)',
        [row.id, row.name]
      )
      inserted++
    }
  }

  return { inserted, updated }
}

// ── TLD pricing import ────────────────────────────────────────

export async function importTldPricing(
  rows: IspTldPricing[],
  conn: PoolConnection
): Promise<Pick<ImportCounts, 'inserted' | 'updated'>> {
  let inserted = 0
  let updated = 0

  for (const row of rows) {
    const result = await conn.execute<any>(
      `INSERT INTO tld_pricing
         (zone, tld, description, cost, fee, default_registrar, note,
          price_udr, price_cn, price_marcaria, price_ud)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         tld               = VALUES(tld),
         description       = VALUES(description),
         cost              = VALUES(cost),
         fee               = VALUES(fee),
         default_registrar = VALUES(default_registrar),
         note              = VALUES(note),
         price_udr         = VALUES(price_udr),
         price_cn          = VALUES(price_cn),
         price_marcaria    = VALUES(price_marcaria),
         price_ud          = VALUES(price_ud)`,
      [
        row.zone, row.tld, row.description ?? null,
        row.cost ?? null, row.fee ?? null, row.default_registrar ?? null,
        row.note ?? null, row.price_udr ?? null, row.price_cn ?? null,
        row.price_marcaria ?? null, row.price_ud ?? null,
      ]
    )
    // affectedRows = 1 → insert, 2 → update, 0 → no-op (identical row)
    const affected = (result[0] as any).affectedRows
    if (affected === 1) inserted++
    else if (affected >= 2) updated++
  }

  return { inserted, updated }
}

// ── Domain import ─────────────────────────────────────────────

export async function importDomains(
  rows: IspDomain[],
  conn: PoolConnection,
  createdBy: number
): Promise<{ inserted: number; skipped: number; fqdnToId: Map<string, number> }> {
  let inserted = 0
  let skipped = 0
  const fqdnToId = new Map<string, number>()

  // Build map of all existing domains first (for fqdnToId, including pre-existing)
  const [existingRows] = await conn.execute<any[]>('SELECT id, fqdn FROM domains')
  for (const r of existingRows as any[]) {
    fqdnToId.set(r.fqdn, r.id)
  }

  for (const row of rows) {
    if (fqdnToId.has(row.fqdn)) {
      await conn.execute(
        'UPDATE domains SET ns_reference = ? WHERE id = ?',
        [row.ns_reference ?? null, fqdnToId.get(row.fqdn)!]
      )
      skipped++
      continue
    }

    // Look up default registrar from tld_pricing for this domain's TLD
    const tldParts = row.fqdn.split('.')
    let registrar: string | null = null
    // Try longest-suffix match: e.g. "co.uk", then "uk"
    for (let i = 1; i < tldParts.length; i++) {
      const zone = tldParts.slice(i).join('.')
      const [tldRow] = await conn.execute<any[]>(
        'SELECT default_registrar FROM tld_pricing WHERE zone = ?',
        [zone]
      )
      if ((tldRow as any[]).length > 0) {
        registrar = (tldRow as any[])[0].default_registrar ?? null
        break
      }
    }

    const result = await conn.execute<any>(
      `INSERT INTO domains
         (tenant_id, fqdn, status, notes, notes_internal, cost_center, brand,
          ns_reference, smtp_to, spam_to, add_fee, we_registered, flag, publish, registrar)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.tenant_id, row.fqdn, row.notes ?? null, row.notes_internal ?? null,
        row.cost_center ?? null, row.brand ?? null, row.ns_reference ?? null,
        row.smtp_to ?? null, row.spam_to ?? null, row.add_fee ?? null,
        row.we_registered, row.flag ?? null, row.publish, registrar,
      ]
    )
    const newId = (result[0] as any).insertId
    fqdnToId.set(row.fqdn, newId)
    inserted++

    if (row.publish) {
      await conn.execute(
        `INSERT INTO zone_render_queue (domain_id, priority)
         VALUES (?, 5)
         ON DUPLICATE KEY UPDATE status = 'pending', retries = 0, error = NULL`,
        [newId]
      )
      await conn.execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [newId])
    }

    // Abrechnungsposten mitschreiben (idempotent — gleicher Connection, gleiche Transaktion)
    try {
      await createBillingItemForDomain({
        domainId: newId,
        tenantId: row.tenant_id,
        fqdn: row.fqdn,
        createdBy,
        conn,
      })
    } catch (err) {
      console.warn(`[import] billing_item auto-create skipped for ${row.fqdn}:`, (err as Error).message)
    }
  }

  return { inserted, skipped, fqdnToId }
}

// ── DNS record import ─────────────────────────────────────────

export async function importRecords(
  rows: IspNsRecord[],
  fqdnToId: Map<string, number>,
  conn: PoolConnection
): Promise<Pick<ImportCounts, 'deleted' | 'inserted'>> {
  let deleted = 0
  let inserted = 0

  // Group records by domain fqdn
  const byDomain = new Map<string, IspNsRecord[]>()
  for (const row of rows) {
    if (!fqdnToId.has(row.domain_fqdn)) continue
    const list = byDomain.get(row.domain_fqdn) ?? []
    list.push(row)
    byDomain.set(row.domain_fqdn, list)
  }

  for (const [fqdn, records] of byDomain) {
    const domainId = fqdnToId.get(fqdn)!

    const [del] = await conn.execute<any>(
      'DELETE FROM dns_records WHERE domain_id = ?',
      [domainId]
    )
    deleted += (del as any).affectedRows

    for (const rec of records) {
      let priority: number | null = rec.priority ?? null
      let weight: number | null = null
      let port: number | null = null
      let value = rec.value

      if (rec.type === 'SRV') {
        // Legacy isp.ns.ENTRY holds the full SRV rdata in one field:
        // "<priority> <weight> <port> <target>". Split into proper columns.
        const parts = value.trim().split(/\s+/)
        if (parts.length === 4) {
          priority = parseInt(parts[0], 10)
          weight = parseInt(parts[1], 10)
          port = parseInt(parts[2], 10)
          value = parts[3].endsWith('.') ? parts[3].slice(0, -1) : parts[3]
        }
      }

      await conn.execute(
        `INSERT INTO dns_records (domain_id, name, type, priority, weight, port, value, ttl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          domainId,
          rec.name ?? '@',
          rec.type,
          priority,
          weight,
          port,
          value,
          rec.ttl ?? null,
        ]
      )
      inserted++
    }
  }

  return { deleted, inserted }
}
