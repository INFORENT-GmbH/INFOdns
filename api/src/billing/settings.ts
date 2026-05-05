import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, execute } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'
import { writeAuditLog } from '../audit/middleware.js'

// ── Validators ───────────────────────────────────────────────

// Format-Constraints sind hier absichtlich weich (max-Limits, kein min) damit
// Admins partielle Daten speichern und schrittweise vervollständigen können.
// Strikte Pflichtangaben werden erst beim Invoice-Issuing geprüft, nicht beim
// Settings-Save.
const SettingsBody = z.object({
  company_name:                z.string().max(255),
  address_line1:               z.string().max(255),
  address_line2:               z.string().max(255).nullable().optional(),
  zip:                         z.string().max(20),
  city:                        z.string().max(100),
  country:                     z.string().max(2),
  phone:                       z.string().max(50).nullable().optional(),
  email:                       z.string().max(255),                       // email() validation würde leere Strings ablehnen
  website:                     z.string().max(255).nullable().optional(),

  tax_id:                      z.string().max(50).nullable().optional(),
  vat_id:                      z.string().max(50).nullable().optional(),
  commercial_register:         z.string().max(100).nullable().optional(),
  managing_director:           z.string().max(255).nullable().optional(),
  managing_director_ids:       z.array(z.number().int().positive()).nullable().optional(),

  bank_name:                   z.string().max(100),
  iban:                        z.string().max(34),
  bic:                         z.string().max(11),
  account_holder:              z.string().max(255),

  default_currency:            z.string().max(3),
  default_payment_terms_days:  z.number().int().min(0).max(365),
  default_tax_rate_percent:    z.number().min(0).max(100),
  postal_fee_cents:            z.number().int().min(0),
  invoice_number_format:       z.string().max(50),
  invoice_footer_text:         z.string().nullable().optional(),
  logo_path:                   z.string().max(255).nullable().optional(),

  auto_issue_drafts:           z.boolean(),
  auto_issue_threshold_cents:  z.number().int().min(0).nullable().optional(),
}).partial()

const DunningLevelBody = z.object({
  label:           z.string().min(1).max(50),
  days_after_due:  z.number().int().min(0).max(365),
  fee_cents:       z.number().int().min(0),
  template_key:    z.string().min(1).max(100),
}).partial()

// ── Helpers ──────────────────────────────────────────────────

function toBoolInt(v: unknown): number | null {
  if (v == null) return null
  return v ? 1 : 0
}

// Normalize the row for the API: map TINYINT(1) → boolean, JSON column → array.
// managing_director_ids ist optional (Migration 033) — wenn die Spalte fehlt
// oder leer ist, geben wir [] zurück damit das Frontend immer ein Array hat.
function normalizeSettings(row: any): any {
  if (!row) return row
  let ids: number[] = []
  const raw = row.managing_director_ids
  if (raw != null && raw !== '') {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (Array.isArray(parsed)) ids = parsed
    } catch { /* invalid JSON → leeres Array */ }
  }
  return {
    ...row,
    auto_issue_drafts: !!row.auto_issue_drafts,
    default_tax_rate_percent: Number(row.default_tax_rate_percent),
    managing_director_ids: ids,
  }
}

// ── Routes ───────────────────────────────────────────────────

