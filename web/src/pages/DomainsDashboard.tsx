import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { getDomainStats, type Domain, type LabelSuggestion, type Tenant } from '../api/client'
import LabelChip from '../components/LabelChip'
import Tooltip from '../components/Tooltip'
import { useI18n } from '../i18n/I18nContext'
import * as s from '../styles/shell'

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
  selectedIds: Set<number>
  onToggleSelected: (id: number) => void
  onSelectAll: () => void
  onClearSelection: () => void
}

type SortKey = 'fqdn' | 'zone_status' | 'ns_ok' | 'dnssec_enabled' | 'status' | 'tenant_name'
type SortDir = 'asc' | 'desc'

type ColumnKey = 'zone' | 'ns' | 'dnssec' | 'status' | 'tenant' | 'lastRendered' | 'nsChecked' | 'created' | 'labels'

const COLUMN_KEYS: ColumnKey[] = [
  'zone', 'ns', 'dnssec', 'status', 'tenant',
  'lastRendered', 'nsChecked', 'created', 'labels',
]

const COLUMN_DEFAULTS: Record<ColumnKey, boolean> = {
  zone: true, ns: true, dnssec: true, status: true, tenant: true,
  lastRendered: true, nsChecked: true, created: true, labels: true,
}

const ZONE_STATUS_ORDER: Record<string, number> = { error: 0, dirty: 1, clean: 2 }

const INLINE_STYLES = `
  @keyframes spin { to { transform: rotate(360deg); } }
  .dtv-row { transition: background 0.08s; cursor: pointer; }
  .dtv-row:hover td { background: #f1f5f9; }
  .dtv-sort:hover { color: #1d4ed8; }
`

function formatRelative(iso: string | null | undefined, t: (k: any, ...args: any[]) => string): { label: string; absolute: string } {
  if (!iso) return { label: '—', absolute: '' }
  const date = new Date(iso)
  const ms = Date.now() - date.getTime()
  const s = Math.max(0, Math.floor(ms / 1000))
  let short: string
  if (s < 60)         short = `${s}s`
  else if (s < 3600)  short = `${Math.floor(s / 60)}m`
  else if (s < 86400) short = `${Math.floor(s / 3600)}h`
  else if (s < 86400 * 30)  short = `${Math.floor(s / 86400)}d`
  else if (s < 86400 * 365) short = `${Math.floor(s / 86400 / 30)}mo`
  else                      short = `${Math.floor(s / 86400 / 365)}y`
  return { label: t('time_ago', short), absolute: date.toLocaleString() }
}

function StatPill({ label, value, warn }: { label: string; value: number | undefined; warn?: boolean }) {
  if (value === undefined) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.8125rem', color: warn && value > 0 ? '#fff' : '#475569', background: warn && value > 0 ? '#dc2626' : '#e2e8f0', borderRadius: 4, padding: '1px 8px', fontWeight: warn && value > 0 ? 600 : 400 }}>
      {value} {label}
    </span>
  )
}

function WarnPill({ label, value, color = '#dc2626' }: { label: string; value: number | undefined; color?: string }) {
  if (!value) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.8125rem', color: '#fff', background: color, borderRadius: 4, padding: '1px 8px', fontWeight: 600 }}>
      {value} {label}
    </span>
  )
}

const ZONE_BADGE_LABELS: Record<string, 'zone_clean' | 'zone_dirty' | 'zone_error' | 'zone_suspended'> = {
  clean:     'zone_clean',
  dirty:     'zone_dirty',
  error:     'zone_error',
  suspended: 'zone_suspended',
}

function ZoneBadge({ status, suspended, t }: { status: string; suspended: boolean; t: (k: any) => string }) {
  const key = suspended ? 'suspended' : status
  const cfg: Record<string, { color: string; bg: string; spin?: boolean }> = {
    clean:     { color: '#15803d', bg: '#dcfce7' },
    dirty:     { color: '#92400e', bg: '#fef3c7', spin: true },
    error:     { color: '#991b1b', bg: '#fee2e2' },
    suspended: { color: '#374151', bg: '#f3f4f6' },
  }
  const c = cfg[key]
  if (!c) return null
  const labelKey = ZONE_BADGE_LABELS[key]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', fontWeight: 500, color: c.color, background: c.bg, borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap' }}>
      {c.spin
        ? <span style={{ display: 'inline-block', width: '0.5em', height: '0.5em', border: '1.5px solid #ca8a04', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        : <span style={{ fontSize: '.4rem' }}>●</span>}
      {labelKey ? t(labelKey) : key}
    </span>
  )
}

