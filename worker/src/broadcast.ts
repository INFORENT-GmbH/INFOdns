/**
 * Send a WebSocket event to all connected clients via the API's internal broadcast endpoint.
 * Fire-and-forget: failures are logged but never thrown.
 */

const API_URL        = process.env.API_INTERNAL_URL ?? 'http://api:3000'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? ''

export type WsEvent =
  | { type: 'domain_status'; domainId: number; fqdn: string; zone_status: string; tenantId?: number | null; last_serial?: number; last_rendered_at?: string | null; zone_error?: string | null; ns_ok?: number | null; dnssec_ok?: number | null }
  | { type: 'bulk_job_progress'; jobId: number; status: string; processed_domains: number; affected_domains: number; createdBy?: number }
  | { type: 'record_changed'; domainId: number; tenantId?: number | null }
  | { type: 'mail_queue_update'; mailId: number; status: string; retries?: number; error?: string | null }
  | { type: 'ticket_created'; ticketId: number }
  | { type: 'ticket_updated'; ticketId: number }
  | { type: 'ticket_message_added'; ticketId: number }

export function broadcastEvent(event: WsEvent): void {
  if (!INTERNAL_SECRET) return
  // 5 s cap so a slow/hung API can't wedge the worker — fetch() has no
  // built-in timeout, so without AbortController these promises pile up.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  fetch(`${API_URL}/internal/broadcast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify(event),
    signal: ctrl.signal,
  })
    .catch(err => console.warn('[worker] broadcast failed:', err.message))
    .finally(() => clearTimeout(timer))
}
