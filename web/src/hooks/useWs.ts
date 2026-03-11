import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

type WsEvent =
  | { type: 'domain_status'; domainId: number; fqdn: string; zone_status: string; last_serial?: number; last_rendered_at?: string | null; zone_error?: string | null }
  | { type: 'bulk_job_progress'; jobId: number; status: string; processed_domains: number; affected_domains: number }
  | { type: 'record_changed'; domainId: number }

const WS_BASE = (() => {
  const api = (import.meta.env.VITE_API_URL ?? '')
  if (api.startsWith('https://')) return api.replace('https://', 'wss://')
  if (api.startsWith('http://'))  return api.replace('http://', 'ws://')
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host
})()

export function useWs(token: string | null) {
  const qc = useQueryClient()
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!token) return  // not logged in; do nothing

    let destroyed = false

    function connect() {
      if (destroyed) return
      const url = `${WS_BASE}/api/v1/ws?token=${encodeURIComponent(token!)}`
      const ws = new WebSocket(url)
      wsRef.current = ws

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
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        if (!destroyed) {
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
}
