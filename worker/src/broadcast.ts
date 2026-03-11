/**
 * Send a WebSocket event to all connected clients via the API's internal broadcast endpoint.
 * Fire-and-forget: failures are logged but never thrown.
 */

const API_URL        = process.env.API_INTERNAL_URL ?? 'http://api:3000'
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? ''

export type WsEvent =
  | { type: 'domain_status'; domainId: number; fqdn: string; zone_status: string; last_serial?: number; last_rendered_at?: string | null; zone_error?: string | null }
  | { type: 'bulk_job_progress'; jobId: number; status: string; processed_domains: number; affected_domains: number }

export function broadcastEvent(event: WsEvent): void {
  if (!INTERNAL_SECRET) return
  fetch(`${API_URL}/internal/broadcast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify(event),
  }).catch(err => console.warn('[worker] broadcast failed:', err.message))
}
