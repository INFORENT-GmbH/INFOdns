import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute, transaction } from '../db.js'
import { requireAuth, requireOperatorOrAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'
import { broadcast } from '../ws/hub.js'

// ── Helpers ──────────────────────────────────────────────────

function ownerClause(req: any): string {
  if (req.user.role === 'admin') return ''
  return ` AND d.tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ${Number(req.user.sub)})`
}

/** Resolve filter_json to a list of domain IDs the requesting user can access */
async function resolveDomainIds(filter: any, req: any): Promise<number[]> {
  const owner = ownerClause(req)
  let where = `d.status = 'active'${owner}`
  const params: unknown[] = []

  if (filter.mode === 'tenant' && filter.tenant_ids?.length) {
    where += ` AND d.tenant_id IN (${filter.tenant_ids.map(() => '?').join(',')})`
    params.push(...filter.tenant_ids)
  } else if (filter.mode === 'explicit' && filter.domain_ids?.length) {
    where += ` AND d.id IN (${filter.domain_ids.map(() => '?').join(',')})`
    params.push(...filter.domain_ids)
  }
  if (filter.fqdn_pattern) {
    where += ` AND d.fqdn LIKE ?`
    params.push(filter.fqdn_pattern)
  }

  const rows = await query<{ id: number }>(`SELECT d.id FROM domains d WHERE ${where}`, params)
  return rows.map(r => r.id)
}

/** Compute what changes a bulk operation would make to a single domain */
async function computeDomainDiff(
  domainId: number,
  operation: string,
  payload: any
): Promise<{ op: string; record_id?: number; record: object }[]> {
  const changes: { op: string; record_id?: number; record: object }[] = []

  const { match, replace_with, records, new_ttl } = payload

  // Helper: find matching records in a domain.
  // `name` is required for replace/delete/change_ttl — a missing name would let
  // a single criterion (e.g. type=A, value=1.1.1.1) silently hit unrelated
  // records like `@` and `mail` together. `value` matches exactly to avoid
  // substring collisions (10.0.0.1 vs 10.0.0.10).
  async function findMatches() {
    if (!match) return []
    let sql = 'SELECT * FROM dns_records WHERE domain_id = ? AND is_deleted = 0'
    const p: unknown[] = [domainId]
    if (match.name)  { sql += ' AND name = ?';  p.push(match.name) }
    if (match.type)  { sql += ' AND type = ?';  p.push(match.type) }
    if (match.value) { sql += ' AND value = ?'; p.push(match.value) }
    return query<any>(sql, p)
  }

  switch (operation) {
    case 'add':
      for (const rec of records ?? []) {
        // Only add if not already present (upsert logic: skip exact duplicates)
        const existing = await queryOne<any>(
          'SELECT id FROM dns_records WHERE domain_id=? AND name=? AND type=? AND value=? AND is_deleted=0',
          [domainId, rec.name, rec.type, rec.value]
        )
        if (!existing) changes.push({ op: 'add', record: rec })
      }
      break

    case 'replace':
      for (const existing of await findMatches()) {
        changes.push({ op: 'delete', record_id: existing.id, record: existing })
        changes.push({ op: 'add', record: replace_with })
      }
      break

    case 'delete':
      for (const existing of await findMatches()) {
        changes.push({ op: 'delete', record_id: existing.id, record: existing })
      }
      break

    case 'change_ttl':
      for (const existing of await findMatches()) {
        changes.push({ op: 'update_ttl', record_id: existing.id, record: { ...existing, ttl: new_ttl } })
      }
      break
  }

  return changes
}

// ── Routes ────────────────────────────────────────────────────

const CreateBulkJobBody = z.object({
  operation: z.enum(['add', 'replace', 'delete', 'change_ttl']),
  filter_json: z.object({
    mode: z.enum(['all', 'tenant', 'explicit']),
    tenant_ids: z.array(z.number()).optional(),
    domain_ids: z.array(z.number()).optional(),
    fqdn_pattern: z.string().optional(),
  }),
  payload_json: z.record(z.string(), z.unknown()),
})

export async function bulkRoutes(app: FastifyInstance) {

  // GET /bulk-jobs
  app.get('/bulk-jobs', { preHandler: requireAuth }, async (req: any) => {
    if (req.user.role === 'tenant') {
      return query('SELECT * FROM bulk_jobs WHERE created_by = ? ORDER BY created_at DESC LIMIT 100', [req.user.sub])
    }
    return query('SELECT * FROM bulk_jobs ORDER BY created_at DESC LIMIT 100')
  })

  // POST /bulk-jobs
  app.post('/bulk-jobs', { preHandler: requireAuth }, async (req, reply) => {
    const body = CreateBulkJobBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const result = await execute(
      `INSERT INTO bulk_jobs (created_by, operation, status, filter_json, payload_json)
       VALUES (?, ?, 'draft', ?, ?)`,
      [(req as any).user.sub, body.data.operation,
       JSON.stringify(body.data.filter_json), JSON.stringify(body.data.payload_json)]
    )
    const job = await queryOne('SELECT * FROM bulk_jobs WHERE id = ?', [result.insertId])
    return reply.status(201).send(job)
  })

  // GET /bulk-jobs/:id
  app.get<{ Params: { id: string } }>('/bulk-jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
    const job = await queryOne<any>('SELECT * FROM bulk_jobs WHERE id = ?', [req.params.id])
    if (!job) return reply.status(404).send({ code: 'NOT_FOUND' })
    if ((req as any).user.role === 'tenant' && job.created_by !== Number((req as any).user.sub)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    return job
  })

  // GET /bulk-jobs/:id/domains  — per-domain status
  app.get<{ Params: { id: string } }>('/bulk-jobs/:id/domains', { preHandler: requireAuth }, async (req, reply) => {
    const job = await queryOne<any>('SELECT id, created_by FROM bulk_jobs WHERE id = ?', [req.params.id])
    if (!job) return reply.status(404).send({ code: 'NOT_FOUND' })
    if ((req as any).user.role === 'tenant' && job.created_by !== Number((req as any).user.sub)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    const rows = await query(
      `SELECT bjd.*, d.fqdn FROM bulk_job_domains bjd
       JOIN domains d ON d.id = bjd.domain_id
       WHERE bjd.bulk_job_id = ? ORDER BY d.fqdn`,
      [req.params.id]
    )
    return rows
  })

  // POST /bulk-jobs/:id/preview
  // Resolves domain filter, computes per-domain diffs, stores in preview_json
  app.post<{ Params: { id: string } }>('/bulk-jobs/:id/preview', { preHandler: requireAuth }, async (req, reply) => {
    const job = await queryOne<any>('SELECT * FROM bulk_jobs WHERE id = ?', [req.params.id])
    if (!job) return reply.status(404).send({ code: 'NOT_FOUND' })
    if ((req as any).user.role === 'tenant' && job.created_by !== Number((req as any).user.sub)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    if (!['draft', 'approved'].includes(job.status)) {
      return reply.status(409).send({ code: 'INVALID_STATE', message: `Job is ${job.status}` })
    }

    await execute("UPDATE bulk_jobs SET status = 'previewing' WHERE id = ?", [job.id])

    let filter, payload
    try {
      filter  = typeof job.filter_json  === 'string' ? JSON.parse(job.filter_json)  : job.filter_json
      payload = typeof job.payload_json === 'string' ? JSON.parse(job.payload_json) : job.payload_json
    } catch (err: any) {
      await execute("UPDATE bulk_jobs SET status = 'draft' WHERE id = ?", [job.id])
      return reply.status(422).send({ code: 'CORRUPT_JOB_PAYLOAD', message: `Stored job JSON is invalid: ${err.message}` })
    }

    // Operations that match existing records must specify a record `name` —
    // otherwise (type=A, value=1.1.1.1) would clobber `@` and `mail` together.
    if (['replace', 'delete', 'change_ttl'].includes(job.operation)) {
      if (!payload?.match?.name) {
        await execute("UPDATE bulk_jobs SET status = 'draft' WHERE id = ?", [job.id])
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'match.name is required for replace, delete, and change_ttl operations',
        })
      }
    }

    const domainIds = await resolveDomainIds(filter, req)

    // Compute diff per domain
    const perDomain: any[] = []
    let totalAdded = 0, totalDeleted = 0, totalUpdated = 0

    for (const domainId of domainIds) {
      const domain = await queryOne<any>('SELECT id, fqdn FROM domains WHERE id = ?', [domainId])
      if (!domain) continue
      const changes = await computeDomainDiff(domainId, job.operation, payload)
      if (changes.length === 0) continue
      perDomain.push({ domain_id: domainId, fqdn: domain.fqdn, changes })
      totalAdded   += changes.filter(c => c.op === 'add').length
      totalDeleted += changes.filter(c => c.op === 'delete').length
      totalUpdated += changes.filter(c => c.op === 'update_ttl').length
    }

    const preview = {
      summary: {
        domains_affected: perDomain.length,
        records_added: totalAdded,
        records_deleted: totalDeleted,
        records_updated: totalUpdated,
      },
      per_domain: perDomain,
    }

    // Insert bulk_job_domains rows
    await execute('DELETE FROM bulk_job_domains WHERE bulk_job_id = ?', [job.id])
    for (const d of perDomain) {
      await execute(
        "INSERT INTO bulk_job_domains (bulk_job_id, domain_id, status) VALUES (?, ?, 'pending')",
        [job.id, d.domain_id]
      )
    }

    await execute(
      `UPDATE bulk_jobs SET status = 'approved', preview_json = ?, affected_domains = ? WHERE id = ?`,
      [JSON.stringify(preview), perDomain.length, job.id]
    )

    return queryOne('SELECT * FROM bulk_jobs WHERE id = ?', [job.id])
  })

  // POST /bulk-jobs/:id/approve  — enqueue for Worker execution
  app.post<{ Params: { id: string } }>('/bulk-jobs/:id/approve', { preHandler: requireAuth }, async (req, reply) => {
    const job = await queryOne<any>('SELECT * FROM bulk_jobs WHERE id = ?', [req.params.id])
    if (!job) return reply.status(404).send({ code: 'NOT_FOUND' })
    if ((req as any).user.role === 'tenant' && job.created_by !== Number((req as any).user.sub)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    if (job.status !== 'approved') {
      return reply.status(409).send({ code: 'INVALID_STATE', message: 'Job must be in approved state' })
    }
    await execute("UPDATE bulk_jobs SET status = 'running' WHERE id = ?", [job.id])
    await writeAuditLog({ req, entityType: 'bulk_job', entityId: job.id, action: 'bulk_apply' })
    broadcast({ type: 'bulk_job_progress', jobId: job.id, status: 'running', processed_domains: 0, affected_domains: job.affected_domains })
    return { ok: true, id: job.id }
  })

  // GET /zone-render-queue — all zone render tasks (admin/operator only)
  app.get('/zone-render-queue', { preHandler: requireOperatorOrAdmin }, async () => {
    return query(`
      SELECT q.id, q.domain_id, q.priority, q.retries, q.max_retries,
             q.status, q.error, q.created_at, q.updated_at,
             d.fqdn AS domain_name, t.name AS tenant_name
      FROM zone_render_queue q
      JOIN domains d ON d.id = q.domain_id
      JOIN tenants t ON t.id = d.tenant_id
      ORDER BY FIELD(q.status,'processing','pending','failed','done'), q.created_at DESC
      LIMIT 200
    `)
  })

  // GET /domains/search-by-record — find domains that have a matching record
  // Used by the Bulk page to seed the domain list
  app.get('/domains/search-by-record', { preHandler: requireAuth }, async (req: any, reply) => {
    const { type, name, value } = req.query as Record<string, string>
    if (!type) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'type is required' })

    const owner = req.user.role === 'admin' ? '' : ` AND d.tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ${Number(req.user.sub)})`
    const params: unknown[] = [type]
    let recordWhere = 'r.type = ? AND r.is_deleted = 0'
    if (name)  { recordWhere += ' AND r.name = ?';        params.push(name) }
    if (value) { recordWhere += ' AND r.value LIKE ?';    params.push(`%${value}%`) }

    const rows = await query(
      `SELECT d.id, d.fqdn, d.tenant_id, c.name AS tenant_name,
              r.id AS record_id, r.name AS record_name, r.type AS record_type,
              r.ttl, r.priority, r.value
       FROM dns_records r
       JOIN domains d ON d.id = r.domain_id
       JOIN tenants c ON c.id = d.tenant_id
       WHERE ${recordWhere} AND d.status = 'active'${owner}
       ORDER BY d.fqdn`,
      params
    )
    return rows
  })
}
