import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'

const REGISTRARS = ['CN', 'MARCARIA', 'UD', 'UDR'] as const

const TldPricingBody = z.object({
  zone:              z.string().min(1).max(20),
  tld:               z.string().min(1).max(10),
  description:       z.string().max(30).nullable().optional(),
  cost:              z.number().nullable().optional(),
  fee:               z.number().int().nullable().optional(),
  default_registrar: z.enum(REGISTRARS).nullable().optional(),
  note:              z.string().max(30).nullable().optional(),
  price_udr:         z.number().nullable().optional(),
  price_cn:          z.number().nullable().optional(),
  price_marcaria:    z.number().nullable().optional(),
  price_ud:          z.number().nullable().optional(),
})

const TldPricingUpdateBody = TldPricingBody.omit({ zone: true }).partial()

export async function tldPricingRoutes(app: FastifyInstance) {

  // GET /tld-pricing
  app.get('/tld-pricing', { preHandler: requireAdmin }, async () => {
    return query(`
      SELECT zone, tld, description, cost, fee, default_registrar, note,
             price_udr, price_cn, price_marcaria, price_ud,
             created_at, updated_at
      FROM tld_pricing
      ORDER BY zone
    `)
  })

  // POST /tld-pricing
  app.post('/tld-pricing', { preHandler: requireAdmin }, async (req, reply) => {
    const body = TldPricingBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const d = body.data
    const existing = await queryOne('SELECT zone FROM tld_pricing WHERE zone = ?', [d.zone])
    if (existing) return reply.status(409).send({ code: 'CONFLICT', message: `Zone '${d.zone}' already exists` })

    await execute(
      `INSERT INTO tld_pricing
         (zone, tld, description, cost, fee, default_registrar, note,
          price_udr, price_cn, price_marcaria, price_ud)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.zone, d.tld, d.description ?? null, d.cost ?? null, d.fee ?? null,
       d.default_registrar ?? null, d.note ?? null, d.price_udr ?? null,
       d.price_cn ?? null, d.price_marcaria ?? null, d.price_ud ?? null]
    )
    return reply.status(201).send(await queryOne('SELECT * FROM tld_pricing WHERE zone = ?', [d.zone]))
  })

  // PUT /tld-pricing/:zone
  app.put<{ Params: { zone: string } }>('/tld-pricing/:zone', { preHandler: requireAdmin }, async (req, reply) => {
    const { zone } = req.params
    const existing = await queryOne('SELECT zone FROM tld_pricing WHERE zone = ?', [zone])
    if (!existing) return reply.status(404).send({ code: 'NOT_FOUND' })

    const body = TldPricingUpdateBody.safeParse(req.body)
    if (!body.success) return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })

    const d = body.data
    const cols = ['tld', 'description', 'cost', 'fee', 'default_registrar', 'note',
                  'price_udr', 'price_cn', 'price_marcaria', 'price_ud'] as const
    const sets: string[] = []
    const vals: unknown[] = []
    for (const col of cols) {
      if (col in d) { sets.push(`${col} = ?`); vals.push((d as any)[col] ?? null) }
    }
    if (sets.length === 0) return queryOne('SELECT * FROM tld_pricing WHERE zone = ?', [zone])
    vals.push(zone)
    await execute(`UPDATE tld_pricing SET ${sets.join(', ')} WHERE zone = ?`, vals)
    return queryOne('SELECT * FROM tld_pricing WHERE zone = ?', [zone])
  })

  // DELETE /tld-pricing/:zone
  app.delete<{ Params: { zone: string } }>('/tld-pricing/:zone', { preHandler: requireAdmin }, async (req, reply) => {
    const { zone } = req.params
    const existing = await queryOne('SELECT zone FROM tld_pricing WHERE zone = ?', [zone])
    if (!existing) return reply.status(404).send({ code: 'NOT_FOUND' })
    await execute('DELETE FROM tld_pricing WHERE zone = ?', [zone])
    return { ok: true }
  })
}
