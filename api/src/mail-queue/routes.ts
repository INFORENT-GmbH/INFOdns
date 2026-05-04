import { FastifyInstance } from 'fastify'
import { query, queryOne, execute } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { renderTemplate, type Locale } from '../lib/mailTemplates.js'

export async function mailQueueRoutes(app: FastifyInstance) {
  // GET /mail-queue  (admin only)
  app.get('/mail-queue', { preHandler: requireAdmin }, async (req: any) => {
    const { status, template, search, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum  = Math.max(1, Number(page))
    const limitNum = Math.min(200, Math.max(1, Number(limit)))
    const offset   = (pageNum - 1) * limitNum
    const params: unknown[] = []
    const clauses: string[] = []

    if (status)   { clauses.push('status = ?');   params.push(status) }
    if (template) { clauses.push('template = ?'); params.push(template) }
    if (search) {
      const escaped = search.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&')
      const pattern = `%${escaped}%`
      clauses.push('to_email LIKE ?')
      params.push(pattern)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [rows, countRow, templateRows] = await Promise.all([
      query(
        `SELECT id, to_email, template, status, retries, max_retries, error, created_at, updated_at
         FROM mail_queue ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, offset]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*) AS total FROM mail_queue ${where}`,
        params
      ),
      query<{ template: string | null }>(
        `SELECT DISTINCT template FROM mail_queue WHERE template IS NOT NULL ORDER BY template`
      ),
    ])

    return {
      data: rows,
      total: countRow?.total ?? 0,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil((countRow?.total ?? 0) / limitNum),
      templates: (templateRows as any[]).map(r => r.template).filter((t): t is string => !!t),
    }
  })

  // GET /mail-queue/:id  (admin only — full row + rendered preview)
  app.get<{ Params: { id: string } }>('/mail-queue/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id)
    const mail = await queryOne<any>(
      `SELECT id, to_email, template, payload, subject, body_html, body_text,
              status, retries, max_retries, error, created_at, updated_at
         FROM mail_queue WHERE id = ?`,
      [id]
    )
    if (!mail) return reply.status(404).send({ code: 'NOT_FOUND' })

    if (typeof mail.payload === 'string') {
      try { mail.payload = JSON.parse(mail.payload) } catch { /* leave as string */ }
    }

    // For template-based mails, the worker renders at send time. Render the same
    // templates here so the UI can preview pending mails.
    let renderError: string | null = null
    if (mail.template && mail.payload && typeof mail.payload === 'object') {
      try {
        const locale: Locale = (mail.payload as any)._locale === 'en' ? 'en' : 'de'
        const rendered = renderTemplate(mail.template, locale, mail.payload)
        if (!mail.subject)   mail.subject   = rendered.subject
        if (!mail.body_html) mail.body_html = rendered.html
        if (!mail.body_text) mail.body_text = rendered.text
      } catch (err: any) {
        renderError = err?.message ?? String(err)
      }
    }

    return { ...mail, render_error: renderError }
  })

  // POST /mail-queue/:id/retry  (admin only — reset a failed mail to pending)
  app.post<{ Params: { id: string } }>('/mail-queue/:id/retry', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number(req.params.id)
    const mail = await queryOne<{ status: string }>('SELECT status FROM mail_queue WHERE id = ?', [id])
    if (!mail) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (mail.status !== 'failed') return reply.status(400).send({ code: 'NOT_FAILED' })

    await execute(
      `UPDATE mail_queue SET status = 'pending', retries = 0, error = NULL, updated_at = NOW() WHERE id = ?`,
      [id]
    )
    return { ok: true }
  })
}
