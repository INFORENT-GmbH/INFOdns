import { query, queryOne, execute, transaction, pool } from './db.js'
import { claimSerial } from './serialNumber.js'
import { renderZone } from './renderZone.js'
import { validateZone } from './validateZone.js'
import { deployZone, rndcDnssecStatus, cleanupDnssecArtifacts, rndcReload } from './deployZone.js'
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
const BATCH_SIZE               = Number(process.env.BATCH_SIZE ?? 100)
const WORKER_CONCURRENCY       = Number(process.env.WORKER_CONCURRENCY ?? 10)
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
  ns_reference: string | null
  publish: number
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

interface DnssecKeyStatus {
  keytag: number
  dnskeyOmnipresent: boolean
}

/**
 * Parse `rndc dnssec -status <fqdn>` output. Each key block looks like:
 *
 *   key: 25839 (ECDSAP256SHA256), CSK
 *     ...
 *     - dnskey:         omnipresent
 *     - ds:             rumoured
 *     ...
 */
function parseRndcDnssecStatus(output: string): DnssecKeyStatus[] {
  const keys: DnssecKeyStatus[] = []
  const blocks = output.split(/\n(?=key:\s)/)
  for (const block of blocks) {
    const keyMatch = block.match(/^key:\s+(\d+)\s+\(/m)
    if (!keyMatch) continue
    const dnskeyMatch = block.match(/-\s+dnskey:\s+(\S+)/)
    keys.push({
      keytag: Number(keyMatch[1]),
      dnskeyOmnipresent: dnskeyMatch?.[1] === 'omnipresent',
    })
  }
  return keys
}

/**
 * Wait for BIND to finish KASP key generation, then read the active DNSKEY
 * out of the matching K<fqdn>.+<algo>+<keytag>.key file.
 *
 * Polls `rndc dnssec -status` for up to ~60s. Prefers a key with
 * DNSKEYState=omnipresent; falls back to whichever key is present at the
 * end if none has reached omnipresent yet (initial publication can be slow).
 */
async function extractDsRecords(fqdn: string): Promise<string | null> {
  const ATTEMPTS = 12
  const INTERVAL_MS = 5000
  let activeKeytag: number | null = null

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, INTERVAL_MS))
    try {
      const status = await rndcDnssecStatus(fqdn)
      const keys = parseRndcDnssecStatus(status)
      const omnipresent = keys.find(k => k.dnskeyOmnipresent)
      if (omnipresent) { activeKeytag = omnipresent.keytag; break }
      // No omnipresent key yet — accept any key on the final attempt so
      // freshly-published zones don't get stuck waiting for state convergence.
      if (attempt === ATTEMPTS - 1 && keys.length > 0) activeKeytag = keys[0].keytag
    } catch (err: any) {
      console.warn(`[worker] rndc dnssec -status ${fqdn} attempt ${attempt + 1}/${ATTEMPTS}: ${err.message}`)
    }
  }

  if (activeKeytag === null) {
    console.warn(`[worker] no DNSSEC key reported by BIND for ${fqdn} after ${(ATTEMPTS * INTERVAL_MS) / 1000}s`)
    return null
  }

  try {
    const files = await readdir(BIND_KEYS_DIR)
    // Filenames are K<fqdn>.+<NNN>+<NNNNN>.key (3-digit algo, 5-digit keytag)
    const tagSuffix = `+${String(activeKeytag).padStart(5, '0')}.key`
    const keyFile = files.find(f => f.startsWith(`K${fqdn}.+`) && f.endsWith(tagSuffix))
    if (!keyFile) {
      console.warn(`[worker] DNSKEY file for keytag ${activeKeytag} not found in ${BIND_KEYS_DIR} for ${fqdn}`)
      return null
    }
    const content = await readFile(join(BIND_KEYS_DIR, keyFile), 'utf8')
    return extractDnskeyFromKeyFile(content)
  } catch (err: any) {
    console.warn(`[worker] reading DNSKEY file for ${fqdn} failed: ${err.message}`)
    return null
  }
}

/**
 * Run extraction in the background and update the DB once a key is available.
 * Used by both processJob (post-deploy) and the periodic retry task.
 * Broadcasts a domain_status event on success so the UI re-fetches.
 */
