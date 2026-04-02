import { query, queryOne, execute, transaction, pool } from './db.js'
import { claimSerial } from './serialNumber.js'
import { renderZone } from './renderZone.js'
import { validateZone } from './validateZone.js'
import { deployZone } from './deployZone.js'
import { regenerateNamedConf } from './namedConf.js'
import { pollBulkJobs } from './bulkExecutor.js'
import { checkNsDelegation } from './nsDelegation.js'
import { checkDnssec } from './dnssecCheck.js'
import { broadcastEvent } from './broadcast.js'
import { queueMail, pollMailQueue } from './mailer.js'
import { pollImap } from './ticketMailImporter.js'
import { promises as dns } from 'dns'
import { existsSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

const BIND_KEYS_DIR = process.env.BIND_KEYS_DIR ?? '/bind/primary/keys'

const POLL_INTERVAL_MS         = Number(process.env.POLL_INTERVAL_MS ?? 2000)
const BATCH_SIZE               = Number(process.env.BATCH_SIZE ?? 10)
const MAIL_ADMIN_TO            = process.env.MAIL_ADMIN_TO ?? ''
const ALIAS_REFRESH_INTERVAL_MS = Number(process.env.ALIAS_REFRESH_INTERVAL_MS ?? 10_000)

const NS_RECORDS: string[] = (process.env.NS_RECORDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

if (NS_RECORDS.length === 0) {
  console.warn('[worker] WARNING: NS_RECORDS is empty — zones will have no NS records')
}

// ── Types ────────────────────────────────────────────────────

interface QueueRow {
  id: number
  domain_id: number
  retries: number
  max_retries: number
}

interface DomainRow {
  id: number
  fqdn: string
  default_ttl: number
  tenant_id: number
  status: string
}

interface SoaRow {
  mname: string
  rname: string
  refresh: number
  retry: number
  expire: number
  minimum_ttl: number
}

interface RecordRow {
  name: string
  type: string
  ttl: number | null
  priority: number | null
  weight: number | null
  port: number | null
  value: string
}

// ── DNSSEC DNSKEY extraction ──────────────────────────────────

/**
 * Extract DNSKEY data from a BIND public key file.
 * Returns "<flags> <protocol> <algorithm> <base64key>" or null if not a KSK/CSK.
 */
function extractDnskeyFromKeyFile(content: string): string | null {
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith(';')) continue
    const m = line.match(/DNSKEY\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)$/)
    if (!m) continue
    const [, flags, protocol, algorithm, key] = m
    if (Number(flags) & 1) return `${flags} ${protocol} ${algorithm} ${key}`
  }
  return null
}

async function extractDsRecords(fqdn: string): Promise<string | null> {
  // BIND writes key files asynchronously — retry a few times
  for (let attempt = 1; attempt <= 5; attempt++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const files = await readdir(BIND_KEYS_DIR)
      const prefix = `K${fqdn}.`
      const keyFiles = files.filter(f => f.startsWith(prefix) && f.endsWith('.key'))
      if (keyFiles.length === 0) continue
      for (const kf of keyFiles) {
        const content = await readFile(join(BIND_KEYS_DIR, kf), 'utf8')
        const dnskey = extractDnskeyFromKeyFile(content)
        if (dnskey) return dnskey
      }
    } catch (err: any) {
      console.warn(`[worker] DNSKEY extraction attempt ${attempt}/5:`, err.message)
    }
  }
  return null
}

// ── Core render pipeline ─────────────────────────────────────

