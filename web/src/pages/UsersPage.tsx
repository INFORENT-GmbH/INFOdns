import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, getCustomers, type User } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

export default function UsersPage() {
  const { t } = useI18n()
  const { user: currentUser, impersonate } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'customer', locale: 'de' })
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
  })

  function setField(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function toggleCustomer(id: number) {
    setSelectedCustomerIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await createUser({
        ...form,
        customer_ids: selectedCustomerIds,
      } as any)
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ email: '', password: '', full_name: '', role: 'customer', locale: 'de' })
      setSelectedCustomerIds([])
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const customerNames = (ids: number[]) => {
    if (!ids.length) return <span style={styles.muted}>—</span>
    return ids.map(id => {
      const c = customers.find(c => c.id === id)
      return c ? c.name : `#${id}`
    }).join(', ')
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = { admin: '#b91c1c', operator: '#1d4ed8', customer: '#15803d' }
    return <span style={{ color: colors[role] ?? '#374151', fontWeight: 600, fontSize: '.75rem' }}>{role}</span>
  }

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('users_title')}</h2>
        <button onClick={() => setShowForm(v => !v)} style={styles.btnPrimary}>{t('users_add')}</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.formCard}>
          <h4 style={{ margin: 0 }}>{t('users_newTitle')}</h4>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.grid}>
            <label style={styles.label}>{t('email')} <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} required style={styles.input} /></label>
            <label style={styles.label}>{t('login_password')} <input type="password" value={form.password} onChange={e => setField('password', e.target.value)} required minLength={8} style={styles.input} /></label>
            <label style={styles.label}>{t('users_fullName')} <input value={form.full_name} onChange={e => setField('full_name', e.target.value)} required style={styles.input} /></label>
            <label style={styles.label}>
              {t('role')}
              <select value={form.role} onChange={e => setField('role', e.target.value)} style={styles.input}>
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="customer">customer</option>
              </select>
            </label>
            <label style={styles.label}>
              {t('users_locale')}
              <select value={form.locale} onChange={e => setField('locale', e.target.value)} style={styles.input}>
                <option value="de">{t('locale_de')}</option>
                <option value="en">{t('locale_en')}</option>
              </select>
            </label>
          </div>
          <div>
            <div style={{ fontSize: '.875rem', fontWeight: 500, marginBottom: '.25rem' }}>{t('users_customers')}</div>
            <div style={styles.checkboxGrid}>
              {customers.map(c => (
                <label key={c.id} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={selectedCustomerIds.includes(c.id)}
                    onChange={() => toggleCustomer(c.id)}
                  />
                  {c.name}
                </label>
              ))}
              {customers.length === 0 && <span style={styles.muted}>{t('users_noCustomer')}</span>}
            </div>
          </div>
          <div style={styles.actions}>
            <button type="button" onClick={() => setShowForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
            <button type="submit" disabled={saving} style={styles.btnPrimary}>{saving ? t('creating') : t('create')}</button>
          </div>
        </form>
      )}

      {isLoading ? <p>{t('loading')}</p> : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('email')}</th>
              <th style={styles.th}>{t('name')}</th>
              <th style={styles.th}>{t('role')}</th>
              <th style={styles.th}>{t('users_customers')}</th>
              <th style={styles.th}>{t('active')}</th>
              <th style={styles.th}>{t('users_locale')}</th>
              <th style={styles.th}>{t('created')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: User) => (
              <tr key={u.id} style={styles.tr}>
                <td style={styles.td}>{u.email}</td>
                <td style={styles.td}>{u.full_name}</td>
                <td style={styles.td}>{roleBadge(u.role)}</td>
                <td style={styles.td}>{customerNames(u.customer_ids ?? [])}</td>
                <td style={styles.td}>{u.is_active ? '✓' : '—'}</td>
                <td style={styles.td}>{u.locale === 'en' ? t('locale_en') : t('locale_de')}</td>
                <td style={styles.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={styles.td}>
                  {currentUser?.role === 'admin' && u.id !== currentUser.sub && (
                    <button
                      onClick={() => impersonate(u.id)}
                      style={styles.btnImpersonate}
                      title={t('users_impersonate')}
                    >
                      {t('users_impersonate')}
                    </button>
                  )}
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
  formCard: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 600 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  checkboxGrid: { display: 'flex', flexWrap: 'wrap', gap: '.5rem .75rem' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.875rem', cursor: 'pointer' },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem', borderRadius: 4, fontSize: '.875rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem' },
  actions: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr: { borderBottom: '1px solid #e5e7eb' },
  td: { padding: '.625rem .75rem', fontSize: '.875rem' },
  muted: { color: '#9ca3af' },
  btnImpersonate: { padding: '.25rem .5rem', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer' },
}
