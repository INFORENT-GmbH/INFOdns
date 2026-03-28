import { promises as dns } from 'dns'
import { query, execute } from './db.js'
import { broadcastEvent } from './broadcast.js'

interface DomainRow {
  id: number
  fqdn: string
  ns_ok: number | null
  zone_status: string
}

const FILTER_SQL: Record<string, string> = {
  all:     "status = 'active'",
  pending: "status = 'active' AND (ns_ok IS NULL OR ns_ok = 0)",
  ok:      "status = 'active' AND ns_ok = 1",
}

export async function checkNsDelegation(
  nsRecords: string[],
  filter: 'all' | 'pending' | 'ok' = 'all'
): Promise<void> {
  const expected = new Set(
    nsRecords.map(r => r.toLowerCase().replace(/\.$/, ''))
  )
  if (expected.size === 0) return

  const domains = await query<DomainRow>(
    `SELECT id, fqdn, ns_ok, zone_status FROM domains WHERE ${FILTER_SQL[filter]}`
  )

  for (const domain of domains) {
    let newOk: number | null = domain.ns_ok

    try {
      const resolved = await dns.resolveNs(domain.fqdn)
      const actual = resolved.map(r => r.toLowerCase().replace(/\.$/, ''))
      newOk = (actual.length === expected.size && actual.every(ns => expected.has(ns))) ? 1 : 0
    } catch (err: any) {
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
        newOk = null  // unregistered / no NS records in public DNS
      } else if (err.code === 'ESERVFAIL' || err.code === 'ETIMEDOUT') {
        console.warn(`[nsDelegation] transient DNS error for ${domain.fqdn}: ${err.code}`)
        continue  // keep previous value, skip DB write
      } else {
        console.warn(`[nsDelegation] DNS lookup failed for ${domain.fqdn}: ${err.message}`)
        continue
      }
    }

    await execute(
      'UPDATE domains SET ns_ok = ?, ns_checked_at = NOW() WHERE id = ?',
      [newOk, domain.id]
    )

    if (newOk !== domain.ns_ok) {
      broadcastEvent({
        type: 'domain_status',
        domainId: domain.id,
        fqdn: domain.fqdn,
        zone_status: domain.zone_status,
        ns_ok: newOk,
      })
    }
  }

  if (domains.length > 0) {
    console.log(`[nsDelegation] Checked ${domains.length} ${filter} domains`)
  }
}
