import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTenants, createTenant, updateTenant, deleteTenant, type Tenant } from '../api/client'
import { useI18n } from '../i18n/I18nContext'

export default function TenantsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Tenant | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })

  function openCreate() {
    setEditTarget(null); setName(''); setError(null); setShowForm(true)
  }
  function openEdit(c: Tenant) {
    setEditTarget(c); setName(c.name); setError(null); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      if (editTarget) {
        await updateTenant(editTarget.id, { name })
      } else {
        await createTenant({ name })
      }
      qc.invalidateQueries({ queryKey: ['tenants'] })
      setShowForm(false)
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
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
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('tenants_title')}</h2>
        <button onClick={openCreate} style={styles.btnPrimary}>{t('tenants_add')}</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.formCard}>
          <h4 style={{ margin: 0 }}>{editTarget ? t('tenants_editTitle') : t('tenants_newTitle')}</h4>
          {error && <div style={styles.error}>{error}</div>}
          <label style={styles.label}>
            {t('name')}
            <input value={name} onChange={e => setName(e.target.value)} required style={styles.input} />
          </label>
          <div style={styles.actions}>
            <button type="button" onClick={() => setShowForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
            <button type="submit" disabled={saving} style={styles.btnPrimary}>{saving ? t('saving') : t('save')}</button>
          </div>
        </form>
      )}

      {isLoading ? <p>{t('loading')}</p> : (
        <div style={{ overflowX: 'auto' }}><table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('name')}</th>
              <th style={styles.th}>{t('active')}</th>
              <th style={styles.th}>{t('created')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((c: Tenant) => (
              <tr key={c.id} style={styles.tr}>
                <td style={styles.td}>{c.name}</td>
                <td style={styles.td}>{c.is_active ? '✓' : '—'}</td>
                <td style={styles.td}>{new Date(c.created_at).toLocaleDateString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button onClick={() => openEdit(c)} style={styles.btnIcon}>{t('edit')}</button>
                  <button onClick={() => handleDelete(c)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>{t('delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' },
  h2: { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  formCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 480 },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem', borderRadius: 4, fontSize: '.875rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input: { padding: '.375rem .75rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.875rem' },
  actions: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },
  btnPrimary: { padding: '.3125rem .75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  btnSecondary: { padding: '.3125rem .75rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer', color: '#374151' },
  btnIcon: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '.04em' },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '.4375rem .75rem', fontSize: '.8125rem', color: '#1e293b' },
}