async function processJob(job: QueueRow): Promise<void> {
  const domainId = job.domain_id
  console.log(`[worker] Processing job ${job.id} for domain ${domainId}`)

  // Step 2: Load domain + records + SOA template
  const domain = await queryOne<DomainRow>('SELECT id, fqdn, default_ttl, tenant_id, status FROM domains WHERE id = ?', [domainId])
  if (!domain) throw new Error(`Domain ${domainId} not found`)

  // Non-active domain: just sync named.conf to remove it from BIND, skip render
  if (domain.status !== 'active') {
    const allDomains = await query<{ fqdn: string; dnssec_enabled: number }>(
      "SELECT fqdn, dnssec_enabled FROM domains WHERE status = 'active' ORDER BY fqdn"
    )
    await regenerateNamedConf(allDomains.map(r => ({ fqdn: r.fqdn, dnssec_enabled: !!r.dnssec_enabled })))
    await execute("UPDATE zone_render_queue SET status = 'done', updated_at = NOW() WHERE id = ?", [job.id])
    console.log(`[worker] Job ${job.id} — ${domain.fqdn} is ${domain.status}, synced named.conf, skipped render`)
    return
  }

  const records = await query<RecordRow>(
    `SELECT name, type, ttl, priority, weight, port, value
     FROM dns_records WHERE domain_id = ? AND is_deleted = 0`,
    [domainId]
  )

  const soa = await queryOne<SoaRow>(
    `SELECT mname, rname, refresh, retry, expire, minimum_ttl
     FROM soa_templates WHERE tenant_id = ? OR tenant_id IS NULL
     ORDER BY tenant_id DESC LIMIT 1`,
    [domain.tenant_id]
  )
  if (!soa) throw new Error('No SOA template found')

  // Step 3: Claim serial inside a transaction with FOR UPDATE
  const serial = await transaction(async (conn) => claimSerial(conn, domainId))

  // Step 4: Render zone in memory (async — ALIAS records are resolved via DNS)
  const content = await renderZone(domain, records, soa, serial, NS_RECORDS)

  // Step 5: Validate with named-checkzone
  const validation = await validateZone(domain.fqdn, content)
  if (!validation.ok) {
    throw new Error(`named-checkzone failed: ${validation.error}`)
  }

  // Step 6: Ensure named.conf.local is up-to-date (covers newly added domains)
  const allDomains = await query<{ fqdn: string; dnssec_enabled: number }>(
    "SELECT fqdn, dnssec_enabled FROM domains WHERE status = 'active' ORDER BY fqdn"
  )
  const allZones = allDomains.map(r => r.fqdn)
  console.log(`[worker] Syncing named.conf.local with ${allZones.length} zones (includes ${domain.fqdn}: ${allZones.includes(domain.fqdn)})`)
  await regenerateNamedConf(allDomains.map(r => ({ fqdn: r.fqdn, dnssec_enabled: !!r.dnssec_enabled })))

  // Step 7: Atomic file replace + rndc reload
  await deployZone(domain.fqdn, content)

  // Step 7b: Extract DS records for DNSSEC-enabled domains (best-effort, non-fatal)
  const dnssecRow = await queryOne<{ dnssec_enabled: number }>(
    'SELECT dnssec_enabled FROM domains WHERE id = ?', [domainId]
  )
  if (dnssecRow?.dnssec_enabled) {
    const ds = await extractDsRecords(domain.fqdn)
    if (ds !== null) {
      await execute('UPDATE domains SET dnssec_ds = ? WHERE id = ?', [ds, domainId])
    }
  } else {
    await execute('UPDATE domains SET dnssec_ds = NULL, dnssec_ok = NULL, dnssec_checked_at = NULL WHERE id = ?', [domainId])
  }

  // Step 8: Mark domain clean
  await execute(
    "UPDATE domains SET zone_status = 'clean', last_rendered_at = NOW() WHERE id = ?",
    [domainId]
  )
  await execute(
    "UPDATE zone_render_queue SET status = 'done', updated_at = NOW() WHERE id = ?",
    [job.id]
  )

  const rendered = await queryOne<{ last_rendered_at: string }>('SELECT last_rendered_at FROM domains WHERE id = ?', [domainId])
  broadcastEvent({ type: 'domain_status', domainId, fqdn: domain.fqdn, zone_status: 'clean', last_serial: serial, last_rendered_at: rendered?.last_rendered_at ?? null, zone_error: null })
  if (MAIL_ADMIN_TO) {
    queueMail(MAIL_ADMIN_TO, 'zone_deploy_success', { fqdn: domain.fqdn, jobId: job.id, serial, renderedAt: rendered?.last_rendered_at ?? 'unknown' })
  }

  console.log(`[worker] Job ${job.id} done — ${domain.fqdn} serial ${serial}`)
}

// ── Poll loop ─────────────────────────────────────────────────

let running = true

