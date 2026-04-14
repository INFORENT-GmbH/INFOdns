import type { FastifyInstance } from 'fastify'
import { addClient } from './hub.js'
import type { JwtPayload } from '../auth/jwt.js'

export async function wsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    // Authenticate: expect ?token=<accessToken> query param
    // (Browsers cannot set Authorization headers on WebSocket upgrade requests)
    const token = (req.query as Record<string, string>).token
    if (!token) {
      socket.close(4001, 'Unauthorized')
      return
    }

    let payload: JwtPayload
    try {
      payload = app.jwt.verify<JwtPayload>(token)
    } catch {
      socket.close(4001, 'Unauthorized')
      return
    }

    addClient(socket, { role: payload.role, sub: payload.sub, tenantId: payload.tenantId })

    // Send a ping every 30s to keep the connection alive through proxies
    const ping = setInterval(() => {
      if (socket.readyState === 1) socket.ping()
    }, 30_000)

    socket.on('close', () => clearInterval(ping))
  })
}
