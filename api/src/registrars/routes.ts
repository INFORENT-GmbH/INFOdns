import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'

const RegistrarBody = z.object({
  code:  z.string().min(1).max(10).regex(/^[A-Z0-9_]+$/, 'Code must be uppercase letters/digits/underscore'),
  name:  z.string().min(1).max(100),
  url:   z.string().max(255).nullable().optional(),
  notes: z.string().nullable().optional(),
})

const RegistrarUpdateBody = RegistrarBody.omit({ code: true }).partial()

export async function registrarRoutes(app: FastifyInstance) {

  // GET /registrars  (any authenticated user — needed for dropdowns)
  app.get('/registrars', { preHandler: requireAuth }, async () => {
    return query('SELECT code, name, url, notes, created_at, updated_at FROM registrars ORDER BY code')
  })

  // POST /registrars
  app.post('/registrars', { preHandler: requireAdmin }, async (req, reply) => {
    const body = RegistrarBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const d = body.data
    const existing = await queryOne('SELECT code FROM registrars WHERE code = ?', [d.code])
    if (existing) return reply.status(409).send({ code: 'CONFLICT', message: `Registrar '${d.code}' already exists` })

    await execute(
      'INSERT INTO registrars (code, name, url, notes) VALUES (?, ?, ?, ?)',
      [d.code, d.name, d.url ?? null, d.notes ?? null]
    )
    return reply.status(201).send(await queryOne('SELECT * FROM registrars WHERE code = ?', [d.code]))
  })

  // PUT /registrars/:code
  app.put<{ Params: { code: string } }>('/registrars/:code', { preHandler: requireAdmin }, async (req, reply) => {
    const { code } = req.params
    const existing = await queryOne('SELECT code FROM registrars WHERE code = ?', [code])
    if (!existing) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = RegistrarUpdateBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const d = body.data
    const cols = ['name', 'url', 'notes'] as const
    const sets: string[] = []
    const vals: unknown[] = []
    for (const col of cols) {
      if (col in d) { sets.push(`${col} = ?`); vals.push((d as any)[col] ?? null) }
    }
    if (sets.length === 0) return queryOne('SELECT * FROM registrars WHERE code = ?', [code])
    vals.push(code)
    await execute(`UPDATE registrars SET ${sets.join(', ')} WHERE code = ?`, vals)
    return queryOne('SELECT * FROM registrars WHERE code = ?', [code])
  })

  // DELETE /registrars/:code
  app.delete<{ Params: { code: string } }>('/registrars/:code', { preHandler: requireAdmin }, async (req, reply) => {
    const { code } = req.params
    const existing = await queryOne('SELECT code FROM registrars WHERE code = ?', [code])
    if (!existing) return reply.status(404).send({ code: 'NOT_FOUND' })
    await execute('DELETE FROM registrars WHERE code = ?', [code])
    return { ok: true }
  })
}
