import type { WebSocket } from '@fastify/websocket'

/**
 * In-process WebSocket broadcast hub.
 * Any server code can call broadcast() to push an event to all connected clients.
 */

const clients = new Set<WebSocket>()

export function addClient(ws: WebSocket): void {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
}

export function broadcast(event: WsEvent): void {
  if (clients.size === 0) return
  const msg = JSON.stringify(event)
  for (const ws of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(msg)
    }
  }
}

// ── Event types ───────────────────────────────────────────────

export type WsEvent =
  | { type: 'domain_status'; domainId: number; fqdn: string; zone_status: string; last_serial?: number; last_rendered_at?: string | null; zone_error?: string | null }
  | { type: 'bulk_job_progress'; jobId: number; status: string; processed_domains: number; affected_domains: number }
  | { type: 'record_changed'; domainId: number }
