import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, updateUser, deleteUser, restoreUser, inviteUser, getInvites, revokeInvite, getTenants, adminResetUserPassword, type User, type PendingInvite } from '../api/client'
import Select from '../components/Select'
import Dropdown, { DropdownItem, DropdownEmpty } from '../components/Dropdown'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import ListPage from '../components/ListPage'
import ListTable from '../components/ListTable'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

const INLINE_STYLES = `
  .user-row { transition: background 0.08s; }
  .user-row:hover td { background: #f1f5f9; }
  .user-input:focus { border-color: #2563eb !important; outline: none; box-shadow: 0 0 0 2px #bfdbfe; }
`

const ROLE_OPTIONS = ['admin', 'operator', 'tenant'] as const
type RoleFilter = '' | typeof ROLE_OPTIONS[number]
type StatusFilter = 'active' | 'deleted'

const USER_FILTER_DEFAULTS = {
  search:        '',
  role:          '' as RoleFilter,
  tenantFilter:  [] as number[],
  status:        'active' as StatusFilter,
}

export default function UsersPage() {
  const { t } = useI18n()
  const { user: currentUser, impersonate } = useAuth()
  const qc = useQueryClient()

  const {
    filters, setFilter, persist, setPersist, clear: clearFilters, hasActive,
  } = usePersistedFilters('users', USER_FILTER_DEFAULTS)
  const { search, role, tenantFilter, status } = filters
  const showDeleted = status === 'deleted'

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

  const [resetSuccess, setResetSuccess] = useState<string | null>(null)
  const [resettingId, setResettingId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ email: '', full_name: '', role: 'tenant', locale: 'de', is_active: true, phone: '', street: '', zip: '', city: '', country: '' })
  const [editTenantIds, setEditTenantIds] = useState<number[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', showDeleted ? 'deleted' : 'active'],
    queryFn: () => getUsers({ deleted: showDeleted }).then(r => r.data),
  })

  const { data: invites = [] } = useQuery({
    queryKey: ['invites'],
    queryFn: () => getInvites().then(r => r.data),
    enabled: !showDeleted,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (q && !u.email.toLowerCase().includes(q) && !u.full_name.toLowerCase().includes(q)) return false
      if (role && u.role !== role) return false
      if (tenantFilter.length > 0 && !tenantFilter.some(id => (u.tenant_ids ?? []).includes(id))) return false
      return true
    })
  }, [users, search, role, tenantFilter])

  const filteredInvites = useMemo(() => {
    if (showDeleted) return [] as PendingInvite[]
    const q = search.trim().toLowerCase()
    return invites.filter(inv => {
      if (q && !inv.email.toLowerCase().includes(q) && !(inv.full_name ?? '').toLowerCase().includes(q)) return false
      if (role && inv.role !== role) return false
      if (tenantFilter.length > 0 && !tenantFilter.some(id => (inv.tenant_ids ?? []).includes(id))) return false
      return true
    })
  }, [invites, showDeleted, search, role, tenantFilter])

  function setField(key: string, value: string) { setForm(f => ({ ...f, [key]: value })) }
  function toggleTenant(id: number) {
    setSelectedTenantIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  }
  function setInviteField(key: string, value: string) { setInviteForm(f => ({ ...f, [key]: value })) }
  function toggleInviteTenant(id: number) {
    setInviteTenantIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  }

  function startEdit(u: User) {
    setEditingId(u.id)
    setEditForm({ email: u.email, full_name: u.full_name, role: u.role, locale: u.locale, is_active: !!u.is_active, phone: u.phone ?? '', street: u.street ?? '', zip: u.zip ?? '', city: u.city ?? '', country: u.country ?? '' })
    setEditTenantIds(u.tenant_ids ?? [])
    setEditError(null)
  }
  function setEditField(key: string, value: string | boolean) { setEditForm(f => ({ ...f, [key]: value })) }
  function toggleEditTenant(id: number) {
    setEditTenantIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  }

  async function handleUpdate() {
    if (!editingId) return
    setEditSaving(true); setEditError(null)
    try {
      await updateUser(editingId, { ...editForm, phone: editForm.phone || null, street: editForm.street || null, zip: editForm.zip || null, city: editForm.city || null, country: editForm.country || null, tenant_ids: editTenantIds } as any)
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditingId(null)
    } catch (err: any) {
      setEditError(formatApiError(err))
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
      setInviteError(formatApiError(err))
    } finally {
      setInviting(false)
    }
  }

  async function handleResetPassword(u: User) {
    if (!confirm(t('users_resetPasswordConfirm', u.email))) return
    setResettingId(u.id)
    setResetSuccess(null)
    try {
      await adminResetUserPassword(u.id)
      setResetSuccess(u.email)
    } catch {
      setResetSuccess(null)
    } finally {
      setResettingId(null)
    }
  }

  async function handleDelete(u: User) {
    if (!confirm(t('users_deleteConfirm', u.email))) return
    setBusyId(u.id)
    try {
      await deleteUser(u.id)
      qc.invalidateQueries({ queryKey: ['users'] })
      if (editingId === u.id) setEditingId(null)
    } finally {
      setBusyId(null)
    }
  }

  async function handleRestore(u: User) {
    setBusyId(u.id)
    try {
      await restoreUser(u.id)
      qc.invalidateQueries({ queryKey: ['users'] })
    } finally {
      setBusyId(null)
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
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const tenantNames = (ids: number[]) => {
    if (!ids.length) return <span style={localStyles.muted}>—</span>
    return ids.map(id => {
      const c = tenants.find(c => c.id === id)
      return c ? c.name : `#${id}`
    }).join(', ')
  }

  const roleBadge = (r: string) => {
    const bg: Record<string, string> = { admin: '#fee2e2', operator: '#dbeafe', tenant: '#dcfce7' }
    const fg: Record<string, string> = { admin: '#991b1b', operator: '#1e40af', tenant: '#166534' }
    return (
      <span style={{ display: 'inline-block', background: bg[r] ?? '#f1f5f9', color: fg[r] ?? '#374151', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 }}>
        {r}
      </span>
    )
  }

  const TenantCheckboxes = ({ selected, toggle }: { selected: number[]; toggle: (id: number) => void }) => (
    <div>
      <div style={localStyles.sectionDivider}>
        <span style={localStyles.sectionLabel}>{t('users_tenants')}</span>
      </div>
      <div style={localStyles.checkboxGrid}>
        {tenants.map(c => (
          <label key={c.id} style={localStyles.checkboxLabel}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name}
          </label>
        ))}
        {tenants.length === 0 && <span style={localStyles.muted}>{t('users_noTenant')}</span>}
      </div>
    </div>
  )

  // Filter bar building blocks ----------------------------------------------
  const ROLE_FILTER_OPTIONS: { value: RoleFilter; label: string }[] = [
    { value: 'admin',    label: 'admin' },
    { value: 'operator', label: 'operator' },
    { value: 'tenant',   label: 'tenant' },
  ]
  const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'active',  label: t('users_active') },
    { value: 'deleted', label: t('users_deleted') },
  ]
  const roleLabel = ROLE_FILTER_OPTIONS.find(o => o.value === role)?.label ?? t('users_allRoles')
  const statusLabel = STATUS_OPTIONS.find(o => o.value === status)?.label ?? t('users_active')

  function tenantButtonLabel() {
    if (tenantFilter.length === 0) return t('domains_allTenants')
    if (tenantFilter.length === 1) return tenants.find(c => c.id === tenantFilter[0])?.name ?? t('domains_allTenants')
    return `${tenantFilter.length} ${t('domains_tenantsSelected')}`
  }
  function toggleFilterTenant(id: number) {
    setFilter('tenantFilter', tenantFilter.includes(id) ? tenantFilter.filter(x => x !== id) : [...tenantFilter, id])
  }
  const [tenantSearch, setTenantSearch] = useState('')
  const filteredTenantOptions = tenants.filter(c => c.name.toLowerCase().includes(tenantSearch.toLowerCase()))

  const totalCount = (showDeleted ? users.length : users.length + invites.length)
  const visibleCount = filteredUsers.length + filteredInvites.length
  const filtersActive = !!(search || role || tenantFilter.length > 0)

  return (
    <ListPage>
      <style>{INLINE_STYLES}</style>

      {showDeleted && (
        <div style={localStyles.infoBanner}>{t('users_deletedBanner')}</div>
      )}

      {inviteSuccess && (
        <div style={localStyles.successBanner}>
          {t('users_inviteSuccess')} <strong>{inviteSuccess}</strong>
        </div>
      )}

      {resetSuccess && (
        <div style={localStyles.successBanner}>
          {t('users_resetPasswordSent')} <strong>{resetSuccess}</strong>
        </div>
      )}

      {!showDeleted && showInviteForm && (
        <div style={localStyles.formCard}>
          <div style={localStyles.formHeader}>
            <h4 style={localStyles.formTitle}>{t('users_inviteTitle')}</h4>
          </div>
          <form onSubmit={handleInvite}>
            {inviteError && <div style={localStyles.error}>{inviteError}</div>}
            <div style={localStyles.formBody}>
              <div style={localStyles.grid}>
                <label style={localStyles.label}>{t('email')} <input className="user-input" type="email" value={inviteForm.email} onChange={e => setInviteField('email', e.target.value)} required style={localStyles.input} /></label>
                <label style={localStyles.label}>{t('users_fullName')} <input className="user-input" value={inviteForm.full_name} onChange={e => setInviteField('full_name', e.target.value)} required style={localStyles.input} /></label>
                <label style={localStyles.label}>
                  {t('role')}
                  <Select value={inviteForm.role} onChange={v => setInviteField('role', v)} style={localStyles.input}
                    options={[{ value: 'admin', label: 'admin' }, { value: 'operator', label: 'operator' }, { value: 'tenant', label: 'tenant' }]} />
                </label>
                <label style={localStyles.label}>
                  {t('users_locale')}
                  <Select value={inviteForm.locale} onChange={v => setInviteField('locale', v)} style={localStyles.input}
                    options={[{ value: 'de', label: t('locale_de') }, { value: 'en', label: t('locale_en') }]} />
                </label>
              </div>
              <TenantCheckboxes selected={inviteTenantIds} toggle={toggleInviteTenant} />
            </div>
            <div style={localStyles.formFooter}>
              <button type="button" onClick={() => setShowInviteForm(false)} style={s.secondaryBtn}>{t('cancel')}</button>
              <button type="submit" disabled={inviting} style={s.actionBtn}>{inviting ? t('saving') : t('users_invite')}</button>
            </div>
          </form>
        </div>
      )}

      {!showDeleted && showForm && (
        <div style={localStyles.formCard}>
          <div style={localStyles.formHeader}>
            <h4 style={localStyles.formTitle}>{t('users_newTitle')}</h4>
          </div>
          <form onSubmit={handleSubmit}>
            {error && <div style={localStyles.error}>{error}</div>}
            <div style={localStyles.formBody}>
              <div style={localStyles.grid}>
                <label style={localStyles.label}>{t('email')} <input className="user-input" type="email" value={form.email} onChange={e => setField('email', e.target.value)} required style={localStyles.input} /></label>
                <label style={localStyles.label}>{t('login_password')} <input className="user-input" type="password" value={form.password} onChange={e => setField('password', e.target.value)} required minLength={8} style={localStyles.input} /></label>
                <label style={localStyles.label}>{t('users_fullName')} <input className="user-input" value={form.full_name} onChange={e => setField('full_name', e.target.value)} required style={localStyles.input} /></label>
                <label style={localStyles.label}>
                  {t('role')}
                  <Select value={form.role} onChange={v => setField('role', v)} style={localStyles.input}
                    options={[{ value: 'admin', label: 'admin' }, { value: 'operator', label: 'operator' }, { value: 'tenant', label: 'tenant' }]} />
                </label>
                <label style={localStyles.label}>
                  {t('users_locale')}
                  <Select value={form.locale} onChange={v => setField('locale', v)} style={localStyles.input}
                    options={[{ value: 'de', label: t('locale_de') }, { value: 'en', label: t('locale_en') }]} />
                </label>
              </div>

              <div style={localStyles.sectionDivider}>
                <span style={localStyles.sectionLabel}>{t('users_addressSection')}</span>
              </div>
              <div style={localStyles.grid}>
                <label style={localStyles.label}>{t('users_phone')} <input className="user-input" value={form.phone} onChange={e => setField('phone', e.target.value)} style={localStyles.input} /></label>
                <label style={{ ...localStyles.label, gridColumn: '1 / -1' }}>{t('users_street')} <input className="user-input" value={form.street} onChange={e => setField('street', e.target.value)} style={localStyles.input} /></label>
                <label style={localStyles.label}>{t('users_zip')} <input className="user-input" value={form.zip} onChange={e => setField('zip', e.target.value)} style={localStyles.input} /></label>
                <label style={localStyles.label}>{t('users_city')} <input className="user-input" value={form.city} onChange={e => setField('city', e.target.value)} style={localStyles.input} /></label>
                <label style={localStyles.label}>{t('users_country')} <input className="user-input" value={form.country} onChange={e => setField('country', e.target.value)} maxLength={2} placeholder="DE" style={localStyles.input} /></label>
              </div>

              <TenantCheckboxes selected={selectedTenantIds} toggle={toggleTenant} />
            </div>
            <div style={localStyles.formFooter}>
              <button type="button" onClick={() => setShowForm(false)} style={s.secondaryBtn}>{t('cancel')}</button>
              <button type="submit" disabled={saving} style={s.actionBtn}>{saving ? t('creating') : t('create')}</button>
            </div>
          </form>
        </div>
      )}

        {/* Stats / count bar */}
        <FilterBar>
          <span style={localStyles.countPill}>
            {filtersActive
              ? t('users_filteredCount', visibleCount, totalCount)
              : `${totalCount} ${t('users_title').toLowerCase()}`}
          </span>
          {!showDeleted && invites.length > 0 && (
            <span style={{ fontSize: '.8125rem', color: '#64748b' }}>
              {invites.length} {t('users_pendingInvite')}
            </span>
          )}
        </FilterBar>

        {/* Filter bar */}
        <FilterBar>
          <SearchInput
            value={search}
            onChange={v => setFilter('search', v)}
            placeholder={t('users_searchPlaceholder')}
          />

          <Dropdown
            label={
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: role ? '#111827' : '#9ca3af' }}>
                {roleLabel}
              </span>
            }
            active={!!role}
            onClear={() => setFilter('role', '' as RoleFilter)}
            width={160}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setFilter('role', '' as RoleFilter); close() }}>
                  <span style={{ color: '#6b7280' }}>{t('users_allRoles')}</span>
                </DropdownItem>
                {ROLE_FILTER_OPTIONS.map(opt => (
                  <DropdownItem key={opt.value} onSelect={() => { setFilter('role', opt.value); close() }}>
                    {opt.label}
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>

          {tenants.length > 1 && (
            <Dropdown
              label={
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tenantFilter.length > 0 ? '#111827' : '#9ca3af' }}>
                  {tenantButtonLabel()}
                </span>
              }
              active={tenantFilter.length > 0}
              onClear={() => { setFilter('tenantFilter', []); setTenantSearch('') }}
              width={200}
            >
              {() => (
                <>
                  <div style={{ padding: '4px 8px 6px', borderBottom: '1px solid #f3f4f6' }}>
                    <input
                      value={tenantSearch}
                      onChange={e => setTenantSearch(e.target.value)}
                      onMouseDown={e => e.stopPropagation()}
                      placeholder={t('domains_searchTenants')}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '.25rem .5rem', border: '1px solid #e5e7eb', borderRadius: 3, fontSize: '.8125rem', outline: 'none' }}
                    />
                  </div>
                  {filteredTenantOptions.map(c => (
                    <DropdownItem key={c.id} onSelect={() => toggleFilterTenant(c.id)} gap=".5rem">
                      <input type="checkbox" checked={tenantFilter.includes(c.id)} readOnly style={{ pointerEvents: 'none', flexShrink: 0 }} />
                      {c.name}
                    </DropdownItem>
                  ))}
                  {filteredTenantOptions.length === 0 && (
                    <DropdownEmpty>{t('domains_noTenantMatch')}</DropdownEmpty>
                  )}
                </>
              )}
            </Dropdown>
          )}

          <Dropdown
            label={
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#111827' }}>
                {statusLabel}
              </span>
            }
            active={status !== 'active'}
            onClear={() => { setFilter('status', 'active' as StatusFilter); setEditingId(null); setShowForm(false); setShowInviteForm(false) }}
            width={140}
          >
            {close => (
              <>
                {STATUS_OPTIONS.map(opt => (
                  <DropdownItem
                    key={opt.value}
                    onSelect={() => {
                      setFilter('status', opt.value)
                      setEditingId(null); setShowForm(false); setShowInviteForm(false)
                      close()
                    }}
                  >
                    {opt.label}
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>

          <FilterPersistControls
            persist={persist}
            setPersist={setPersist}
            onClear={clearFilters}
            hasActive={hasActive}
            style={{ marginLeft: 'auto' }}
          />

          {!showDeleted && (
            <>
              <button
                onClick={() => { setShowInviteForm(v => !v); setShowForm(false); setInviteSuccess(null) }}
                style={s.secondaryBtn}
              >
                {t('users_invite')}
              </button>
              <button
                onClick={() => { setShowForm(v => !v); setShowInviteForm(false) }}
                style={s.actionBtn}
              >
                {t('users_add')}
              </button>
            </>
          )}
        </FilterBar>

        {/* Table */}
        <ListTable>
          {isLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>{t('email')}</th>
                  <th style={s.th}>{t('name')}</th>
                  <th style={s.th}>{t('role')}</th>
                  <th style={s.th}>{t('users_tenants')}</th>
                  <th style={s.th}>{t('active')}</th>
                  <th style={s.th}>{t('users_locale')}</th>
                  <th style={s.th}>{showDeleted ? t('users_deletedAt') : t('created')}</th>
                  <th style={{ ...s.th, width: 1 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u: User) => (
                  <React.Fragment key={u.id}>
                    <tr className="user-row">
                      <td style={s.td}>
                        <span style={{ fontWeight: 600 }}>{u.email}</span>
                      </td>
                      <td style={s.td}>{u.full_name}</td>
                      <td style={s.td}>{roleBadge(u.role)}</td>
                      <td style={{ ...s.td, color: '#64748b' }}>{tenantNames(u.tenant_ids ?? [])}</td>
                      <td style={s.td}>
                        {u.is_active
                          ? <span style={localStyles.badgeActive}>Active</span>
                          : <span style={localStyles.badgeInactive}>Inactive</span>}
                      </td>
                      <td style={{ ...s.td, color: '#64748b' }}>{u.locale === 'en' ? t('locale_en') : t('locale_de')}</td>
                      <td style={{ ...s.td, color: '#64748b' }}>
                        {showDeleted
                          ? (u.deleted_at ? new Date(u.deleted_at).toLocaleDateString() : '—')
                          : new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '.375rem' }}>
                          {showDeleted ? (
                            <button
                              onClick={() => handleRestore(u)}
                              disabled={busyId === u.id}
                              style={s.actionBtn}
                            >
                              {busyId === u.id ? '…' : t('users_restore')}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => editingId === u.id ? setEditingId(null) : startEdit(u)}
                                style={editingId === u.id ? s.secondaryBtn : localStyles.btnEdit}
                              >
                                {editingId === u.id ? t('cancel') : t('edit')}
                              </button>
                              {currentUser?.role === 'admin' && u.id !== currentUser.sub && (
                                <button
                                  onClick={() => impersonate(u.id)}
                                  style={localStyles.btnImpersonate}
                                  title={t('users_impersonate')}
                                >
                                  {t('users_impersonate')}
                                </button>
                              )}
                              {currentUser?.role === 'admin' && (
                                <button
                                  onClick={() => handleResetPassword(u)}
                                  disabled={resettingId === u.id}
                                  style={localStyles.btnReset}
                                  title={t('users_resetPassword')}
                                >
                                  {resettingId === u.id ? '…' : t('users_resetPassword')}
                                </button>
                              )}
                              {currentUser?.role === 'admin' && u.id !== currentUser.sub && (
                                <button
                                  onClick={() => handleDelete(u)}
                                  disabled={busyId === u.id}
                                  style={localStyles.btnDelete}
                                  title={t('users_delete')}
                                >
                                  {busyId === u.id ? '…' : t('users_delete')}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {!showDeleted && editingId === u.id && (
                      <tr key={`${u.id}-edit`}>
                        <td colSpan={8} style={localStyles.editPanel}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', maxWidth: 600 }}>
                            {editError && <div style={{ ...localStyles.error, margin: 0 }}>{editError}</div>}
                            <div style={localStyles.grid}>
                              <label style={localStyles.label}>{t('email')} <input className="user-input" type="email" value={editForm.email} onChange={e => setEditField('email', e.target.value)} style={localStyles.input} /></label>
                              <label style={localStyles.label}>{t('users_fullName')} <input className="user-input" value={editForm.full_name} onChange={e => setEditField('full_name', e.target.value)} style={localStyles.input} /></label>
                              <label style={localStyles.label}>
                                {t('role')}
                                <Select value={editForm.role} onChange={v => setEditField('role', v)} style={localStyles.input}
                                  options={[{ value: 'admin', label: 'admin' }, { value: 'operator', label: 'operator' }, { value: 'tenant', label: 'tenant' }]} />
                              </label>
                              <label style={localStyles.label}>
                                {t('users_locale')}
                                <Select value={editForm.locale} onChange={v => setEditField('locale', v)} style={localStyles.input}
                                  options={[{ value: 'de', label: t('locale_de') }, { value: 'en', label: t('locale_en') }]} />
                              </label>
                            </div>

                            <div style={localStyles.sectionDivider}>
                              <span style={localStyles.sectionLabel}>{t('users_addressSection')}</span>
                            </div>
                            <div style={localStyles.grid}>
                              <label style={localStyles.label}>{t('users_phone')} <input className="user-input" value={editForm.phone} onChange={e => setEditField('phone', e.target.value)} style={localStyles.input} /></label>
                              <label style={{ ...localStyles.label, gridColumn: '1 / -1' }}>{t('users_street')} <input className="user-input" value={editForm.street} onChange={e => setEditField('street', e.target.value)} style={localStyles.input} /></label>
                              <label style={localStyles.label}>{t('users_zip')} <input className="user-input" value={editForm.zip} onChange={e => setEditField('zip', e.target.value)} style={localStyles.input} /></label>
                              <label style={localStyles.label}>{t('users_city')} <input className="user-input" value={editForm.city} onChange={e => setEditField('city', e.target.value)} style={localStyles.input} /></label>
                              <label style={localStyles.label}>{t('users_country')} <input className="user-input" value={editForm.country} onChange={e => setEditField('country', e.target.value)} maxLength={2} placeholder="DE" style={localStyles.input} /></label>
                            </div>

                            <label style={localStyles.checkboxLabel}>
                              <input type="checkbox" checked={editForm.is_active} onChange={e => setEditField('is_active', e.target.checked)} />
                              <span style={{ fontWeight: 500 }}>{t('active')}</span>
                            </label>

                            <TenantCheckboxes selected={editTenantIds} toggle={toggleEditTenant} />

                            <div style={localStyles.actions}>
                              <button type="button" onClick={() => setEditingId(null)} style={s.secondaryBtn}>{t('cancel')}</button>
                              <button type="button" onClick={handleUpdate} disabled={editSaving} style={s.actionBtn}>{editSaving ? t('saving') : t('save')}</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {filteredInvites.map((inv: PendingInvite) => (
                  <tr key={`invite-${inv.id}`} className="user-row" style={{ opacity: 0.7 }}>
                    <td style={s.td}>{inv.email}</td>
                    <td style={{ ...s.td, color: '#64748b' }}>{inv.full_name || <span style={localStyles.muted}>—</span>}</td>
                    <td style={s.td}>{roleBadge(inv.role)}</td>
                    <td style={{ ...s.td, color: '#64748b' }}>{tenantNames(inv.tenant_ids ?? [])}</td>
                    <td style={s.td}>
                      <span style={localStyles.badgePending}>
                        {t('users_pendingInvite')}
                      </span>
                    </td>
                    <td style={{ ...s.td, color: '#64748b' }}>{inv.locale === 'en' ? t('locale_en') : t('locale_de')}</td>
                    <td style={{ ...s.td, color: '#64748b' }}>{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td style={s.td}>
                      <button
                        style={localStyles.btnRevoke}
                        onClick={() => revokeInvite(inv.id).then(() => qc.invalidateQueries({ queryKey: ['invites'] }))}
                      >
                        {t('users_revokeInvite')}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && filteredInvites.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '.8125rem' }}>
                    {showDeleted ? t('users_noDeletedUsers') : 'No users yet'}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </ListTable>
    </ListPage>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  // Form (preserved from prior look — only list/filter pieces moved to shared)
  formCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, margin: '.75rem .75rem 0', flexShrink: 0, maxHeight: '70vh', overflowY: 'auto' },
  formHeader: { padding: '.625rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  formTitle: { margin: 0, fontSize: '.875rem', fontWeight: 600, color: '#1e293b' },
  formBody: { padding: '.75rem', display: 'flex', flexDirection: 'column', gap: '.75rem' },
  formFooter: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', padding: '.625rem .75rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0' },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem', margin: '.75rem .75rem 0' },
  successBanner: { background: '#dcfce7', color: '#15803d', padding: '.5rem .75rem', fontSize: '.8125rem', borderBottom: '1px solid #bbf7d0', flexShrink: 0 },
  infoBanner:    { background: '#fef3c7', color: '#92400e', padding: '.5rem .75rem', fontSize: '.8125rem', borderBottom: '1px solid #fde68a', flexShrink: 0 },

  sectionDivider: { borderBottom: '1px solid #f1f5f9', paddingBottom: 2, marginTop: '.25rem' },
  sectionLabel: { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' },

  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  checkboxGrid: { display: 'flex', flexWrap: 'wrap', gap: '.5rem .75rem', marginTop: '.375rem' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.8125rem', cursor: 'pointer' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8125rem', fontWeight: 500, color: '#374151' },
  input: { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },
  actions: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },

  editPanel: { padding: '.75rem', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' },
  muted: { color: '#94a3b8' },

  countPill: { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },

  badgeActive:   { display: 'inline-block', background: '#dcfce7', color: '#15803d', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  badgeInactive: { display: 'inline-block', background: '#f1f5f9', color: '#64748b', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },
  badgePending:  { display: 'inline-block', background: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600 },

  btnEdit:        { padding: '.25rem .5rem', background: '#fff', border: '1px solid #2563eb', color: '#2563eb', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer', fontWeight: 500 },
  btnImpersonate: { padding: '.25rem .5rem', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer' },
  btnReset:       { padding: '.25rem .5rem', background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer' },
  btnRevoke:      { padding: '.25rem .5rem', background: '#fff', border: '1px solid #e2e8f0', color: '#64748b', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer' },
  btnDelete:      { padding: '.25rem .5rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, fontSize: '.75rem', fontWeight: 500, cursor: 'pointer' },
}
