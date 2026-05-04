import { useEffect, useRef, useState } from 'react'
import { useNavigate, useMatch } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type Domain, type LabelSuggestion, type Tenant } from '../api/client'
import LabelChip from '../components/LabelChip'
import Tooltip from '../components/Tooltip'
import FilterPersistControls from '../components/FilterPersistControls'
import { useI18n } from '../i18n/I18nContext'
import { getDirtyDomainFqdns, subscribe } from '../hooks/domainEditCache'

interface Props {
  domains: Domain[]
  isLoading: boolean
  search: string
  setSearch: (v: string) => void
  labelFilter: string
  setLabelFilter: (v: string) => void
  labelSuggestions: LabelSuggestion[]
  tenantFilter: number[]
  setTenantFilter: (v: number[]) => void
  tenants: Tenant[]
  totalCount?: number
  selectedCount: number
  filtersPersist: boolean
  setFiltersPersist: (v: boolean) => void
  clearFilters: () => void
  filtersHasActive: boolean
}

const zoneStatusDotColors: Record<string, string> = {
  clean:     '#16a34a',
  dirty:     '#ca8a04',
  error:     '#dc2626',
  suspended: '#9ca3af',
}

const spinnerDotStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '0.55em',
  height: '0.55em',
  border: '1.5px solid #ca8a04',
  borderTopColor: 'transparent',
  borderRadius: '50%',
  animation: 'spin 0.7s linear infinite',
  flexShrink: 0,
  verticalAlign: 'middle',
}

function ZoneStatusDot({ status, suspended }: { status: string; suspended: boolean }) {
  const key = suspended ? 'suspended' : status
  if (!key) return null
  if (key === 'dirty') return <Tooltip tip="Zone dirty" style={spinnerDotStyle} />
  const color = zoneStatusDotColors[key]
  if (!color) return null
  return <Tooltip tip={`Zone ${key}`} style={{ fontSize: '.45rem', color, flexShrink: 0, lineHeight: 1, cursor: 'default' }}>●</Tooltip>
}

const INLINE_STYLES = `
  .condensed-row { transition: background 0.08s; }
  .condensed-row:hover { background: #e8f0fe !important; }
  @keyframes spin { to { transform: rotate(360deg); } }
`

