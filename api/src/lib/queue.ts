import { query, queryOne, execute } from '../db.js'
import { broadcast } from '../ws/hub.js'

/** Enqueue a zone render job for a domain (upsert — one pending job per domain) */
export async function enqueueRender(domainId: number): Promise<void> {
  await execute(
    `INSERT INTO zone_render_queue (domain_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'processing', status, 'pending'), updated_at = NOW()`,
    [domainId]
  )
  await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [domainId])

  // Broadcast so connected UIs see the dirty transition immediately, not only
  // after the worker finishes rendering.
  const row = await queryOne<{ fqdn: string; tenant_id: number }>(
    'SELECT fqdn, tenant_id FROM domains WHERE id = ?',
    [domainId]
  )
  if (row) {
    broadcast({
      type: 'domain_status',
      domainId,
      fqdn: row.fqdn,
      zone_status: 'dirty',
      tenantId: row.tenant_id,
    })
  }
}

/** Enqueue zone renders for every domain that uses a given template */
export async function enqueueRendersByTemplate(templateId: number): Promise<void> {
  const rows = await query<{ domain_id: number }>(
    'SELECT domain_id FROM domain_templates WHERE template_id = ?',
    [templateId]
  )
  for (const { domain_id } of rows) {
    await enqueueRender(domain_id)
  }
}
