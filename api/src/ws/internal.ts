import type { FastifyInstance } from 'fastify'
import { createHash, timingSafeEqual } from 'crypto'
import { broadcast, type WsEvent } from './hub.js'

/**
 * Internal-only route for the Worker to push events into the WebSocket hub.
 * Protected by a shared secret (INTERNAL_SECRET env var).
 * Only reachable within the Docker internal network.
 */
export async function internalRoutes(app: FastifyInstance) {
  app.post('/internal/broadcast', async (req, reply) => {
    const secret = process.env.INTERNAL_SECRET
    const provided = req.headers['x-internal-secret']
    if (!secret || typeof provided !== 'string') {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    // Compare SHA-256 digests so timingSafeEqual gets equal-length buffers
    // (it throws on length mismatch) and the comparison cost doesn't leak
    // the secret length.
    const a = createHash('sha256').update(secret).digest()
    const b = createHash('sha256').update(provided).digest()
    if (!timingSafeEqual(a, b)) {
      return reply.status(403).send({ code: 'FORBIDDEN' })
    }
    broadcast(req.body as WsEvent)
    return { ok: true }
  })
}