function extractAndStoreDsAsync(domainId: number, fqdn: string, tenantId: number, zoneStatus: string): void {
  extractDsRecords(fqdn).then(async ds => {
    if (ds === null) return
    await execute('UPDATE domains SET dnssec_ds = ? WHERE id = ?', [ds, domainId])
    broadcastEvent({ type: 'domain_status', domainId, fqdn, zone_status: zoneStatus, tenantId })
    console.log(`[worker] DNSSEC DS extracted for ${fqdn}`)
  }).catch(err => console.warn(`[worker] DS extraction for ${fqdn} failed: ${err.message}`))
}

// ── named.conf cache ─────────────────────────────────────────
// regenerateNamedConf() is expensive (write file + rndc reconfig + rndc reload
// of catalog zone). For most renders — record edits on existing zones — the
// active zone set hasn't changed, so the conf doesn't need rewriting. We
// fingerprint the zone set and skip the rewrite when it matches the last
// successfully-applied state. The 60s syncNamedConf tick still force-rewrites
// to catch out-of-band drift.

let lastConfFingerprint: string | null = null
// Serialize ensureNamedConf so parallel jobs in the same batch don't all
// race to rewrite named.conf.local. The chain catches errors per-call so a
// single failure doesn't poison subsequent calls.
let confChain: Promise<unknown> = Promise.resolve()

function fingerprintZones(zones: { fqdn: string; dnssec_enabled: boolean }[]): string {
  return zones.map(z => `${z.fqdn}|${z.dnssec_enabled ? 1 : 0}`).sort().join(';')
}

async function ensureNamedConf(zones: { fqdn: string; dnssec_enabled: boolean }[]): Promise<void> {
  const next = confChain.catch(() => {}).then(async () => {
    const fp = fingerprintZones(zones)
    if (fp === lastConfFingerprint) return
    await regenerateNamedConf(zones)
    lastConfFingerprint = fp
  })
  confChain = next
  return next
}

// ── Core render pipeline ─────────────────────────────────────

