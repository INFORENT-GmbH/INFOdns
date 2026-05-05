import { useEffect, useMemo, useState } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenants, createTenant, updateTenant, deleteTenant, validateVatId, type Tenant } from '../api/client'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import Select, { type SelectOption } from '../components/Select'
import PhoneInput from '../components/PhoneInput'
import ListTable from '../components/ListTable'
import MasterDetailLayout from '../components/MasterDetailLayout'
import { useI18n } from '../i18n/I18nContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

const TAX_MODE_OPTIONS: SelectOption[] = [
  { value: 'standard',       label: 'Standard (Inland, regulär besteuert)' },
  { value: 'reverse_charge', label: 'Reverse-Charge (EU-B2B, §13b UStG)' },
  { value: 'small_business', label: 'Kleinunternehmer (§19 UStG)' },
  { value: 'non_eu',         label: 'Drittland (nicht steuerbar)' },
]
const LOCALE_OPTIONS: SelectOption[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
]

const INLINE_STYLES = `
  .tenant-input:focus { border-color: #2563eb !important; outline: none; box-shadow: 0 0 0 2px #bfdbfe; }
`

const emptyForm = {
  name: '', company_name: '', first_name: '', last_name: '',
  street: '', zip: '', city: '', country: '',
  phone: '', fax: '', email: '', vat_id: '', notes: '',
  // Billing-Profil
  billing_email: '', tax_mode: 'standard' as 'standard' | 'reverse_charge' | 'small_business' | 'non_eu',
  tax_rate_percent_override: '', payment_terms_days_override: '',
  postal_delivery_default: false, invoice_locale: 'de' as 'de' | 'en',
  dunning_paused: false, billing_notes: '',
}

type SelectedId = number | 'new' | null
type StatusFilter = '' | 'active' | 'inactive'
const TENANT_FILTER_DEFAULTS = { search: '', status: '' as StatusFilter, country: '' }

