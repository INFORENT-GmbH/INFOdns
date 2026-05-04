import { FastifyInstance } from 'fastify'
import { query, queryOne } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

export async function auditRoutes(app: FastifyInstance) {
  // GET /audit-logs
  app.get('/audit-logs', { preHandler: requireAuth }, async (req: any, reply) => {
    const { domain_id, user_id, tenant_id, entity_type, from, to, action, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum  = Math.max(1, Number(page))
    const limitNum = Math.min(200, Math.max(1, Number(limit)))
    const offset   = (pageNum - 1) * limitNum
    const params: unknown[] = []
    const clauses: string[] = []

    if (req.user.role === 'tenant') {
      clauses.push('tenant_id IN (SELECT tenant_id FROM user_tenants WHERE user_id = ?)')
      params.push(req.user.sub)
    }

    if (domain_id)   { clauses.push('domain_id = ?');   params.push(Number(domain_id)) }
    if (user_id)     { clauses.push('user_id = ?');     params.push(Number(user_id)) }
    if (tenant_id)   { clauses.push('tenant_id = ?');   params.push(Number(tenant_id)) }
    if (entity_type) { clauses.push('entity_type = ?'); params.push(entity_type) }
    if (action)      { clauses.push('action = ?');      params.push(action) }
    if (from)        { clauses.push('created_at >= ?'); params.push(from) }
    if (to)          { clauses.push('created_at <= ?'); params.push(to + ' 23:59:59') }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [rows, countRow, entityRows] = await Promise.all([
      query(
        `SELECT id, user_id, tenant_id, domain_id, entity_type, entity_id, action,
                old_value, new_value, ip_address, created_at
         FROM audit_logs ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
        params
      ),
      query<{ entity_type: string }>(
        `SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type`
      ),
    ])

    return {
      data: rows,
      total: countRow?.total ?? 0,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil((countRow?.total ?? 0) / limitNum),
      entityTypes: (entityRows as any[]).map(r => r.entity_type).filter((t): t is string => !!t),
    }
  })
}
