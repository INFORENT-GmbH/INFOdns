import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDomains, createDomain, getCustomers, getLabelSuggestions, type Domain } from '../api/client'
import ZoneStatusBadge from '../components/ZoneStatusBadge'
import LabelChip from '../components/LabelChip'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

export default function DomainsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newFqdn, setNewFqdn] = useState('')
  const [newCustomerId, setNewCustomerId] = useState('')
  const [creating, setCreating] = useState(false)

  const isAdminOrOp = user?.role === 'admin' || user?.role === 'operator'

  const { data: labelSuggestions = [] } = useQuery({
    queryKey: ['label-suggestions'],
    queryFn: () => getLabelSuggestions().then(r => r.data),
    staleTime: 30_000,
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
    enabled: isAdminOrOp,
  })

  const { data: domains = [], isLoading, error, refetch } = useQuery({
    queryKey: ['domains', search, labelFilter],
    queryFn: () => {
      const params: Record<string, string> = {}
      if (search) params.search = search
      if (labelFilter) params.label = labelFilter
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

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('domains_title')}</h2>
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
          {isAdminOrOp && (
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

      {isLoading && <p style={styles.muted}>{t('loading')}</p>}
      {error && <p style={styles.errorText}>{t('domains_loadError')}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>FQDN</th>
            <th style={styles.th}>{t('customer')}</th>
            <th style={styles.th}>{t('status')}</th>
            <th style={styles.th}>{t('domains_zone')}</th>
            <th style={styles.th}>{t('domains_labels')}</th>
            <th style={styles.th}>{t('serial')}</th>
            <th style={styles.th}>{t('domains_lastRendered')}</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d: Domain) => (
            <tr key={d.id} style={styles.tr}>
              <td style={styles.td}>
                <Link to={`/domains/${d.id}`} style={styles.link}>{d.fqdn}</Link>
              </td>
              <td style={styles.td}>{d.customer_name}</td>
              <td style={styles.td}>{d.status}</td>
              <td style={styles.td}><ZoneStatusBadge status={d.zone_status} /></td>
              <td style={styles.td}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(d.labels ?? []).map(l => {
                    const val = l.value ? `${l.key}=${l.value}` : l.key
                    return (
                      <span key={l.id} onClick={() => { setLabelFilter(val) }} style={{ cursor: 'pointer' }}>
                        <LabelChip label={l} />
                      </span>
                    )
                  })}
                </div>
              </td>
              <td style={styles.td}><code>{d.last_serial || '—'}</code></td>
              <td style={styles.td}>
                {d.last_rendered_at
                  ? new Date(d.last_rendered_at).toLocaleString()
                  : <span style={styles.muted}>{t('never')}</span>}
              </td>
            </tr>
          ))}
          {!isLoading && domains.length === 0 && (
            <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', ...styles.muted }}>{t('domains_noneFound')}</td></tr>
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
}