async function poll(): Promise<void> {
  // Claim a batch of pending jobs with optimistic locking
  const candidates = await query<QueueRow>(
    `SELECT id, domain_id, retries, max_retries
     FROM zone_render_queue
     WHERE status = 'pending'
     ORDER BY priority DESC, created_at ASC
     LIMIT ?`,
    [BATCH_SIZE]
  )

  for (const job of candidates) {
    // Optimistic claim — only one worker will succeed per job
    const result = await execute(
      `UPDATE zone_render_queue SET status = 'processing', updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [job.id]
    )
    if (result.affectedRows === 0) continue  // another worker claimed it

    try {
      await processJob(job)
    } catch (err: any) {
      console.error(`[worker] Job ${job.id} failed:`, err.message)
      const newRetries = job.retries + 1
      if (newRetries >= job.max_retries) {
        await execute(
          `UPDATE zone_render_queue SET status = 'failed', retries = ?, error = ?, updated_at = NOW() WHERE id = ?`,
          [newRetries, err.message, job.id]
        )
        await execute("UPDATE domains SET zone_status = 'error' WHERE id = ?", [job.domain_id])
        const failedDomain = await queryOne<{ fqdn: string }>('SELECT fqdn FROM domains WHERE id = ?', [job.domain_id])
        if (failedDomain) {
          broadcastEvent({ type: 'domain_status', domainId: job.domain_id, fqdn: failedDomain.fqdn, zone_status: 'error', zone_error: err.message })
          if (MAIL_ADMIN_TO) {
            queueMail(MAIL_ADMIN_TO, 'zone_deploy_failed', { fqdn: failedDomain.fqdn, jobId: job.id, retries: newRetries, error: err.message })
          }
        }
      } else {
        // Back to pending for retry
        await execute(
          `UPDATE zone_render_queue SET status = 'pending', retries = ?, error = ?, updated_at = NOW() WHERE id = ?`,
          [newRetries, err.message, job.id]
        )
      }
    }
  }
}

// ── named.conf.local maintenance ─────────────────────────────
// Runs every 60s to pick up newly added/deleted domains and regenerate conf files.

async function syncNamedConf(): Promise<void> {
  try {
    const rows = await query<{ fqdn: string; dnssec_enabled: number }>(
      "SELECT fqdn, dnssec_enabled FROM domains WHERE status = 'active' ORDER BY fqdn"
    )
    const zones = rows.map(r => ({ fqdn: r.fqdn, dnssec_enabled: !!r.dnssec_enabled }))
    await regenerateNamedConf(zones)
    console.log(`[worker] named.conf.local synced — ${zones.length} zones`)
  } catch (err: any) {
    console.error('[worker] named.conf.local sync failed:', err.message)
  }
}

// ── Domain lifecycle: reminders + hard purge ─────────────────

const REMINDER_SCHEDULE: { daysRemaining: number; bit: number }[] = [
  { daysRemaining: 21, bit: 1 },
  { daysRemaining: 14, bit: 2 },
  { daysRemaining: 7,  bit: 4 },
  { daysRemaining: 3,  bit: 8 },
  { daysRemaining: 2,  bit: 16 },
  { daysRemaining: 1,  bit: 32 },
]

async function processDomainLifecycle(): Promise<void> {
  try {
    const deleted = await query<{ id: number; fqdn: string; deleted_at: string; reminder_flags: number }>(
      "SELECT id, fqdn, deleted_at, reminder_flags FROM domains WHERE status = 'deleted' AND deleted_at IS NOT NULL"
    )
    if (deleted.length === 0) return

    const admins = await query<{ email: string }>(
      "SELECT email FROM users WHERE role = 'admin' AND is_active = 1"
    )

    for (const domain of deleted) {
      const deletedMs = new Date(domain.deleted_at).getTime()
      const daysElapsed = (Date.now() - deletedMs) / 86400_000

      if (daysElapsed >= 30) {
        await execute('DELETE FROM domains WHERE id = ?', [domain.id])
        console.log(`[worker] Purged domain ${domain.fqdn} (id=${domain.id}) — exceeded 30-day retention`)
        continue
      }

      const daysRemaining = Math.ceil(30 - daysElapsed)
      const purgeDate = new Date(deletedMs + 30 * 86400_000).toISOString().slice(0, 10)
      const deletedAt = new Date(domain.deleted_at).toISOString().slice(0, 10)
      let newFlags = domain.reminder_flags

      for (const { daysRemaining: threshold, bit } of REMINDER_SCHEDULE) {
        const dueAfterDays = 30 - threshold
        if (daysElapsed >= dueAfterDays && !(newFlags & bit)) {
          for (const admin of admins) {
            queueMail(admin.email, 'domain_purge_reminder', { fqdn: domain.fqdn, daysRemaining, deletedAt, purgeDate })
          }
          newFlags |= bit
        }
      }

      if (newFlags !== domain.reminder_flags) {
        await execute('UPDATE domains SET reminder_flags = ? WHERE id = ?', [newFlags, domain.id])
      }
    }
  } catch (err: any) {
    console.error('[worker] processDomainLifecycle failed:', err.message)
  }
}

// ── Startup: re-queue zones with missing zone files ──────────

const ZONE_DIR = process.env.ZONE_DIR ?? '/bind/primary/zones'

async function requeueMissingZones(): Promise<void> {
  const rows = await query<{ id: number; fqdn: string }>(
    "SELECT id, fqdn FROM domains WHERE status = 'active'"
  )
  const missing: string[] = []
  for (const { id, fqdn } of rows) {
    if (!existsSync(join(ZONE_DIR, `${fqdn}.zone`))) {
      missing.push(fqdn)
      await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [id])
      await execute(
        `INSERT INTO zone_render_queue (domain_id, priority)
         VALUES (?, 5)
         ON DUPLICATE KEY UPDATE status = 'pending', retries = 0, error = NULL`,
        [id]
      )
    }
  }
  if (missing.length > 0) {
    console.log(`[worker] Re-queued ${missing.length} zones with missing files: ${missing.join(', ')}`)
  }
}

// ── ALIAS refresh: re-queue zones with ALIAS records ─────────
// Resolves each ALIAS target and only re-queues if the IPs actually changed.

interface AliasRecordRow {
  record_id: number
  domain_id: number
  fqdn: string
  alias_target: string
  alias_resolved: string | null
}

async function requeueAliasZones(): Promise<void> {
  try {
    const rows = await query<AliasRecordRow>(
      `SELECT r.id AS record_id, d.id AS domain_id, d.fqdn, r.value AS alias_target, r.alias_resolved
       FROM domains d
       JOIN dns_records r ON r.domain_id = d.id
       WHERE d.status = 'active' AND r.type = 'ALIAS' AND r.is_deleted = 0`
    )
    if (rows.length === 0) return

    const changedDomains = new Set<number>()

    for (const row of rows) {
      let v4: string[] = []
      let v6: string[] = []
      try {
        v4 = await dns.resolve4(row.alias_target)
      } catch (err: any) {
        if (err.code === 'ESERVFAIL' || err.code === 'ETIMEDOUT') continue
        // ENOTFOUND / ENODATA → no IPs, treat as empty
      }
      try {
        v6 = await dns.resolve6(row.alias_target)
      } catch { /* IPv6 is optional */ }

      const fingerprint = [...v4, ...v6].sort().join(',')
      if (fingerprint === (row.alias_resolved ?? '')) continue

      await execute('UPDATE dns_records SET alias_resolved = ? WHERE id = ?', [fingerprint, row.record_id])
      changedDomains.add(row.domain_id)
    }

    for (const domainId of changedDomains) {
      await execute(
        `INSERT INTO zone_render_queue (domain_id, priority)
         VALUES (?, 1)
         ON DUPLICATE KEY UPDATE status = 'pending', retries = 0, error = NULL`,
        [domainId]
      )
    }

    if (changedDomains.size > 0) {
      console.log(`[worker] ALIAS refresh: re-queued ${changedDomains.size} zone(s) with changed IPs`)
    }
  } catch (err: any) {
    console.error('[worker] requeueAliasZones failed:', err.message)
  }
}

// ── Entry point ───────────────────────────────────────────────

console.log('[worker] Starting INFOdns Worker')

// Re-queue any zones missing their zone files (e.g. after redeploy)
await requeueMissingZones()

// Initial conf sync, then every 60s
await syncNamedConf()
setInterval(syncNamedConf, 60_000)

// Domain lifecycle: reminders + hard purge, hourly
await processDomainLifecycle()
setInterval(processDomainLifecycle, 60 * 60 * 1000)

// ALIAS refresh: re-queue domains with ALIAS records on a fixed interval
setInterval(requeueAliasZones, ALIAS_REFRESH_INTERVAL_MS)

// NS delegation check: all on startup, then split by status
await checkNsDelegation(NS_RECORDS, 'all')
// Pending/mismatch domains: every 15s (fast feedback when delegation is set)
setInterval(() => checkNsDelegation(NS_RECORDS, 'pending').catch(err =>
  console.error('[worker] checkNsDelegation (pending) failed:', err.message)
), 15_000)
// Ok domains: every 5 minutes (steady-state confirmation)
setInterval(() => checkNsDelegation(NS_RECORDS, 'ok').catch(err =>
  console.error('[worker] checkNsDelegation (ok) failed:', err.message)
), 5 * 60 * 1000)

// DNSSEC check: DNSKEY visibility in public DNS
await checkDnssec('all')
// Pending/broken: every 30s (DNSKEY propagation takes time after signing)
setInterval(() => checkDnssec('pending').catch(err =>
  console.error('[worker] checkDnssec (pending) failed:', err.message)
), 30_000)
// Ok domains: every 10 minutes (steady-state confirmation)
setInterval(() => checkDnssec('ok').catch(err =>
  console.error('[worker] checkDnssec (ok) failed:', err.message)
), 10 * 60 * 1000)

// Poll loop
;(async function loop() {
  while (running) {
    try {
      await poll()
      await pollBulkJobs()
      await pollMailQueue()
      await pollImap()
    } catch (err: any) {
      console.error('[worker] Poll error:', err.message)
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  await pool.end()
  console.log('[worker] Shut down cleanly')
})()

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[worker] SIGTERM received — finishing current job then exiting')
  running = false
})
process.on('SIGINT', () => {
  running = false
})
