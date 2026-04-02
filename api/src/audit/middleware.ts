import { FastifyRequest } from 'fastify'
import { execute } from '../db.js'

interface AuditParams {
  req: FastifyRequest
  entityType: string
  entityId?: number
  domainId?: number
  action: string
  oldValue?: unknown
  newValue?: unknown
}

export async function writeAuditLog({
  req,
  entityType,
  entityId,
  domainId,
  action,
  oldValue,
  newValue,
}: AuditParams): Promise<void> {
  const user = (req as any).user
  await execute(
    `INSERT INTO audit_logs
       (user_id, tenant_id, domain_id, entity_type, entity_id, action, old_value, new_value, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user?.sub ?? null,
      user?.tenantId ?? null,
      domainId ?? null,
      entityType,
      entityId ?? null,
      action,
      oldValue != null ? JSON.stringify(oldValue) : null,
      newValue != null ? JSON.stringify(newValue) : null,
      req.ip,
      req.headers['user-agent'] ?? null,
    ]
  )
}
