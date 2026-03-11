import type { FastifyInstance } from 'fastify'
import { broadcast, type WsEvent } from './hub.js'

/**
 * Internal-only route for the Worker to push events into the WebSocket hub.
 * Protected by a shared secret (INTERNAL_SECRET env var).
 * Only reachable within the Docker internal network.
 */
export async function internalRoutes(app: FastifyInstance) {
  app.post('/internal/broadcast', async (req, reply) => {
    const secret = process.env.INTERNAL_SECRET
    if (!secret || req.headers['x-internal-secret'] !== secret) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    broadcast(req.body as WsEvent)
    return { ok: true }
  })
}
