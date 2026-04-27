import Fastify from 'fastify'
import fjwt from '@fastify/jwt'
import fcookie from '@fastify/cookie'
import fhelmet from '@fastify/helmet'
import frateLimit from '@fastify/rate-limit'
import fws from '@fastify/websocket'
import fmultipart from '@fastify/multipart'

import { authRoutes } from './auth/routes.js'
import { tenantRoutes } from './tenants/routes.js'
import { userRoutes } from './users/routes.js'
import { domainRoutes } from './domains/routes.js'
import { recordRoutes } from './records/routes.js'
import { auditRoutes } from './audit/routes.js'
import { bulkRoutes } from './bulk/routes.js'
import { wsRoutes } from './ws/routes.js'
import { internalRoutes } from './ws/internal.js'
import { nsStatusRoutes, startNsStatusPoller } from './ns-status/index.js'
import { mailQueueRoutes } from './mail-queue/routes.js'
import { ticketRoutes } from './tickets/routes.js'
import { importRoutes } from './import/routes.js'
import { tldPricingRoutes } from './tld-pricing/routes.js'
import { registrarRoutes } from './registrars/routes.js'
import { templateRoutes } from './templates/routes.js'

const app = Fastify({ logger: true, trustProxy: true })

// ── Plugins ──────────────────────────────────────────────────
await app.register(fhelmet, { global: true })
await app.register(fcookie)
await app.register(fjwt, { secret: process.env.JWT_SECRET! })
// handleProtocols echoes back one of the client's offered sub-protocols so the
// WS handshake succeeds. We carry the access token in Sec-WebSocket-Protocol
// (see api/src/ws/routes.ts) instead of a query string to keep tokens out of
// nginx access logs and Referer headers.
await app.register(fws, {
  options: {
    handleProtocols: (protocols: Set<string>) => {
      if (protocols.has('bearer')) return 'bearer'
      // Single-element fallback (the JWT itself). Echo it so the browser accepts.
      const first = protocols.values().next().value
      return first ?? false
    },
  },
})
await app.register(fmultipart, {
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
})
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

// ── Run pending DB migrations ────────────────────────────────
import { runMigrations } from './db.js'
await runMigrations()

// ── NS status poller ─────────────────────────────────────────
startNsStatusPoller()

// ── Internal broadcast endpoint (worker → hub) ────────────────
await app.register(internalRoutes)

// ── Routes (all under /api/v1) ────────────────────────────────
await app.register(async (v1) => {
  await v1.register(authRoutes)
  await v1.register(tenantRoutes)
  await v1.register(userRoutes)
  await v1.register(domainRoutes)
  await v1.register(recordRoutes)
  await v1.register(auditRoutes)
  await v1.register(bulkRoutes)
  await v1.register(wsRoutes)
  await v1.register(nsStatusRoutes)
  await v1.register(mailQueueRoutes)
  await v1.register(ticketRoutes)
  await v1.register(importRoutes)
  await v1.register(tldPricingRoutes)
  await v1.register(registrarRoutes)
  await v1.register(templateRoutes)
}, { prefix: '/api/v1' })

// ── Start ────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000)
await app.listen({ port, host: '0.0.0.0' })
