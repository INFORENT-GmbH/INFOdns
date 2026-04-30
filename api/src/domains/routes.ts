import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { promises as dns } from 'dns'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { query, queryOne, execute } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'
import { enqueueRender } from '../lib/queue.js'
import { broadcast } from '../ws/hub.js'

const execFileAsync = promisify(execFile)

async function queueMail(to: string, template: string, payload: unknown): Promise<void> {
  await execute(
    `INSERT INTO mail_queue (to_email, template, payload) VALUES (?, ?, ?)`,
    [to, template, JSON.stringify(payload)]
  )
}

const FQDN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

const EXPECTED_NS: string[] = (process.env.NS_RECORDS ?? '')
  .split(',').map(s => s.trim().replace(/\.$/, '').toLowerCase()).filter(Boolean)

const CreateDomainBody = z.object({
  fqdn: z.string().min(1).max(253).refine(v => FQDN_RE.test(v), 'Invalid FQDN'),
  tenant_id: z.number().int().positive(),
  default_ttl: z.number().int().positive().optional().default(3600),
  notes: z.string().optional(),
})

const UpdateDomainBody = z.object({
  status: z.enum(['active', 'pending', 'suspended']).optional(),
  default_ttl: z.number().int().positive().optional(),
  notes: z.string().optional(),
  dnssec_enabled: z.boolean().optional(),
  tenant_id: z.number().int().positive().optional(),
  ns_reference: z.string().max(253).nullable().optional(),
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


/** Inject ownership filter for non-admin users via user_tenants junction table */
function ownerFilter(req: any): string {
  if (req.user.role === 'admin') return ''
  return ` AND d.tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ${Number(req.user.sub)})`
}

// ── DNS check helpers ────────────────────────────────────────────────

const SECONDARY_IPS = (process.env.SECONDARY_IPS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const NS_RECORD_NAMES = (process.env.NS_RECORDS ?? '').split(',')
  .map(s => s.trim().replace(/\.$/, '').split('.')[0]).filter(Boolean)

const DNS_RESOLVERS = [
  { name: NS_RECORD_NAMES[0] ?? 'ns1', ip: SECONDARY_IPS[0] ?? '80.243.196.38' },
  { name: NS_RECORD_NAMES[1] ?? 'ns2', ip: SECONDARY_IPS[1] ?? '80.243.196.39' },
  { name: '1.1.1.1', ip: '1.1.1.1' },
  { name: '8.8.8.8', ip: '8.8.8.8' },
]

const UNSUPPORTED_TYPES = new Set(['TLSA', 'SSHFP', 'DNSKEY', 'DS'])

function buildQueryFqdn(label: string, domainFqdn: string): string {
  return label === '@' || label === '' ? domainFqdn : `${label}.${domainFqdn}`
}

function formatDnsAnswers(type: string, raw: any): string[] {
  if (!Array.isArray(raw)) return []
  const t = type === 'ALIAS' ? 'A' : type
  switch (t) {
    case 'MX':    return raw.map((r: any) => `${r.priority} ${r.exchange}`)
    case 'TXT':   return raw.map((chunks: string[]) => chunks.join(''))
    case 'SRV':   return raw.map((r: any) => `${r.priority} ${r.weight} ${r.port} ${r.name}`)
    case 'CAA':   return raw.map((r: any) => `${r.critical} ${r.issue ?? r.issuewild ?? r.iodef ?? ''}`)
    case 'NAPTR': return raw.map((r: any) =>
                    `${r.order} ${r.preference} "${r.flags}" "${r.service}" "${r.regexp}" ${r.replacement}`)
    default:      return raw as string[]
  }
}

async function queryResolver(
  resolverIp: string,
  fqdn: string,
  type: string,
): Promise<{ values: string[]; error?: string }> {
  const effectiveType = type === 'ALIAS' ? 'A' : type
  const resolver = new dns.Resolver()
  resolver.setServers([`${resolverIp}:53`])
  try {
    const raw = await Promise.race<any>([
      resolver.resolve(fqdn, effectiveType as any),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
    return { values: formatDnsAnswers(type, raw) }
  } catch (err: any) {
    return { values: [], error: err.code ?? err.message ?? 'error' }
  }
}

export async function domainRoutes(app: FastifyInstance) {
  // GET /domains/labels  — distinct label keys + values scoped to a tenant
  app.get('/domains/labels', { preHandler: requireAuth }, async (req: any, reply) => {
    const isAdmin = req.user.role === 'admin'
    const { tenant_id } = req.query as Record<string, string>

    const params: unknown[] = []
    let where: string
    if (!isAdmin && !tenant_id) {
      where = 'WHERE l.tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ?) AND l.admin_only = 0'
      params.push(req.user.sub)
    } else if (tenant_id) {
      if (!isAdmin) {
        const owned = await queryOne(
          'SELECT 1 FROM user_tenants WHERE user_id = ? AND tenant_id = ?',
          [req.user.sub, Number(tenant_id)]
        )
        if (!owned) return reply.status(403).send({ code: 'FORBIDDEN' })
      }
      where = isAdmin
        ? 'WHERE (l.tenant_id = ? AND l.admin_only = 0) OR (l.admin_only = 1 AND l.tenant_id IS NULL)'
        : 'WHERE l.tenant_id = ? AND l.admin_only = 0'
      params.push(Number(tenant_id))
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
    const { search, tenant_id, label, page = '1', limit = '50', show_deleted } = req.query as Record<string, string>
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
      where += ` AND d.tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ?)`
      params.push(req.user.sub)
    }
    if (tenant_id) {
      const ids = tenant_id.split(',').map(Number).filter(n => Number.isInteger(n) && n > 0)
      if (ids.length === 1) {
        where += ` AND d.tenant_id = ?`
        params.push(ids[0])
      } else if (ids.length > 1) {
        where += ` AND d.tenant_id IN (${ids.map(() => '?').join(',')})`
        params.push(...ids)
      }
    }
    if (search) {
      // Glob-style: `*` → `%`, `?` → `_`, anchored on both ends.
      // Escape LIKE specials in raw input first so user-typed `%`/`_`/`\` are literal.
      const pattern = search
        .replace(/\\/g, '\\\\')
        .replace(/[%_]/g, '\\$&')
        .replace(/\*/g, '%')
        .replace(/\?/g, '_')
      where += ` AND d.fqdn LIKE ?`
      params.push(pattern)
    }

    const rows = await query(
      `SELECT d.id, d.fqdn, d.status, d.zone_status, d.last_serial, d.last_rendered_at,
              d.default_ttl, d.tenant_id, c.name AS tenant_name, d.created_at, d.deleted_at,
              d.dnssec_enabled, d.ns_ok, d.ns_checked_at, d.dnssec_ok, d.dnssec_checked_at,
              d.ns_reference
       FROM domains d JOIN tenants c ON c.id = d.tenant_id${join}
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

    // Non-admin/operator users can only create domains for their own tenants
    if (!['admin', 'operator'].includes(req.user.role)) {
      const owned = await queryOne(
        'SELECT 1 FROM user_tenants WHERE user_id = ? AND tenant_id = ?',
        [req.user.sub, body.data.tenant_id]
      )
      if (!owned) return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    const existing = await queryOne('SELECT id FROM domains WHERE fqdn = ?', [body.data.fqdn])
    if (existing) return reply.status(409).send({ code: 'FQDN_TAKEN' })

    let result
    try {
      result = await execute(
        'INSERT INTO domains (fqdn, tenant_id, default_ttl, notes, status, zone_status) VALUES (?, ?, ?, ?, ?, ?)',
        [body.data.fqdn, body.data.tenant_id, body.data.default_ttl, body.data.notes ?? null, 'active', 'dirty']
      )
    } catch (err: any) {
      // Race: another concurrent request inserted the same FQDN between our SELECT and INSERT.
      if (err?.code === 'ER_DUP_ENTRY') return reply.status(409).send({ code: 'FQDN_TAKEN' })
      throw err
    }
    const created = await queryOne('SELECT * FROM domains WHERE id = ?', [result.insertId])
    await writeAuditLog({ req, entityType: 'domain', entityId: result.insertId, domainId: result.insertId, action: 'create', newValue: created })
    await enqueueRender(result.insertId)
    return reply.status(201).send(created)
  })

  // GET /domains/stats
  app.get('/domains/stats', { preHandler: requireAuth }, async (req: any, reply) => {
    const isAdmin = req.user.role === 'admin'
    const ownerWhere = isAdmin ? '' : ` AND d.tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ${Number(req.user.sub)})`

    const [row] = await query(
      `SELECT
         COUNT(*)                                                    AS total,
         SUM(d.status = 'active')                                   AS active,
         SUM(d.status = 'pending')                                  AS pending,
         SUM(d.status = 'suspended')                                AS suspended,
         SUM(d.status = 'deleted')                                  AS deleted,
         SUM(d.zone_status = 'error'  AND d.status = 'active')     AS zone_error,
         SUM(d.zone_status = 'dirty'  AND d.status = 'active')     AS zone_dirty,
         SUM(d.ns_ok = 0              AND d.status = 'active')     AS ns_not_ok,
         SUM(d.dnssec_enabled = 1     AND d.status = 'active')     AS dnssec_enabled,
         SUM(d.ns_reference IS NOT NULL AND d.status = 'active')   AS ns_ref
       FROM domains d WHERE 1=1${ownerWhere}`,
      []
    ) as any[]

    const top_tenants = isAdmin ? await query(
      `SELECT c.name AS tenant_name, COUNT(*) AS domain_count
       FROM domains d JOIN tenants c ON c.id = d.tenant_id
       WHERE d.status != 'deleted'
       GROUP BY d.tenant_id ORDER BY domain_count DESC LIMIT 10`,
      []
    ) : []

    return { ...row, top_tenants }
  })

  // GET /domains/:id  — accepts either FQDN or numeric ID
  app.get<{ Params: { id: string } }>('/domains/:id', { preHandler: requireAuth }, async (req, reply) => {
    const isNumeric = /^\d+$/.test(req.params.id)
    const whereCol = isNumeric ? 'd.id' : 'd.fqdn'
    const row = await queryOne(
      `SELECT d.*, c.name AS tenant_name,
              q.error AS zone_error, q.retries AS zone_retries
       FROM domains d
       JOIN tenants c ON c.id = d.tenant_id
       LEFT JOIN zone_render_queue q ON q.domain_id = d.id AND q.id = (
         SELECT MAX(id) FROM zone_render_queue WHERE domain_id = d.id
       )
       WHERE ${whereCol} = ? AND d.status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    ) as any
    if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
    const isAdmin = (req as any).user.role === 'admin'
    const labelMap = await fetchLabels([row.id], isAdmin)
    const templates = await query(
      `SELECT t.id, t.name FROM domain_templates dt
       JOIN dns_templates t ON t.id = dt.template_id
       WHERE dt.domain_id = ? ORDER BY dt.assigned_at`,
      [row.id]
    )
    return { ...row, labels: labelMap.get(row.id) ?? [], expected_ns: EXPECTED_NS, templates }
  })

  // POST /domains/:id/check-dnssec — force a DNSKEY visibility check NOW (instead of
  // waiting for the worker's polling cadence). Updates dnssec_ok + dnssec_checked_at
  // and broadcasts the change so the UI updates everywhere.
  app.post<{ Params: { id: string } }>(
    '/domains/:id/check-dnssec',
    { preHandler: requireAuth },
    async (req, reply) => {
      const isNumeric = /^\d+$/.test(req.params.id)
      const whereCol = isNumeric ? 'd.id' : 'd.fqdn'
      const row = await queryOne<{ id: number; fqdn: string; tenant_id: number; dnssec_enabled: number; zone_status: string }>(
        `SELECT d.id, d.fqdn, d.tenant_id, d.dnssec_enabled, d.zone_status FROM domains d
         WHERE ${whereCol} = ? AND d.status != 'deleted'${ownerFilter(req)}`,
        [req.params.id]
      )
      if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
      if (!row.dnssec_enabled) return reply.status(400).send({ code: 'DNSSEC_NOT_ENABLED' })

      // Validate end-to-end chain of trust against a validating resolver (1.1.1.1).
      // The AD flag is only set when the resolver verified the DS-DNSKEY chain.
      const ok = await execFileAsync('dig', [
        '+dnssec', '+timeout=5', '+tries=2', '+noshort',
        'SOA', row.fqdn, '@1.1.1.1',
      ]).then(({ stdout }) => {
        if (!/->>HEADER<<-.*status:\s*NOERROR/i.test(stdout)) return false
        return /;;\s*flags:[^;]*\bad\b/i.test(stdout)
      }).catch(() => false)

      const newOk = ok ? 1 : 0
      await execute(
        'UPDATE domains SET dnssec_ok = ?, dnssec_checked_at = NOW() WHERE id = ?',
        [newOk, row.id]
      )
      broadcast({
        type: 'domain_status',
        domainId: row.id,
        fqdn: row.fqdn,
        zone_status: row.zone_status,
        tenantId: row.tenant_id,
        dnssec_ok: newOk,
      })
      return { ok: !!newOk, dnssec_ok: newOk, checked_at: new Date().toISOString() }
    }
  )

  // POST /domains/:id/check-serial — preflight optimistic-locking check before bulk apply
  // Body: { expected_serial: number }. 200 if matches, 409 if zone has advanced.
  app.post<{ Params: { id: string }; Body: { expected_serial?: number } }>(
    '/domains/:id/check-serial',
    { preHandler: requireAuth },
    async (req, reply) => {
      const expected = Number(req.body?.expected_serial)
      if (!Number.isFinite(expected) || expected <= 0) {
        return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'expected_serial must be a positive integer' })
      }
      const isNumeric = /^\d+$/.test(req.params.id)
      const whereCol = isNumeric ? 'd.id' : 'd.fqdn'
      const row = await queryOne<{ last_serial: number }>(
        `SELECT d.last_serial FROM domains d
         WHERE ${whereCol} = ? AND d.status != 'deleted'${ownerFilter(req)}`,
        [req.params.id]
      )
      if (!row) return reply.status(404).send({ code: 'NOT_FOUND' })
      if (row.last_serial !== expected) {
        return reply.status(409).send({
          code: 'SERIAL_CONFLICT',
          message: `Zone has been updated by someone else (your serial: ${expected}, current: ${row.last_serial}). Reload to see the latest records.`,
          current_serial: row.last_serial,
        })
      }
      return { ok: true, current_serial: row.last_serial }
    }
  )

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
    if (body.data.tenant_id !== undefined && req.user.role !== 'admin') {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }

    if (body.data.tenant_id !== undefined) {
      const targetTenant = await queryOne(
        'SELECT id FROM tenants WHERE id = ? AND is_active = 1',
        [body.data.tenant_id]
      )
      if (!targetTenant) return reply.status(422).send({ code: 'TENANT_NOT_FOUND' })
    }

    const dnssecVal = body.data.dnssec_enabled != null ? (body.data.dnssec_enabled ? 1 : 0) : null
    const nsRefProvided = body.data.ns_reference !== undefined

    const setParts: string[] = [
      'status         = COALESCE(?, status)',
      'default_ttl    = COALESCE(?, default_ttl)',
      'notes          = COALESCE(?, notes)',
      'dnssec_enabled = COALESCE(?, dnssec_enabled)',
      'tenant_id      = COALESCE(?, tenant_id)',
    ]
    const setParams: unknown[] = [
      body.data.status ?? null,
      body.data.default_ttl ?? null,
      body.data.notes ?? null,
      dnssecVal,
      body.data.tenant_id ?? null,
    ]

    if (nsRefProvided) { setParts.push('ns_reference = ?'); setParams.push(body.data.ns_reference) }

    setParams.push(req.params.id)
    await execute(`UPDATE domains SET ${setParts.join(', ')} WHERE id = ?`, setParams)

    const updated = await queryOne('SELECT * FROM domains WHERE id = ?', [req.params.id])
    await writeAuditLog({ req, entityType: 'domain', entityId: Number(req.params.id), domainId: Number(req.params.id), action: 'update', oldValue: old, newValue: updated })
    const zoneRelevant = body.data.status !== undefined || body.data.default_ttl !== undefined || body.data.dnssec_enabled !== undefined || nsRefProvided
    if (zoneRelevant) await enqueueRender(Number(req.params.id))
    return updated
  })

  // PUT /domains/:id/labels
  app.put<{ Params: { id: string } }>('/domains/:id/labels', { preHandler: requireAuth }, async (req: any, reply) => {
    const domain = await queryOne(
      `SELECT id, tenant_id FROM domains WHERE id = ? AND status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    ) as any
    if (!domain) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = UpdateLabelsBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const domainId = Number(req.params.id)
    const isAdmin = req.user.role === 'admin'
    const tenantIdForLabel = domain.tenant_id as number

    const labelIds: number[] = []
    for (const { id: existingId, key, value, color, admin_only } of body.data.labels) {
      const useAdminOnly = isAdmin && !!admin_only
      let labelId: number

      if (existingId > 0) {
        // Update existing canonical row.
        // When marking admin-only: move to global (tenant_id = NULL).
        // When un-marking: leave tenant_id as-is — don't include it in the UPDATE.
        if (useAdminOnly) {
          await execute(
            'UPDATE labels SET label_key=?, label_value=?, color=?, admin_only=1, tenant_id=NULL WHERE id=?',
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
            ? 'SELECT id FROM labels WHERE label_key=? AND label_value=? AND admin_only=1 AND tenant_id IS NULL'
            : 'SELECT id FROM labels WHERE label_key=? AND label_value=? AND admin_only=0 AND tenant_id=?',
          useAdminOnly ? [key, value] : [key, value, tenantIdForLabel]
        ) as any
        if (existing) {
          if (color !== undefined) await execute('UPDATE labels SET color=? WHERE id=?', [color ?? null, existing.id])
          labelId = existing.id
        } else {
          const r = await execute(
            'INSERT INTO labels (tenant_id, label_key, label_value, color, admin_only) VALUES (?, ?, ?, ?, ?)',
            [useAdminOnly ? null : tenantIdForLabel, key, value, color ?? null, useAdminOnly ? 1 : 0]
          )
          labelId = r.insertId
        }
      }

      labelIds.push(labelId)

      // color + admin_only are key-level — propagate to all rows with the same key
      if (isAdmin) {
        if (useAdminOnly) {
          await execute(
            'UPDATE labels SET admin_only=1, tenant_id=NULL, color=? WHERE label_key=? AND id!=?',
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
          // Un-mark admin_only globally, but scope color to same tenant
          await execute('UPDATE labels SET admin_only=0 WHERE label_key=? AND id!=?', [key, labelId])
          await execute('UPDATE labels SET color=? WHERE label_key=? AND tenant_id=? AND id!=?',
            [color ?? null, key, tenantIdForLabel, labelId])
        }
      } else {
        // Non-admin: still propagate color within same tenant scope
        await execute(
          'UPDATE labels SET color=? WHERE label_key=? AND tenant_id=? AND id!=?',
          [color ?? null, key, tenantIdForLabel, labelId]
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

  // GET /domains/:id/dns-check
  app.get<{ Params: { id: string } }>('/domains/:id/dns-check', { preHandler: requireAuth }, async (req, reply) => {
    const isNumeric = /^\d+$/.test(req.params.id)
    const whereCol = isNumeric ? 'd.id' : 'd.fqdn'
    const domain = await queryOne(
      `SELECT d.id, d.fqdn FROM domains d
       WHERE ${whereCol} = ? AND d.status != 'deleted'${ownerFilter(req)}`,
      [req.params.id]
    ) as any
    if (!domain) return reply.status(404).send({ code: 'NOT_FOUND' })

    const records = await query(
      `SELECT DISTINCT name, type FROM dns_records WHERE domain_id = ? AND is_deleted = 0
       UNION
       SELECT DISTINCT r.name, r.type FROM dns_template_records r
       JOIN domain_templates dt ON dt.template_id = r.template_id
       WHERE dt.domain_id = ?`,
      [domain.id, domain.id]
    ) as { name: string; type: string }[]

    const results = await Promise.all(
      records.map(async ({ name, type }) => {
        const fqdn = buildQueryFqdn(name, domain.fqdn)
        const answers: Record<string, any> = {}
        await Promise.all(DNS_RESOLVERS.map(async ({ name: rName, ip }) => {
          if (UNSUPPORTED_TYPES.has(type)) {
            answers[rName] = { values: [], unsupported: true }
            return
          }
          answers[rName] = await queryResolver(ip, fqdn, type)
        }))
        return { name, type, answers }
      })
    )

    return {
      fqdn: domain.fqdn,
      resolvers: DNS_RESOLVERS.map(r => r.name),
      results,
    }
  })
}
