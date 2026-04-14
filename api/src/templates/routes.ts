import { FastifyInstance } from 'fastify'
import { query, queryOne, execute, transaction } from '../db.js'
import { requireAuth, requireOperatorOrAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'
import { validateRecord } from '../records/validators.js'
import { broadcast } from '../ws/hub.js'

// ── Helpers ───────────────────────────────────────────────────

function visibilityClause(req: any): { sql: string; params: unknown[] } {
  if (req.user.role === 'admin') return { sql: '', params: [] }
  return {
    sql: ` AND (t.tenant_id IS NULL OR t.tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ?))`,
    params: [Number(req.user.sub)],
  }
}

function canWriteTemplate(req: any, templateTenantId: number | null): boolean {
  if (req.user.role === 'admin') return true
  if (req.user.role === 'operator') {
    return templateTenantId !== null && templateTenantId === req.user.tenantId
  }
  return false
}

/** Resolve domain and enforce ownership — mirrors pattern in records/routes.ts */
async function resolveDomain(domainId: string, req: any, reply: any) {
  const ownerClause = req.user.role === 'admin'
    ? ''
    : ` AND tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ${Number(req.user.sub)})`
  const domain = await queryOne<{ id: number; tenant_id: number }>(
    `SELECT id, tenant_id FROM domains WHERE id = ? AND status != 'deleted'${ownerClause}`,
    [domainId]
  )
  if (!domain) { reply.status(404).send({ code: 'NOT_FOUND' }); return null }
  return domain
}

/** Enqueue a zone render job for a domain */
async function enqueueRender(domainId: number) {
  await execute(
    `INSERT INTO zone_render_queue (domain_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'processing', status, 'pending'), updated_at = NOW()`,
    [domainId]
  )
  await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [domainId])
}

// ── Diff computation ──────────────────────────────────────────

type ApplyMode = 'add_missing' | 'overwrite_matching' | 'replace_all'

interface TemplateRecord {
  id: number
  name: string
  type: string
  ttl: number | null
  priority: number | null
  weight: number | null
  port: number | null
  value: string
}

interface DnsRecord {
  id: number
  name: string
  type: string
  ttl: number | null
  priority: number | null
  weight: number | null
  port: number | null
  value: string
}

interface TemplateDiff {
  toAdd: TemplateRecord[]
  toUpdate: { existing: DnsRecord; incoming: TemplateRecord }[]
  toDelete: DnsRecord[]
}

async function computeTemplateDiff(
  domainId: number,
  templateRecords: TemplateRecord[],
  mode: ApplyMode
): Promise<TemplateDiff> {
  const existing = await query<DnsRecord>(
    `SELECT id, name, type, ttl, priority, weight, port, value
     FROM dns_records WHERE domain_id = ? AND is_deleted = 0`,
    [domainId]
  )

  if (mode === 'replace_all') {
    return { toAdd: templateRecords, toUpdate: [], toDelete: existing }
  }

  const toAdd: TemplateRecord[] = []
  const toUpdate: { existing: DnsRecord; incoming: TemplateRecord }[] = []

  for (const tr of templateRecords) {
    // Find first existing record with same name+type
    const match = existing.find(e => e.name === tr.name && e.type === tr.type)
    if (!match) {
      toAdd.push(tr)
    } else if (mode === 'overwrite_matching') {
      // Only add to toUpdate if something actually differs
      if (
        match.ttl !== tr.ttl ||
        match.priority !== tr.priority ||
        match.weight !== tr.weight ||
        match.port !== tr.port ||
        match.value !== tr.value
      ) {
        toUpdate.push({ existing: match, incoming: tr })
      }
    }
    // add_missing: if match found, skip entirely
  }

  return { toAdd, toUpdate, toDelete: [] }
}

// ── Routes ────────────────────────────────────────────────────

