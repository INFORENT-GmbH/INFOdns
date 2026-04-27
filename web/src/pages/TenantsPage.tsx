import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenants, createTenant, updateTenant, deleteTenant, type Tenant } from '../api/client'
import { useI18n } from '../i18n/I18nContext'
import { formatApiError } from '../lib/formError'

const INLINE_STYLES = `
  .tenant-row { transition: background 0.08s; cursor: pointer; }
  .tenant-row:hover { background: #e8f0fe !important; }
  .tenant-input:focus { border-color: #2563eb !important; outline: none; box-shadow: 0 0 0 2px #bfdbfe; }
`

const emptyForm = {
  name: '', company_name: '', first_name: '', last_name: '',
  street: '', zip: '', city: '', country: '',
  phone: '', fax: '', email: '', vat_id: '', notes: '',
}

export default function TenantsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Tenant | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })

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

      <div style={styles.header}>
        <h2 style={styles.h2}>{t('tenants_title')}</h2>
        <button onClick={openCreate} style={styles.btnPrimary}>{t('tenants_add')}</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.formCard}>
          <div style={styles.formHeader}>
            <h4 style={styles.formTitle}>{editTarget ? t('tenants_editTitle') : t('tenants_newTitle')}</h4>
          </div>
          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.formBody}>
            {/* General */}
            <div style={styles.grid}>
              <label style={styles.label}>
                {t('name')}
                <input className="tenant-input" value={form.name} onChange={set('name')} required style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_companyName')}
                <input className="tenant-input" value={form.company_name} onChange={set('company_name')} style={styles.input} />
              </label>
            </div>

            {/* Contact */}
            <div style={styles.sectionDivider}>
              <span style={styles.sectionLabel}>{t('tenants_contactSection')}</span>
            </div>
            <div style={styles.grid}>
              <label style={styles.label}>
                {t('tenants_firstName')}
                <input className="tenant-input" value={form.first_name} onChange={set('first_name')} style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_lastName')}
                <input className="tenant-input" value={form.last_name} onChange={set('last_name')} style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_email')}
                <input className="tenant-input" type="email" value={form.email} onChange={set('email')} style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_phone')}
                <input className="tenant-input" value={form.phone} onChange={set('phone')} style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_fax')}
                <input className="tenant-input" value={form.fax} onChange={set('fax')} style={styles.input} />
              </label>
            </div>

            {/* Address */}
            <div style={styles.sectionDivider}>
              <span style={styles.sectionLabel}>{t('tenants_addressSection')}</span>
            </div>
            <div style={styles.grid}>
              <label style={{ ...styles.label, gridColumn: '1 / -1' }}>
                {t('tenants_street')}
                <input className="tenant-input" value={form.street} onChange={set('street')} style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_zip')}
                <input className="tenant-input" value={form.zip} onChange={set('zip')} style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_city')}
                <input className="tenant-input" value={form.city} onChange={set('city')} style={styles.input} />
              </label>
              <label style={styles.label}>
                {t('tenants_country')}
                <input className="tenant-input" value={form.country} onChange={set('country')} maxLength={2} style={styles.input} placeholder="DE" />
              </label>
            </div>

            {/* Billing */}
            <div style={styles.sectionDivider}>
              <span style={styles.sectionLabel}>{t('tenants_billingSection')}</span>
            </div>
            <label style={styles.label}>
              {t('tenants_vatId')}
              <input className="tenant-input" value={form.vat_id} onChange={set('vat_id')} style={styles.input} />
            </label>

            {/* Notes */}
            <div style={styles.sectionDivider}>
              <span style={styles.sectionLabel}>{t('tenants_notes')}</span>
            </div>
            <textarea className="tenant-input" value={form.notes} onChange={set('notes')} rows={3} style={{ ...styles.input, resize: 'vertical' }} />
          </div>

          <div style={styles.formFooter}>
            <button type="button" onClick={() => setShowForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
            <button type="submit" disabled={saving} style={styles.btnPrimary}>{saving ? t('saving') : t('save')}</button>
          </div>
        </form>
      )}

      {isLoading ? <p style={{ padding: '.75rem', color: '#64748b', fontSize: '.8125rem' }}>{t('loading')}</p> : (
        <div style={styles.card}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('name')}</th>
                <th style={styles.th}>{t('tenants_companyName')}</th>
                <th style={styles.th}>{t('tenants_email')}</th>
                <th style={styles.th}>{t('tenants_phone')}</th>
                <th style={styles.th}>{t('active')}</th>
                <th style={styles.th}>{t('created')}</th>
                <th style={{ ...styles.th, width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((c: Tenant) => (
                <tr key={c.id} className="tenant-row" onClick={() => openEdit(c)}>
                  <td style={styles.td}>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{c.name}</span>
                  </td>
                  <td style={styles.tdMuted}>{c.company_name ?? ''}</td>
                  <td style={styles.tdMuted}>{c.email ?? ''}</td>
                  <td style={styles.tdMuted}>{c.phone ?? ''}</td>
                  <td style={styles.td}>
                    {c.is_active
                      ? <span style={styles.badgeActive}>Active</span>
                      : <span style={styles.badgeInactive}>Inactive</span>}
                  </td>
                  <td style={styles.tdMuted}>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => openEdit(c)} style={styles.btnEdit}>{t('edit')}</button>
                    <button onClick={() => handleDelete(c)} style={styles.btnDanger}>{t('delete')}</button>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '.8125rem' }}>No tenants yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem', flexWrap: 'wrap', gap: '.5rem' },
  h2: { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },

  // Card wrapper for table
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' },

  // Form
  formCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: '1rem', overflow: 'hidden' },
  formHeader: { padding: '.625rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  formTitle: { margin: 0, fontSize: '.875rem', fontWeight: 600, color: '#1e293b' },
  formBody: { padding: '.75rem', display: 'flex', flexDirection: 'column', gap: '.75rem' },
  formFooter: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', padding: '.625rem .75rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0' },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem', margin: '.75rem .75rem 0' },

  // Section dividers
  sectionDivider: { borderBottom: '1px solid #f1f5f9', paddingBottom: 2, marginTop: '.25rem' },
  sectionLabel: { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' },

  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8125rem', fontWeight: 500, color: '#374151' },
  input: { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },

  // Table
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '.04em' },
  td: { padding: '.5rem .75rem', fontSize: '.8125rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9' },
  tdMuted: { padding: '.5rem .75rem', fontSize: '.8125rem', color: '#64748b', borderBottom: '1px solid #f1f5f9' },

  // Badges
  badgeActive: { display: 'inline-block', background: '#dcfce7', color: '#15803d', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  badgeInactive: { display: 'inline-block', background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },

  // Buttons
  btnPrimary: { padding: '.3125rem .75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.3125rem .75rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer', color: '#374151' },
  btnEdit: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px', fontWeight: 500 },
  btnDanger: { background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px', fontWeight: 500 },
}
