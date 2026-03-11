import type { FastifyInstance } from 'fastify'
import { addClient } from './hub.js'

export async function wsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    // Authenticate: expect ?token=<accessToken> query param
    // (Browsers cannot set Authorization headers on WebSocket upgrade requests)
    const token = (req.query as Record<string, string>).token
    if (!token) {
      socket.close(4001, 'Unauthorized')
      return
    }

    try {
      app.jwt.verify(token)
    } catch {
      socket.close(4001, 'Unauthorized')
      return
    }

    addClient(socket)

    // Send a ping every 30s to keep the connection alive through proxies
    const ping = setInterval(() => {
      if (socket.readyState === 1) socket.ping()
    }, 30_000)

    socket.on('close', () => clearInterval(ping))
  })
}
