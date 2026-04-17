import { query, execute } from '../db.js'

/** Enqueue a zone render job for a domain (upsert — one pending job per domain) */
export async function enqueueRender(domainId: number): Promise<void> {
  await execute(
    `INSERT INTO zone_render_queue (domain_id, status) VALUES (?, 'pending')
     ON DUPLICATE KEY UPDATE status = IF(status = 'processing', status, 'pending'), updated_at = NOW()`,
    [domainId]
  )
  await execute("UPDATE domains SET zone_status = 'dirty' WHERE id = ?", [domainId])
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
