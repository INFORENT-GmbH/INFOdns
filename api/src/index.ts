import Fastify from 'fastify'
import fjwt from '@fastify/jwt'
import fcookie from '@fastify/cookie'
import fhelmet from '@fastify/helmet'
import frateLimit from '@fastify/rate-limit'
import fws from '@fastify/websocket'

import { authRoutes } from './auth/routes.js'
import { customerRoutes } from './customers/routes.js'
import { userRoutes } from './users/routes.js'
import { domainRoutes } from './domains/routes.js'
import { recordRoutes } from './records/routes.js'
import { auditRoutes } from './audit/routes.js'
import { bulkRoutes } from './bulk/routes.js'
import { wsRoutes } from './ws/routes.js'
import { internalRoutes } from './ws/internal.js'
import { nsStatusRoutes, startNsStatusPoller } from './ns-status/index.js'

const app = Fastify({ logger: true, trustProxy: true })

// ── Plugins ──────────────────────────────────────────────────
await app.register(fhelmet, { global: true })
await app.register(fcookie)
await app.register(fjwt, { secret: process.env.JWT_SECRET! })
await app.register(fws)
await app.register(frateLimit, {
  global: false,
  max: 10,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
})

// ── Health ───────────────────────────────────────────────────
app.get('/health', async () => ({ ok: true }))
app.get('/ready', async (_req, reply) => {
  try {
    const { pool } = await import('./db.js')
    await pool.query('SELECT 1')
    return { ok: true }
  } catch {
    return reply.status(503).send({ ok: false })
  }
})

// ── NS status poller ─────────────────────────────────────────
startNsStatusPoller()

// ── Internal broadcast endpoint (worker → hub) ────────────────
await app.register(internalRoutes)

// ── Routes (all under /api/v1) ────────────────────────────────
await app.register(async (v1) => {
  await v1.register(authRoutes)
  await v1.register(customerRoutes)
  await v1.register(userRoutes)
  await v1.register(domainRoutes)
  await v1.register(recordRoutes)
  await v1.register(auditRoutes)
  await v1.register(bulkRoutes)
  await v1.register(wsRoutes)
  await v1.register(nsStatusRoutes)
}, { prefix: '/api/v1' })

// ── Start ────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
