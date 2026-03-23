import { FastifyInstance } from 'fastify'
import { query, queryOne, execute } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'
import { validateRecord } from './validators.js'
import { broadcast } from '../ws/hub.js'
import { parseZoneFile } from './parseZone.js'

/** Enqueue a zone render job for a domain (upsert — one pending job per domain) */
async function enqueueRender(domainId: number) {
  await execute(
    `INSERT INTO zone_render_queue (domain_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'processing', status, 'pending'), updated_at = NOW()`,
    [domainId]
  )
  await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [domainId])
}

/** Resolve domain and enforce ownership */
async function resolveDomain(domainId: string, req: any, reply: any) {
  const ownerClause = req.user.role === 'admin' ? '' : ` AND customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ${Number(req.user.sub)})`
  const domain = await queryOne(
    `SELECT id, customer_id FROM domains WHERE id = ? AND status != 'deleted'${ownerClause}`,
    [domainId]
  )
  if (!domain) { reply.status(404).send({ code: 'NOT_FOUND' }); return null }
  return domain as { id: number; customer_id: number }
}

export async function recordRoutes(app: FastifyInstance) {
  // GET /domains/:domainId/records
  app.get<{ Params: { domainId: string } }>(
    '/domains/:domainId/records',
    { preHandler: requireAuth },
    async (req, reply) => {
      const domain = await resolveDomain(req.params.domainId, req, reply)
      if (!domain) return

      const records = await (await import('../db.js')).query(
        `SELECT id, name, type, ttl, priority, weight, port, value, created_at, updated_at
         FROM dns_records WHERE domain_id = ? AND is_deleted = 0 ORDER BY type, name`,
        [domain.id]
      )
      return records
    }
  )

  // POST /domains/:domainId/records
  app.post<{ Params: { domainId: string } }>(
    '/domains/:domainId/records',
    { preHandler: requireAuth },
    async (req, reply) => {
      const domain = await resolveDomain(req.params.domainId, req, reply)
      if (!domain) return

      const validation = validateRecord(req.body)
      if (!validation.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: validation.error })

      const { name, type, ttl, priority, weight, port, value } = validation.data
      const result = await execute(
        `INSERT INTO dns_records (domain_id, name, type, ttl, priority, weight, port, value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [domain.id, name, type, ttl ?? null, priority ?? null, weight ?? null, port ?? null, value]
      )
      await enqueueRender(domain.id)
      broadcast({ type: 'record_changed', domainId: domain.id })

      const created = await queryOne('SELECT * FROM dns_records WHERE id = ?', [result.insertId])
      await writeAuditLog({ req, entityType: 'dns_record', entityId: result.insertId, domainId: domain.id, action: 'create', newValue: created })
      return reply.status(201).send(created)
    }
  )

  // PUT /domains/:domainId/records/:id
  app.put<{ Params: { domainId: string; id: string } }>(
    '/domains/:domainId/records/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const domain = await resolveDomain(req.params.domainId, req, reply)
      if (!domain) return

      const old = await queryOne(
        'SELECT * FROM dns_records WHERE id = ? AND domain_id = ? AND is_deleted = 0',
        [req.params.id, domain.id]
      )
      if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

      const validation = validateRecord({ ...(old as any), ...(req.body as any) })
      if (!validation.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: validation.error })

      const { name, type, ttl, priority, weight, port, value } = validation.data
      await execute(
        `UPDATE dns_records SET name=?, type=?, ttl=?, priority=?, weight=?, port=?, value=? WHERE id=?`,
        [name, type, ttl ?? null, priority ?? null, weight ?? null, port ?? null, value, req.params.id]
      )
      await enqueueRender(domain.id)
      broadcast({ type: 'record_changed', domainId: domain.id })

      const updated = await queryOne('SELECT * FROM dns_records WHERE id = ?', [req.params.id])
      await writeAuditLog({ req, entityType: 'dns_record', entityId: Number(req.params.id), domainId: domain.id, action: 'update', oldValue: old, newValue: updated })
      return updated
    }
  )

  // DELETE /domains/:domainId/records/:id
  app.delete<{ Params: { domainId: string; id: string } }>(
    '/domains/:domainId/records/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const domain = await resolveDomain(req.params.domainId, req, reply)
      if (!domain) return

      const old = await queryOne(
        'SELECT * FROM dns_records WHERE id = ? AND domain_id = ? AND is_deleted = 0',
        [req.params.id, domain.id]
      )
      if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

      await execute('UPDATE dns_records SET is_deleted = 1 WHERE id = ?', [req.params.id])
      await enqueueRender(domain.id)
      broadcast({ type: 'record_changed', domainId: domain.id })
      await writeAuditLog({ req, entityType: 'dns_record', entityId: Number(req.params.id), domainId: domain.id, action: 'delete', oldValue: old })
      return { ok: true }
    }
  )

  // POST /domains/:domainId/zone-import/parse
  app.post<{ Params: { domainId: string } }>(
    '/domains/:domainId/zone-import/parse',
    { preHandler: requireAuth },
    async (req, reply) => {
      const domain = await resolveDomain(req.params.domainId, req, reply)
      if (!domain) return

      const domainData = await queryOne<{ fqdn: string; default_ttl: number }>(
        'SELECT fqdn, default_ttl FROM domains WHERE id = ?',
        [domain.id]
      )
      if (!domainData) return reply.status(404).send({ code: 'NOT_FOUND' })

      // Read uploaded file
      let fileText = ''
      try {
        for await (const part of (req as any).files()) {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk as Buffer)
          fileText = Buffer.concat(chunks).toString('utf8')
          break // only process first file
        }
      } catch (err: any) {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(400).send({ code: 'PARSE_ERROR', message: 'File too large (max 20 MB)' })
        }
        throw err
      }

      if (!fileText.trim()) {
        return reply.status(400).send({ code: 'PARSE_ERROR', message: 'Empty or unreadable file' })
      }

      const { records: parsed, skipped } = parseZoneFile(fileText, domainData.fqdn, domainData.default_ttl)

      if (parsed.length === 0 && skipped.length === 0) {
        return reply.status(400).send({ code: 'PARSE_ERROR', message: 'No DNS records found in file' })
      }

      // Fetch existing records for conflict detection
      const existing = await query<any>(
        'SELECT id, name, type, ttl, priority, weight, port, value FROM dns_records WHERE domain_id = ? AND is_deleted = 0',
        [domain.id]
      )

      // Partition parsed records into new vs conflicts
      const newRecords = []
      const conflicts = []

      for (const rec of parsed) {
        const matches = existing.filter((e: any) => e.name === rec.name && e.type === rec.type)
        if (matches.length === 0) {
          newRecords.push(rec)
        } else {
          // Pair incoming with first matching existing record
          conflicts.push({ existing: matches[0], incoming: rec })
        }
      }

      return { new: newRecords, conflicts, skipped }
    }
  )
}
