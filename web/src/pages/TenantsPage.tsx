import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenants, createTenant, updateTenant, deleteTenant, type Tenant } from '../api/client'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import { useI18n } from '../i18n/I18nContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

const INLINE_STYLES = `
  .tenant-row { transition: background 0.08s; cursor: pointer; }
  .tenant-row:hover td { background: #f1f5f9; }
  .tenant-input:focus { border-color: #2563eb !important; outline: none; box-shadow: 0 0 0 2px #bfdbfe; }
`

const emptyForm = {
  name: '', company_name: '', first_name: '', last_name: '',
  street: '', zip: '', city: '', country: '',
  phone: '', fax: '', email: '', vat_id: '', notes: '',
}

type StatusFilter = '' | 'active' | 'inactive'
const TENANT_FILTER_DEFAULTS = { search: '', status: '' as StatusFilter, country: '' }

export default function TenantsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()

  const {
    filters, setFilter, persist, setPersist, clear: clearFilters, hasActive,
  } = usePersistedFilters('tenants', TENANT_FILTER_DEFAULTS)
  const { search, status, country } = filters

  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Tenant | null>(null)
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

  function set(field: keyof typeof emptyForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))
  }

  function openCreate() {
    setEditTarget(null); setForm(emptyForm); setError(null); setShowForm(true)
  }
  function openEdit(c: Tenant) {
    setEditTarget(c)
    setForm({
      name: c.name,
      company_name: c.company_name ?? '',
      first_name: c.first_name ?? '',
      last_name: c.last_name ?? '',
      street: c.street ?? '',
      zip: c.zip ?? '',
      city: c.city ?? '',
      country: c.country ?? '',
      phone: c.phone ?? '',
      fax: c.fax ?? '',
      email: c.email ?? '',
      vat_id: c.vat_id ?? '',
      notes: c.notes ?? '',
    })
    setError(null); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    const payload: any = { name: form.name }
    for (const [k, v] of Object.entries(form)) {
      if (k === 'name') continue
      payload[k] = v || null
    }
    try {
      if (editTarget) {
        await updateTenant(editTarget.id, payload)
      } else {
        await createTenant(payload)
      }
      qc.invalidateQueries({ queryKey: ['tenants'] })
      setShowForm(false)
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
  }

  return (
    <div>
      <style>{INLINE_STYLES}</style>

      <div style={s.pageBar}>
        <h2 style={s.pageTitle}>{t('tenants_title')}</h2>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={localStyles.formCard}>
          <div style={localStyles.formHeader}>
            <h4 style={localStyles.formTitle}>{editTarget ? t('tenants_editTitle') : t('tenants_newTitle')}</h4>
          </div>
          {error && <div style={localStyles.error}>{error}</div>}

          <div style={localStyles.formBody}>
            {/* General */}
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

            {/* Contact */}
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
                <input className="tenant-input" value={form.phone} onChange={set('phone')} style={localStyles.input} />
              </label>
              <label style={localStyles.label}>
                {t('tenants_fax')}
                <input className="tenant-input" value={form.fax} onChange={set('fax')} style={localStyles.input} />
              </label>
            </div>

            {/* Address */}
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

            {/* Billing */}
            <div style={localStyles.sectionDivider}>
              <span style={localStyles.sectionLabel}>{t('tenants_billingSection')}</span>
            </div>
            <label style={localStyles.label}>
              {t('tenants_vatId')}
              <input className="tenant-input" value={form.vat_id} onChange={set('vat_id')} style={localStyles.input} />
            </label>

            {/* Notes */}
            <div style={localStyles.sectionDivider}>
              <span style={localStyles.sectionLabel}>{t('tenants_notes')}</span>
            </div>
            <textarea className="tenant-input" value={form.notes} onChange={set('notes')} rows={3} style={{ ...localStyles.input, resize: 'vertical' }} />
          </div>

          <div style={localStyles.formFooter}>
            <button type="button" onClick={() => setShowForm(false)} style={s.secondaryBtn}>{t('cancel')}</button>
            <button type="submit" disabled={saving} style={s.actionBtn}>{saving ? t('saving') : t('save')}</button>
          </div>
        </form>
      )}

      <div style={s.panel}>
        {/* Stats / count bar */}
        <FilterBar>
          <span style={localStyles.countPill}>
            {hasActive
              ? t('tenants_filteredCount', filteredTenants.length, tenants.length)
              : `${tenants.length} ${t('tenants_title').toLowerCase()}`}
          </span>
        </FilterBar>

        {/* Filter bar */}
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

          <button onClick={openCreate} style={s.actionBtn}>{t('tenants_add')}</button>
        </FilterBar>

        {/* Table */}
        <div style={s.tableWrap}>
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
                  <th style={{ ...s.th, width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((c: Tenant) => (
                  <tr key={c.id} className="tenant-row" onClick={() => openEdit(c)}>
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
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => openEdit(c)} style={localStyles.btnEdit}>{t('edit')}</button>
                      <button onClick={() => handleDelete(c)} style={localStyles.btnDanger}>{t('delete')}</button>
                    </td>
                  </tr>
                ))}
                {filteredTenants.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '.8125rem' }}>{t('tenants_none')}</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  // Form
  formCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: '1rem', overflow: 'hidden' },
  formHeader: { padding: '.625rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  formTitle: { margin: 0, fontSize: '.875rem', fontWeight: 600, color: '#1e293b' },
  formBody: { padding: '.75rem', display: 'flex', flexDirection: 'column', gap: '.75rem' },
  formFooter: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', padding: '.625rem .75rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0' },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem', margin: '.75rem .75rem 0' },

  sectionDivider: { borderBottom: '1px solid #f1f5f9', paddingBottom: 2, marginTop: '.25rem' },
  sectionLabel: { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' },

  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8125rem', fontWeight: 500, color: '#374151' },
  input: { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },

  countPill: { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },

  badgeActive: { display: 'inline-block', background: '#dcfce7', color: '#15803d', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  badgeInactive: { display: 'inline-block', background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },

  btnEdit:   { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px', fontWeight: 500 },
  btnDanger: { background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px', fontWeight: 500 },
}
