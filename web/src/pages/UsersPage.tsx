import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, type User } from '../api/client'

export default function UsersPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'customer', customer_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
  })

  function setField(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await createUser({
        ...form,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
      } as any)
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ email: '', password: '', full_name: '', role: 'customer', customer_id: '' })
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = { admin: '#b91c1c', operator: '#1d4ed8', customer: '#15803d' }
    return <span style={{ color: colors[role] ?? '#374151', fontWeight: 600, fontSize: '.75rem' }}>{role}</span>
  }

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>Users</h2>
        <button onClick={() => setShowForm(v => !v)} style={styles.btnPrimary}>+ Add User</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={styles.formCard}>
          <h4 style={{ margin: 0 }}>New User</h4>
          {error && <div style={styles.error}>{error}</div>}
          <div style={styles.grid}>
            <label style={styles.label}>Email <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} required style={styles.input} /></label>
            <label style={styles.label}>Password <input type="password" value={form.password} onChange={e => setField('password', e.target.value)} required minLength={8} style={styles.input} /></label>
            <label style={styles.label}>Full name <input value={form.full_name} onChange={e => setField('full_name', e.target.value)} required style={styles.input} /></label>
            <label style={styles.label}>
              Role
              <select value={form.role} onChange={e => setField('role', e.target.value)} style={styles.input}>
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="customer">customer</option>
              </select>
            </label>
            <label style={styles.label}>Customer ID (optional) <input type="number" value={form.customer_id} onChange={e => setField('customer_id', e.target.value)} style={styles.input} /></label>
          </div>
          <div style={styles.actions}>
            <button type="button" onClick={() => setShowForm(false)} style={styles.btnSecondary}>Cancel</button>
            <button type="submit" disabled={saving} style={styles.btnPrimary}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      )}

      {isLoading ? <p>Loading…</p> : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Customer ID</th>
              <th style={styles.th}>Active</th>
              <th style={styles.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: User) => (
              <tr key={u.id} style={styles.tr}>
                <td style={styles.td}>{u.email}</td>
                <td style={styles.td}>{u.full_name}</td>
                <td style={styles.td}>{roleBadge(u.role)}</td>
                <td style={styles.td}>{u.customer_id ?? <span style={styles.muted}>—</span>}</td>
                <td style={styles.td}>{u.is_active ? '✓' : '—'}</td>
                <td style={styles.td}>{new Date(u.created_at).toLocaleDateString()}</td>
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
}
