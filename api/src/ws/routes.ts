import type { FastifyInstance } from 'fastify'
import { addClient } from './hub.js'
import type { JwtPayload } from '../auth/jwt.js'

// Token is carried in the Sec-WebSocket-Protocol header (browsers can set this via
// `new WebSocket(url, protocols)`). We accept either:
//   - "bearer.<jwt>" (preferred — paired with a literal "bearer" sub-protocol)
//   - "<jwt>"        (single-element fallback)
// Falling back to ?token= query string is intentionally NOT supported anymore: it
// leaked tokens into nginx access logs, browser history, and Referer headers.
function extractToken(req: any): string | null {
  const raw = req.headers['sec-websocket-protocol']
  if (typeof raw !== 'string' || raw.length === 0) return null
  const protocols = raw.split(',').map(s => s.trim()).filter(Boolean)
  // Pattern: ["bearer", "<jwt>"]
  const bearerIdx = protocols.indexOf('bearer')
  if (bearerIdx !== -1 && protocols[bearerIdx + 1]) return protocols[bearerIdx + 1]
  // Single-element fallback
  if (protocols.length === 1) return protocols[0]
  return null
}

export async function wsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const token = extractToken(req)
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
