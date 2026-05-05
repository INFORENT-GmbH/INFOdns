import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getBillingSettings, updateBillingSettings,
  getDunningLevels, updateDunningLevel,
  getUsers,
  type CompanySettings, type DunningLevel,
} from '../../api/client'
import EuroInput from '../../components/EuroInput'
import PhoneInput from '../../components/PhoneInput'
import MultiSelect from '../../components/MultiSelect'
import { formatApiError } from '../../lib/formError'
import * as s from '../../styles/shell'

type Form = Partial<CompanySettings>

export default function BillingSettingsPage() {
  usePageTitle('Billing Settings')
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['billing', 'settings'],
    queryFn: () => getBillingSettings().then(r => r.data),
  })
  const { data: levels = [] } = useQuery({
    queryKey: ['billing', 'dunning-levels'],
    queryFn: () => getDunningLevels().then(r => r.data),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
  })
  const userOptions = useMemo(
    () => users
      .filter(u => u.is_active && !u.deleted_at)
      .map(u => ({ value: String(u.id), label: `${u.full_name} (${u.email})` })),
    [users]
  )

  const [form, setForm] = useState<Form>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  function set<K extends keyof CompanySettings>(k: K, v: CompanySettings[K] | string) {
    setForm(prev => ({ ...prev, [k]: v as any }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSaving(true)
    try {
      await updateBillingSettings(form)
      qc.invalidateQueries({ queryKey: ['billing', 'settings'] })
      setSavedAt(Date.now())
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading || !settings) {
    return <div style={{ padding: '2rem', color: '#9ca3af' }}>Loading…</div>
  }

  return (
    <div style={localStyles.page}>
      <h2 style={localStyles.h2}>Abrechnungs-Einstellungen</h2>

      {error && <div style={localStyles.error}>{error}</div>}
      {savedAt && !error && <div style={localStyles.success}>Gespeichert.</div>}

      <form onSubmit={handleSave} style={localStyles.form}>

        <section style={localStyles.section}>
          <h3 style={localStyles.h3}>Firma &amp; Anschrift</h3>
          <div style={localStyles.grid}>
            <Field label="Firmenname *">
              <input style={localStyles.input} value={form.company_name ?? ''}
                onChange={e => set('company_name', e.target.value)} required />
            </Field>
            <Field label="E-Mail (Versand) *">
              <input style={localStyles.input} type="email" value={form.email ?? ''}
                onChange={e => set('email', e.target.value)} required />
            </Field>
            <Field label="Adresse Zeile 1 *">
              <input style={localStyles.input} value={form.address_line1 ?? ''}
                onChange={e => set('address_line1', e.target.value)} required />
            </Field>
            <Field label="Adresse Zeile 2">
              <input style={localStyles.input} value={form.address_line2 ?? ''}
                onChange={e => set('address_line2', e.target.value || null as any)} />
            </Field>
            <Field label="PLZ *">
              <input style={localStyles.input} value={form.zip ?? ''}
                onChange={e => set('zip', e.target.value)} required />
            </Field>
            <Field label="Ort *">
              <input style={localStyles.input} value={form.city ?? ''}
                onChange={e => set('city', e.target.value)} required />
            </Field>
            <Field label="Land (ISO 2)">
              <input style={localStyles.input} maxLength={2} value={form.country ?? 'DE'}
                onChange={e => set('country', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Telefon">
              <PhoneInput value={form.phone ?? ''}
                onChange={v => set('phone', v || null as any)}
                style={{ width: '100%' }} />
            </Field>
            <Field label="Webseite">
              <input style={localStyles.input} value={form.website ?? ''}
                onChange={e => set('website', e.target.value || null as any)} />
            </Field>
            <Field label="Geschäftsführer">
              <MultiSelect
                values={(form.managing_director_ids ?? []).map(String)}
                onChange={vs => set('managing_director_ids', vs.map(Number) as any)}
                options={userOptions}
                placeholder="Geschäftsführer wählen…"
                style={{ minWidth: '100%' }}
              />
            </Field>
            <Field label="Handelsregister">
              <input style={localStyles.input} value={form.commercial_register ?? ''}
                onChange={e => set('commercial_register', e.target.value || null as any)} />
            </Field>
          </div>
        </section>

        <section style={localStyles.section}>
          <h3 style={localStyles.h3}>Steuer-Identifikation</h3>
          <p style={localStyles.hint}>Mindestens eines von beiden ist nach §14 UStG Pflicht auf jeder Rechnung.</p>
          <div style={localStyles.grid}>
            <Field label="Steuernummer">
              <input style={localStyles.input} value={form.tax_id ?? ''}
                onChange={e => set('tax_id', e.target.value || null as any)} />
            </Field>
            <Field label="USt-IdNr.">
              <input style={localStyles.input} value={form.vat_id ?? ''}
                onChange={e => set('vat_id', e.target.value || null as any)} />
            </Field>
          </div>
        </section>

        <section style={localStyles.section}>
          <h3 style={localStyles.h3}>Bankverbindung</h3>
          <p style={localStyles.hint}>Wird auf jeder Rechnung als Empfängerkonto gedruckt.</p>
          <div style={localStyles.grid}>
            <Field label="Bank *">
              <input style={localStyles.input} value={form.bank_name ?? ''}
                onChange={e => set('bank_name', e.target.value)} required />
            </Field>
            <Field label="Kontoinhaber *">
              <input style={localStyles.input} value={form.account_holder ?? ''}
                onChange={e => set('account_holder', e.target.value)} required />
            </Field>
            <Field label="IBAN *">
              <input style={localStyles.input} value={form.iban ?? ''}
                onChange={e => set('iban', e.target.value.replace(/\s/g, '').toUpperCase())}
                required />
            </Field>
            <Field label="BIC *">
              <input style={localStyles.input} value={form.bic ?? ''}
                onChange={e => set('bic', e.target.value.toUpperCase())} required />
            </Field>
          </div>
        </section>

        <section style={localStyles.section}>
          <h3 style={localStyles.h3}>Rechnungs-Defaults</h3>
          <div style={localStyles.grid}>
            <Field label="Standard-Steuersatz (%)">
              <input style={localStyles.input} type="number" step="0.01"
                value={form.default_tax_rate_percent ?? 19}
                onChange={e => set('default_tax_rate_percent', Number(e.target.value))} />
            </Field>
            <Field label="Zahlungsziel (Tage)">
              <input style={localStyles.input} type="number"
                value={form.default_payment_terms_days ?? 14}
                onChange={e => set('default_payment_terms_days', Number(e.target.value))} />
            </Field>
            <Field label="Postversand-Aufpreis">
              <EuroInput cents={form.postal_fee_cents ?? 180}
                onChange={c => set('postal_fee_cents', c)}
                style={{ width: '100%' }} />
            </Field>
            <Field label="Währung">
              <input style={localStyles.input} maxLength={3}
                value={form.default_currency ?? 'EUR'}
                onChange={e => set('default_currency', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Rechnungsnummer-Format">
              <input style={localStyles.input} value={form.invoice_number_format ?? ''}
                onChange={e => set('invoice_number_format', e.target.value)} />
              <span style={localStyles.hint}>{'Tokens: {year}, {seq}, {seq:05d}'}</span>
            </Field>
            <Field label="Drafts automatisch versenden">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8125rem', color: '#1e293b' }}>
                <input type="checkbox" checked={form.auto_issue_drafts ?? false}
                  onChange={e => set('auto_issue_drafts', e.target.checked as any)} />
                Aktiv
              </label>
            </Field>
          </div>
          <Field label="Fußtext auf Rechnung">
            <textarea style={{ ...localStyles.input, minHeight: 60 }}
              value={form.invoice_footer_text ?? ''}
              onChange={e => set('invoice_footer_text', e.target.value || null as any)} />
          </Field>
        </section>

        <div style={localStyles.formFooter}>
          <button type="submit" disabled={saving} style={s.actionBtn}>
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </form>

      <DunningSection levels={levels} />
    </div>
  )
}

// ── Dunning-Levels-Sub-Section ───────────────────────────────

function DunningSection({ levels }: { levels: DunningLevel[] }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState<Partial<DunningLevel>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit(l: DunningLevel) {
    setEditing(l.level); setForm(l); setError(null)
  }

  async function save() {
    if (editing == null) return
    setSaving(true); setError(null)
    try {
      const { level, ...rest } = form
      void level
      await updateDunningLevel(editing, rest)
      qc.invalidateQueries({ queryKey: ['billing', 'dunning-levels'] })
      setEditing(null)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={{ ...localStyles.section, marginTop: 32 }}>
      <h3 style={localStyles.h3}>Mahnstufen</h3>
      <p style={localStyles.hint}>Reihenfolge der automatischen Mahnungen ab Fälligkeit. Stufe 0 = Erinnerung (gebührenfrei).</p>
      {error && <div style={localStyles.error}>{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
        <thead>
          <tr>
            <th style={s.th}>Stufe</th>
            <th style={s.th}>Bezeichnung</th>
            <th style={s.th}>Tage nach Fälligkeit</th>
            <th style={s.th}>Gebühr</th>
            <th style={s.th}>Template-Schlüssel</th>
            <th style={s.th}></th>
          </tr>
        </thead>
        <tbody>
          {levels.map(l => editing === l.level ? (
            <tr key={l.level} style={{ background: '#fffbeb' }}>
              <td style={s.td}><strong>{l.level}</strong></td>
              <td style={s.td}>
                <input style={localStyles.cellInput} value={form.label ?? ''}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
              </td>
              <td style={s.td}>
                <input style={localStyles.cellInput} type="number" value={form.days_after_due ?? 0}
                  onChange={e => setForm(f => ({ ...f, days_after_due: Number(e.target.value) }))} />
              </td>
              <td style={s.td}>
                <EuroInput cents={form.fee_cents ?? 0}
                  onChange={c => setForm(f => ({ ...f, fee_cents: c }))}
                  allowNegative={false} style={{ width: 100 }} />
              </td>
              <td style={s.td}>
                <input style={localStyles.cellInput} value={form.template_key ?? ''}
                  onChange={e => setForm(f => ({ ...f, template_key: e.target.value }))} />
              </td>
              <td style={s.td}>
                <button type="button" onClick={save} disabled={saving} style={s.actionBtn}>
                  {saving ? '…' : 'OK'}
                </button>
                <button type="button" onClick={() => setEditing(null)} style={{ ...s.secondaryBtn, marginLeft: 4 }}>
                  Abbr.
                </button>
              </td>
            </tr>
          ) : (
            <tr key={l.level}>
              <td style={s.td}><strong>{l.level}</strong></td>
              <td style={s.td}>{l.label}</td>
              <td style={s.td}>{l.days_after_due}</td>
              <td style={s.td}>{(l.fee_cents / 100).toFixed(2)} €</td>
              <td style={s.td}><code>{l.template_key}</code></td>
              <td style={s.td}>
                <button type="button" onClick={() => startEdit(l)} style={s.secondaryBtn}>Bearbeiten</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ── Field ────────────────────────────────────────────────────

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <label style={localStyles.label}>
      <span style={localStyles.labelText}>{label}</span>
      {children}
    </label>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:        { padding: '1.5rem 2rem', maxWidth: 980 },
  h2:          { margin: '0 0 1.25rem', fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  h3:          { margin: '0 0 .5rem', fontSize: '.9375rem', fontWeight: 600, color: '#334155' },
  hint:        { margin: '0 0 .75rem', fontSize: '.75rem', color: '#94a3b8' },
  form:        { display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  section:     { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.25rem' },
  grid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.75rem 1rem' },
  label:       { display: 'flex', flexDirection: 'column', gap: 4 },
  labelText:   { fontSize: '.75rem', fontWeight: 600, color: '#475569' },
  input:       { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },
  cellInput:   { padding: '.25rem .5rem', border: '1px solid #cbd5e1', borderRadius: 3, fontSize: '.8125rem', width: '100%', boxSizing: 'border-box' as const },
  formFooter:  { display: 'flex', justifyContent: 'flex-end' },
  error:       { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem', marginBottom: '.75rem' },
  success:     { background: '#dcfce7', color: '#15803d', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem', marginBottom: '.75rem' },
  muted:       { color: '#94a3b8', fontSize: '.75rem' },
}
