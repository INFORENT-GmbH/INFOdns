import { query, queryOne, execute, transaction } from './db.js'
import { broadcastEvent } from './broadcast.js'

const BULK_BATCH_SIZE = Number(process.env.BULK_BATCH_SIZE ?? 50)

interface BulkJob {
  id: number
  operation: string
  filter_json: string | object
  payload_json: string | object
}

// ── Apply a single operation to a single domain ───────────────

async function applyToDomain(
  domainId: number,
  operation: string,
  payload: any,
  jobId: number,
): Promise<void> {
  const { match, replace_with, records, new_ttl } = payload

  await transaction(async (conn) => {
    async function findMatches(): Promise<any[]> {
      let sql = 'SELECT * FROM dns_records WHERE domain_id = ? AND is_deleted = 0'
      const p: any[] = [domainId]
      if (match?.name)  { sql += ' AND name = ?';      p.push(match.name) }
      if (match?.type)  { sql += ' AND type = ?';      p.push(match.type) }
      if (match?.value) { sql += ' AND value LIKE ?';  p.push(`%${match.value}%`) }
      const [rows] = await conn.execute<any[]>(sql, p)
      return rows
    }

    switch (operation) {
      case 'add':
        for (const rec of records ?? []) {
          const [rows] = await conn.execute<any[]>(
            'SELECT id FROM dns_records WHERE domain_id=? AND name=? AND type=? AND value=? AND is_deleted=0',
            [domainId, rec.name, rec.type, rec.value]
          )
          if (!rows[0]) {
            await conn.execute(
              `INSERT INTO dns_records (domain_id, name, type, ttl, priority, weight, port, value)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [domainId, rec.name, rec.type, rec.ttl ?? null, rec.priority ?? null,
               rec.weight ?? null, rec.port ?? null, rec.value]
            )
          }
        }
        break

      case 'replace':
        for (const existing of await findMatches()) {
          await conn.execute(
            "UPDATE dns_records SET is_deleted=1, updated_at=NOW() WHERE id=?",
            [existing.id]
          )
          await conn.execute(
            `INSERT INTO dns_records (domain_id, name, type, ttl, priority, weight, port, value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [domainId, replace_with.name, replace_with.type, replace_with.ttl ?? null,
             replace_with.priority ?? null, replace_with.weight ?? null, replace_with.port ?? null,
             replace_with.value]
          )
        }
        break

      case 'delete':
        for (const existing of await findMatches()) {
          await conn.execute(
            "UPDATE dns_records SET is_deleted=1, updated_at=NOW() WHERE id=?",
            [existing.id]
          )
        }
        break

      case 'change_ttl':
        for (const existing of await findMatches()) {
          await conn.execute(
            "UPDATE dns_records SET ttl=?, updated_at=NOW() WHERE id=?",
            [new_ttl, existing.id]
          )
        }
        break
    }
  })
}

// ── Enqueue a zone render for a domain ────────────────────────

async function enqueueRender(domainId: number): Promise<void> {
  await execute(
    `INSERT INTO zone_render_queue (domain_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'processing', status, 'pending'), updated_at = NOW()`,
    [domainId]
  )
  await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [domainId])
}

// ── Process one running bulk job ──────────────────────────────

export async function processBulkJob(job: BulkJob): Promise<void> {
  const payload = typeof job.payload_json === 'string'
    ? JSON.parse(job.payload_json) : job.payload_json

  // Get all pending domain rows for this job
  const domainRows = await query<{ id: number; domain_id: number }>(
    "SELECT id, domain_id FROM bulk_job_domains WHERE bulk_job_id = ? AND status = 'pending' LIMIT ?",
    [job.id, BULK_BATCH_SIZE]
  )

  if (domainRows.length === 0) {
    // All done
    await execute(
      "UPDATE bulk_jobs SET status = 'done', updated_at = NOW() WHERE id = ?",
      [job.id]
    )
    console.log(`[worker] Bulk job ${job.id} completed`)
    return
  }

  for (const row of domainRows) {
    try {
      await applyToDomain(row.domain_id, job.operation, payload, job.id)
      await enqueueRender(row.domain_id)
      await execute(
        "UPDATE bulk_job_domains SET status = 'done' WHERE id = ?",
        [row.id]
      )
      broadcastEvent({ type: 'record_changed', domainId: row.domain_id })
    } catch (err: any) {
      console.error(`[worker] Bulk job ${job.id} domain ${row.domain_id} failed:`, err.message)
      await execute(
        "UPDATE bulk_job_domains SET status = 'failed', error = ? WHERE id = ?",
        [err.message, row.id]
      )
    }

    // Update processed_domains count and broadcast progress
    await execute(
      `UPDATE bulk_jobs SET processed_domains = (
         SELECT COUNT(*) FROM bulk_job_domains WHERE bulk_job_id = ? AND status != 'pending'
       ), updated_at = NOW() WHERE id = ?`,
      [job.id, job.id]
    )
    const progress = await queryOne<{ processed_domains: number; affected_domains: number }>(
      'SELECT processed_domains, affected_domains FROM bulk_jobs WHERE id = ?', [job.id]
    )
    if (progress) broadcastEvent({ type: 'bulk_job_progress', jobId: job.id, status: 'running', processed_domains: progress.processed_domains, affected_domains: progress.affected_domains })
  }

  // Check if all domains are processed now
  const remaining = await queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM bulk_job_domains WHERE bulk_job_id = ? AND status = 'pending'",
    [job.id]
  )
  if (!remaining || remaining.cnt === 0) {
    const failed = await queryOne<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM bulk_job_domains WHERE bulk_job_id = ? AND status = 'failed'",
      [job.id]
    )
    const finalStatus = 'done'
    await execute(
      `UPDATE bulk_jobs SET status = ?, updated_at = NOW() WHERE id = ?`,
      [finalStatus, job.id]
    )
    const done = await queryOne<{ processed_domains: number; affected_domains: number }>(
      'SELECT processed_domains, affected_domains FROM bulk_jobs WHERE id = ?', [job.id]
    )
    if (done) broadcastEvent({ type: 'bulk_job_progress', jobId: job.id, status: 'done', processed_domains: done.processed_domains, affected_domains: done.affected_domains })
    console.log(`[worker] Bulk job ${job.id} finished (${failed?.cnt ?? 0} domain failures)`)
  }
}

// ── Poll for running bulk jobs ────────────────────────────────

export async function pollBulkJobs(): Promise<void> {
  const jobs = await query<BulkJob>(
    "SELECT id, operation, filter_json, payload_json FROM bulk_jobs WHERE status = 'running' LIMIT 5"
  )
  for (const job of jobs) {
    try {
      await processBulkJob(job)
    } catch (err: any) {
      console.error(`[worker] Bulk job ${job.id} executor error:`, err.message)
      await execute(
        "UPDATE bulk_jobs SET status = 'failed', error = ?, updated_at = NOW() WHERE id = ?",
        [err.message, job.id]
      )
    }
  }
}
