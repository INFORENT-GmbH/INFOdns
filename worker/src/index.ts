import { query, queryOne, execute, transaction, pool } from './db.js'
import { claimSerial } from './serialNumber.js'
import { renderZone } from './renderZone.js'
import { validateZone } from './validateZone.js'
import { deployZone } from './deployZone.js'
import { regenerateNamedConf } from './namedConf.js'
import { pollBulkJobs } from './bulkExecutor.js'
import { broadcastEvent } from './broadcast.js'
import { sendJobMail } from './mailer.js'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2000)
const BATCH_SIZE       = Number(process.env.BATCH_SIZE ?? 10)

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
  customer_id: number
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

// ── Core render pipeline ─────────────────────────────────────

async function processJob(job: QueueRow): Promise<void> {
  const domainId = job.domain_id
  console.log(`[worker] Processing job ${job.id} for domain ${domainId}`)

  // Step 2: Load domain + records + SOA template
  const domain = await queryOne<DomainRow>('SELECT id, fqdn, default_ttl, customer_id FROM domains WHERE id = ?', [domainId])
  if (!domain) throw new Error(`Domain ${domainId} not found`)

  const records = await query<RecordRow>(
    `SELECT name, type, ttl, priority, weight, port, value
     FROM dns_records WHERE domain_id = ? AND is_deleted = 0`,
    [domainId]
  )

  const soa = await queryOne<SoaRow>(
    `SELECT mname, rname, refresh, retry, expire, minimum_ttl
     FROM soa_templates WHERE customer_id = ? OR customer_id IS NULL
     ORDER BY customer_id DESC LIMIT 1`,
    [domain.customer_id]
  )
  if (!soa) throw new Error('No SOA template found')

  // Step 3: Claim serial inside a transaction with FOR UPDATE
  const serial = await transaction(async (conn) => claimSerial(conn, domainId))

  // Step 4: Render zone in memory
  const content = renderZone(domain, records, soa, serial, NS_RECORDS)

  // Step 5: Validate with named-checkzone
  const validation = await validateZone(domain.fqdn, content)
  if (!validation.ok) {
    throw new Error(`named-checkzone failed: ${validation.error}`)
  }

  // Step 6: Ensure named.conf.local is up-to-date (covers newly added domains)
  await syncNamedConf()

  // Step 7: Atomic file replace + rndc reload
  await deployZone(domain.fqdn, content)

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
  sendJobMail(`[INFOdns] Zone deployed: ${domain.fqdn}`, `Job ${job.id} completed successfully.\n\nDomain: ${domain.fqdn}\nSerial: ${serial}\nRendered at: ${rendered?.last_rendered_at ?? 'unknown'}`)

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
          sendJobMail(`[INFOdns] Zone deploy FAILED: ${failedDomain.fqdn}`, `Job ${job.id} failed after ${newRetries} retries.\n\nDomain: ${failedDomain.fqdn}\nError: ${err.message}`)
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
    const rows = await query<{ fqdn: string }>(
      "SELECT fqdn FROM domains WHERE status = 'active' ORDER BY fqdn"
    )
    const zones = rows.map(r => r.fqdn)
    await regenerateNamedConf(zones)
    console.log(`[worker] named.conf.local synced — ${zones.length} zones`)
  } catch (err: any) {
    console.error('[worker] named.conf.local sync failed:', err.message)
  }
}

// ── Entry point ───────────────────────────────────────────────

console.log('[worker] Starting INFOdns Worker')

// Initial conf sync, then every 60s
await syncNamedConf()
setInterval(syncNamedConf, 60_000)

// Poll loop
;(async function loop() {
  while (running) {
    try {
      await poll()
      await pollBulkJobs()
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