export default function DomainsPage({
  domains, isLoading,
  search, setSearch,
  labelFilter, setLabelFilter, labelSuggestions,
  tenantFilter, setTenantFilter, tenants,
  totalCount, selectedCount,
  filtersPersist, setFiltersPersist, clearFilters, filtersHasActive,
}: Props) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const detailMatch = useMatch('/domains/:id')
  const selectedFqdn = detailMatch?.params.id ?? null

  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false)
  const [tenantSearch, setTenantSearch] = useState('')
  const tenantDropdownRef = useRef<HTMLDivElement>(null)
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false)
  const displayOptionsRef = useRef<HTMLDivElement>(null)

  function toggleTenant(id: number) {
    setTenantFilter(tenantFilter.includes(id) ? tenantFilter.filter(x => x !== id) : [...tenantFilter, id])
  }

  const filteredTenants = tenants.filter(c =>
    c.name.toLowerCase().includes(tenantSearch.toLowerCase())
  )

  function tenantButtonLabel(): string {
    if (tenantFilter.length === 0) return t('domains_allTenants')
    if (tenantFilter.length === 1) return tenants.find(c => c.id === tenantFilter[0])?.name ?? t('domains_allTenants')
    return `${tenantFilter.length} ${t('domains_tenantsSelected')}`
  }

  const [dirtyDomainIds, setDirtyDomainIds] = useState(() => getDirtyDomainFqdns())
  useEffect(() => subscribe(() => setDirtyDomainIds(getDirtyDomainFqdns())), [])

  const [showLabels, setShowLabels] = useState(() => localStorage.getItem('domainsPage.showLabels') === 'true')
  useEffect(() => { localStorage.setItem('domainsPage.showLabels', String(showLabels)) }, [showLabels])
  const [showStatus, setShowStatus] = useState(() => localStorage.getItem('domainsPage.showStatus') !== 'false')
  useEffect(() => { localStorage.setItem('domainsPage.showStatus', String(showStatus)) }, [showStatus])
  const [showTenant, setShowTenant] = useState(() => localStorage.getItem('domainsPage.showTenant') !== 'false')
  useEffect(() => { localStorage.setItem('domainsPage.showTenant', String(showTenant)) }, [showTenant])
  const [showNsRef, setShowNsRef] = useState(() => localStorage.getItem('domainsPage.showNsRef') !== 'false')
  useEffect(() => { localStorage.setItem('domainsPage.showNsRef', String(showNsRef)) }, [showNsRef])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: domains.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 8,
    getItemKey: (i) => domains[i].id,
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{INLINE_STYLES}</style>

      {/* Header */}
      <div style={{ padding: '.5rem .625rem .375rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.375rem' }}>
          <h2 style={{ margin: 0, fontSize: '.875rem', fontWeight: 700, color: '#1e293b' }}>{t('domains_title')}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.375rem' }}>
            <div ref={displayOptionsRef} style={{ position: 'relative', display: 'flex' }}>
              <button
                type="button"
                onClick={() => setDisplayOptionsOpen(v => !v)}
                onBlur={e => { if (!displayOptionsRef.current?.contains(e.relatedTarget as Node)) setDisplayOptionsOpen(false) }}
                title={t('domains_displayOptions')}
                aria-label={t('domains_displayOptions')}
                style={{ padding: '.05rem .3rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 3, cursor: 'pointer', fontSize: '.8rem', color: '#64748b', lineHeight: 1 }}
              >
                ⚙
              </button>
              {displayOptionsOpen && (
                <div style={{ ...styles.labelDropdown, left: 'auto', right: 0, minWidth: 170 }}>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowStatus(v => !v) }}
                    style={{ ...styles.labelDropdownItem, gap: '.5rem' }}
                  >
                    <input type="checkbox" checked={showStatus} readOnly style={{ pointerEvents: 'none' as const, flexShrink: 0 }} />
                    {t('domains_showStatus')}
                  </button>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowTenant(v => !v) }}
                    style={{ ...styles.labelDropdownItem, gap: '.5rem' }}
                  >
                    <input type="checkbox" checked={showTenant} readOnly style={{ pointerEvents: 'none' as const, flexShrink: 0 }} />
                    {t('domains_showTenant')}
                  </button>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowNsRef(v => !v) }}
                    style={{ ...styles.labelDropdownItem, gap: '.5rem' }}
                  >
                    <input type="checkbox" checked={showNsRef} readOnly style={{ pointerEvents: 'none' as const, flexShrink: 0 }} />
                    {t('domains_showNsRef')}
                  </button>
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowLabels(v => !v) }}
                    style={{ ...styles.labelDropdownItem, gap: '.5rem' }}
                  >
                    <input type="checkbox" checked={showLabels} readOnly style={{ pointerEvents: 'none' as const, flexShrink: 0 }} />
                    {t('domains_showLabels')}
                  </button>
                </div>
              )}
            </div>
            {selectedCount > 0 && (
              <span
                style={{ fontSize: '.7rem', fontWeight: 600, color: '#fff', background: '#2563eb', borderRadius: 10, padding: '1px 7px' }}
                title={`${selectedCount} ${t('bulk_selected')}`}
              >
                {selectedCount} {t('bulk_selected')}
              </span>
            )}
            {!isLoading && (() => {
              const filtersActive = !!(search || labelFilter || tenantFilter.length > 0)
              const showFiltered = filtersActive && totalCount !== undefined && totalCount !== domains.length
              return (
                <span
                  style={{ fontSize: '.7rem', fontWeight: 600, color: '#64748b', background: '#e2e8f0', borderRadius: 10, padding: '1px 7px' }}
                  title={showFiltered ? t('domains_filteredCount', domains.length, totalCount) : undefined}
                >
                  {showFiltered ? t('domains_filteredCount', domains.length, totalCount) : domains.length}
                </span>
              )
            })()}
          </div>
        </div>

        {/* Search */}
        <input
          placeholder={t('domains_searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...styles.searchInput, width: '100%', boxSizing: 'border-box' as const, marginBottom: '.375rem' }}
        />

        {/* Label filter */}
        <div ref={labelDropdownRef} style={{ position: 'relative', marginBottom: '.375rem' }}>
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

        {/* Tenant filter */}
        {tenants.length > 1 && (
          <div ref={tenantDropdownRef} style={{ position: 'relative' }}>
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

        <FilterPersistControls
          persist={filtersPersist}
          setPersist={setFiltersPersist}
          onClear={clearFilters}
          hasActive={filtersHasActive}
          compact
          style={{ marginTop: '.375rem', justifyContent: 'space-between', display: 'flex' }}
        />

      </div>

      {/* Domain rows (virtualized) */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <div style={{ width: 18, height: 18, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}
        {!isLoading && domains.length === 0 && (
          <div style={{ padding: '1.5rem', color: '#9ca3af', textAlign: 'center' as const, fontSize: '.8rem' }}>{t('domains_noneFound')}</div>
        )}
        {!isLoading && domains.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map(vi => {
              const d = domains[vi.index]
              const isSelected = selectedFqdn === d.fqdn
              const suspended = d.status === 'suspended'
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className={isSelected ? undefined : 'condensed-row'}
                  onClick={() => navigate(`/domains/${d.fqdn}`)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vi.start}px)`,
                    padding: '.35rem .625rem',
                    paddingLeft: isSelected ? 'calc(.625rem - 3px)' : '.625rem',
                    borderLeft: isSelected ? '3px solid #2563eb' : '3px solid transparent',
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    background: isSelected ? '#eff6ff' : suspended ? '#fffbeb' : undefined,
                    boxSizing: 'border-box',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                    {showStatus && <ZoneStatusDot status={d.zone_status} suspended={suspended} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontWeight: 500, fontSize: '.8125rem', color: isSelected ? '#1d4ed8' : '#111827', flexShrink: 1, minWidth: 0 }}>
                      {d.fqdn}
                      {showNsRef && d.ns_reference && (
                        <span style={{ fontWeight: 400, color: '#9ca3af' }}>
                          <span style={{ margin: '0 3px' }}>→</span>
                          <span style={{ color: isSelected ? '#6d93e8' : '#6b7280' }}>{d.ns_reference}</span>
                        </span>
                      )}
                    </span>
                    {showStatus && d.ns_ok === 0 && (
                      <Tooltip tip={t('domains_nsWarning')} style={{ fontSize: '.6rem', fontWeight: 600, color: '#dc2626', flexShrink: 0, cursor: 'default' }}>⚠</Tooltip>
                    )}
                    {showStatus && dirtyDomainIds.has(d.fqdn) && (
                      <span style={{ color: '#f59e0b', fontSize: '.45rem', flexShrink: 0, lineHeight: 1 }} title="Unsaved changes">●</span>
                    )}
                    {showTenant && d.tenant_name && (
                      <span style={{ fontSize: '.65rem', color: '#9ca3af', whiteSpace: 'nowrap' as const, flexShrink: 0, marginLeft: 'auto' }}>{d.tenant_name}</span>
                    )}
                  </div>
                  {!!(suspended || (showLabels && d.labels && d.labels.length > 0)) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem', marginTop: 2, flexWrap: 'wrap' as const }}>
                      {suspended && (
                        <span style={{ fontSize: '.65rem', color: '#92400e' }}>{t('domains_suspended')}</span>
                      )}
                      {showLabels && d.labels?.map(l => <LabelChip key={l.id} label={l} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  searchInput: { padding: '.25rem .5rem', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.8125rem', width: 240, background: '#fff' },
  btnClear: { padding: '.2rem .4rem', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '.8125rem', lineHeight: 1 },
  labelDropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, marginTop: 2, background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20, maxHeight: 240, overflowY: 'auto' as const, padding: '4px 0' },
  labelDropdownItem: { display: 'flex', alignItems: 'center', width: '100%', padding: '.25rem .5rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' as const, fontSize: '.8125rem' },
}
