import { FastifyInstance } from 'fastify'
import { execute, queryOne } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

// VIES REST-Endpoint (offiziell, von der EU-Kommission betrieben).
// Doku: https://ec.europa.eu/taxation_customs/vies/#/technical-information
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number'

interface ViesResponse {
  isValid: boolean
  requestDate: string
  userError?: string
  name?: string
  address?: string
  // Es gibt mehr Felder, aber wir brauchen nur die.
}

/** Splittet "DE123456789" in Country-Code und Number. Akzeptiert Leerzeichen. */
function parseVatId(raw: string): { country: string; number: string } | null {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase()
  const m = cleaned.match(/^([A-Z]{2})([A-Z0-9]+)$/)
  if (!m) return null
  return { country: m[1], number: m[2] }
}

async function checkVies(country: string, number: string): Promise<ViesResponse> {
  const resp = await fetch(VIES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ countryCode: country, vatNumber: number }),
  })
  if (!resp.ok) {
    throw new Error(`VIES HTTP ${resp.status}`)
  }
  return resp.json() as Promise<ViesResponse>
}

export async function billingViesRoutes(app: FastifyInstance) {
  // POST /billing/validate-vat-id/:tenantId
  app.post<{ Params: { tenantId: string } }>(
    '/billing/validate-vat-id/:tenantId',
    { preHandler: requireAdmin }, async (req: any, reply) => {
    const t = await queryOne<any>('SELECT id, vat_id FROM tenants WHERE id = ?', [req.params.tenantId])
    if (!t) return reply.status(404).send({ code: 'NOT_FOUND' })
    if (!t.vat_id) {
      return reply.status(400).send({ code: 'NO_VAT_ID', message: 'Tenant hat keine USt-IdNr. hinterlegt.' })
    }

    const parsed = parseVatId(t.vat_id)
    if (!parsed) {
      return reply.status(400).send({
        code: 'BAD_FORMAT',
        message: 'USt-IdNr. nicht parsebar — erwartet Format wie "DE123456789".',
      })
    }

    let result: ViesResponse
    try {
      result = await checkVies(parsed.country, parsed.number)
    } catch (err: any) {
      return reply.status(503).send({
        code: 'VIES_UNREACHABLE',
        message: `VIES nicht erreichbar: ${err.message}. Status nicht aktualisiert.`,
      })
    }

    await execute(
      `UPDATE tenants SET
         vat_id_valid         = ?,
         vat_id_validated_at  = NOW(),
         vat_id_check_name    = ?,
         vat_id_check_address = ?
       WHERE id = ?`,
      [
        result.isValid ? 1 : 0,
        result.name ?? null,
        result.address ?? null,
        req.params.tenantId,
      ]
    )
    await writeAuditLog({
      req, entityType: 'tenant', entityId: Number(req.params.tenantId),
      action: 'vat_id_check',
      newValue: { valid: result.isValid, name: result.name, address: result.address },
    })

    return {
      tenant_id: Number(req.params.tenantId),
      vat_id: t.vat_id,
      valid: result.isValid,
      name: result.name ?? null,
      address: result.address ?? null,
      checked_at: new Date().toISOString(),
    }
  })
}
