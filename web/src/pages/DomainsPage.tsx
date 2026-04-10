import { useEffect, useRef, useState } from 'react'
import { useNavigate, useMatch } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDomains, getTenants, getLabelSuggestions, type Domain } from '../api/client'
import LabelChip from '../components/LabelChip'
import ZoneStatusBadge from '../components/ZoneStatusBadge'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { getDirtyDomainIds, subscribe } from '../hooks/domainEditCache'

const INLINE_STYLES = `
  .condensed-row { transition: background 0.08s; }
  .condensed-row:hover { background: #f0f4ff !important; }
`

export default function DomainsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const detailMatch = useMatch('/domains/:id')
  const selectedId = detailMatch?.params.id ? Number(detailMatch.params.id) : null
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const [tenantFilter, setTenantFilter] = useState<number[]>([])
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false)
  const [tenantSearch, setTenantSearch] = useState('')
  const tenantDropdownRef = useRef<HTMLDivElement>(null)

  const { data: labelSuggestions = [] } = useQuery({
    queryKey: ['label-suggestions'],
    queryFn: () => getLabelSuggestions().then(r => r.data),
    staleTime: 30_000,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
    enabled: !!user,
  })

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['domains', search, labelFilter, tenantFilter.join(',')],
    queryFn: () => {
      const params: Record<string, string> = { limit: '9999' }
      if (search) params.search = search
      if (labelFilter) params.label = labelFilter
      if (tenantFilter.length > 0) params.tenant_id = tenantFilter.join(',')
      return getDomains(params).then(r => r.data)
    },
  })

  function toggleTenant(id: number) {
    setTenantFilter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const filteredTenants = tenants.filter(c =>
    c.name.toLowerCase().includes(tenantSearch.toLowerCase())
  )

  function tenantButtonLabel(): string {
    if (tenantFilter.length === 0) return t('domains_allTenants')
    if (tenantFilter.length === 1) return tenants.find(c => c.id === tenantFilter[0])?.name ?? t('domains_allTenants')
    return `${tenantFilter.length} ${t('domains_tenantsSelected')}`
  }

  const [dirtyDomainIds, setDirtyDomainIds] = useState(() => getDirtyDomainIds())
  useEffect(() => subscribe(() => setDirtyDomainIds(getDirtyDomainIds())), [])

  return (
    <div>
      <style>{INLINE_STYLES}</style>
      <div style={{ padding: '.625rem .75rem', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10, background: '#fff' }}>
        <input
          placeholder={t('domains_searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...styles.searchInput, width: '100%', boxSizing: 'border-box' as const, marginBottom: '.375rem' }}
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
                <div style={{ padding: '.5rem .75rem', color: '#9ca3af', fontSize: '.8rem' }}>{t('domains_noLabels')}</div>
              )}
            </div>
          )}
        </div>
        {tenants.length > 1 && (
          <div ref={tenantDropdownRef} style={{ position: 'relative', marginTop: '.375rem' }}>
            <button
              type="button"
              onClick={() => setTenantDropdownOpen(v => !v)}
              onBlur={e => { if (!tenantDropdownRef.current?.contains(e.relatedTarget as Node)) { setTenantDropdownOpen(false); setTenantSearch('') } }}
              style={{
                ...styles.searchInput, width: '100%', boxSizing: 'border-box' as const,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', background: '#fff', textAlign: 'left' as const,
                outline: tenantFilter.length > 0 ? '2px solid #2563eb' : undefined,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, color: tenantFilter.length > 0 ? '#111827' : '#9ca3af' }}>
                {tenantButtonLabel()}
              </span>
              <span style={{ fontSize: '.65rem', color: '#9ca3af', marginLeft: 4, flexShrink: 0 }}>▼</span>
            </button>
            {tenantFilter.length > 0 && (
              <button
                onClick={() => { setTenantFilter([]); setTenantDropdownOpen(false); setTenantSearch('') }}
                style={{ ...styles.btnClear, position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                title="Clear"
              >✕</button>
            )}
            {tenantDropdownOpen && (
              <div style={styles.labelDropdown}>
                <div style={{ padding: '4px 8px 6px', borderBottom: '1px solid #f3f4f6' }}>
                  <input
                    value={tenantSearch}
                    onChange={e => setTenantSearch(e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    placeholder={t('domains_searchTenants')}
                    style={{ width: '100%', boxSizing: 'border-box' as const, padding: '.25rem .5rem', border: '1px solid #e5e7eb', borderRadius: 3, fontSize: '.8125rem', outline: 'none' }}
                  />
                </div>
                {filteredTenants.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); toggleTenant(c.id) }}
                    style={{ ...styles.labelDropdownItem, gap: '.5rem' }}
                  >
                    <input type="checkbox" checked={tenantFilter.includes(c.id)} readOnly style={{ pointerEvents: 'none' as const, flexShrink: 0 }} />
                    {c.name}
                  </button>
                ))}
                {filteredTenants.length === 0 && (
                  <div style={{ padding: '.5rem .75rem', color: '#9ca3af', fontSize: '.8rem' }}>{t('domains_noTenantMatch')}</div>
                )}
              </div>
            )}
          </div>
        )}
        {!isLoading && (
          <div style={{ fontSize: '.7rem', color: '#9ca3af', marginTop: '.375rem' }}>
            {domains.length} domain{domains.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
          <div style={{ width: 18, height: 18, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      )}
      <div>
        {domains.map((d: Domain) => {
          const isSelected = selectedId === d.id
          const suspended = d.status === 'suspended'
          return (
            <div
              key={d.id}
              className={isSelected ? undefined : 'condensed-row'}
              onClick={() => navigate(`/domains/${d.id}`)}
              style={{
                padding: '.3rem .625rem',
                paddingLeft: isSelected ? 'calc(.625rem - 3px)' : '.625rem',
                borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
                borderBottom: '1px solid #f3f4f6',
                cursor: 'pointer',
                background: isSelected ? '#eff6ff' : suspended ? '#fffbeb' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '.25rem', overflow: 'hidden' }}>
                {dirtyDomainIds.has(d.id) && (
                  <span style={{ color: '#f59e0b', fontSize: '.45rem', flexShrink: 0, lineHeight: 1 }} title="Unsaved changes">●</span>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontWeight: 500, fontSize: '.75rem', color: isSelected ? '#1d4ed8' : '#111827', flexShrink: 1, minWidth: 0 }}>
                  {d.fqdn}
                  {d.ns_reference && (
                    <span style={{ fontWeight: 400, color: '#9ca3af' }}>
                      <span style={{ margin: '0 3px' }}>→</span>
                      <span style={{ color: isSelected ? '#6d93e8' : '#6b7280' }}>{d.ns_reference}</span>
                    </span>
                  )}
                </span>
                {d.tenant_name && (
                  <span style={{ fontSize: '.65rem', color: '#9ca3af', whiteSpace: 'nowrap' as const, flexShrink: 0, marginLeft: 'auto' }}>{d.tenant_name}</span>
                )}
              </div>
              {!!(d.zone_status || d.ns_ok === 0 || d.dnssec_enabled || suspended || (d.labels && d.labels.length > 0)) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem', marginTop: 1, flexWrap: 'wrap' as const }}>
                  <ZoneStatusBadge status={d.zone_status} suspended={d.status === 'suspended'} />
                  {d.ns_ok === 0 && (
                    <span className="tip" data-tip={t('domains_nsWarning')} style={{ fontSize: '.6rem', fontWeight: 600, color: '#dc2626', background: '#fee2e2', padding: '1px 4px', borderRadius: 6 }}>⚠ NS</span>
                  )}
                  {!!d.dnssec_enabled && (
                    <span style={{ fontSize: '.6rem', fontWeight: 600, color: '#166534', background: '#dcfce7', padding: '1px 4px', borderRadius: 6 }}>DNSSEC</span>
                  )}
                  {suspended && (
                    <span style={{ fontSize: '.65rem', color: '#92400e' }}>{t('domains_suspended')}</span>
                  )}
                  {d.labels?.map(l => <LabelChip key={l.id} label={l} />)}
                </div>
              )}
            </div>
          )
        })}
        {!isLoading && domains.length === 0 && (
          <div style={{ padding: '1.5rem', color: '#9ca3af', textAlign: 'center' as const, fontSize: '.8rem' }}>{t('domains_noneFound')}</div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  searchInput: { padding: '.25rem .5rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', width: 240 },
  btnClear: { padding: '.2rem .4rem', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '.8125rem', lineHeight: 1 },
  labelDropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, marginTop: 2, background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20, maxHeight: 240, overflowY: 'auto' as const, padding: '4px 0' },
  labelDropdownItem: { display: 'flex', alignItems: 'center', width: '100%', padding: '.25rem .5rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const, fontSize: '.8125rem' },
}