export default function TenantsPage() {
  usePageTitle('Tenants')
  const { t } = useI18n()
  const qc = useQueryClient()

  const {
    filters, setFilter, persist, setPersist, clear: clearFilters, hasActive,
  } = usePersistedFilters('tenants', TENANT_FILTER_DEFAULTS)
  const { search, status, country } = filters

  const [selectedId, setSelectedId] = useState<SelectedId>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })

  const filteredTenants = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tenants.filter(c => {
      if (q && !(
        c.name.toLowerCase().includes(q) ||
        (c.company_name ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q)
      )) return false
      if (status === 'active' && !c.is_active) return false
      if (status === 'inactive' && c.is_active) return false
      if (country && (c.country ?? '').toUpperCase() !== country.toUpperCase()) return false
      return true
    })
  }, [tenants, search, status, country])

  const countryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of tenants) {
      if (c.country) set.add(c.country.toUpperCase())
    }
    return Array.from(set).sort()
  }, [tenants])

  const editTarget: Tenant | null = useMemo(
    () => typeof selectedId === 'number' ? tenants.find(c => c.id === selectedId) ?? null : null,
    [tenants, selectedId]
  )

  // Sync form whenever the selection changes.
  useEffect(() => {
    setError(null)
    if (selectedId === 'new') {
      setForm(emptyForm)
    } else if (editTarget) {
      setForm({
        name: editTarget.name,
        company_name: editTarget.company_name ?? '',
        first_name: editTarget.first_name ?? '',
        last_name: editTarget.last_name ?? '',
        street: editTarget.street ?? '',
        zip: editTarget.zip ?? '',
        city: editTarget.city ?? '',
        country: editTarget.country ?? '',
        phone: editTarget.phone ?? '',
        fax: editTarget.fax ?? '',
        email: editTarget.email ?? '',
        vat_id: editTarget.vat_id ?? '',
        notes: editTarget.notes ?? '',
        billing_email: editTarget.billing_email ?? '',
        tax_mode: editTarget.tax_mode ?? 'standard',
        tax_rate_percent_override: editTarget.tax_rate_percent_override != null ? String(editTarget.tax_rate_percent_override) : '',
        payment_terms_days_override: editTarget.payment_terms_days_override != null ? String(editTarget.payment_terms_days_override) : '',
        postal_delivery_default: !!editTarget.postal_delivery_default,
        invoice_locale: editTarget.invoice_locale ?? 'de',
        dunning_paused: !!editTarget.dunning_paused,
        billing_notes: editTarget.billing_notes ?? '',
      })
    }
  }, [selectedId, editTarget])

  function set(field: keyof typeof emptyForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  function setRaw<K extends keyof typeof emptyForm>(field: K, value: typeof emptyForm[K]) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleValidateVatId() {
    if (!editTarget) return
    setSaving(true); setError(null)
    try {
      const r = await validateVatId(editTarget.id)
      qc.invalidateQueries({ queryKey: ['tenants'] })
      alert(r.data.valid
        ? `USt-IdNr. gültig.\nName: ${r.data.name ?? '—'}\nAdresse: ${r.data.address ?? '—'}`
        : `USt-IdNr. NICHT gültig laut VIES.`)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally { setSaving(false) }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    const payload: any = { name: form.name }
    const numericFields = new Set(['tax_rate_percent_override', 'payment_terms_days_override'])
    const booleanFields = new Set(['postal_delivery_default', 'dunning_paused'])
    for (const [k, v] of Object.entries(form)) {
      if (k === 'name') continue
      if (numericFields.has(k)) {
        payload[k] = v === '' || v == null ? null : Number(v)
      } else if (booleanFields.has(k)) {
        payload[k] = !!v
      } else {
        payload[k] = v === '' ? null : v
      }
    }
    try {
      if (editTarget) {
        await updateTenant(editTarget.id, payload)
      } else {
        await createTenant(payload)
      }
      qc.invalidateQueries({ queryKey: ['tenants'] })
      setSelectedId(null)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: Tenant) {
    if (!confirm(t('tenants_deleteConfirm', c.name))) return
    await deleteTenant(c.id)
    qc.invalidateQueries({ queryKey: ['tenants'] })
    if (selectedId === c.id) setSelectedId(null)
  }

  // ── Dashboard view ──────────────────────────────────────────────
  const dashboard = (
    <>
      <style>{INLINE_STYLES}</style>

      <FilterBar>
        <span style={localStyles.countPill}>
          {hasActive
            ? t('tenants_filteredCount', filteredTenants.length, tenants.length)
            : `${tenants.length} ${t('tenants_title').toLowerCase()}`}
        </span>
      </FilterBar>

      <FilterBar>
        <SearchInput
          value={search}
          onChange={v => setFilter('search', v)}
          placeholder={t('tenants_searchPlaceholder')}
          width={280}
        />

        <Dropdown
          label={
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: status ? '#111827' : '#9ca3af' }}>
              {status === 'active' ? t('users_active') : status === 'inactive' ? 'Inactive' : t('domains_allStatuses')}
            </span>
          }
          active={!!status}
          onClear={() => setFilter('status', '' as StatusFilter)}
          width={140}
        >
          {close => (
            <>
              <DropdownItem onSelect={() => { setFilter('status', '' as StatusFilter); close() }}>
                <span style={{ color: '#6b7280' }}>{t('domains_allStatuses')}</span>
              </DropdownItem>
              <DropdownItem onSelect={() => { setFilter('status', 'active' as StatusFilter); close() }}>
                {t('users_active')}
              </DropdownItem>
              <DropdownItem onSelect={() => { setFilter('status', 'inactive' as StatusFilter); close() }}>
                Inactive
              </DropdownItem>
            </>
          )}
        </Dropdown>

        {countryOptions.length > 0 && (
          <Dropdown
            label={
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: country ? '#111827' : '#9ca3af' }}>
                {country || t('tenants_country')}
              </span>
            }
            active={!!country}
            onClear={() => setFilter('country', '')}
            width={120}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setFilter('country', ''); close() }}>
                  <span style={{ color: '#6b7280' }}>{t('tenants_country')}</span>
                </DropdownItem>
                {countryOptions.map(c => (
                  <DropdownItem key={c} onSelect={() => { setFilter('country', c); close() }}>
                    {c}
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>
        )}

        <FilterPersistControls
          persist={persist}
          setPersist={setPersist}
          onClear={clearFilters}
          hasActive={hasActive}
          style={{ marginLeft: 'auto' }}
        />

        <button onClick={() => setSelectedId('new')} style={s.actionBtn}>{t('tenants_add')}</button>
      </FilterBar>

      <ListTable>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th}>{t('name')}</th>
                <th style={s.th}>{t('tenants_companyName')}</th>
                <th style={s.th}>{t('tenants_email')}</th>
                <th style={s.th}>{t('tenants_phone')}</th>
                <th style={s.th}>{t('active')}</th>
                <th style={s.th}>{t('created')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.map((c: Tenant) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{ cursor: 'pointer', background: selectedId === c.id ? '#eff6ff' : undefined }}
                  onMouseOver={e => { if (selectedId !== c.id) e.currentTarget.style.background = '#f1f5f9' }}
                  onMouseOut={e => { if (selectedId !== c.id) e.currentTarget.style.background = '' }}
                >
                  <td style={s.td}>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{c.name}</span>
                  </td>
                  <td style={{ ...s.td, color: '#64748b' }}>{c.company_name ?? ''}</td>
                  <td style={{ ...s.td, color: '#64748b' }}>{c.email ?? ''}</td>
                  <td style={{ ...s.td, color: '#64748b' }}>{c.phone ?? ''}</td>
                  <td style={s.td}>
                    {c.is_active
                      ? <span style={localStyles.badgeActive}>Active</span>
                      : <span style={localStyles.badgeInactive}>Inactive</span>}
                  </td>
                  <td style={{ ...s.td, color: '#64748b' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {filteredTenants.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '.8125rem' }}>{t('tenants_none')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </ListTable>
    </>
  )

  // ── Sidebar view (compact list when detail is open) ─────────────
  const sidebar = (
    <>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={v => setFilter('search', v)}
          placeholder={t('tenants_searchPlaceholder')}
          width="100%"
        />
      </FilterBar>
      <FilterBar>
        <button onClick={() => setSelectedId('new')} style={{ ...s.actionBtn, width: '100%' }}>{t('tenants_add')}</button>
      </FilterBar>
      <ListTable>
        {filteredTenants.map((c: Tenant) => {
          const isSel = selectedId === c.id
          return (
            <div
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                padding: '.5rem .75rem',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                background: isSel ? '#eff6ff' : 'transparent',
              }}
            >
              <div style={{ fontSize: '.8125rem', fontWeight: isSel ? 600 : 500, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.name}
              </div>
              <div style={{ fontSize: '.7rem', color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.company_name || c.email || '—'}
              </div>
            </div>
          )
        })}
        {filteredTenants.length === 0 && (
          <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '.8125rem' }}>{t('tenants_none')}</div>
        )}
      </ListTable>
    </>
  )

  // ── Detail pane ─────────────────────────────────────────────────
  const detailPane = (
    <div style={localStyles.detailPane}>
      <style>{INLINE_STYLES}</style>
      <div style={localStyles.detailHeader}>
        <button onClick={() => setSelectedId(null)} style={localStyles.backBtn}>← {t('cancel')}</button>
        <h3 style={localStyles.detailTitle}>
          {selectedId === 'new' ? t('tenants_newTitle') : (editTarget?.name ?? '')}
        </h3>
        {editTarget && (
          <button onClick={() => handleDelete(editTarget)} style={localStyles.btnDanger}>{t('delete')}</button>
        )}
      </div>

      <form onSubmit={handleSubmit} style={localStyles.formBody}>
        {error && <div style={localStyles.error}>{error}</div>}

        <div style={localStyles.grid}>
          <label style={localStyles.label}>
            {t('name')}
            <input className="tenant-input" value={form.name} onChange={set('name')} required style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_companyName')}
            <input className="tenant-input" value={form.company_name} onChange={set('company_name')} style={localStyles.input} />
          </label>
        </div>

        <div style={localStyles.sectionDivider}>
          <span style={localStyles.sectionLabel}>{t('tenants_contactSection')}</span>
        </div>
        <div style={localStyles.grid}>
          <label style={localStyles.label}>
            {t('tenants_firstName')}
            <input className="tenant-input" value={form.first_name} onChange={set('first_name')} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_lastName')}
            <input className="tenant-input" value={form.last_name} onChange={set('last_name')} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_email')}
            <input className="tenant-input" type="email" value={form.email} onChange={set('email')} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_phone')}
            <PhoneInput value={form.phone} onChange={v => setRaw('phone', v)} style={{ width: '100%' }} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_fax')}
            <PhoneInput value={form.fax} onChange={v => setRaw('fax', v)} style={{ width: '100%' }} />
          </label>
        </div>

        <div style={localStyles.sectionDivider}>
          <span style={localStyles.sectionLabel}>{t('tenants_addressSection')}</span>
        </div>
        <div style={localStyles.grid}>
          <label style={{ ...localStyles.label, gridColumn: '1 / -1' }}>
            {t('tenants_street')}
            <input className="tenant-input" value={form.street} onChange={set('street')} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_zip')}
            <input className="tenant-input" value={form.zip} onChange={set('zip')} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_city')}
            <input className="tenant-input" value={form.city} onChange={set('city')} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            {t('tenants_country')}
            <input className="tenant-input" value={form.country} onChange={set('country')} maxLength={2} style={localStyles.input} placeholder="DE" />
          </label>
        </div>

        <div style={localStyles.sectionDivider}>
          <span style={localStyles.sectionLabel}>{t('tenants_billingSection')}</span>
        </div>
        <label style={localStyles.label}>
          {t('tenants_vatId')}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input className="tenant-input" value={form.vat_id} onChange={set('vat_id')}
              style={{ ...localStyles.input, flex: 1 }} />
            {editTarget && form.vat_id && (
              <button type="button" style={s.secondaryBtn} onClick={handleValidateVatId} disabled={saving}>
                VIES prüfen
              </button>
            )}
          </div>
          {editTarget?.vat_id_validated_at && (
            <div style={{ fontSize: '.75rem', marginTop: 4,
                           color: editTarget.vat_id_valid ? '#15803d' : '#b91c1c' }}>
              {editTarget.vat_id_valid
                ? `✓ Gültig (geprüft ${editTarget.vat_id_validated_at.slice(0,10)})${editTarget.vat_id_check_name ? ' — ' + editTarget.vat_id_check_name : ''}`
                : `✗ Nicht gültig (geprüft ${editTarget.vat_id_validated_at.slice(0,10)})`}
            </div>
          )}
        </label>
        <label style={localStyles.label}>
          Rechnungs-E-Mail (überschreibt Kontakt-E-Mail für Rechnungen)
          <input className="tenant-input" type="email" value={form.billing_email} onChange={set('billing_email')} style={localStyles.input} />
        </label>
        <label style={localStyles.label}>
          Steuermodus
          <Select
            value={form.tax_mode}
            onChange={v => setRaw('tax_mode', v as typeof form.tax_mode)}
            options={TAX_MODE_OPTIONS}
            style={{ minWidth: '100%' }}
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <label style={localStyles.label}>
            Steuersatz-Override (%)
            <input className="tenant-input" type="number" step="0.01"
              value={form.tax_rate_percent_override} onChange={set('tax_rate_percent_override')}
              placeholder="Default aus Settings" style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            Zahlungsziel-Override (Tage)
            <input className="tenant-input" type="number"
              value={form.payment_terms_days_override} onChange={set('payment_terms_days_override')}
              placeholder="Default aus Settings" style={localStyles.input} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
          <label style={localStyles.label}>
            Rechnungs-Sprache
            <Select
              value={form.invoice_locale}
              onChange={v => setRaw('invoice_locale', v as typeof form.invoice_locale)}
              options={LOCALE_OPTIONS}
              style={{ minWidth: '100%' }}
            />
          </label>
          <label style={{ ...localStyles.label, justifyContent: 'flex-end' }}>
            <span style={{ visibility: 'hidden' }}>spacer</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8125rem' }}>
                <input type="checkbox" checked={form.postal_delivery_default}
                  onChange={e => setRaw('postal_delivery_default', e.target.checked)} />
                Postversand als Standard
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8125rem' }}>
                <input type="checkbox" checked={form.dunning_paused}
                  onChange={e => setRaw('dunning_paused', e.target.checked)} />
                Mahnungen pausiert
              </label>
            </span>
          </label>
        </div>
        <label style={localStyles.label}>
          Interne Abrechnungs-Notizen
          <textarea className="tenant-input" value={form.billing_notes} onChange={set('billing_notes')}
            rows={2} style={{ ...localStyles.input, resize: 'vertical' }} />
        </label>

        <div style={localStyles.sectionDivider}>
          <span style={localStyles.sectionLabel}>{t('tenants_notes')}</span>
        </div>
        <textarea className="tenant-input" value={form.notes} onChange={set('notes')} rows={3} style={{ ...localStyles.input, resize: 'vertical' }} />

        <div style={localStyles.formFooter}>
          <button type="button" onClick={() => setSelectedId(null)} style={s.secondaryBtn}>{t('cancel')}</button>
          <button type="submit" disabled={saving} style={s.actionBtn}>{saving ? t('saving') : t('save')}</button>
        </div>
      </form>
    </div>
  )

  return (
    <MasterDetailLayout
      dashboard={dashboard}
      sidebar={sidebar}
      detail={detailPane}
      isOpen={selectedId !== null}
    />
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  countPill:    { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  detailPane:   { padding: '1rem 1.5rem' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  detailTitle:  { margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b', flex: 1 },
  backBtn:      { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '.875rem', padding: 0 },
  formBody:     { display: 'flex', flexDirection: 'column' as const, gap: '.75rem', maxWidth: 600 },
  formFooter:   { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', paddingTop: '.75rem', borderTop: '1px solid #f1f5f9' },
  error:        { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  sectionDivider: { borderBottom: '1px solid #f1f5f9', paddingBottom: 2, marginTop: '.5rem' },
  sectionLabel: { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  grid:         { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  label:        { display: 'flex', flexDirection: 'column' as const, gap: '.25rem', fontSize: '.8125rem', fontWeight: 500, color: '#374151' },
  input:        { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },
  badgeActive:  { display: 'inline-block', background: '#dcfce7', color: '#15803d', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  badgeInactive:{ display: 'inline-block', background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  btnDanger:    { background: 'none', border: '1px solid #fca5a5', color: '#b91c1c', cursor: 'pointer', fontSize: '.8125rem', padding: '.25rem .625rem', borderRadius: 4, fontWeight: 500 },
}
