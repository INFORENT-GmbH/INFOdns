import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, type Customer } from '../api/client'
import { useI18n } from '../i18n/I18nContext'

export default function CustomersPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Customer | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
  })

  function openCreate() {
    setEditTarget(null); setName(''); setSlug(''); setError(null); setShowForm(true)
  }
  function openEdit(c: Customer) {
    setEditTarget(c); setName(c.name); setSlug(c.slug); setError(null); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      if (editTarget) {
        await updateCustomer(editTarget.id, { name, slug })
      } else {
        await createCustomer({ name, slug })
      }
      qc.invalidateQueries({ queryKey: ['customers'] })
      setShowForm(false)
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(c: Customer) {
    if (!confirm(t('customers_deleteConfirm', c.name))) return
    await deleteCustomer(c.id)
    qc.invalidateQueries({ queryKey: ['customers'] })
  }

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('customers_title')}</h2>
        <button onClick={openCreate} style={styles.btnPrimary}>{t('customers_add')}</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.formCard}>
          <h4 style={{ margin: 0 }}>{editTarget ? t('customers_editTitle') : t('customers_newTitle')}</h4>
          {error && <div style={styles.error}>{error}</div>}
          <label style={styles.label}>
            {t('name')}
            <input value={name} onChange={e => setName(e.target.value)} required style={styles.input} />
          </label>
          <label style={styles.label}>
            {t('slug')}
            <input value={slug} onChange={e => setSlug(e.target.value)} required pattern="[a-z0-9-]+" style={styles.input} placeholder={t('customers_slugPh')} />
          </label>
          <div style={styles.actions}>
            <button type="button" onClick={() => setShowForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
            <button type="submit" disabled={saving} style={styles.btnPrimary}>{saving ? t('saving') : t('save')}</button>
          </div>
        </form>
      )}

      {isLoading ? <p>{t('loading')}</p> : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('name')}</th>
              <th style={styles.th}>{t('slug')}</th>
              <th style={styles.th}>{t('active')}</th>
              <th style={styles.th}>{t('created')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c: Customer) => (
              <tr key={c.id} style={styles.tr}>
                <td style={styles.td}>{c.name}</td>
                <td style={styles.td}><code>{c.slug}</code></td>
                <td style={styles.td}>{c.is_active ? '✓' : '—'}</td>
                <td style={styles.td}>{new Date(c.created_at).toLocaleDateString()}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>
                  <button onClick={() => openEdit(c)} style={styles.btnIcon}>{t('edit')}</button>
                  <button onClick={() => handleDelete(c)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>{t('delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  h2: { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  formCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 480 },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem', borderRadius: 4, fontSize: '.875rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem' },
  actions: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  btnIcon: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr: { borderBottom: '1px solid #e5e7eb' },
  td: { padding: '.625rem .75rem', fontSize: '.875rem' },
}