async function processJob(job: QueueRow): Promise<void> {
  const domainId = job.domain_id
  console.log(`[worker] Processing job ${job.id} for domain ${domainId}`)

  // Step 2: Load domain + records + SOA template
  const domain = await queryOne<DomainRow>('SELECT id, fqdn, default_ttl, tenant_id, status, ns_reference, publish FROM domains WHERE id = ?', [domainId])
  if (!domain) throw new Error(`Domain ${domainId} not found`)

  // Non-active domain: just sync named.conf to remove it from BIND, skip render
  if (domain.status !== 'active') {
    const allDomains = await query<{ fqdn: string; dnssec_enabled: number }>(
      "SELECT fqdn, dnssec_enabled FROM domains WHERE status = 'active' AND publish = 1 ORDER BY fqdn"
    )
    await ensureNamedConf(allDomains.map(r => ({ fqdn: r.fqdn, dnssec_enabled: !!r.dnssec_enabled })))
    await execute("UPDATE domains SET zone_status = 'clean' WHERE id = ?", [domainId])
    await execute("UPDATE zone_render_queue SET status = 'done', updated_at = NOW() WHERE id = ?", [job.id])
    broadcastEvent({ type: 'domain_status', domainId, fqdn: domain.fqdn, zone_status: 'clean', tenantId: domain.tenant_id, zone_error: null })
    console.log(`[worker] Job ${job.id} — ${domain.fqdn} is ${domain.status}, synced named.conf, skipped render`)
    return
  }

  // publish=0: active but not deployed to nameservers — keep it out of named.conf
  if (!domain.publish) {
    const allDomains = await query<{ fqdn: string; dnssec_enabled: number }>(
      "SELECT fqdn, dnssec_enabled FROM domains WHERE status = 'active' AND publish = 1 ORDER BY fqdn"
    )
    await ensureNamedConf(allDomains.map(r => ({ fqdn: r.fqdn, dnssec_enabled: !!r.dnssec_enabled })))
    await execute("UPDATE domains SET zone_status = 'clean' WHERE id = ?", [domainId])
    await execute("UPDATE zone_render_queue SET status = 'done', updated_at = NOW() WHERE id = ?", [job.id])
    broadcastEvent({ type: 'domain_status', domainId, fqdn: domain.fqdn, zone_status: 'clean', tenantId: domain.tenant_id, zone_error: null })
    console.log(`[worker] Job ${job.id} — ${domain.fqdn} has publish=0, synced named.conf, skipped render`)
    return
  }

  // If ns_reference is set, mirror records from the referenced domain instead of own records
  let recordSourceId = domainId
  if (domain.ns_reference) {
    const ref = await queryOne<{ id: number }>(
      "SELECT id FROM domains WHERE fqdn = ? AND status = 'active'",
      [domain.ns_reference]
    )
    if (!ref) throw new Error(`ns_reference target '${domain.ns_reference}' not found or not active`)
    recordSourceId = ref.id
    console.log(`[worker] ${domain.fqdn} mirrors records from ${domain.ns_reference} (id=${ref.id})`)
  }

  const records = await query<RecordRow>(
    `SELECT name, type, ttl, priority, weight, port, value
     FROM dns_records WHERE domain_id = ? AND is_deleted = 0`,
    [recordSourceId]
  )

  // Merge records from all assigned templates into the zone
  const assignedTemplates = await query<{ template_id: number }>(
    'SELECT template_id FROM domain_templates WHERE domain_id = ?',
    [domainId]
  )
  if (assignedTemplates.length > 0) {
    const ids = assignedTemplates.map(r => r.template_id)
    const placeholders = ids.map(() => '?').join(', ')
    const templateRecords = await query<RecordRow>(
      `SELECT name, type, ttl, priority, weight, port, value
       FROM dns_template_records WHERE template_id IN (${placeholders})`,
      ids
    )
    records.push(...templateRecords)
  }

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

  // Step 6: Ensure named.conf.local is up-to-date (covers newly added domains).
  // Cached: skipped when the active zone set hasn't changed since the last render.
  const allDomains = await query<{ fqdn: string; dnssec_enabled: number }>(
    "SELECT fqdn, dnssec_enabled FROM domains WHERE status = 'active' AND publish = 1 ORDER BY fqdn"
  )
  await ensureNamedConf(allDomains.map(r => ({ fqdn: r.fqdn, dnssec_enabled: !!r.dnssec_enabled })))

  // Step 7: Atomic file replace + rndc reload
  await deployZone(domain.fqdn, content)

  // Step 7b: Extract DS records for DNSSEC-enabled domains (fire-and-forget,
  // can take up to 60s while BIND finishes KASP key generation; the periodic
  // retryDnssecExtraction task picks up anything that misses the window).
  const dnssecRow = await queryOne<{ dnssec_enabled: number }>(
    'SELECT dnssec_enabled FROM domains WHERE id = ?', [domainId]
  )
  if (dnssecRow?.dnssec_enabled) {
    extractAndStoreDsAsync(domainId, domain.fqdn, domain.tenant_id, 'clean')
  } else {
    await execute('UPDATE domains SET dnssec_ds = NULL, dnssec_ok = NULL, dnssec_checked_at = NULL WHERE id = ?', [domainId])
    // Drop BIND's inline-signing artifacts so a stale signed copy can't be
    // resurrected on re-enable. Only reload BIND if there was something to
    // clean — most zones never had DNSSEC and don't need the extra reload.
    const signedPath = join(ZONE_DIR, `${domain.fqdn}.zone.signed`)
    if (existsSync(signedPath)) {
      await cleanupDnssecArtifacts(domain.fqdn)
      await rndcReload(domain.fqdn).catch(err =>
        console.warn(`[worker] rndc reload after DNSSEC disable for ${domain.fqdn}: ${err.message}`)
      )
    }
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
  broadcastEvent({ type: 'domain_status', domainId, fqdn: domain.fqdn, zone_status: 'clean', tenantId: domain.tenant_id, last_serial: serial, last_rendered_at: rendered?.last_rendered_at ?? null, zone_error: null })
  if (MAIL_ADMIN_TO) {
    await queueMail(MAIL_ADMIN_TO, 'zone_deploy_success', { fqdn: domain.fqdn, jobId: job.id, serial, renderedAt: rendered?.last_rendered_at ?? 'unknown' })
  }

  console.log(`[worker] Job ${job.id} done — ${domain.fqdn} serial ${serial}`)
}

// ── Poll loop ─────────────────────────────────────────────────

let running = true

async function runJob(job: QueueRow): Promise<void> {
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
      const failedDomain = await queryOne<{ fqdn: string; tenant_id: number }>('SELECT fqdn, tenant_id FROM domains WHERE id = ?', [job.domain_id])
      if (failedDomain) {
        broadcastEvent({ type: 'domain_status', domainId: job.domain_id, fqdn: failedDomain.fqdn, zone_status: 'error', tenantId: failedDomain.tenant_id, zone_error: err.message })
        if (MAIL_ADMIN_TO) {
          await queueMail(MAIL_ADMIN_TO, 'zone_deploy_failed', { fqdn: failedDomain.fqdn, jobId: job.id, retries: newRetries, error: err.message })
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

// Spawn up to `concurrency` workers pulling from a shared index. Errors
// inside fn must be handled by fn itself (we don't want one bad job to
// poison the whole batch).
async function parallelMap<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const n = Math.min(concurrency, items.length)
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

async function poll(): Promise<boolean> {
  // Claim a batch of pending jobs with optimistic locking.
  // Returns true if at least one job was claimed, so the main loop can skip
  // its idle sleep and immediately drain the rest of the queue.
  const candidates = await query<QueueRow>(
    `SELECT id, domain_id, retries, max_retries
     FROM zone_render_queue
     WHERE status = 'pending'
     ORDER BY priority DESC, created_at ASC
     LIMIT ?`,
    [BATCH_SIZE]
  )

  // Claim phase — serial because each row is its own UPDATE.
  const claimed: QueueRow[] = []
  for (const job of candidates) {
    const result = await execute(
      `UPDATE zone_render_queue SET status = 'processing', updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [job.id]
    )
    if (result.affectedRows > 0) claimed.push(job)
  }
  if (claimed.length === 0) return false

  // Execute phase — bounded parallelism. Per-domain renders are independent
  // (different DB rows, different zone files); ensureNamedConf is mutex-guarded.
  await parallelMap(claimed, WORKER_CONCURRENCY, runJob)
  return true
}

// ── named.conf.local maintenance ─────────────────────────────
// Runs every 60s to pick up newly added/deleted domains and regenerate conf files.

async function syncNamedConf(): Promise<void> {
  try {
    const rows = await query<{ fqdn: string; dnssec_enabled: number }>(
      "SELECT fqdn, dnssec_enabled FROM domains WHERE status = 'active' AND publish = 1 ORDER BY fqdn"
    )
    const zones = rows.map(r => ({ fqdn: r.fqdn, dnssec_enabled: !!r.dnssec_enabled }))
    // Force regenerate (bypass per-job cache) so out-of-band drift gets corrected.
    await regenerateNamedConf(zones)
    lastConfFingerprint = fingerprintZones(zones)
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
            await queueMail(admin.email, 'domain_purge_reminder', { fqdn: domain.fqdn, daysRemaining, deletedAt, purgeDate })
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

// On startup, recover from an unclean shutdown:
//  - rows stuck in 'processing' (worker died mid-flight) → reset to 'pending'
//  - domains marked dirty with no live queue row (queue was wiped, or an enqueue
//    was lost) → re-queue them
async function recoverStuckJobs(): Promise<void> {
  const reset = await execute(
    "UPDATE zone_render_queue SET status = 'pending', updated_at = NOW() WHERE status = 'processing'"
  )
  if (reset.affectedRows > 0) {
    console.log(`[worker] Recovered ${reset.affectedRows} stuck 'processing' jobs`)
  }

  // Catch every dirty domain regardless of publish/status — processJob has
  // branches for non-active and publish=0 domains and will mark them clean
  // after a named.conf sync.
  const dirty = await query<{ id: number; fqdn: string }>(
    `SELECT d.id, d.fqdn
     FROM domains d
     LEFT JOIN zone_render_queue q
       ON q.domain_id = d.id AND q.status IN ('pending', 'processing')
     WHERE d.zone_status = 'dirty' AND q.id IS NULL`
  )
  for (const d of dirty) {
    await execute(
      `INSERT INTO zone_render_queue (domain_id, priority) VALUES (?, 5)
       ON DUPLICATE KEY UPDATE status = 'pending', retries = 0, error = NULL, updated_at = NOW()`,
      [d.id]
    )
  }
  if (dirty.length > 0) {
    console.log(`[worker] Re-queued ${dirty.length} dirty domains without a live queue row`)
  }
}

async function requeueMissingZones(): Promise<void> {
  const rows = await query<{ id: number; fqdn: string }>(
    "SELECT id, fqdn FROM domains WHERE status = 'active' AND publish = 1"
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

// ── DNSSEC DS retry: re-extract for zones still missing DS ───
// Initial extraction in processJob is fire-and-forget with a 60s ceiling; on
// cold BIND containers KASP can take longer. This sweeper closes that gap.

async function retryDnssecExtraction(): Promise<void> {
  try {
    const rows = await query<{ id: number; fqdn: string; tenant_id: number; zone_status: string }>(
      `SELECT id, fqdn, tenant_id, zone_status FROM domains
       WHERE status = 'active' AND publish = 1 AND dnssec_enabled = 1 AND dnssec_ds IS NULL`
    )
    for (const row of rows) {
      extractAndStoreDsAsync(row.id, row.fqdn, row.tenant_id, row.zone_status)
    }
  } catch (err: any) {
    console.error('[worker] retryDnssecExtraction failed:', err.message)
  }
}

// ── Entry point ───────────────────────────────────────────────

console.log('[worker] Starting INFORENT Prisma Worker')

// Recover from unclean shutdown: reset stuck 'processing' rows and queue any
// dirty domains that lost their queue row.
await recoverStuckJobs()

// Re-queue any zones missing their zone files (e.g. after redeploy)
await requeueMissingZones()

// Periodic background tasks. Tracked so SIGTERM can clear them all.
const intervals: NodeJS.Timeout[] = []
const safeInterval = (fn: () => void | Promise<void>, ms: number, label: string) => {
  intervals.push(setInterval(() => {
    if (!running) return
    Promise.resolve(fn()).catch(err => console.error(`[worker] ${label} failed:`, err.message))
  }, ms))
}

// Initial conf sync, then every 60s
await syncNamedConf()
safeInterval(syncNamedConf, 60_000, 'syncNamedConf')

// Domain lifecycle: reminders + hard purge, hourly
await processDomainLifecycle()
safeInterval(processDomainLifecycle, 60 * 60 * 1000, 'processDomainLifecycle')

// ALIAS refresh: re-queue domains with ALIAS records on a fixed interval
safeInterval(requeueAliasZones, ALIAS_REFRESH_INTERVAL_MS, 'requeueAliasZones')

// NS delegation check: all on startup, then split by status
await checkNsDelegation(NS_RECORDS, 'all')
// Pending/mismatch domains: every 15s (fast feedback when delegation is set)
safeInterval(() => checkNsDelegation(NS_RECORDS, 'pending'), 15_000, 'checkNsDelegation (pending)')
// Ok domains: every 5 minutes (steady-state confirmation)
safeInterval(() => checkNsDelegation(NS_RECORDS, 'ok'), 5 * 60 * 1000, 'checkNsDelegation (ok)')

// DNSSEC check: DNSKEY visibility in public DNS
await checkDnssec('all')
// Pending/broken: every 30s (DNSKEY propagation takes time after signing)
safeInterval(() => checkDnssec('pending'), 30_000, 'checkDnssec (pending)')
// Ok domains: every 10 minutes (steady-state confirmation)
safeInterval(() => checkDnssec('ok'), 10 * 60 * 1000, 'checkDnssec (ok)')

// DNSSEC DS extraction retry: catches zones where KASP took longer than
// processJob's fire-and-forget window
safeInterval(retryDnssecExtraction, 30_000, 'retryDnssecExtraction')

// Graceful shutdown plumbing — declared before the loop so the loop's sleep can register wakeups.
const shutdownWakeups: Array<() => void> = []
let shuttingDown = false

// Poll loop. Promise resolves once the loop exits, so shutdown can await it.
const loopFinished = (async function loop() {
  while (running) {
    let didWork = false
    try {
      didWork = await poll()
      if (!running) break
      await pollBulkJobs()
      if (!running) break
      await pollMailQueue()
      if (!running) break
      await pollImap()
    } catch (err: any) {
      console.error('[worker] Poll error:', err.message)
    }
    if (!running) break
    // When poll() drained zone-render jobs, immediately re-poll to keep up with
    // a backlog instead of waiting POLL_INTERVAL_MS between batches. Sleep only
    // when the queue was empty. Always wake on shutdown so we don't add latency.
    if (didWork) continue
    await new Promise<void>(resolve => {
      const t = setTimeout(resolve, POLL_INTERVAL_MS)
      shutdownWakeups.push(() => { clearTimeout(t); resolve() })
    })
  }
})()

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[worker] ${signal} received — clearing timers and finishing current job`)
  running = false
  for (const id of intervals) clearInterval(id)
  while (shutdownWakeups.length) shutdownWakeups.shift()!()

  // Force exit after 30s so a hung job doesn't block container shutdown.
  const force = setTimeout(() => {
    console.error('[worker] Shutdown timeout — forcing exit')
    process.exit(1)
  }, 30_000)
  force.unref()

  try {
    await loopFinished
    await pool.end()
    console.log('[worker] Shut down cleanly')
    process.exit(0)
  } catch (err: any) {
    console.error('[worker] Shutdown error:', err.message)
    process.exit(1)
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('SIGINT', () => { void shutdown('SIGINT') })