async function hasManagingDirectorIds(): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT 1 AS yes FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_settings'
       AND COLUMN_NAME = 'managing_director_ids'`
  )
  return !!row
}

export async function billingSettingsRoutes(app: FastifyInstance) {
  // GET /billing/settings — admin only
  app.get('/billing/settings', { preHandler: requireAdmin }, async () => {
    const row = await queryOne('SELECT * FROM company_settings WHERE id = 1')
    return normalizeSettings(row)
  })

  // PATCH /billing/settings
  app.patch('/billing/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const body = SettingsBody.safeParse(req.body)
    if (!body.success) {
      // Detaillierte Fehler pro Feld zurückgeben — sonst sieht der User nur
      // "Invalid input" und weiß nicht welches Feld kaputt ist.
      const issues = body.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: issues.join('; '),
      })
    }
    const old = await queryOne('SELECT * FROM company_settings WHERE id = 1')
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    const fields = body.data
    // Build dynamic SET — COALESCE keeps unspecified fields untouched.
    // managing_director_ids ist optional (Migration 033) — wird nur gesetzt
    // falls die Spalte existiert.
    const hasMd = await hasManagingDirectorIds()
    const mdSet  = hasMd ? `managing_director_ids = COALESCE(?, managing_director_ids),` : ''
    const mdParam = hasMd
      ? [fields.managing_director_ids != null ? JSON.stringify(fields.managing_director_ids) : null]
      : []

    await execute(
      `UPDATE company_settings SET
        company_name = COALESCE(?, company_name),
        address_line1 = COALESCE(?, address_line1),
        address_line2 = COALESCE(?, address_line2),
        zip = COALESCE(?, zip),
        city = COALESCE(?, city),
        country = COALESCE(?, country),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        website = COALESCE(?, website),
        tax_id = COALESCE(?, tax_id),
        vat_id = COALESCE(?, vat_id),
        commercial_register = COALESCE(?, commercial_register),
        managing_director = COALESCE(?, managing_director),
        ${mdSet}
        bank_name = COALESCE(?, bank_name),
        iban = COALESCE(?, iban),
        bic = COALESCE(?, bic),
        account_holder = COALESCE(?, account_holder),
        default_currency = COALESCE(?, default_currency),
        default_payment_terms_days = COALESCE(?, default_payment_terms_days),
        default_tax_rate_percent = COALESCE(?, default_tax_rate_percent),
        postal_fee_cents = COALESCE(?, postal_fee_cents),
        invoice_number_format = COALESCE(?, invoice_number_format),
        invoice_footer_text = COALESCE(?, invoice_footer_text),
        logo_path = COALESCE(?, logo_path),
        auto_issue_drafts = COALESCE(?, auto_issue_drafts),
        auto_issue_threshold_cents = COALESCE(?, auto_issue_threshold_cents)
       WHERE id = 1`,
      [
        fields.company_name ?? null, fields.address_line1 ?? null, fields.address_line2 ?? null,
        fields.zip ?? null, fields.city ?? null, fields.country ?? null,
        fields.phone ?? null, fields.email ?? null, fields.website ?? null,
        fields.tax_id ?? null, fields.vat_id ?? null,
        fields.commercial_register ?? null, fields.managing_director ?? null,
        ...mdParam,
        fields.bank_name ?? null, fields.iban ?? null, fields.bic ?? null, fields.account_holder ?? null,
        fields.default_currency ?? null, fields.default_payment_terms_days ?? null,
        fields.default_tax_rate_percent ?? null, fields.postal_fee_cents ?? null,
        fields.invoice_number_format ?? null, fields.invoice_footer_text ?? null, fields.logo_path ?? null,
        toBoolInt(fields.auto_issue_drafts), fields.auto_issue_threshold_cents ?? null,
      ]
    )
    const updated = await queryOne('SELECT * FROM company_settings WHERE id = 1')
    await writeAuditLog({ req, entityType: 'company_settings', entityId: 1, action: 'update', oldValue: old, newValue: updated })
    return normalizeSettings(updated)
  })

  // GET /billing/dunning-levels
  app.get('/billing/dunning-levels', { preHandler: requireAdmin }, async () => {
    return query('SELECT level, label, days_after_due, fee_cents, template_key FROM dunning_levels ORDER BY level')
  })

  // PATCH /billing/dunning-levels/:level
  app.patch<{ Params: { level: string } }>('/billing/dunning-levels/:level',
    { preHandler: requireAdmin }, async (req, reply) => {
    const level = Number(req.params.level)
    if (!Number.isInteger(level) || level < 0 || level > 9) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'invalid level' })
    }
    const body = DunningLevelBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: body.error.message })
    }
    const old = await queryOne('SELECT * FROM dunning_levels WHERE level = ?', [level])
    if (!old) return reply.status(404).send({ code: 'NOT_FOUND' })

    await execute(
      `UPDATE dunning_levels SET
        label = COALESCE(?, label),
        days_after_due = COALESCE(?, days_after_due),
        fee_cents = COALESCE(?, fee_cents),
        template_key = COALESCE(?, template_key)
       WHERE level = ?`,
      [body.data.label ?? null, body.data.days_after_due ?? null,
       body.data.fee_cents ?? null, body.data.template_key ?? null, level]
    )
    const updated = await queryOne('SELECT * FROM dunning_levels WHERE level = ?', [level])
    await writeAuditLog({ req, entityType: 'dunning_level', entityId: level, action: 'update', oldValue: old, newValue: updated })
    return updated
  })
}
