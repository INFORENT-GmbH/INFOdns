import type { WebSocket } from '@fastify/websocket'

/**
 * In-process WebSocket broadcast hub.
 * Any server code can call broadcast() to push an event to connected clients.
 * Tenant users only receive events for their own data.
 */

interface ClientInfo {
  role: string
  sub: number
  tenantId: number | null
}

const clients = new Map<WebSocket, ClientInfo>()

export function addClient(ws: WebSocket, info: ClientInfo): void {
  clients.set(ws, info)
  ws.on('close', () => clients.delete(ws))
}

function shouldReceive(event: WsEvent, info: ClientInfo): boolean {
  // Admins and operators receive all events
  if (info.role === 'admin' || info.role === 'operator') return true

  // Tenant-scoped filtering
  switch (event.type) {
    case 'domain_status':
    case 'record_changed':
      return event.tenantId != null && event.tenantId === info.tenantId
    case 'bulk_job_progress':
      return event.createdBy != null && event.createdBy === info.sub
    case 'mail_queue_update':
      return false  // tenants have no access to the mail queue
    default:
      return true   // ns_status, ticket_* go to all authenticated users
  }
}

export function broadcast(event: WsEvent): void {
  if (clients.size === 0) return
  const msg = JSON.stringify(event)
  for (const [ws, info] of clients) {
    if (ws.readyState !== 1 /* OPEN */) {
      // Socket already closed/closing — drop it so we don't keep retrying.
      clients.delete(ws)
      continue
    }
    if (!shouldReceive(event, info)) continue
    try {
      ws.send(msg)
    } catch (err: any) {
      console.warn(`[ws] broadcast send failed (sub=${info.sub}): ${err.message}`)
      clients.delete(ws)
      try { ws.terminate() } catch { /* ignore */ }
    }
  }
}

// ── Event types ───────────────────────────────────────────────

export type WsEvent =
  | { type: 'domain_status'; domainId: number; fqdn: string; zone_status: string; tenantId?: number | null; last_serial?: number; last_rendered_at?: string | null; zone_error?: string | null; ns_ok?: number | null; dnssec_ok?: number | null }
  | { type: 'bulk_job_progress'; jobId: number; status: string; processed_domains: number; affected_domains: number; createdBy?: number }
  | { type: 'record_changed'; domainId: number; tenantId?: number | null }
  | { type: 'ns_status'; status: Record<string, { ok: boolean; latencyMs: number | null; checkedAt: string }> }
  | { type: 'mail_queue_update'; mailId: number; status: string; retries?: number; error?: string | null }
  | { type: 'ticket_created'; ticketId: number }
  | { type: 'ticket_updated'; ticketId: number }
  | { type: 'ticket_message_added'; ticketId: number }
