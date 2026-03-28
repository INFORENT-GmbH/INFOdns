import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

async function queueMail(to: string, template: string, payload: unknown): Promise<void> {
  await execute(
    `INSERT INTO mail_queue (to_email, template, payload) VALUES (?, ?, ?)`,
    [to, template, JSON.stringify(payload)]
  )
}

async function enqueueRender(domainId: number) {
  await execute(
    `INSERT INTO zone_render_queue (domain_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'processing', status, 'pending'), updated_at = NOW()`,
    [domainId]
  )
  await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [domainId])
}

const FQDN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

const EXPECTED_NS: string[] = (process.env.NS_RECORDS ?? '')
  .split(',').map(s => s.trim().replace(/\.$/, '').toLowerCase()).filter(Boolean)

const CreateDomainBody = z.object({
  fqdn: z.string().min(1).max(253).refine(v => FQDN_RE.test(v), 'Invalid FQDN'),
  customer_id: z.number().int().positive(),
  default_ttl: z.number().int().positive().optional().default(3600),
  notes: z.string().optional(),
})

const UpdateDomainBody = z.object({
  status: z.enum(['active', 'pending', 'suspended']).optional(),
  default_ttl: z.number().int().positive().optional(),
  notes: z.string().optional(),
  dnssec_enabled: z.boolean().optional(),
  customer_id: z.number().int().positive().optional(),
})

const LabelSchema = z.object({
  id: z.number().int().optional().default(0),
  key: z.string().regex(/^[a-zA-Z0-9_\-.\/]{1,63}$/),
  value: z.string().max(63).default(''),
  color: z.string().max(20).nullable().optional(),
  admin_only: z.boolean().optional().default(false),
})

const UpdateLabelsBody = z.object({
  labels: z.array(LabelSchema),
})

async function fetchLabels(domainIds: number[], isAdmin = false): Promise<Map<number, { id: number; key: string; value: string; color: string | null; admin_only: boolean }[]>> {
  if (domainIds.length === 0) return new Map()
  const adminFilter = isAdmin ? '' : ' AND l.admin_only = 0'
  const rows = await query(
    `SELECT l.id, dl.domain_id, l.label_key AS \`key\`, l.label_value AS \`value\`, l.color, l.admin_only
     FROM domain_labels dl
     JOIN labels l ON l.id = dl.label_id
     WHERE dl.domain_id IN (${domainIds.map(() => '?').join(',')})${adminFilter}
     ORDER BY l.label_key, l.id`,
    domainIds
  ) as any[]
  const map = new Map<number, { id: number; key: string; value: string; color: string | null; admin_only: boolean }[]>()
  for (const r of rows) {
    if (!map.has(r.domain_id)) map.set(r.domain_id, [])
    map.get(r.domain_id)!.push({ id: r.id, key: r.key, value: r.value, color: r.color ?? null, admin_only: !!r.admin_only })
  }
  return map
}


/** Inject ownership filter for non-admin users via user_customers junction table */
function ownerFilter(req: any): string {
  if (req.user.role === 'admin') return ''
  return ` AND d.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ${Number(req.user.sub)})`
}

