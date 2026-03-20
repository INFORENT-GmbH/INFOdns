import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

type WsEvent =
  | { type: 'domain_status'; domainId: number; fqdn: string; zone_status: string; last_serial?: number; last_rendered_at?: string | null; zone_error?: string | null }
  | { type: 'bulk_job_progress'; jobId: number; status: string; processed_domains: number; affected_domains: number }
  | { type: 'record_changed'; domainId: number }
  | { type: 'ns_status'; status: Record<string, { ok: boolean; latencyMs: number | null; checkedAt: string }> }
  | { type: 'mail_queue_update'; mailId: number; status: string; retries?: number; error?: string | null }

export type WsStatus = 'connected' | 'disconnected' | 'reconnecting'

const WS_BASE = (() => {
  const api = (import.meta.env.VITE_API_URL ?? '')
  if (api.startsWith('https://')) return api.replace('https://', 'wss://')
  if (api.startsWith('http://'))  return api.replace('http://', 'ws://')
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
})()

export function useWs(token: string | null): WsStatus {
  const qc = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<WsStatus>('connected')
  // Track whether we've ever successfully connected so we know when a close is a *re*connect
  const everConnected = useRef(false)

  useEffect(() => {
    if (!token) return  // not logged in; do nothing

    let destroyed = false
    // Reset on token change so a new token (e.g. impersonation) doesn't
    // trigger the page-reload path meant for missed-event recovery.
    everConnected.current = false

    function connect() {
      if (destroyed) return
      const url = `${WS_BASE}/api/v1/ws?token=${encodeURIComponent(token!)}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (everConnected.current) {
          // Was disconnected — reload to sync any missed events
          window.location.reload()
        } else {
          everConnected.current = true
          setStatus('connected')
        }
      }

      ws.onmessage = (e) => {
        let event: WsEvent
        try { event = JSON.parse(e.data) } catch { return }

        switch (event.type) {
          case 'domain_status':
            qc.setQueryData(['domain', event.domainId], (old: any) => {
              if (!old) return old
              return {
                ...old,
                zone_status: event.zone_status,
                last_serial: event.last_serial ?? old.last_serial,
                last_rendered_at: event.last_rendered_at ?? old.last_rendered_at,
                zone_error: event.zone_error ?? null,
              }
            })
            qc.invalidateQueries({ queryKey: ['domains'] })
            break

          case 'record_changed':
            qc.invalidateQueries({ queryKey: ['records', event.domainId] })
            break

          case 'bulk_job_progress':
            qc.setQueryData(['bulk-job', event.jobId], (old: any) => {
              if (!old) return old
              return { ...old, status: event.status, processed_domains: event.processed_domains }
            })
            qc.invalidateQueries({ queryKey: ['bulk-jobs'] })
            break

          case 'ns_status':
            qc.setQueryData(['ns-status'], event.status)
            break

          case 'mail_queue_update':
            qc.invalidateQueries({ queryKey: ['mail-queue'] })
            break
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        if (!destroyed) {
          if (everConnected.current) setStatus('reconnecting')
          retryRef.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      destroyed = true
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [token, qc])

  return status
}
