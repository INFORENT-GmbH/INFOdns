import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, updateUser, inviteUser, getInvites, revokeInvite, getTenants, type User, type PendingInvite } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

export default function UsersPage() {
  const { t } = useI18n()
  const { user: currentUser, impersonate } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'tenant', locale: 'de' })
  const [selectedTenantIds, setSelectedTenantIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'tenant', locale: 'de' })
  const [inviteTenantIds, setInviteTenantIds] = useState<number[]>([])
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ email: '', full_name: '', role: 'tenant', locale: 'de', is_active: true })
  const [editTenantIds, setEditTenantIds] = useState<number[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
  })

  const { data: invites = [] } = useQuery({
    queryKey: ['invites'],
    queryFn: () => getInvites().then(r => r.data),
  })

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })

  function setField(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function toggleTenant(id: number) {
    setSelectedTenantIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  function setInviteField(key: string, value: string) {
    setInviteForm(f => ({ ...f, [key]: value }))
  }

  function toggleInviteTenant(id: number) {
    setInviteTenantIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  function startEdit(u: User) {
    setEditingId(u.id)
    setEditForm({ email: u.email, full_name: u.full_name, role: u.role, locale: u.locale, is_active: !!u.is_active })
    setEditTenantIds(u.tenant_ids ?? [])
    setEditError(null)
  }

  function setEditField(key: string, value: string | boolean) {
    setEditForm(f => ({ ...f, [key]: value }))
  }

  function toggleEditTenant(id: number) {
    setEditTenantIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  async function handleUpdate() {
    if (!editingId) return
    setEditSaving(true); setEditError(null)
    try {
      await updateUser(editingId, { ...editForm, tenant_ids: editTenantIds } as any)
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditingId(null)
    } catch (err: any) {
      setEditError(err.response?.data?.message ?? err.message)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true); setInviteError(null); setInviteSuccess(null)
    try {
      await inviteUser({ ...inviteForm, tenant_ids: inviteTenantIds })
      qc.invalidateQueries({ queryKey: ['invites'] })
      setInviteSuccess(inviteForm.email)
      setInviteForm({ email: '', full_name: '', role: 'tenant', locale: 'de' })
      setInviteTenantIds([])
      setShowInviteForm(false)
    } catch (err: any) {
      setInviteError(err.response?.data?.message ?? err.message)
    } finally {
      setInviting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null)
    try {
      await createUser({
        ...form,
        tenant_ids: selectedTenantIds,
      } as any)
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ email: '', password: '', full_name: '', role: 'tenant', locale: 'de' })
      setSelectedTenantIds([])
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const tenantNames = (ids: number[]) => {
    if (!ids.length) return <span style={styles.muted}>—</span>
    return ids.map(id => {
      const c = tenants.find(c => c.id === id)
      return c ? c.name : `#${id}`
    }).join(', ')
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = { admin: '#b91c1c', operator: '#1d4ed8', tenant: '#15803d' }
    return <span style={{ color: colors[role] ?? '#374151', fontWeight: 600, fontSize: '.75rem' }}>{role}</span>
  }

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('users_title')}</h2>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <button
            onClick={() => { setShowInviteForm(v => !v); setShowForm(false); setInviteSuccess(null) }}
            style={styles.btnSecondary}
          >
            {t('users_invite')}
          </button>
          <button onClick={() => { setShowForm(v => !v); setShowInviteForm(false) }} style={styles.btnPrimary}>{t('users_add')}</button>
        </div>
      </div>

      {inviteSuccess && (
        <div style={{ background: '#dcfce7', color: '#15803d', padding: '.625rem .875rem', borderRadius: 4, fontSize: '.875rem', marginBottom: '1rem' }}>
          {t('users_inviteSuccess')} <strong>{inviteSuccess}</strong>
        </div>
      )}

      {showInviteForm && (
        <form onSubmit={handleInvite} style={styles.formCard}>
          <h4 style={{ margin: 0 }}>{t('users_inviteTitle')}</h4>
          {inviteError && <div style={styles.error}>{inviteError}</div>}
          <div style={styles.grid}>
            <label style={styles.label}>{t('email')} <input type="email" value={inviteForm.email} onChange={e => setInviteField('email', e.target.value)} required style={styles.input} /></label>
            <label style={styles.label}>{t('users_fullName')} <input value={inviteForm.full_name} onChange={e => setInviteField('full_name', e.target.value)} required style={styles.input} /></label>
            <label style={styles.label}>
              {t('role')}
              <select value={inviteForm.role} onChange={e => setInviteField('role', e.target.value)} style={styles.input}>
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="tenant">tenant</option>
              </select>
            </label>
            <label style={styles.label}>
              {t('users_locale')}
              <select value={inviteForm.locale} onChange={e => setInviteField('locale', e.target.value)} style={styles.input}>
                <option value="de">{t('locale_de')}</option>
                <option value="en">{t('locale_en')}</option>
              </select>
            </label>
          </div>
          <div>
            <div style={{ fontSize: '.875rem', fontWeight: 500, marginBottom: '.25rem' }}>{t('users_tenants')}</div>
            <div style={styles.checkboxGrid}>
              {tenants.map(c => (
                <label key={c.id} style={styles.checkboxLabel}>
                  <input type="checkbox" checked={inviteTenantIds.includes(c.id)} onChange={() => toggleInviteTenant(c.id)} />
                  {c.name}
                </label>
              ))}
              {tenants.length === 0 && <span style={styles.muted}>{t('users_noTenant')}</span>}
            </div>
          </div>
          <div style={styles.actions}>
            <button type="button" onClick={() => setShowInviteForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
            <button type="submit" disabled={inviting} style={styles.btnPrimary}>{inviting ? t('saving') : t('users_invite')}</button>
          </div>
        </form>
      )}

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
                <option value="tenant">tenant</option>
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
            <div style={{ fontSize: '.875rem', fontWeight: 500, marginBottom: '.25rem' }}>{t('users_tenants')}</div>
            <div style={styles.checkboxGrid}>
              {tenants.map(c => (
                <label key={c.id} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={selectedTenantIds.includes(c.id)}
                    onChange={() => toggleTenant(c.id)}
                  />
                  {c.name}
                </label>
              ))}
              {tenants.length === 0 && <span style={styles.muted}>{t('users_noTenant')}</span>}
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
              <th style={styles.th}>{t('users_tenants')}</th>
              <th style={styles.th}>{t('active')}</th>
              <th style={styles.th}>{t('users_locale')}</th>
              <th style={styles.th}>{t('created')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: User) => (
              <React.Fragment key={u.id}>
                <tr style={styles.tr}>
                  <td style={styles.td}>{u.email}</td>
                  <td style={styles.td}>{u.full_name}</td>
                  <td style={styles.td}>{roleBadge(u.role)}</td>
                  <td style={styles.td}>{tenantNames(u.tenant_ids ?? [])}</td>
                  <td style={styles.td}>{u.is_active ? '✓' : '—'}</td>
                  <td style={styles.td}>{u.locale === 'en' ? t('locale_en') : t('locale_de')}</td>
                  <td style={styles.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: '.375rem' }}>
                      <button
                        onClick={() => editingId === u.id ? setEditingId(null) : startEdit(u)}
                        style={editingId === u.id ? styles.btnSecondary : styles.btnEdit}
                      >
                        {editingId === u.id ? t('cancel') : t('edit')}
                      </button>
                      {currentUser?.role === 'admin' && u.id !== currentUser.sub && (
                        <button
                          onClick={() => impersonate(u.id)}
                          style={styles.btnImpersonate}
                          title={t('users_impersonate')}
                        >
                          {t('users_impersonate')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {editingId === u.id && (
                  <tr key={`${u.id}-edit`}>
                    <td colSpan={8} style={{ padding: '.75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 600 }}>
                        {editError && <div style={styles.error}>{editError}</div>}
                        <div style={styles.grid}>
                          <label style={styles.label}>{t('email')} <input type="email" value={editForm.email} onChange={e => setEditField('email', e.target.value)} style={styles.input} /></label>
                          <label style={styles.label}>{t('users_fullName')} <input value={editForm.full_name} onChange={e => setEditField('full_name', e.target.value)} style={styles.input} /></label>
                          <label style={styles.label}>
                            {t('role')}
                            <select value={editForm.role} onChange={e => setEditField('role', e.target.value)} style={styles.input}>
                              <option value="admin">admin</option>
                              <option value="operator">operator</option>
                              <option value="tenant">tenant</option>
                            </select>
                          </label>
                          <label style={styles.label}>
                            {t('users_locale')}
                            <select value={editForm.locale} onChange={e => setEditField('locale', e.target.value)} style={styles.input}>
                              <option value="de">{t('locale_de')}</option>
                              <option value="en">{t('locale_en')}</option>
                            </select>
                          </label>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.875rem', fontWeight: 500, cursor: 'pointer' }}>
                          <input type="checkbox" checked={editForm.is_active} onChange={e => setEditField('is_active', e.target.checked)} />
                          {t('active')}
                        </label>
                        <div>
                          <div style={{ fontSize: '.875rem', fontWeight: 500, marginBottom: '.25rem' }}>{t('users_tenants')}</div>
                          <div style={styles.checkboxGrid}>
                            {tenants.map(c => (
                              <label key={c.id} style={styles.checkboxLabel}>
                                <input type="checkbox" checked={editTenantIds.includes(c.id)} onChange={() => toggleEditTenant(c.id)} />
                                {c.name}
                              </label>
                            ))}
                            {tenants.length === 0 && <span style={styles.muted}>{t('users_noTenant')}</span>}
                          </div>
                        </div>
                        <div style={styles.actions}>
                          <button type="button" onClick={() => setEditingId(null)} style={styles.btnSecondary}>{t('cancel')}</button>
                          <button type="button" onClick={handleUpdate} disabled={editSaving} style={styles.btnPrimary}>{editSaving ? t('saving') : t('save')}</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {invites.map((inv: PendingInvite) => (
              <tr key={`invite-${inv.id}`} style={{ ...styles.tr, opacity: 0.7 }}>
                <td style={styles.td}>{inv.email}</td>
                <td style={{ ...styles.td, color: '#9ca3af' }}>{inv.full_name || <span style={styles.muted}>—</span>}</td>
                <td style={styles.td}>{roleBadge(inv.role)}</td>
                <td style={styles.td}>{tenantNames(inv.tenant_ids ?? [])}</td>
                <td style={styles.td}>
                  <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 12, fontSize: '.75rem', fontWeight: 600 }}>
                    {t('users_pendingInvite')}
                  </span>
                </td>
                <td style={styles.td}>{inv.locale === 'en' ? t('locale_en') : t('locale_de')}</td>
                <td style={styles.td}>{new Date(inv.created_at).toLocaleDateString()}</td>
                <td style={styles.td}>
                  <button
                    style={styles.btnRevoke}
                    onClick={() => revokeInvite(inv.id).then(() => qc.invalidateQueries({ queryKey: ['invites'] }))}
                  >
                    {t('users_revokeInvite')}
                  </button>
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
  btnEdit:        { padding: '.25rem .5rem', background: '#fff', border: '1px solid #2563eb', color: '#2563eb', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer' },
  btnImpersonate: { padding: '.25rem .5rem', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer' },
  btnRevoke:      { padding: '.25rem .5rem', background: '#fff', border: '1px solid #d1d5db', color: '#6b7280', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer' },
}
