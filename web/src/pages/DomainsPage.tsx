import { useRef, useState } from 'react'
import { Link, useNavigate, useMatch } from 'react-router-dom'
import { checkNavGuard } from '../hooks/navGuard'
import { useQuery } from '@tanstack/react-query'
import { getDomains, createDomain, getCustomers, getLabelSuggestions, restoreDomain, type Domain } from '../api/client'
import LabelChip from '../components/LabelChip'
import ZoneStatusBadge from '../components/ZoneStatusBadge'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

const INLINE_STYLES = `
  @keyframes spin { to { transform: rotate(360deg); } }
  .domain-row { cursor: pointer; }
  .domain-row:hover td { background: #f8faff !important; }
`

const COOKIE_KEY = 'infodns_domain_cols'
const ALL_COLUMNS = ['fqdn', 'customer', 'status', 'zone', 'labels', 'serial', 'lastRendered'] as const
type ColId = typeof ALL_COLUMNS[number]
const DEFAULT_COLUMNS: ColId[] = ['fqdn', 'customer', 'zone', 'labels']

function readColsCookie(): ColId[] {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`))
  if (!m) return DEFAULT_COLUMNS
  try {
    const parsed = JSON.parse(decodeURIComponent(m[1])) as string[]
    const valid = parsed.filter((c): c is ColId => (ALL_COLUMNS as readonly string[]).includes(c))
    return valid.length ? valid : DEFAULT_COLUMNS
  } catch { return DEFAULT_COLUMNS }
}

function writeColsCookie(cols: ColId[]) {
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(JSON.stringify(cols))}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

export default function DomainsPage({ condensed = false }: { condensed?: boolean }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const detailMatch = useMatch('/domains/:id')
  const selectedId = detailMatch?.params.id ? Number(detailMatch.params.id) : null
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newFqdn, setNewFqdn] = useState('')
  const [newCustomerId, setNewCustomerId] = useState('')
  const [creating, setCreating] = useState(false)
  const [visibleCols, setVisibleCols] = useState<ColId[]>(readColsCookie)
  const [colDropdownOpen, setColDropdownOpen] = useState(false)
  const colDropdownRef = useRef<HTMLDivElement>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [restoringId, setRestoringId] = useState<number | null>(null)


  const { data: labelSuggestions = [] } = useQuery({
    queryKey: ['label-suggestions'],
    queryFn: () => getLabelSuggestions().then(r => r.data),
    staleTime: 30_000,
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
    enabled: !!user,
  })

  const { data: domains = [], isLoading, error, refetch } = useQuery({
    queryKey: ['domains', search, labelFilter, showDeleted],
    queryFn: () => {
      const params: Record<string, string> = {}
      if (search) params.search = search
      if (labelFilter) params.label = labelFilter
      if (showDeleted) params.show_deleted = 'true'
      return getDomains(Object.keys(params).length ? params : undefined).then(r => r.data)
    },
  })

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      await createDomain({ fqdn: newFqdn, customer_id: Number(newCustomerId) as any })
      setNewFqdn('')
      setNewCustomerId('')
      setShowCreate(false)
      refetch()
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleRestore(id: number) {
    setRestoringId(id)
    try {
      await restoreDomain(id)
      refetch()
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
    } finally {
      setRestoringId(null)
    }
  }

  function toggleCol(col: ColId) {
    setVisibleCols(prev => {
      const next = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
      const result = next.length ? next : prev
      writeColsCookie(result)
      return result
    })
  }

  const colLabels: Record<ColId, string> = {
    fqdn: 'FQDN',
    customer: t('customer'),
    status: t('status'),
    zone: t('domains_zone'),
    labels: t('domains_labels'),
    serial: t('serial'),
    lastRendered: t('domains_lastRendered'),
  }

  const show = (col: ColId) => visibleCols.includes(col)

  if (condensed) {
    return (
      <div style={{ padding: '.75rem' }}>
        <style>{INLINE_STYLES}</style>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.375rem', marginBottom: '.5rem' }}>
          <input
            placeholder={t('domains_searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...styles.searchInput, width: '100%', boxSizing: 'border-box' as const }}
          />
          <div ref={labelDropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setLabelDropdownOpen(v => !v)}
              onBlur={e => { if (!labelDropdownRef.current?.contains(e.relatedTarget as Node)) setLabelDropdownOpen(false) }}
              style={{
                ...styles.searchInput, width: '100%', boxSizing: 'border-box' as const,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', background: '#fff', textAlign: 'left' as const,
                outline: labelFilter ? '2px solid #2563eb' : undefined,
              }}
            >
              {labelFilter
                ? <LabelChip label={{ id: 0, key: labelFilter.includes('=') ? labelFilter.split('=')[0] : labelFilter, value: labelFilter.includes('=') ? labelFilter.split('=').slice(1).join('=') : '', color: labelSuggestions.find(s => s.key === (labelFilter.includes('=') ? labelFilter.split('=')[0] : labelFilter))?.color ?? null }} />
                : <span style={{ color: '#9ca3af' }}>{t('domains_labelFilterPlaceholder')}</span>}
              <span style={{ fontSize: '.65rem', color: '#9ca3af', marginLeft: 4 }}>{labelFilter ? '' : '▼'}</span>
            </button>
            {labelFilter && (
              <button
                onClick={() => { setLabelFilter(''); setLabelDropdownOpen(false) }}
                style={{ ...styles.btnClear, position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                title="Clear label filter"
              >✕</button>
            )}
            {labelDropdownOpen && (
              <div style={styles.labelDropdown}>
                {labelSuggestions.flatMap(s => {
                  const items: { key: string; value: string; filter: string; color: string | null }[] = []
                  items.push({ key: s.key, value: '', filter: s.key, color: s.color })
                  for (const v of s.values) items.push({ key: s.key, value: v, filter: `${s.key}=${v}`, color: s.color })
                  return items
                }).map(item => (
                  <button
                    key={item.filter}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setLabelFilter(item.filter); setLabelDropdownOpen(false) }}
                    style={styles.labelDropdownItem}
                  >
                    <LabelChip label={{ id: 0, key: item.key, value: item.value, color: item.color }} />
                  </button>
                ))}
                {labelSuggestions.length === 0 && (
                  <div style={{ padding: '.5rem .75rem', color: '#9ca3af', fontSize: '.8rem' }}>No labels</div>
                )}
              </div>
            )}
          </div>
        </div>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ width: 18, height: 18, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
        <table style={styles.table}>
          <tbody>
            {domains.map((d: Domain) => {
              const isSelected = selectedId === d.id
              const suspended = d.status === 'suspended'
              return (
                <tr
                  key={d.id}
                  className="domain-row"
                  style={{ ...styles.tr, background: isSelected ? '#eff6ff' : suspended ? '#fffbeb' : undefined }}
                  onClick={() => { if (checkNavGuard()) navigate(`/domains/${d.id}`) }}
                >
                  <td style={{ ...styles.td, padding: '.5rem .75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.375rem', flexWrap: 'wrap' as const }}>
                      <span style={{ fontWeight: 500, color: isSelected ? '#1d4ed8' : '#2563eb', fontSize: '.875rem', wordBreak: 'break-all' as const }}>{d.fqdn}</span>
                      <ZoneStatusBadge status={d.zone_status} />
                      {!!d.dnssec_enabled && (
                        <span style={{ fontSize: '.65rem', fontWeight: 600, color: '#166534', background: '#dcfce7', padding: '1px 4px', borderRadius: 6 }}>DNSSEC</span>
                      )}
                    </div>
                    {suspended && (
                      <div style={{ fontSize: '.7rem', color: '#92400e', marginTop: 2 }}>suspended</div>
                    )}
                  </td>
                </tr>
              )
            })}
            {!isLoading && domains.length === 0 && (
              <tr><td style={{ ...styles.td, color: '#9ca3af', textAlign: 'center', padding: '1rem' }}>{t('domains_noneFound')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div>
      <style>{INLINE_STYLES}</style>
      <div style={styles.header}>
        <div>
          <h2 style={styles.h2}>{t('domains_title')}</h2>
          {!isLoading && !error && (
            <span style={{ fontSize: '.75rem', color: '#9ca3af', fontWeight: 400 }}>{domains.length} domain{domains.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div style={styles.headerRight}>
          <input
            placeholder={t('domains_searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          <div ref={labelDropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setLabelDropdownOpen(v => !v)}
              onBlur={e => { if (!labelDropdownRef.current?.contains(e.relatedTarget as Node)) setLabelDropdownOpen(false) }}
              style={{
                ...styles.searchInput,
                width: 240,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                background: '#fff',
                textAlign: 'left',
                outline: labelFilter ? '2px solid #2563eb' : undefined,
              }}
            >
              {labelFilter
                ? <LabelChip label={{ id: 0, key: labelFilter.includes('=') ? labelFilter.split('=')[0] : labelFilter, value: labelFilter.includes('=') ? labelFilter.split('=').slice(1).join('=') : '', color: labelSuggestions.find(s => s.key === (labelFilter.includes('=') ? labelFilter.split('=')[0] : labelFilter))?.color ?? null }} />
                : <span style={{ color: '#9ca3af' }}>{t('domains_labelFilterPlaceholder')}</span>}
              <span style={{ fontSize: '.65rem', color: '#9ca3af', marginLeft: 4 }}>{labelFilter ? '' : '▼'}</span>
            </button>
            {labelFilter && (
              <button
                onClick={() => { setLabelFilter(''); setLabelDropdownOpen(false) }}
                style={{ ...styles.btnClear, position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                title="Clear label filter"
              >✕</button>
            )}
            {labelDropdownOpen && (
              <div style={styles.labelDropdown}>
                {labelSuggestions.flatMap(s => {
                  const items: { key: string; value: string; filter: string; color: string | null }[] = []
                  items.push({ key: s.key, value: '', filter: s.key, color: s.color })
                  for (const v of s.values) items.push({ key: s.key, value: v, filter: `${s.key}=${v}`, color: s.color })
                  return items
                }).map(item => (
                  <button
                    key={item.filter}
                    type="button"
                    onMouseDown={e => {
                      e.preventDefault()
                      setLabelFilter(item.filter)
                      setLabelDropdownOpen(false)
                    }}
                    style={styles.labelDropdownItem}
                  >
                    <LabelChip label={{ id: 0, key: item.key, value: item.value, color: item.color }} />
                  </button>
                ))}
                {labelSuggestions.length === 0 && (
                  <div style={{ padding: '.5rem .75rem', color: '#9ca3af', fontSize: '.8rem' }}>No labels</div>
                )}
              </div>
            )}
          </div>
          <div ref={colDropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setColDropdownOpen(v => !v)}
              onBlur={e => { if (!colDropdownRef.current?.contains(e.relatedTarget as Node)) setColDropdownOpen(false) }}
              style={{ ...styles.btnSecondary, fontSize: '.8rem', padding: '.3rem .6rem' }}
            >
              {t('domains_columns')} ▼
            </button>
            {colDropdownOpen && (
              <div style={styles.colDropdown}>
                {ALL_COLUMNS.map(col => (
                  <div
                    key={col}
                    style={styles.colDropdownItem}
                    onMouseDown={e => { e.preventDefault(); toggleCol(col) }}
                  >
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(col)}
                      readOnly
                      style={{ marginRight: 6, pointerEvents: 'none' }}
                    />
                    {colLabels[col]}
                  </div>
                ))}
              </div>
            )}
          </div>
          {user?.role === 'admin' && (
            <button
              onClick={() => { setShowDeleted(v => !v); setSearch(''); setLabelFilter('') }}
              style={showDeleted ? styles.btnTrashActive : styles.btnSecondary}
              title="Show deleted domains"
            >
              Deleted
            </button>
          )}
          {!showDeleted && (
            <button onClick={() => setShowCreate(v => !v)} style={styles.btnPrimary}>
              {t('domains_addDomain')}
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.createForm}>
          <input
            placeholder={t('domains_fqdnPlaceholder')}
            value={newFqdn}
            onChange={e => setNewFqdn(e.target.value)}
            required
            style={styles.input}
          />
          <select
            value={newCustomerId}
            onChange={e => setNewCustomerId(e.target.value)}
            required
            style={{ ...styles.input, width: 200 }}
          >
            <option value="">{t('domains_selectCustomer')}</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button type="submit" disabled={creating} style={styles.btnPrimary}>
            {creating ? t('creating') : t('create')}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} style={styles.btnSecondary}>
            {t('cancel')}
          </button>
        </form>
      )}

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '2rem 0', color: '#6b7280', fontSize: '.875rem' }}>
          <div style={{ width: 18, height: 18, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
          {t('loading')}
        </div>
      )}
      {error && <p style={styles.errorText}>{t('domains_loadError')}</p>}

      <table style={styles.table}>
        <thead>
          {showDeleted ? (
            <tr>
              <th style={styles.th}>FQDN</th>
              <th style={styles.th}>{t('customer')}</th>
              <th style={styles.th}>Deleted</th>
              <th style={styles.th}>Purge in</th>
              <th style={styles.th}></th>
            </tr>
          ) : (
            <tr>
              {show('fqdn') && <th style={styles.th}>FQDN</th>}
              {show('customer') && <th style={styles.th}>{t('customer')}</th>}
              {show('status') && <th style={styles.th}>{t('status')}</th>}
              {show('zone') && <th style={styles.th}>{t('domains_zone')}</th>}
              {show('labels') && <th style={styles.th}>{t('domains_labels')}</th>}
              {show('serial') && <th style={styles.th}>{t('serial')}</th>}
              {show('lastRendered') && <th style={styles.th}>{t('domains_lastRendered')}</th>}
            </tr>
          )}
        </thead>
        <tbody>
          {showDeleted ? (
            domains.map((d: Domain) => {
              const purgeDays = d.deleted_at
                ? Math.ceil((new Date(d.deleted_at).getTime() + 30 * 86400_000 - Date.now()) / 86400_000)
                : null
              const urgent = purgeDays !== null && purgeDays <= 7
              return (
                <tr key={d.id} style={styles.tr}>
                  <td style={{ ...styles.td, color: '#6b7280' }}>{d.fqdn}</td>
                  <td style={styles.td}>{d.customer_name}</td>
                  <td style={styles.td}>
                    {d.deleted_at ? new Date(d.deleted_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ ...styles.td, color: urgent ? '#dc2626' : '#374151', fontWeight: urgent ? 600 : 400 }}>
                    {purgeDays !== null ? (purgeDays <= 0 ? 'Purging…' : `${purgeDays}d`) : '—'}
                  </td>
                  <td style={styles.td}>
                    <button
                      onClick={() => handleRestore(d.id)}
                      disabled={restoringId === d.id}
                      style={styles.btnSuccess}
                    >
                      {restoringId === d.id ? '…' : 'Restore'}
                    </button>
                  </td>
                </tr>
              )
            })
          ) : (
            domains.map((d: Domain) => {
              const suspended = d.status === 'suspended'
              const rowBase: React.CSSProperties = suspended
                ? { ...styles.tr, opacity: 0.65, background: '#fffbeb' }
                : styles.tr
              return (
                <tr
                  key={d.id}
                  className="domain-row"
                  style={rowBase}
                  onClick={e => { if ((e.target as HTMLElement).closest('button,a,input')) return; navigate(`/domains/${d.id}`) }}
                >
                  {show('fqdn') && <td style={styles.td}>
                    <Link to={`/domains/${d.id}`} style={styles.link} onClick={e => e.stopPropagation()}>{d.fqdn}</Link>
                    {!!d.dnssec_enabled && (
                      <span style={{ marginLeft: 6, fontSize: '.7rem', fontWeight: 600, color: '#166534', background: '#dcfce7', padding: '1px 5px', borderRadius: 8, verticalAlign: 'middle' }}>DNSSEC</span>
                    )}
                  </td>}
                  {show('customer') && <td style={styles.td}>{d.customer_name}</td>}
                  {show('status') && <td style={styles.td}>
                    <span style={{
                      display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600,
                      background: d.status === 'active' ? '#dcfce7' : d.status === 'suspended' ? '#fef3c7' : '#f3f4f6',
                      color:      d.status === 'active' ? '#166534' : d.status === 'suspended' ? '#92400e' : '#6b7280',
                    }}>{d.status}</span>
                  </td>}
                  {show('zone') && <td style={styles.td}>
                    <ZoneStatusBadge status={d.zone_status} />
                  </td>}
                  {show('labels') && <td style={styles.td} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(d.labels ?? []).map(l => {
                        const val = l.value ? `${l.key}=${l.value}` : l.key
                        return (
                          <span key={l.id} onClick={() => setLabelFilter(val)} style={{ cursor: 'pointer' }}>
                            <LabelChip label={l} />
                          </span>
                        )
                      })}
                    </div>
                  </td>}
                  {show('serial') && <td style={styles.td}><code>{d.last_serial || '—'}</code></td>}
                  {show('lastRendered') && <td style={{ ...styles.td, ...styles.muted }}>
                    {d.last_rendered_at
                      ? new Date(d.last_rendered_at).toLocaleString()
                      : t('never')}
                  </td>}
                </tr>
              )
            })
          )}
          {!isLoading && domains.length === 0 && (
            <tr><td colSpan={showDeleted ? 5 : visibleCols.length} style={{ ...styles.td, textAlign: 'center', ...styles.muted }}>
              {showDeleted ? 'No deleted domains.' : t('domains_noneFound')}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', marginBottom: '1rem' },
  headerRight: { marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center' },
  h2: { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  searchInput: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', width: 240 },
  createForm: { display: 'flex', gap: '.5rem', marginBottom: '1rem', padding: '1rem', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' },
  input: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', flex: 1 },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  btnClear: { padding: '.25rem .5rem', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '.875rem', lineHeight: 1 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr: { borderBottom: '1px solid #e5e7eb' },
  td: { padding: '.625rem .75rem', fontSize: '.875rem' },
  link: { color: '#2563eb', textDecoration: 'none', fontWeight: 500 },
  muted: { color: '#9ca3af' },
  errorText: { color: '#b91c1c' },
  labelDropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, marginTop: 2, background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20, maxHeight: 240, overflowY: 'auto' as const, padding: '4px 0' },
  labelDropdownItem: { display: 'flex', alignItems: 'center', width: '100%', padding: '.375rem .75rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const, fontSize: '.875rem' },
  colDropdown: { position: 'absolute' as const, top: '100%', right: 0, marginTop: 2, background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20, padding: '6px 0', minWidth: 160 },
  colDropdownItem: { display: 'flex', alignItems: 'center', padding: '.3rem .75rem', fontSize: '.8rem', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  btnTrashActive: { padding: '.375rem .875rem', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer', fontWeight: 600 },
  btnSuccess: { padding: '.375rem .875rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
}