function SortTh({ label, col, sort, setSort }: { label: string; col: SortKey; sort: [SortKey, SortDir]; setSort: (v: [SortKey, SortDir]) => void }) {
  const active = sort[0] === col
  const arrow = active ? (sort[1] === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th
      className="dtv-sort"
      onClick={() => setSort([col, active && sort[1] === 'asc' ? 'desc' : 'asc'])}
      style={{ ...s.th, cursor: 'pointer', userSelect: 'none', color: active ? '#2563eb' : '#64748b', whiteSpace: 'nowrap' }}
    >
      {label}{arrow}
    </th>
  )
}

export default function DomainsTableView({
  domains, isLoading,
  search, setSearch,
  labelFilter, setLabelFilter, labelSuggestions,
  tenantFilter, setTenantFilter, tenants,
  selectedIds, onToggleSelected, onSelectAll, onClearSelection,
}: Props) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [sort, setSort] = useState<[SortKey, SortDir]>(['fqdn', 'asc'])

  // Tick once a minute so "X time ago" cells stay accurate without a refetch.
  // Frequent NS-check broadcasts patch the underlying timestamps via setQueriesData.
  const [, setNow] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setNow(n => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false)
  const labelDropdownRef = useRef<HTMLDivElement>(null)
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false)
  const [tenantSearch, setTenantSearch] = useState('')
  const tenantDropdownRef = useRef<HTMLDivElement>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const columnsRef = useRef<HTMLDivElement>(null)

  const [visible, setVisible] = useState<Record<ColumnKey, boolean>>(() => {
    try {
      const stored = localStorage.getItem('domainsDashboard.columns')
      if (stored) return { ...COLUMN_DEFAULTS, ...JSON.parse(stored) }
    } catch { /* ignore */ }
    return COLUMN_DEFAULTS
  })
  useEffect(() => {
    localStorage.setItem('domainsDashboard.columns', JSON.stringify(visible))
  }, [visible])
  function toggleColumn(key: ColumnKey) {
    setVisible(v => ({ ...v, [key]: !v[key] }))
  }

  const columnLabels: Record<ColumnKey, string> = {
    zone:         t('domains_zone'),
    ns:           'NS',
    dnssec:       t('dashboard_dnssec'),
    status:       t('status'),
    tenant:       t('tenant'),
    lastRendered: t('domains_lastRendered'),
    nsChecked:    t('domains_nsChecked'),
    created:      t('created'),
    labels:       t('domains_labels'),
  }
  const visibleColCount = 2 /* checkbox + domain */ + COLUMN_KEYS.filter(k => visible[k]).length

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

  useEffect(() => {
    if (!labelDropdownOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!labelDropdownRef.current?.contains(e.target as Node)) setLabelDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [labelDropdownOpen])

  useEffect(() => {
    if (!tenantDropdownOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!tenantDropdownRef.current?.contains(e.target as Node)) {
        setTenantDropdownOpen(false)
        setTenantSearch('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [tenantDropdownOpen])

  useEffect(() => {
    if (!columnsOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!columnsRef.current?.contains(e.target as Node)) setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [columnsOpen])

  const { data: stats } = useQuery({
    queryKey: ['domain-stats'],
    queryFn: () => getDomainStats().then(r => r.data),
  })

  const sorted = useMemo(() => {
    const arr = [...domains]
    arr.sort((a, b) => {
      const [col, dir] = sort
      let cmp = 0
      if (col === 'fqdn') cmp = a.fqdn.localeCompare(b.fqdn)
      else if (col === 'zone_status') {
        const ao = ZONE_STATUS_ORDER[a.status === 'suspended' ? 'suspended' : a.zone_status] ?? 9
        const bo = ZONE_STATUS_ORDER[b.status === 'suspended' ? 'suspended' : b.zone_status] ?? 9
        cmp = ao - bo
      }
      else if (col === 'ns_ok') cmp = (a.ns_ok ?? 1) - (b.ns_ok ?? 1)
      else if (col === 'dnssec_enabled') cmp = (b.dnssec_enabled ?? 0) - (a.dnssec_enabled ?? 0)
      else if (col === 'status') cmp = a.status.localeCompare(b.status)
      else if (col === 'tenant_name') cmp = (a.tenant_name ?? '').localeCompare(b.tenant_name ?? '')
      return dir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [domains, sort])

  const tableScrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 36,
    overscan: 10,
    getItemKey: (i) => sorted[i].id,
  })

  const visibleSelectedCount = useMemo(
    () => sorted.reduce((n, d) => n + (selectedIds.has(d.id) ? 1 : 0), 0),
    [sorted, selectedIds],
  )
  const headerChecked       = sorted.length > 0 && visibleSelectedCount === sorted.length
  const headerIndeterminate = visibleSelectedCount > 0 && visibleSelectedCount < sorted.length

  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = headerIndeterminate
  }, [headerIndeterminate])

  function onHeaderCheckboxChange() {
    if (headerChecked || headerIndeterminate) onClearSelection()
    else onSelectAll()
  }
  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{INLINE_STYLES}</style>

      {/* Stats bar */}
      <div style={{ ...s.filterBar, gap: '.5rem', flexShrink: 0 }}>
        <StatPill label={t('dashboard_domains').toLowerCase()} value={stats?.total} />
        {stats && stats.active > 0 && (
          <span style={{ fontSize: '.8125rem', color: '#64748b' }}>{stats.active} {t('dashboard_active').toLowerCase()}</span>
        )}
        {stats && stats.suspended > 0 && (
          <WarnPill label={t('dashboard_suspended').toLowerCase()} value={stats.suspended} color="#d97706" />
        )}
        <WarnPill label={t('dashboard_zoneErrors').toLowerCase()} value={stats?.zone_error} />
        <WarnPill label={t('dashboard_dirtyZones').toLowerCase()} value={stats?.zone_dirty} color="#d97706" />
        <WarnPill label={t('dashboard_nsIssues').toLowerCase()} value={stats?.ns_not_ok} />
        {stats && stats.dnssec_enabled > 0 && (
          <span style={{ fontSize: '.8125rem', color: '#64748b' }}>{stats.dnssec_enabled} {t('dashboard_dnssec')}</span>
        )}
      </div>

      {/* Filter bar */}
      <div style={{ ...s.filterBar, gap: '.5rem', flexShrink: 0, borderTop: 0 }}>
        <input
          placeholder={t('domains_searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={filterStyles.searchInput}
        />

        <div ref={labelDropdownRef} style={{ position: 'relative', minWidth: 200 }}>
          <button
            type="button"
            onClick={() => setLabelDropdownOpen(v => !v)}
            style={{
              ...filterStyles.searchInput, width: '100%', boxSizing: 'border-box' as const,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', textAlign: 'left' as const,
              outline: labelFilter ? '2px solid #2563eb' : undefined,
            }}
          >
            {labelFilter
              ? <LabelChip label={{ id: 0, key: labelFilter.includes('=') ? labelFilter.split('=')[0] : labelFilter, value: labelFilter.includes('=') ? labelFilter.split('=').slice(1).join('=') : '', color: labelSuggestions.find(sg => sg.key === (labelFilter.includes('=') ? labelFilter.split('=')[0] : labelFilter))?.color ?? null }} />
              : <span style={{ color: '#9ca3af' }}>{t('domains_labelFilterPlaceholder')}</span>}
            <span style={{ fontSize: '.65rem', color: '#9ca3af', marginLeft: 4 }}>{labelFilter ? '' : '▼'}</span>
          </button>
          {labelFilter && (
            <button
              onClick={() => { setLabelFilter(''); setLabelDropdownOpen(false) }}
              style={{ ...filterStyles.btnClear, position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
              title="Clear label filter"
            >✕</button>
          )}
          {labelDropdownOpen && (
            <div style={filterStyles.labelDropdown}>
              {labelSuggestions.flatMap(sg => {
                const items: { key: string; value: string; filter: string; color: string | null }[] = []
                items.push({ key: sg.key, value: '', filter: sg.key, color: sg.color })
                for (const v of sg.values) items.push({ key: sg.key, value: v, filter: `${sg.key}=${v}`, color: sg.color })
                return items
              }).map(item => (
                <button
                  key={item.filter}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); setLabelFilter(item.filter); setLabelDropdownOpen(false) }}
                  style={filterStyles.labelDropdownItem}
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
          <div ref={tenantDropdownRef} style={{ position: 'relative', minWidth: 200 }}>
            <button
              type="button"
              onClick={() => setTenantDropdownOpen(v => !v)}
              style={{
                ...filterStyles.searchInput, width: '100%', boxSizing: 'border-box' as const,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', textAlign: 'left' as const,
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
                style={{ ...filterStyles.btnClear, position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                title="Clear"
              >✕</button>
            )}
            {tenantDropdownOpen && (
              <div style={filterStyles.labelDropdown}>
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
                    style={{ ...filterStyles.labelDropdownItem, gap: '.5rem' }}
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

        <div ref={columnsRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={() => setColumnsOpen(v => !v)}
            title={t('domains_displayOptions')}
            aria-label={t('domains_displayOptions')}
            style={{ padding: '.3125rem .5rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 3, cursor: 'pointer', fontSize: '.8125rem', color: '#64748b', lineHeight: 1, display: 'inline-flex', alignItems: 'center', gap: '.375rem' }}
          >
            <span style={{ fontSize: '.95rem' }}>⚙</span>
            {t('domains_columns')}
          </button>
          {columnsOpen && (
            <div style={{ ...filterStyles.labelDropdown, left: 'auto', right: 0, minWidth: 200 }}>
              {COLUMN_KEYS.map(key => (
                <button
                  key={key}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); toggleColumn(key) }}
                  style={{ ...filterStyles.labelDropdownItem, gap: '.5rem' }}
                >
                  <input type="checkbox" checked={visible[key]} readOnly style={{ pointerEvents: 'none' as const, flexShrink: 0 }} />
                  {columnLabels[key]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div ref={tableScrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2rem' }}>
            <div style={{ width: 18, height: 18, border: '2px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : domains.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('domains_noneFound')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 36 }} />
              <col />
              {visible.zone         && <col style={{ width: 110 }} />}
              {visible.ns           && <col style={{ width: 60 }} />}
              {visible.dnssec       && <col style={{ width: 80 }} />}
              {visible.status       && <col style={{ width: 90 }} />}
              {visible.tenant       && <col style={{ width: 130 }} />}
              {visible.lastRendered && <col style={{ width: 100 }} />}
              {visible.nsChecked    && <col style={{ width: 100 }} />}
              {visible.created      && <col style={{ width: 100 }} />}
              {visible.labels       && <col />}
            </colgroup>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ ...s.th, padding: '.4rem .5rem' }}>
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={headerChecked}
                    onChange={onHeaderCheckboxChange}
                    aria-label={t('bulk_selectAll')}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <SortTh label={t('domain')} col="fqdn" sort={sort} setSort={setSort} />
                {visible.zone         && <SortTh label={t('domains_zone')} col="zone_status" sort={sort} setSort={setSort} />}
                {visible.ns           && <SortTh label="NS" col="ns_ok" sort={sort} setSort={setSort} />}
                {visible.dnssec       && <SortTh label={t('dashboard_dnssec')} col="dnssec_enabled" sort={sort} setSort={setSort} />}
                {visible.status       && <SortTh label={t('status')} col="status" sort={sort} setSort={setSort} />}
                {visible.tenant       && <SortTh label={t('tenant')} col="tenant_name" sort={sort} setSort={setSort} />}
                {visible.lastRendered && <th style={{ ...s.th, color: '#64748b', whiteSpace: 'nowrap' }}>{t('domains_lastRendered')}</th>}
                {visible.nsChecked    && <th style={{ ...s.th, color: '#64748b', whiteSpace: 'nowrap' }}>{t('domains_nsChecked')}</th>}
                {visible.created      && <th style={{ ...s.th, color: '#64748b', whiteSpace: 'nowrap' }}>{t('created')}</th>}
                {visible.labels       && <th style={s.th}>{t('domains_labels')}</th>}
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr><td colSpan={visibleColCount} style={{ height: paddingTop, padding: 0, border: 0 }} /></tr>
              )}
              {virtualItems.map(vi => {
                const d = sorted[vi.index]
                const suspended = d.status === 'suspended'
                const isSelected = selectedIds.has(d.id)
                return (
                  <tr
                    key={vi.key}
                    data-index={vi.index}
                    ref={virtualizer.measureElement}
                    className="dtv-row"
                    onClick={() => navigate(`/domains/${d.fqdn}`)}
                    style={isSelected ? { background: '#eff6ff' } : undefined}
                  >
                    <td
                      style={{ ...s.td, padding: '.4rem .5rem' }}
                      onClick={e => { e.stopPropagation(); onToggleSelected(d.id) }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelected(d.id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${d.fqdn}`}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ ...s.td, fontWeight: 500 }}>
                      {d.fqdn}
                      {d.ns_reference && (
                        <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '.75rem' }}>
                          <span style={{ margin: '0 4px' }}>→</span>
                          {d.ns_reference}
                        </span>
                      )}
                    </td>
                    {visible.zone && (
                      <td style={s.td}>
                        <ZoneBadge status={d.zone_status} suspended={suspended} t={t} />
                      </td>
                    )}
                    {visible.ns && (
                      <td style={s.td}>
                        {d.ns_ok === 0
                          ? <span style={{ color: '#dc2626', fontWeight: 600, fontSize: '.8125rem' }}>⚠</span>
                          : d.ns_ok === null
                            ? <span style={{ color: '#9ca3af', fontSize: '.8125rem' }}>—</span>
                            : <span style={{ color: '#16a34a', fontSize: '.875rem' }}>✓</span>}
                      </td>
                    )}
                    {visible.dnssec && (
                      <td style={s.td}>
                        {d.dnssec_enabled
                          ? <span style={{ color: '#16a34a', fontSize: '.875rem' }}>✓</span>
                          : <span style={{ color: '#9ca3af', fontSize: '.8125rem' }}>—</span>}
                      </td>
                    )}
                    {visible.status && (
                      <td style={s.td}>
                        {suspended
                          ? <span style={{ fontSize: '.75rem', fontWeight: 500, color: '#92400e', background: '#fef3c7', borderRadius: 3, padding: '1px 6px' }}>{t('domains_suspended')}</span>
                          : <span style={{ color: '#6b7280', fontSize: '.8125rem' }}>{t('active').toLowerCase()}</span>}
                      </td>
                    )}
                    {visible.tenant && (
                      <td style={{ ...s.td, color: '#6b7280' }}>{d.tenant_name ?? '—'}</td>
                    )}
                    {(visible.lastRendered || visible.nsChecked || visible.created) && (() => {
                      const cell = { ...s.td, color: '#6b7280', fontSize: '.8125rem', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' as const }
                      const inner = { display: 'inline-block', cursor: 'default' as const }
                      const renderCell = (iso: string | null | undefined) => {
                        const r = formatRelative(iso, t)
                        return r.absolute ? <Tooltip tip={r.absolute} style={inner}>{r.label}</Tooltip> : r.label
                      }
                      return (
                        <>
                          {visible.lastRendered && <td style={cell}>{renderCell(d.last_rendered_at)}</td>}
                          {visible.nsChecked    && <td style={cell}>{renderCell(d.ns_checked_at)}</td>}
                          {visible.created      && <td style={cell}>{renderCell(d.created_at)}</td>}
                        </>
                      )
                    })()}
                    {visible.labels && (
                      <td style={s.td}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {d.labels?.map(l => <LabelChip key={l.id} label={l} />)}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
              {paddingBottom > 0 && (
                <tr><td colSpan={visibleColCount} style={{ height: paddingBottom, padding: 0, border: 0 }} /></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const filterStyles: Record<string, React.CSSProperties> = {
  searchInput: { padding: '.3125rem .5rem', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.8125rem', minWidth: 200, background: '#fff', outline: 'none' },
  btnClear: { padding: '.2rem .4rem', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '.8125rem', lineHeight: 1 },
  labelDropdown: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2, background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20, maxHeight: 240, overflowY: 'auto', padding: '4px 0' },
  labelDropdownItem: { display: 'flex', alignItems: 'center', width: '100%', padding: '.25rem .5rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '.8125rem' },
}