export async function domainRoutes(app: FastifyInstance) {
  // GET /domains/labels  — distinct label keys + values scoped to a customer
  app.get('/domains/labels', { preHandler: requireAuth }, async (req: any, reply) => {
    const isAdmin = req.user.role === 'admin'
    const { customer_id } = req.query as Record<string, string>

    const params: unknown[] = []
    let where: string
    if (!isAdmin && !customer_id) {
      where = 'WHERE l.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ?) AND l.admin_only = 0'
      params.push(req.user.sub)
    } else if (customer_id) {
      where = isAdmin
        ? 'WHERE (l.customer_id = ? AND l.admin_only = 0) OR (l.admin_only = 1 AND l.customer_id IS NULL)'
        : 'WHERE l.customer_id = ? AND l.admin_only = 0'
      params.push(Number(customer_id))
    } else {
      where = isAdmin ? '' : 'WHERE l.admin_only = 0'
    }

    const rows = await query(
      `SELECT l.label_key AS \`key\`, l.label_value AS \`value\`, MAX(l.color) AS color, MAX(l.admin_only) AS admin_only
       FROM labels l ${where}
       GROUP BY l.label_key, l.label_value
       ORDER BY l.label_key, l.label_value`,
      params
    ) as any[]
    const map = new Map<string, { values: Set<string>; color: string | null; admin_only: boolean }>()
    for (const r of rows) {
      if (!map.has(r.key)) map.set(r.key, { values: new Set(), color: r.color ?? null, admin_only: !!r.admin_only })
      if (r.value !== '') map.get(r.key)!.values.add(r.value)
    }
    return Array.from(map.entries()).map(([key, { values, color, admin_only }]) => ({ key, values: Array.from(values), color, admin_only }))
  })

  // GET /domains
  app.get('/domains', { preHandler: requireAuth }, async (req: any, reply) => {
    const { search, customer_id, label, page = '1', limit = '50', show_deleted } = req.query as Record<string, string>
    const isAdmin = req.user.role === 'admin'
    const offset = (Number(page) - 1) * Number(limit)
    const params: unknown[] = []
    let join = ''
    let where = (isAdmin && show_deleted === 'true')
      ? "WHERE d.status = 'deleted'"
      : "WHERE d.status != 'deleted'"

    if (label) {
      const eqIdx = label.indexOf('=')
      const lKey = eqIdx >= 0 ? label.slice(0, eqIdx) : label
      const lVal = eqIdx >= 0 ? label.slice(eqIdx + 1) : null
      if (lVal !== null) {
        where += ` AND EXISTS (SELECT 1 FROM domain_labels _dl JOIN labels _l ON _l.id = _dl.label_id WHERE _dl.domain_id = d.id AND _l.label_key = ? AND _l.label_value = ?)`
        params.push(lKey, lVal)
      } else {
        where += ` AND EXISTS (SELECT 1 FROM domain_labels _dl JOIN labels _l ON _l.id = _dl.label_id WHERE _dl.domain_id = d.id AND _l.label_key = ?)`
        params.push(lKey)
      }
    }

    if (!isAdmin) {
      where += ` AND d.customer_id IN (SELECT customer_id FROM user_customers WHERE user_id = ?)`
      params.push(req.user.sub)
    }
    if (customer_id) {
      where += ` AND d.customer_id = ?`
      params.push(Number(customer_id))
    }
    if (search) {
      where += ` AND d.fqdn LIKE ?`
      params.push(`%${search}%`)
    }

    const rows = await query(
      `SELECT d.id, d.fqdn, d.status, d.zone_status, d.last_serial, d.last_rendered_at,
              d.default_ttl, d.customer_id, c.name AS customer_name, d.created_at, d.deleted_at,
              d.dnssec_enabled, d.ns_ok, d.ns_checked_at
       FROM domains d JOIN customers c ON c.id = d.customer_id${join}
       ${where}
       ORDER BY d.fqdn
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    ) as any[]
    const labelMap = await fetchLabels(rows.map((r: any) => r.id), isAdmin)
    return rows.map((r: any) => ({ ...r, labels: labelMap.get(r.id) ?? [], expected_ns: EXPECTED_NS }))
  })

  // POST /domains
  app.post('/domains', { preHandler: requireAuth }, async (req: any, reply) => {
    const body = CreateDomainBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    // Non-admin/operator users can only create domains for their own customers
    if (!['admin', 'operator'].includes(req.user.role)) {
      const owned = await queryOne(
        'SELECT 1 FROM user_customers WHERE user_id = ? AND customer_id = ?',
        [req.user.sub, body.data.customer_id]
      )
      if (!owned) return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const existing = await queryOne('SELECT id FROM domains WHERE fqdn = ?', [body.data.fqdn])
    if (existing) return reply.status(409).send({ code: 'FQDN_TAKEN' })

    const result = await execute(
      'INSERT INTO domains (fqdn, customer_id, default_ttl, notes, status, zone_status) VALUES (?, ?, ?, ?, ?, ?)',
      [body.data.fqdn, body.data.customer_id, body.data.default_ttl, body.data.notes ?? null, 'active', 'dirty']
    )
    const created = await queryOne('SELECT * FROM domains WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'domain', entityId: result.insertId, domainId: result.insertId, action: 'create', newValue: created })
    await enqueueRender(result.insertId)
    return reply.status(201).send(created)
  })

  // GET /domains/:id
  app.get<{ Params: { id: string } }>('/domains/:id', { preHandler: requireAuth }, async (req, reply) => {
    const row = await queryOne(
      `SELECT d.*, c.name AS customer_name,
              q.error AS zone_error, q.retries AS zone_retries
       FROM domains d
       JOIN customers c ON c.id = d.customer_id
       LEFT JOIN zone_render_queue q ON q.domain_id = d.id AND q.id = (
         SELECT MAX(id) FROM zone_render_queue WHERE domain_id = d.id
       )
       WHERE d.id = ? AND d.status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    ) as any
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    const isAdmin = (req as any).user.role === 'admin'
    const labelMap = await fetchLabels([row.id], isAdmin)
    return { ...row, labels: labelMap.get(row.id) ?? [], expected_ns: EXPECTED_NS }
  })

  // PUT /domains/:id
  app.put<{ Params: { id: string } }>('/domains/:id', { preHandler: requireAuth }, async (req, reply) => {
    const old = await queryOne(
      `SELECT * FROM domains WHERE id = ? AND status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    )
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateDomainBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    if (body.data.status !== undefined && req.user.role !== 'admin') {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    if (body.data.dnssec_enabled !== undefined && !['admin', 'operator'].includes(req.user.role)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    if (body.data.customer_id !== undefined && req.user.role !== 'admin') {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    if (body.data.customer_id !== undefined) {
      const targetCustomer = await queryOne(
        'SELECT id FROM customers WHERE id = ? AND is_active = 1',
        [body.data.customer_id]
      )
      if (!targetCustomer) return reply.status(422).send({ code: 'CUSTOMER_NOT_FOUND' })
    }

    const dnssecVal = body.data.dnssec_enabled != null ? (body.data.dnssec_enabled ? 1 : 0) : null
    await execute(
      `UPDATE domains SET
         status         = COALESCE(?, status),
         default_ttl    = COALESCE(?, default_ttl),
         notes          = COALESCE(?, notes),
         dnssec_enabled = COALESCE(?, dnssec_enabled),
         customer_id    = COALESCE(?, customer_id)
       WHERE id = ?`,
      [body.data.status ?? null, body.data.default_ttl ?? null, body.data.notes ?? null, dnssecVal, body.data.customer_id ?? null, req.params.id]
    )
    const updated = await queryOne('SELECT * FROM domains WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'domain', entityId: Number(req.params.id), domainId: Number(req.params.id), action: 'update', oldValue: old, newValue: updated })
    const zoneRelevant = body.data.status !== undefined || body.data.default_ttl !== undefined || body.data.dnssec_enabled !== undefined
    if (zoneRelevant) await enqueueRender(Number(req.params.id))
    return updated
  })

  // PUT /domains/:id/labels
  app.put<{ Params: { id: string } }>('/domains/:id/labels', { preHandler: requireAuth }, async (req: any, reply) => {
    const domain = await queryOne(
      `SELECT id, customer_id FROM domains WHERE id = ? AND status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    ) as any
    if (!domain) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateLabelsBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const domainId = Number(req.params.id)
    const isAdmin = req.user.role === 'admin'
    const customerIdForLabel = domain.customer_id as number

    const labelIds: number[] = []
    for (const { id: existingId, key, value, color, admin_only } of body.data.labels) {
      const useAdminOnly = isAdmin && !!admin_only
      let labelId: number

      if (existingId > 0) {
        // Update existing canonical row.
        // When marking admin-only: move to global (customer_id = NULL).
        // When un-marking: leave customer_id as-is — don't include it in the UPDATE.
        if (useAdminOnly) {
          await execute(
            'UPDATE labels SET label_key=?, label_value=?, color=?, admin_only=1, customer_id=NULL WHERE id=?',
            [key, value, color ?? null, existingId]
          )
        } else {
          await execute(
            'UPDATE labels SET label_key=?, label_value=?, color=?, admin_only=0 WHERE id=?',
            [key, value, color ?? null, existingId]
          )
        }
        labelId = existingId
      } else {
        // New label: find existing by key+value+scope, or insert.
        const existing = await queryOne(
          useAdminOnly
            ? 'SELECT id FROM labels WHERE label_key=? AND label_value=? AND admin_only=1 AND customer_id IS NULL'
            : 'SELECT id FROM labels WHERE label_key=? AND label_value=? AND admin_only=0 AND customer_id=?',
          useAdminOnly ? [key, value] : [key, value, customerIdForLabel]
        ) as any
        if (existing) {
          if (color !== undefined) await execute('UPDATE labels SET color=? WHERE id=?', [color ?? null, existing.id])
          labelId = existing.id
        } else {
          const r = await execute(
            'INSERT INTO labels (customer_id, label_key, label_value, color, admin_only) VALUES (?, ?, ?, ?, ?)',
            [useAdminOnly ? null : customerIdForLabel, key, value, color ?? null, useAdminOnly ? 1 : 0]
          )
          labelId = r.insertId
        }
      }

      labelIds.push(labelId)

      // color + admin_only are key-level — propagate to all rows with the same key
      if (isAdmin) {
        if (useAdminOnly) {
          await execute(
            'UPDATE labels SET admin_only=1, customer_id=NULL, color=? WHERE label_key=? AND id!=?',
            [color ?? null, key, labelId]
          )
          // Consolidate duplicate rows (same key+value) that now share scope
          const dupeRows = await query(
            'SELECT id, label_value FROM labels WHERE label_key = ? ORDER BY id',
            [key]
          ) as { id: number; label_value: string }[]
          const byValue = new Map<string, number[]>()
          for (const r of dupeRows) {
            if (!byValue.has(r.label_value)) byValue.set(r.label_value, [])
            byValue.get(r.label_value)!.push(r.id)
          }
          for (const [, ids] of byValue) {
            if (ids.length <= 1) continue
            const canonical = ids.includes(labelId) ? labelId : ids[0]
            const dupeIds = ids.filter(i => i !== canonical)
            for (const dupeId of dupeIds) {
              await execute('UPDATE domain_labels SET label_id = ? WHERE label_id = ?', [canonical, dupeId])
            }
            await execute(`DELETE FROM labels WHERE id IN (${dupeIds.map(() => '?').join(',')})`, dupeIds)
          }
        } else {
          // Un-mark admin_only globally, but scope color to same customer
          await execute('UPDATE labels SET admin_only=0 WHERE label_key=? AND id!=?', [key, labelId])
          await execute('UPDATE labels SET color=? WHERE label_key=? AND customer_id=? AND id!=?',
            [color ?? null, key, customerIdForLabel, labelId])
        }
      } else {
        // Non-admin: still propagate color within same customer scope
        await execute(
          'UPDATE labels SET color=? WHERE label_key=? AND customer_id=? AND id!=?',
          [color ?? null, key, customerIdForLabel, labelId]
        )
      }
    }

    // Full-replace assignments, preserving admin-only ones for non-admins
    if (isAdmin) {
      await execute('DELETE FROM domain_labels WHERE domain_id = ?', [domainId])
    } else {
      await execute(
        `DELETE dl FROM domain_labels dl
         JOIN labels l ON l.id = dl.label_id
         WHERE dl.domain_id = ? AND l.admin_only = 0`,
        [domainId]
      )
    }
    for (const labelId of labelIds) {
      await execute('INSERT IGNORE INTO domain_labels (domain_id, label_id) VALUES (?, ?)', [domainId, labelId])
    }

    const labelMap = await fetchLabels([domainId], isAdmin)
    return labelMap.get(domainId) ?? []
  })

  // DELETE /domains/:id  (soft delete — admin only)
  app.delete<{ Params: { id: string } }>('/domains/:id', { preHandler: requireAuth }, async (req: any, reply) => {
    if (req.user.role !== 'admin') return reply.status(403).send({ code: 'FORBIDDEN' })
    const old = await queryOne("SELECT * FROM domains WHERE id = ? AND status != 'deleted'", [req.params.id]) as any
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const purgeDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
    await execute(
      "UPDATE domains SET status = 'deleted', deleted_at = NOW(), reminder_flags = 0 WHERE id = ?",
      [req.params.id]
    )
    await writeAuditLog({ req, entityType: 'domain', entityId: Number(req.params.id), domainId: Number(req.params.id), action: 'delete', oldValue: old })
    await enqueueRender(Number(req.params.id))

    const admins = await query<{ email: string }>('SELECT email FROM users WHERE role = ? AND is_active = 1', ['admin'])
    for (const admin of admins) {
      await queueMail(admin.email, 'domain_deleted', {
        fqdn: old.fqdn,
        deletedBy: req.user.email ?? String(req.user.sub),
        deletedAt: new Date().toISOString().slice(0, 10),
        purgeDate,
      })
    }
    return { ok: true }
  })

  // POST /domains/:id/restore  (admin only)
  app.post<{ Params: { id: string } }>('/domains/:id/restore', { preHandler: requireAuth }, async (req: any, reply) => {
    if (req.user.role !== 'admin') return reply.status(403).send({ code: 'FORBIDDEN' })
    const old = await queryOne("SELECT * FROM domains WHERE id = ? AND status = 'deleted'", [req.params.id])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })
    await execute(
      "UPDATE domains SET status = 'active', deleted_at = NULL, reminder_flags = 0 WHERE id = ?",
      [req.params.id]
    )
    const restored = await queryOne('SELECT * FROM domains WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'domain', entityId: Number(req.params.id), domainId: Number(req.params.id), action: 'restore', oldValue: old, newValue: restored })
    await enqueueRender(Number(req.params.id))
    return restored
  })
}
