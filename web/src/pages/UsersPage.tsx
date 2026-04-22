import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, updateUser, inviteUser, getInvites, revokeInvite, getTenants, type User, type PendingInvite } from '../api/client'
import Select from '../components/Select'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

const INLINE_STYLES = `
  .user-row { transition: background 0.08s; }
  .user-row:hover { background: #e8f0fe !important; }
  .user-input:focus { border-color: #2563eb !important; outline: none; box-shadow: 0 0 0 2px #bfdbfe; }
`

export default function UsersPage() {
  const { t } = useI18n()
  const { user: currentUser, impersonate } = useAuth()
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'tenant', locale: 'de', phone: '', street: '', zip: '', city: '', country: '' })
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
  const [editForm, setEditForm] = useState({ email: '', full_name: '', role: 'tenant', locale: 'de', is_active: true, phone: '', street: '', zip: '', city: '', country: '' })
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
    setEditForm({ email: u.email, full_name: u.full_name, role: u.role, locale: u.locale, is_active: !!u.is_active, phone: u.phone ?? '', street: u.street ?? '', zip: u.zip ?? '', city: u.city ?? '', country: u.country ?? '' })
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
      await updateUser(editingId, { ...editForm, phone: editForm.phone || null, street: editForm.street || null, zip: editForm.zip || null, city: editForm.city || null, country: editForm.country || null, tenant_ids: editTenantIds } as any)
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
        phone: form.phone || null,
        street: form.street || null,
        zip: form.zip || null,
        city: form.city || null,
        country: form.country || null,
        tenant_ids: selectedTenantIds,
      } as any)
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowForm(false)
      setForm({ email: '', password: '', full_name: '', role: 'tenant', locale: 'de', phone: '', street: '', zip: '', city: '', country: '' })
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
    const bg: Record<string, string> = { admin: '#fee2e2', operator: '#dbeafe', tenant: '#dcfce7' }
    const fg: Record<string, string> = { admin: '#991b1b', operator: '#1e40af', tenant: '#166534' }
    return (
      <span style={{ display: 'inline-block', background: bg[role] ?? '#f1f5f9', color: fg[role] ?? '#374151', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 }}>
        {role}
      </span>
    )
  }

  const TenantCheckboxes = ({ selected, toggle }: { selected: number[]; toggle: (id: number) => void }) => (
    <div>
      <div style={styles.sectionDivider}>
        <span style={styles.sectionLabel}>{t('users_tenants')}</span>
      </div>
      <div style={styles.checkboxGrid}>
        {tenants.map(c => (
          <label key={c.id} style={styles.checkboxLabel}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name}
          </label>
        ))}
        {tenants.length === 0 && <span style={styles.muted}>{t('users_noTenant')}</span>}
      </div>
    </div>
  )

  return (
    <div>
      <style>{INLINE_STYLES}</style>

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
        <div style={styles.successBanner}>
          {t('users_inviteSuccess')} <strong>{inviteSuccess}</strong>
        </div>
      )}

      {showInviteForm && (
        <div style={styles.formCard}>
          <div style={styles.formHeader}>
            <h4 style={styles.formTitle}>{t('users_inviteTitle')}</h4>
          </div>
          <form onSubmit={handleInvite}>
            {inviteError && <div style={styles.error}>{inviteError}</div>}
            <div style={styles.formBody}>
              <div style={styles.grid}>
                <label style={styles.label}>{t('email')} <input className="user-input" type="email" value={inviteForm.email} onChange={e => setInviteField('email', e.target.value)} required style={styles.input} /></label>
                <label style={styles.label}>{t('users_fullName')} <input className="user-input" value={inviteForm.full_name} onChange={e => setInviteField('full_name', e.target.value)} required style={styles.input} /></label>
                <label style={styles.label}>
                  {t('role')}
                  <Select value={inviteForm.role} onChange={v => setInviteField('role', v)} style={styles.input}
                    options={[{ value: 'admin', label: 'admin' }, { value: 'operator', label: 'operator' }, { value: 'tenant', label: 'tenant' }]} />
                </label>
                <label style={styles.label}>
                  {t('users_locale')}
                  <Select value={inviteForm.locale} onChange={v => setInviteField('locale', v)} style={styles.input}
                    options={[{ value: 'de', label: t('locale_de') }, { value: 'en', label: t('locale_en') }]} />
                </label>
              </div>
              <TenantCheckboxes selected={inviteTenantIds} toggle={toggleInviteTenant} />
            </div>
            <div style={styles.formFooter}>
              <button type="button" onClick={() => setShowInviteForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
              <button type="submit" disabled={inviting} style={styles.btnPrimary}>{inviting ? t('saving') : t('users_invite')}</button>
            </div>
          </form>
        </div>
      )}

      {showForm && (
        <div style={styles.formCard}>
          <div style={styles.formHeader}>
            <h4 style={styles.formTitle}>{t('users_newTitle')}</h4>
          </div>
          <form onSubmit={handleSubmit}>
            {error && <div style={styles.error}>{error}</div>}
            <div style={styles.formBody}>
              <div style={styles.grid}>
                <label style={styles.label}>{t('email')} <input className="user-input" type="email" value={form.email} onChange={e => setField('email', e.target.value)} required style={styles.input} /></label>
                <label style={styles.label}>{t('login_password')} <input className="user-input" type="password" value={form.password} onChange={e => setField('password', e.target.value)} required minLength={8} style={styles.input} /></label>
                <label style={styles.label}>{t('users_fullName')} <input className="user-input" value={form.full_name} onChange={e => setField('full_name', e.target.value)} required style={styles.input} /></label>
                <label style={styles.label}>
                  {t('role')}
                  <Select value={form.role} onChange={v => setField('role', v)} style={styles.input}
                    options={[{ value: 'admin', label: 'admin' }, { value: 'operator', label: 'operator' }, { value: 'tenant', label: 'tenant' }]} />
                </label>
                <label style={styles.label}>
                  {t('users_locale')}
                  <Select value={form.locale} onChange={v => setField('locale', v)} style={styles.input}
                    options={[{ value: 'de', label: t('locale_de') }, { value: 'en', label: t('locale_en') }]} />
                </label>
              </div>

              <div style={styles.sectionDivider}>
                <span style={styles.sectionLabel}>{t('users_addressSection')}</span>
              </div>
              <div style={styles.grid}>
                <label style={styles.label}>{t('users_phone')} <input className="user-input" value={form.phone} onChange={e => setField('phone', e.target.value)} style={styles.input} /></label>
                <label style={{ ...styles.label, gridColumn: '1 / -1' }}>{t('users_street')} <input className="user-input" value={form.street} onChange={e => setField('street', e.target.value)} style={styles.input} /></label>
                <label style={styles.label}>{t('users_zip')} <input className="user-input" value={form.zip} onChange={e => setField('zip', e.target.value)} style={styles.input} /></label>
                <label style={styles.label}>{t('users_city')} <input className="user-input" value={form.city} onChange={e => setField('city', e.target.value)} style={styles.input} /></label>
                <label style={styles.label}>{t('users_country')} <input className="user-input" value={form.country} onChange={e => setField('country', e.target.value)} maxLength={2} placeholder="DE" style={styles.input} /></label>
              </div>

              <TenantCheckboxes selected={selectedTenantIds} toggle={toggleTenant} />
            </div>
            <div style={styles.formFooter}>
              <button type="button" onClick={() => setShowForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
              <button type="submit" disabled={saving} style={styles.btnPrimary}>{saving ? t('creating') : t('create')}</button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? <p style={{ padding: '.75rem', color: '#64748b', fontSize: '.8125rem' }}>{t('loading')}</p> : (
        <div style={styles.card}>
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
                <th style={{ ...styles.th, width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: User) => (
                <React.Fragment key={u.id}>
                  <tr className="user-row">
                    <td style={styles.td}>
                      <span style={{ fontWeight: 600 }}>{u.email}</span>
                    </td>
                    <td style={styles.td}>{u.full_name}</td>
                    <td style={styles.td}>{roleBadge(u.role)}</td>
                    <td style={styles.tdMuted}>{tenantNames(u.tenant_ids ?? [])}</td>
                    <td style={styles.td}>
                      {u.is_active
                        ? <span style={styles.badgeActive}>Active</span>
                        : <span style={styles.badgeInactive}>Inactive</span>}
                    </td>
                    <td style={styles.tdMuted}>{u.locale === 'en' ? t('locale_en') : t('locale_de')}</td>
                    <td style={styles.tdMuted}>{new Date(u.created_at).toLocaleDateString()}</td>
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
                      <td colSpan={8} style={styles.editPanel}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 600 }}>
                          {editError && <div style={{ ...styles.error, margin: 0 }}>{editError}</div>}
                          <div style={styles.grid}>
                            <label style={styles.label}>{t('email')} <input className="user-input" type="email" value={editForm.email} onChange={e => setEditField('email', e.target.value)} style={styles.input} /></label>
                            <label style={styles.label}>{t('users_fullName')} <input className="user-input" value={editForm.full_name} onChange={e => setEditField('full_name', e.target.value)} style={styles.input} /></label>
                            <label style={styles.label}>
                              {t('role')}
                              <Select value={editForm.role} onChange={v => setEditField('role', v)} style={styles.input}
                                options={[{ value: 'admin', label: 'admin' }, { value: 'operator', label: 'operator' }, { value: 'tenant', label: 'tenant' }]} />
                            </label>
                            <label style={styles.label}>
                              {t('users_locale')}
                              <Select value={editForm.locale} onChange={v => setEditField('locale', v)} style={styles.input}
                                options={[{ value: 'de', label: t('locale_de') }, { value: 'en', label: t('locale_en') }]} />
                            </label>
                          </div>

                          <div style={styles.sectionDivider}>
                            <span style={styles.sectionLabel}>{t('users_addressSection')}</span>
                          </div>
                          <div style={styles.grid}>
                            <label style={styles.label}>{t('users_phone')} <input className="user-input" value={editForm.phone} onChange={e => setEditField('phone', e.target.value)} style={styles.input} /></label>
                            <label style={{ ...styles.label, gridColumn: '1 / -1' }}>{t('users_street')} <input className="user-input" value={editForm.street} onChange={e => setEditField('street', e.target.value)} style={styles.input} /></label>
                            <label style={styles.label}>{t('users_zip')} <input className="user-input" value={editForm.zip} onChange={e => setEditField('zip', e.target.value)} style={styles.input} /></label>
                            <label style={styles.label}>{t('users_city')} <input className="user-input" value={editForm.city} onChange={e => setEditField('city', e.target.value)} style={styles.input} /></label>
                            <label style={styles.label}>{t('users_country')} <input className="user-input" value={editForm.country} onChange={e => setEditField('country', e.target.value)} maxLength={2} placeholder="DE" style={styles.input} /></label>
                          </div>

                          <label style={styles.checkboxLabel}>
                            <input type="checkbox" checked={editForm.is_active} onChange={e => setEditField('is_active', e.target.checked)} />
                            <span style={{ fontWeight: 500 }}>{t('active')}</span>
                          </label>

                          <TenantCheckboxes selected={editTenantIds} toggle={toggleEditTenant} />

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
                <tr key={`invite-${inv.id}`} style={{ opacity: 0.7 }}>
                  <td style={styles.td}>{inv.email}</td>
                  <td style={styles.tdMuted}>{inv.full_name || <span style={styles.muted}>—</span>}</td>
                  <td style={styles.td}>{roleBadge(inv.role)}</td>
                  <td style={styles.tdMuted}>{tenantNames(inv.tenant_ids ?? [])}</td>
                  <td style={styles.td}>
                    <span style={styles.badgePending}>
                      {t('users_pendingInvite')}
                    </span>
                  </td>
                  <td style={styles.tdMuted}>{inv.locale === 'en' ? t('locale_en') : t('locale_de')}</td>
                  <td style={styles.tdMuted}>{new Date(inv.created_at).toLocaleDateString()}</td>
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
              {users.length === 0 && invites.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '.8125rem' }}>No users yet</td></tr>
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
  successBanner: { background: '#dcfce7', color: '#15803d', padding: '.5rem .75rem', borderRadius: 6, fontSize: '.8125rem', marginBottom: '.75rem', border: '1px solid #bbf7d0' },

  // Section dividers
  sectionDivider: { borderBottom: '1px solid #f1f5f9', paddingBottom: 2, marginTop: '.25rem' },
  sectionLabel: { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' },

  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  checkboxGrid: { display: 'flex', flexWrap: 'wrap', gap: '.5rem .75rem', marginTop: '.375rem' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.8125rem', cursor: 'pointer' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8125rem', fontWeight: 500, color: '#374151' },
  input: { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },
  actions: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },

  // Table
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '.04em' },
  td: { padding: '.5rem .75rem', fontSize: '.8125rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9' },
  tdMuted: { padding: '.5rem .75rem', fontSize: '.8125rem', color: '#64748b', borderBottom: '1px solid #f1f5f9' },
  editPanel: { padding: '.75rem', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' },
  muted: { color: '#94a3b8' },

  // Badges
  badgeActive: { display: 'inline-block', background: '#dcfce7', color: '#15803d', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  badgeInactive: { display: 'inline-block', background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  badgePending: { display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },

  // Buttons
  btnPrimary: { padding: '.3125rem .75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.3125rem .75rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer', color: '#374151' },
  btnEdit:        { padding: '.25rem .5rem', background: '#fff', border: '1px solid #2563eb', color: '#2563eb', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer', fontWeight: 500 },
  btnImpersonate: { padding: '.25rem .5rem', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer' },
  btnRevoke:      { padding: '.25rem .5rem', background: '#fff', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer' },
}