export async function templateRoutes(app: FastifyInstance) {
  // GET /templates
  app.get('/templates', { preHandler: requireAuth }, async (req, reply) => {
    const vis = visibilityClause(req)
    const rows = await query(
      `SELECT t.id, t.tenant_id, t.name, t.description, t.created_at, t.updated_at,
              (SELECT COUNT(*) FROM dns_template_records WHERE template_id = t.id) AS record_count
       FROM dns_templates t
       WHERE 1=1${vis.sql}
       ORDER BY (t.tenant_id IS NULL) DESC, t.name`,
      vis.params
    )
    return rows
  })

  // POST /templates
  app.post('/templates', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const body = req.body as any
    const name = body?.name?.trim()
    if (!name) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'name is required' })

    let tenantId: number | null = body.tenant_id ?? null

    if (req.user.role === 'operator') {
      if (tenantId === null) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Operators cannot create global templates' })
      }
      if (tenantId !== req.user.tenantId) {
        return reply.status(403).send({ code: 'FORBIDDEN', message: 'Operators can only create templates for their own tenant' })
      }
    }

    const result = await execute(
      `INSERT INTO dns_templates (tenant_id, name, description) VALUES (?, ?, ?)`,
      [tenantId, name, body.description ?? null]
    )
    const created = await queryOne('SELECT * FROM dns_templates WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'dns_template', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // GET /templates/:id
  app.get<{ Params: { id: string } }>('/templates/:id', { preHandler: requireAuth }, async (req, reply) => {
    const vis = visibilityClause(req)
    const template = await queryOne(
      `SELECT t.id, t.tenant_id, t.name, t.description, t.created_at, t.updated_at
       FROM dns_templates t WHERE t.id = ?${vis.sql}`,
      [req.params.id, ...vis.params]
    )
    if (!template) return reply.status(404).send({ code: 'NOT_FOUND' })

    const records = await query(
      `SELECT id, name, type, ttl, priority, weight, port, value FROM dns_template_records WHERE template_id = ? ORDER BY type, name`,
      [req.params.id]
    )
    return { ...(template as any), records }
  })

  // PUT /templates/:id
  app.put<{ Params: { id: string } }>('/templates/:id', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const template = await queryOne<{ id: number; tenant_id: number | null }>(
      'SELECT id, tenant_id FROM dns_templates WHERE id = ?',
      [req.params.id]
    )
    if (!template) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!canWriteTemplate(req, template.tenant_id)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const body = req.body as any
    const fields: string[] = []
    const params: unknown[] = []

    if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name.trim()) }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description ?? null) }

    if (fields.length === 0) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'No fields to update' })

    params.push(req.params.id)
    await execute(`UPDATE dns_templates SET ${fields.join(', ')} WHERE id = ?`, params)
    const updated = await queryOne('SELECT * FROM dns_templates WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'dns_template', entityId: Number(req.params.id), action: 'update', newValue: updated })
    return updated
  })

  // DELETE /templates/:id
  app.delete<{ Params: { id: string } }>('/templates/:id', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const template = await queryOne<{ id: number; tenant_id: number | null }>(
      'SELECT id, tenant_id FROM dns_templates WHERE id = ?',
      [req.params.id]
    )
    if (!template) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!canWriteTemplate(req, template.tenant_id)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    await execute('DELETE FROM dns_templates WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'dns_template', entityId: Number(req.params.id), action: 'delete', oldValue: template })
    return { ok: true }
  })

  // POST /templates/:id/records
  app.post<{ Params: { id: string } }>('/templates/:id/records', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const template = await queryOne<{ id: number; tenant_id: number | null }>(
      'SELECT id, tenant_id FROM dns_templates WHERE id = ?',
      [req.params.id]
    )
    if (!template) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!canWriteTemplate(req, template.tenant_id)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const validation = validateRecord(req.body)
    if (!validation.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: validation.error })

    const { name, type, ttl, priority, weight, port, value } = validation.data
    const result = await execute(
      `INSERT INTO dns_template_records (template_id, name, type, ttl, priority, weight, port, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [template.id, name, type, ttl ?? null, priority ?? null, weight ?? null, port ?? null, value]
    )
    const created = await queryOne('SELECT * FROM dns_template_records WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'dns_template_record', entityId: result.insertId, action: 'create', newValue: created })
    return reply.status(201).send(created)
  })

  // PUT /templates/:id/records/:recordId
  app.put<{ Params: { id: string; recordId: string } }>('/templates/:id/records/:recordId', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const template = await queryOne<{ id: number; tenant_id: number | null }>(
      'SELECT id, tenant_id FROM dns_templates WHERE id = ?',
      [req.params.id]
    )
    if (!template) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!canWriteTemplate(req, template.tenant_id)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const old = await queryOne(
      'SELECT * FROM dns_template_records WHERE id = ? AND template_id = ?',
      [req.params.recordId, req.params.id]
    )
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const validation = validateRecord({ ...(old as any), ...(req.body as any) })
    if (!validation.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: validation.error })

    const { name, type, ttl, priority, weight, port, value } = validation.data
    await execute(
      `UPDATE dns_template_records SET name=?, type=?, ttl=?, priority=?, weight=?, port=?, value=? WHERE id=?`,
      [name, type, ttl ?? null, priority ?? null, weight ?? null, port ?? null, value, req.params.recordId]
    )
    const updated = await queryOne('SELECT * FROM dns_template_records WHERE id = ?', [req.params.recordId])
    await writeAuditLog({ req, entityType: 'dns_template_record', entityId: Number(req.params.recordId), action: 'update', oldValue: old, newValue: updated })
    return updated
  })

  // DELETE /templates/:id/records/:recordId
  app.delete<{ Params: { id: string; recordId: string } }>('/templates/:id/records/:recordId', { preHandler: requireOperatorOrAdmin }, async (req, reply) => {
    const template = await queryOne<{ id: number; tenant_id: number | null }>(
      'SELECT id, tenant_id FROM dns_templates WHERE id = ?',
      [req.params.id]
    )
    if (!template) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!canWriteTemplate(req, template.tenant_id)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const old = await queryOne(
      'SELECT * FROM dns_template_records WHERE id = ? AND template_id = ?',
      [req.params.recordId, req.params.id]
    )
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    await execute('DELETE FROM dns_template_records WHERE id = ?', [req.params.recordId])
    await writeAuditLog({ req, entityType: 'dns_template_record', entityId: Number(req.params.recordId), action: 'delete', oldValue: old })
    return { ok: true }
  })

  // POST /domains/:domainId/apply-template/preview
  app.post<{ Params: { domainId: string } }>(
    '/domains/:domainId/apply-template/preview',
    { preHandler: requireAuth },
    async (req, reply) => {
      const domain = await resolveDomain(req.params.domainId, req, reply)
      if (!domain) return

      const body = req.body as any
      const { templateId, mode } = body as { templateId: number; mode: ApplyMode }

      if (!templateId || !mode) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'templateId and mode are required' })
      }
      if (!['add_missing', 'overwrite_matching', 'replace_all'].includes(mode)) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid mode' })
      }

      const vis = visibilityClause(req)
      const template = await queryOne(
        `SELECT t.id FROM dns_templates t WHERE t.id = ?${vis.sql}`,
        [templateId, ...vis.params]
      )
      if (!template) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Template not found' })

      const templateRecords = await query<TemplateRecord>(
        'SELECT id, name, type, ttl, priority, weight, port, value FROM dns_template_records WHERE template_id = ?',
        [templateId]
      )

      const diff = await computeTemplateDiff(domain.id, templateRecords, mode)
      return diff
    }
  )

  // POST /domains/:domainId/apply-template
  app.post<{ Params: { domainId: string } }>(
    '/domains/:domainId/apply-template',
    { preHandler: requireAuth },
    async (req, reply) => {
      const domain = await resolveDomain(req.params.domainId, req, reply)
      if (!domain) return

      const body = req.body as any
      const { templateId, mode } = body as { templateId: number; mode: ApplyMode }

      if (!templateId || !mode) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'templateId and mode are required' })
      }
      if (!['add_missing', 'overwrite_matching', 'replace_all'].includes(mode)) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid mode' })
      }

      const vis = visibilityClause(req)
      const template = await queryOne<{ id: number; name: string }>(
        `SELECT t.id, t.name FROM dns_templates t WHERE t.id = ?${vis.sql}`,
        [templateId, ...vis.params]
      )
      if (!template) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Template not found' })

      const templateRecords = await query<TemplateRecord>(
        'SELECT id, name, type, ttl, priority, weight, port, value FROM dns_template_records WHERE template_id = ?',
        [templateId]
      )

      const diff = await computeTemplateDiff(domain.id, templateRecords, mode)

      await transaction(async (conn) => {
        for (const rec of diff.toDelete) {
          await conn.execute('UPDATE dns_records SET is_deleted = 1 WHERE id = ?', [rec.id])
        }
        for (const tr of diff.toAdd) {
          await conn.execute(
            `INSERT INTO dns_records (domain_id, name, type, ttl, priority, weight, port, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [domain.id, tr.name, tr.type, tr.ttl ?? null, tr.priority ?? null, tr.weight ?? null, tr.port ?? null, tr.value]
          )
        }
        for (const { existing, incoming } of diff.toUpdate) {
          await conn.execute(
            `UPDATE dns_records SET ttl=?, priority=?, weight=?, port=?, value=? WHERE id=?`,
            [incoming.ttl ?? null, incoming.priority ?? null, incoming.weight ?? null, incoming.port ?? null, incoming.value, existing.id]
          )
        }
      })

      await enqueueRender(domain.id)
      broadcast({ type: 'record_changed', domainId: domain.id, tenantId: domain.tenant_id })
      await writeAuditLog({
        req,
        entityType: 'template_apply',
        entityId: templateId,
        domainId: domain.id,
        action: 'apply',
        newValue: {
          templateId,
          templateName: template.name,
          mode,
          added: diff.toAdd.length,
          updated: diff.toUpdate.length,
          deleted: diff.toDelete.length,
        },
      })

      return {
        ok: true,
        added: diff.toAdd.length,
        updated: diff.toUpdate.length,
        deleted: diff.toDelete.length,
      }
    }
  )
}
