import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import mysql from 'mysql2/promise.js'
import { requireAdmin } from '../middleware/auth.js'

// Root pool — needed to query isp.* cross-database and write to infodns.*
const rootPool = mysql.createPool({
  host:     process.env.DB_HOST     ?? 'db',
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     'root',
  password: process.env.DB_ROOT_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'infodns',
  waitForConnections: true,
  connectionLimit: 3,
  timezone: '+00:00',
})

async function rootQuery<T = any>(sql: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await rootPool.execute<mysql.RowDataPacket[]>(sql, params as any[])
  return rows as T[]
}

async function rootTransaction<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await rootPool.getConnection()
  await conn.beginTransaction()
  try {
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
import {
  importTenants,
  importTldPricing,
  importDomains,
  importRecords,
  type IspCompany,
  type IspDomain,
  type IspTldPricing,
  type IspNsRecord,
} from './executor.js'

// ── Preview response types ────────────────────────────────────

type ImportStatus = 'insert' | 'update' | 'skip' | 'overwrite'

interface TenantPreviewRow extends IspCompany {
  status: ImportStatus
}

interface TldPricingPreviewRow extends IspTldPricing {
  status: ImportStatus
}

interface DomainPreviewRow extends IspDomain {
  status: ImportStatus
}

interface RecordPreviewRow {
  domain_fqdn: string
  name: string
  type: string
  priority: number | null
  value: string
  ttl: number | null
  status: 'overwrite'
}

interface ImportPreviewResult {
  tenants: TenantPreviewRow[]
  tld_pricing: TldPricingPreviewRow[]
  domains: DomainPreviewRow[]
  records: RecordPreviewRow[]
}

// ── Run request schema ────────────────────────────────────────

const RunBody = z.object({
  tenant_ids:   z.array(z.number().int()).optional(),
  tld_zones:    z.array(z.string()).optional(),
  domain_fqdns: z.array(z.string()).optional(),
  record_fqdns: z.array(z.string()).optional(),
})

// ── Routes ────────────────────────────────────────────────────

export async function importRoutes(app: FastifyInstance) {

  // GET /import/preview
  // Reads isp.* and annotates each row with its import status.
  app.get('/import/preview', { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      // ── Tenants ──────────────────────────────────────────
      const tenants = await rootQuery<TenantPreviewRow>(`
        SELECT
          c.company_id AS id,
          c.keyword    AS name,
          IF(t.id IS NOT NULL, 'update', 'insert') AS status
        FROM isp.companies c
        LEFT JOIN tenants t ON t.id = c.company_id
        ORDER BY c.company_id
      `)

      // ── TLD Pricing ───────────────────────────────────────
      const tld_pricing = await rootQuery<TldPricingPreviewRow>(`
        SELECT
          f.ZONE      AS zone,
          f.TLD       AS tld,
          f.DESCRIPTION AS description,
          f.EK        AS cost,
          f.FEE       AS fee,
          f.REGISTRAR AS default_registrar,
          f.NOTE      AS note,
          f.UDR       AS price_udr,
          f.CN        AS price_cn,
          f.MARCARIA  AS price_marcaria,
          f.UD        AS price_ud,
          IF(tp.zone IS NOT NULL, 'update', 'insert') AS status
        FROM isp.domain_fees f
        LEFT JOIN tld_pricing tp ON tp.zone COLLATE utf8mb4_general_ci = f.ZONE COLLATE utf8mb4_general_ci
        ORDER BY f.ZONE
      `)

      // ── Domains ───────────────────────────────────────────
      const domains = await rootQuery<DomainPreviewRow>(`
        SELECT
          d.DOMAIN        AS fqdn,
          d.COMPANY_ID    AS tenant_id,
          d.PUBLISH       AS publish,
          d.NOTE          AS notes,
          d.NOTE_INTERNAL AS notes_internal,
          d.COST_CENTER   AS cost_center,
          d.BRAND         AS brand,
          d.NS_REFERENCE  AS ns_reference,
          d.SMTP_TO       AS smtp_to,
          d.SPAM_TO       AS spam_to,
          d.ADD_FEE       AS add_fee,
          d.REGISTRAR     AS we_registered,
          d.FLAG          AS flag,
          IF(existing.id IS NOT NULL, 'skip', 'insert') AS status
        FROM isp.domains d
        LEFT JOIN domains existing ON existing.fqdn COLLATE utf8mb4_general_ci = d.DOMAIN COLLATE utf8mb4_general_ci
        ORDER BY d.DOMAIN
      `)

      // ── Records (individual rows) ─────────────────────────
      const records = await rootQuery<RecordPreviewRow>(`
        SELECT
          n.DOMAIN              AS domain_fqdn,
          COALESCE(n.HOST, '@') AS name,
          n.TYPE                AS type,
          n.PRIORITY            AS priority,
          n.ENTRY               AS value,
          n.TTL                 AS ttl,
          'overwrite'           AS status
        FROM isp.ns n
        ORDER BY n.DOMAIN, n.TYPE, COALESCE(n.HOST, '@')
      `)

      const result: ImportPreviewResult = { tenants, tld_pricing, domains, records }
      return result
    } catch (err: any) {
      // Surface isp DB connectivity issues as a clear error
      if (err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_DB_ERROR') {
        return reply.status(503).send({ code: 'ISP_DB_UNAVAILABLE', message: 'Cannot read isp database: ' + err.message })
      }
      throw err
    }
  })

  // POST /import/run
  app.post('/import/run', { preHandler: requireAdmin }, async (req, reply) => {
    const body = RunBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })
    }

    const { tenant_ids, tld_zones, domain_fqdns, record_fqdns } = body.data

    const result = await rootTransaction(async (conn) => {
      let tenants   = { inserted: 0, updated: 0 }
      let tldPricing = { inserted: 0, updated: 0 }
      let domains   = { inserted: 0, skipped: 0 }
      let records   = { deleted: 0, inserted: 0 }

      // ── Tenants ──────────────────────────────────────────
      if (tenant_ids && tenant_ids.length > 0) {
        const placeholders = tenant_ids.map(() => '?').join(',')
        const [rows] = await conn.execute<any[]>(
          `SELECT company_id AS id, keyword AS name FROM isp.companies WHERE company_id IN (${placeholders})`,
          tenant_ids
        )
        tenants = await importTenants(rows as IspCompany[], conn)
      }

      // ── TLD Pricing ───────────────────────────────────────
      if (tld_zones && tld_zones.length > 0) {
        const placeholders = tld_zones.map(() => '?').join(',')
        const [rows] = await conn.execute<any[]>(
          `SELECT
             ZONE AS zone, TLD AS tld, DESCRIPTION AS description,
             EK AS cost, FEE AS fee, REGISTRAR AS default_registrar,
             NOTE AS note, UDR AS price_udr, CN AS price_cn,
             MARCARIA AS price_marcaria, UD AS price_ud
           FROM isp.domain_fees WHERE ZONE IN (${placeholders})`,
          tld_zones
        )
        tldPricing = await importTldPricing(rows as IspTldPricing[], conn)
      }

      // ── Domains ───────────────────────────────────────────
      let fqdnToId = new Map<string, number>()
      if (domain_fqdns && domain_fqdns.length > 0) {
        const placeholders = domain_fqdns.map(() => '?').join(',')
        const [rows] = await conn.execute<any[]>(
          `SELECT
             DOMAIN AS fqdn, COMPANY_ID AS tenant_id, PUBLISH AS publish,
             NOTE AS notes, NOTE_INTERNAL AS notes_internal,
             COST_CENTER AS cost_center, BRAND AS brand,
             NS_REFERENCE AS ns_reference, SMTP_TO AS smtp_to,
             SPAM_TO AS spam_to, ADD_FEE AS add_fee,
             REGISTRAR AS we_registered, FLAG AS flag
           FROM isp.domains WHERE DOMAIN IN (${placeholders})`,
          domain_fqdns
        )
        const res = await importDomains(rows as IspDomain[], conn)
        domains.inserted = res.inserted
        domains.skipped  = res.skipped
        fqdnToId = res.fqdnToId
      } else if (record_fqdns && record_fqdns.length > 0) {
        // Records selected but no domain import — still need the fqdnToId map
        const [rows] = await conn.execute<any[]>('SELECT id, fqdn FROM domains')
        for (const r of rows as any[]) fqdnToId.set(r.fqdn, r.id)
      }

      // ── DNS Records ───────────────────────────────────────
      if (record_fqdns && record_fqdns.length > 0) {
        const placeholders = record_fqdns.map(() => '?').join(',')
        const [rows] = await conn.execute<any[]>(
          `SELECT
             DOMAIN AS domain_fqdn,
             COALESCE(HOST, '@') AS name,
             TYPE AS type,
             PRIORITY AS priority,
             ENTRY AS value,
             TTL AS ttl
           FROM isp.ns WHERE DOMAIN IN (${placeholders})`,
          record_fqdns
        )
        records = await importRecords(rows as IspNsRecord[], fqdnToId, conn)
      }

      return { tenants, tld_pricing: tldPricing, domains, records }
    })

    return result
  })
}
