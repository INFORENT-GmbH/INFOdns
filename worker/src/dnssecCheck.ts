import { execFile } from 'child_process'
import { promisify } from 'util'
import { query, execute } from './db.js'
import { broadcastEvent } from './broadcast.js'
import { queueMail } from './mailer.js'

const execFileAsync = promisify(execFile)

interface DomainRow {
  id: number
  fqdn: string
  tenant_id: number
  dnssec_ok: number | null
  zone_status: string
}

const FILTER_SQL: Record<string, string> = {
  all:     "status = 'active' AND publish = 1 AND dnssec_enabled = 1",
  pending: "status = 'active' AND publish = 1 AND dnssec_enabled = 1 AND (dnssec_ok IS NULL OR dnssec_ok = 0)",
  ok:      "status = 'active' AND publish = 1 AND dnssec_enabled = 1 AND dnssec_ok = 1",
}

/**
 * Check end-to-end DNSSEC validation by querying a validating resolver and
 * looking for the AD (Authenticated Data) flag in the response. NOERROR
 * without AD means the resolver returned data but couldn't validate the
 * chain of trust — typically because no DS exists at the parent registry.
 */
export async function isDnssecValidated(fqdn: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('dig', [
      '+dnssec', '+timeout=5', '+tries=2', '+noshort',
      'SOA', fqdn, '@1.1.1.1',
    ])
    if (!/->>HEADER<<-.*status:\s*NOERROR/i.test(stdout)) return false
    return /;;\s*flags:[^;]*\bad\b/i.test(stdout)
  } catch {
    return false
  }
}

export async function checkDnssec(filter: 'all' | 'pending' | 'ok' = 'all'): Promise<void> {
  const domains = await query<DomainRow>(
    `SELECT id, fqdn, tenant_id, dnssec_ok, zone_status FROM domains WHERE ${FILTER_SQL[filter]}`
  )

  for (const domain of domains) {
    let newOk: number

    try {
      newOk = (await isDnssecValidated(domain.fqdn)) ? 1 : 0
    } catch (err: any) {
      console.warn(`[dnssecCheck] dig failed for ${domain.fqdn}: ${err.message}`)
      continue
    }

    await execute(
      'UPDATE domains SET dnssec_ok = ?, dnssec_checked_at = NOW() WHERE id = ?',
      [newOk, domain.id]
    )

    if (newOk !== domain.dnssec_ok) {
      broadcastEvent({
        type: 'domain_status',
        domainId: domain.id,
        fqdn: domain.fqdn,
        zone_status: domain.zone_status,
        tenantId: domain.tenant_id,
        dnssec_ok: newOk,
      })

      const template = newOk === 1 ? 'dnssec_ok' : 'dnssec_broken'
      const admins = await query<{ email: string }>(
        "SELECT email FROM users WHERE role = 'admin' AND is_active = 1"
      )
      for (const admin of admins) {
        await queueMail(admin.email, template, { fqdn: domain.fqdn })
      }
    }
  }

  if (domains.length > 0) {
    console.log(`[dnssecCheck] Checked ${domains.length} ${filter} domains`)
  }
}
