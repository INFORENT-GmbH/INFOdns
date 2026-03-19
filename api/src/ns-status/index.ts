import net from 'net'
import { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import { broadcast } from '../ws/hub.js'
import { execute } from '../db.js'

interface NsEntry { ok: boolean; latencyMs: number | null; checkedAt: string }

const NS1_LOCAL = process.env.BIND_PRIMARY_HOST ?? ''

const remoteHosts: [string, string][] = ([
  ['ns2', process.env.NS2_IP ?? ''],
  ['ns3', process.env.NS3_IP ?? ''],
] as [string, string][]).filter(([, ip]) => ip !== '')

const cache: Record<string, NsEntry> = {}
const prevOk: Record<string, boolean> = {}

function checkTcp(host: string, timeoutMs = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const socket = net.createConnection({ host, port: 53 })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => { socket.destroy(); resolve(Date.now() - start) })
    socket.once('timeout', () => { socket.destroy(); reject(new Error('timeout')) })
    socket.once('error', reject)
  })
}

async function refreshAll() {
  let changed = false

  // ns1: check locally via Docker network (bind-primary)
  if (NS1_LOCAL) {
    const checkedAt = new Date().toISOString()
    let ok: boolean
    let latencyMs: number | null
    try {
      latencyMs = await checkTcp(NS1_LOCAL)
      ok = true
    } catch {
      latencyMs = null
      ok = false
    }
    cache['ns1'] = { ok, latencyMs, checkedAt }
    if (prevOk['ns1'] !== ok) {
      changed = true
      prevOk['ns1'] = ok
    }
    execute(
      'INSERT INTO ns_checks (ns_name, ok, latency_ms) VALUES (?, ?, ?)',
      ['ns1', ok ? 1 : 0, latencyMs]
    ).catch(() => {})
  }

  // ns2, ns3: check via external IPs
  await Promise.all(remoteHosts.map(async ([name, ip]) => {
    const checkedAt = new Date().toISOString()
    let ok: boolean
    let latencyMs: number | null

    try {
      latencyMs = await checkTcp(ip)
      ok = true
    } catch {
      latencyMs = null
      ok = false
    }

    cache[name] = { ok, latencyMs, checkedAt }

    if (prevOk[name] !== ok) {
      changed = true
      prevOk[name] = ok
    }

    execute(
      'INSERT INTO ns_checks (ns_name, ok, latency_ms) VALUES (?, ?, ?)',
      [name, ok ? 1 : 0, latencyMs]
    ).catch(() => {/* swallow — don't crash the poller on a DB hiccup */})
  }))

  if (changed) {
    broadcast({ type: 'ns_status', status: { ...cache } })
  }
}

export function startNsStatusPoller() {
  void refreshAll()
  setInterval(() => void refreshAll(), 2_000)
}

export async function nsStatusRoutes(app: FastifyInstance) {
  app.get('/ns-status', { preHandler: [requireAuth] }, async () => cache)
}
