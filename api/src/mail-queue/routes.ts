import { FastifyInstance } from 'fastify'
import { query, queryOne, execute } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'

export async function mailQueueRoutes(app: FastifyInstance) {
  // GET /mail-queue  (admin only)
  app.get('/mail-queue', { preHandler: requireAdmin }, async (req: any) => {
    const { status, page = '1', limit = '50' } = req.query as Record<string, string>
    const pageNum  = Math.max(1, Number(page))
    const limitNum = Math.min(200, Math.max(1, Number(limit)))
    const offset   = (pageNum - 1) * limitNum
    const params: unknown[] = []
    const clauses: string[] = []

    if (status) { clauses.push('status = ?'); params.push(status) }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const [rows, countRow] = await Promise.all([
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
    ])

    return {
      data: rows,
      total: countRow?.total ?? 0,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil((countRow?.total ?? 0) / limitNum),
    }
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
