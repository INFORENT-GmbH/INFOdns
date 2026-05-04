import { useMemo, useState } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useQuery } from '@tanstack/react-query'
import { getAuditLogs, getTenants, type AuditLog } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import ListTable from '../components/ListTable'
import MasterDetailLayout from '../components/MasterDetailLayout'
import { useI18n } from '../i18n/I18nContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import * as s from '../styles/shell'

const ACTIONS = ['create', 'update', 'delete', 'bulk_apply']
const LIMIT = 50

const AUDIT_FILTER_DEFAULTS = { domain_id: '', user_id: '', tenant_id: '', entity_type: '', action: '', from: '', to: '' }

export default function AuditLogPage() {
  usePageTitle('Audit Log')
  const { t } = useI18n()
  const { user } = useAuth()
  const isStaff = user?.role === 'admin' || user?.role === 'operator'
  const {
    filters, setFilter: setFilterInternal,
    persist: filtersPersist, setPersist: setFiltersPersist,
    clear: clearFiltersInternal, hasActive: filtersHasActive,
  } = usePersistedFilters('audit', AUDIT_FILTER_DEFAULTS)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  function setFilter(key: keyof typeof AUDIT_FILTER_DEFAULTS, value: string) {
    setFilterInternal(key, value)
    setPage(1)
  }

  function clearFilters() {
    clearFiltersInternal()
    setPage(1)
  }

  const params: Record<string, string> = {
    page: String(page),
    limit: String(LIMIT),
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => getAuditLogs(params).then(r => r.data),
    placeholderData: (prev) => prev,
  })

  const { data: tenantsList = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
    enabled: isStaff,
  })

  const logs: AuditLog[] = data?.data ?? []
  const totalPages = data?.pages ?? 1
  const total = data?.total ?? 0
  const entityTypes = data?.entityTypes ?? []

  const selectedLog: AuditLog | null = useMemo(
    () => selectedId !== null ? logs.find(l => l.id === selectedId) ?? null : null,
    [logs, selectedId]
  )

  const actionLabel = filters.action || t('audit_allActions')
  const entityLabel = filters.entity_type || t('audit_allEntities')
  const tenantLabel = filters.tenant_id
    ? (tenantsList.find(c => String(c.id) === filters.tenant_id)?.name ?? `#${filters.tenant_id}`)
    : t('audit_allTenants')

  // Shared filter bars
  const filterBars = (
    <>
      <FilterBar>
        <span style={localStyles.countPill}>
          {total > 0
            ? `${total.toLocaleString()} ${t('audit_entries')}`
            : t('audit_noEntries')}
        </span>
      </FilterBar>
      <FilterBar>
        <SearchInput value={filters.domain_id} onChange={v => setFilter('domain_id', v)} placeholder={t('audit_domainId')} width={140} />
        <SearchInput value={filters.user_id} onChange={v => setFilter('user_id', v)} placeholder={t('audit_userId')} width={140} />
        <Dropdown
          label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: filters.action ? '#111827' : '#9ca3af' }}>{actionLabel}</span>}
          active={!!filters.action}
          onClear={() => setFilter('action', '')}
          width={160}
        >
          {close => (
            <>
              <DropdownItem onSelect={() => { setFilter('action', ''); close() }}><span style={{ color: '#6b7280' }}>{t('audit_allActions')}</span></DropdownItem>
              {ACTIONS.map(a => <DropdownItem key={a} onSelect={() => { setFilter('action', a); close() }}>{a}</DropdownItem>)}
            </>
          )}
        </Dropdown>
        {entityTypes.length > 0 && (
          <Dropdown
            label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: filters.entity_type ? '#111827' : '#9ca3af' }}>{entityLabel}</span>}
            active={!!filters.entity_type}
            onClear={() => setFilter('entity_type', '')}
            width={160}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setFilter('entity_type', ''); close() }}><span style={{ color: '#6b7280' }}>{t('audit_allEntities')}</span></DropdownItem>
                {entityTypes.map(et => <DropdownItem key={et} onSelect={() => { setFilter('entity_type', et); close() }}>{et}</DropdownItem>)}
              </>
            )}
          </Dropdown>
        )}
        {isStaff && tenantsList.length > 1 && (
          <Dropdown
            label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: filters.tenant_id ? '#111827' : '#9ca3af' }}>{tenantLabel}</span>}
            active={!!filters.tenant_id}
            onClear={() => setFilter('tenant_id', '')}
            width={180}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setFilter('tenant_id', ''); close() }}><span style={{ color: '#6b7280' }}>{t('audit_allTenants')}</span></DropdownItem>
                {tenantsList.map(c => <DropdownItem key={c.id} onSelect={() => { setFilter('tenant_id', String(c.id)); close() }}>{c.name}</DropdownItem>)}
              </>
            )}
          </Dropdown>
        )}
        <input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} style={localStyles.dateInput} title={t('audit_fromDate')} />
        <input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} style={localStyles.dateInput} title={t('audit_toDate')} />
        <FilterPersistControls
          persist={filtersPersist}
          setPersist={setFiltersPersist}
          onClear={clearFilters}
          hasActive={filtersHasActive}
          style={{ marginLeft: 'auto' }}
        />
      </FilterBar>
    </>
  )

  // Pagination footer
  const pagination = totalPages > 1 && (
    <div style={localStyles.pagination}>
      <button style={localStyles.pageBtn} disabled={page === 1} onClick={() => setPage(1)}>«</button>
      <button style={localStyles.pageBtn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
      <span style={localStyles.pageInfo}>{t('audit_page')} {page} {t('audit_of')} {totalPages}</span>
      <button style={localStyles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
      <button style={localStyles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</button>
    </div>
  )

  // ── Dashboard ──────────────────────────────────────────────────
  const dashboard = (
    <>
      {filterBars}
      <ListTable>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', transition: 'opacity .15s', opacity: isFetching ? 0.6 : 1 }}>
            <thead>
              <tr>
                <th style={s.th}>{t('audit_time')}</th>
                <th style={s.th}>{t('audit_user')}</th>
                <th style={s.th}>{t('audit_action')}</th>
                <th style={s.th}>{t('audit_entity')}</th>
                <th style={s.th}>{t('domain')}</th>
                <th style={s.th}>{t('audit_ip')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const isSel = selectedId === log.id
                return (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedId(log.id)}
                    style={{ cursor: 'pointer', background: isSel ? '#eff6ff' : undefined }}
                    onMouseOver={e => { if (!isSel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseOut={e => { if (!isSel) e.currentTarget.style.background = '' }}
                  >
                    <td style={localStyles.tdMono}>{new Date(log.created_at).toLocaleString()}</td>
                    <td style={s.td}>{log.user_id ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={s.td}><ActionBadge action={log.action} /></td>
                    <td style={s.td}><code style={localStyles.code}>{log.entity_type}</code></td>
                    <td style={s.td}>{log.domain_id ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={localStyles.tdMono}>{log.ip_address ?? <span style={localStyles.muted}>—</span>}</td>
                  </tr>
                )
              })}
              {logs.length === 0 && (
                <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#9ca3af' }}>{t('audit_noEntries')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </ListTable>
      {pagination}
    </>
  )

  // ── Sidebar ────────────────────────────────────────────────────
  const sidebar = (
    <>
      <FilterBar>
        <Dropdown
          label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: filters.action ? '#111827' : '#9ca3af' }}>{actionLabel}</span>}
          active={!!filters.action}
          onClear={() => setFilter('action', '')}
          width="100%"
        >
          {close => (
            <>
              <DropdownItem onSelect={() => { setFilter('action', ''); close() }}><span style={{ color: '#6b7280' }}>{t('audit_allActions')}</span></DropdownItem>
              {ACTIONS.map(a => <DropdownItem key={a} onSelect={() => { setFilter('action', a); close() }}>{a}</DropdownItem>)}
            </>
          )}
        </Dropdown>
      </FilterBar>
      <ListTable>
        {logs.map(log => {
          const isSel = selectedId === log.id
          return (
            <div
              key={log.id}
              onClick={() => setSelectedId(log.id)}
              style={{
                padding: '.5rem .75rem',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                background: isSel ? '#eff6ff' : 'transparent',
              }}
            >
              <div style={{ fontSize: '.7rem', color: '#94a3b8' }}>
                {new Date(log.created_at).toLocaleString()}
              </div>
              <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                <ActionBadge action={log.action} />
                <code style={localStyles.code}>{log.entity_type}</code>
              </div>
            </div>
          )
        })}
      </ListTable>
      {pagination}
    </>
  )

  // ── Detail pane ────────────────────────────────────────────────
  const detailPane = (
    <div style={localStyles.detailPane}>
      <div style={localStyles.detailHeader}>
        <button onClick={() => setSelectedId(null)} style={localStyles.backBtn}>← {t('cancel')}</button>
        <h3 style={localStyles.detailTitle}>{t('audit_title')} #{selectedLog?.id}</h3>
        {selectedLog && <ActionBadge action={selectedLog.action} />}
      </div>

      {selectedLog && (
        <div style={localStyles.formBody}>
          <div style={localStyles.metaGrid}>
            <div><strong>{t('audit_time')}:</strong> {new Date(selectedLog.created_at).toLocaleString()}</div>
            <div><strong>{t('audit_user')}:</strong> {selectedLog.user_id ?? '—'}</div>
            <div><strong>{t('audit_entity')}:</strong> <code style={localStyles.code}>{selectedLog.entity_type}</code></div>
            <div><strong>{t('domain')}:</strong> {selectedLog.domain_id ?? '—'}</div>
            <div><strong>{t('audit_ip')}:</strong> {selectedLog.ip_address ?? '—'}</div>
          </div>

          {(selectedLog.old_value != null || selectedLog.new_value != null) ? (
            <div style={localStyles.diffGrid}>
              {selectedLog.old_value != null && (
                <div>
                  <div style={{ ...localStyles.diffLabel, color: '#b91c1c' }}>{t('audit_before')}</div>
                  <pre style={{ ...localStyles.diffPre, borderColor: '#fecaca' }}>
                    {JSON.stringify(selectedLog.old_value, null, 2)}
                  </pre>
                </div>
              )}
              {selectedLog.new_value != null && (
                <div>
                  <div style={{ ...localStyles.diffLabel, color: '#15803d' }}>{t('audit_after')}</div>
                  <pre style={{ ...localStyles.diffPre, borderColor: '#bbf7d0' }}>
                    {JSON.stringify(selectedLog.new_value, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div style={localStyles.muted}>No diff for this entry.</div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <MasterDetailLayout
      dashboard={dashboard}
      sidebar={sidebar}
      detail={detailPane}
      isOpen={selectedId !== null}
    />
  )
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    create:     { bg: '#dcfce7', text: '#15803d' },
    update:     { bg: '#dbeafe', text: '#1d4ed8' },
    delete:     { bg: '#fee2e2', text: '#b91c1c' },
    bulk_apply: { bg: '#ede9fe', text: '#7c3aed' },
  }
  const c = colors[action] ?? { bg: '#f3f4f6', text: '#374151' }
  return (
    <span style={{ background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 12, fontSize: '.75rem', fontWeight: 600 }}>
      {action}
    </span>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  countPill:    { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  dateInput:    { padding: '.3125rem .5rem', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.8125rem', background: '#fff', outline: 'none' },
  detailPane:   { padding: '1rem 1.5rem' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  detailTitle:  { margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b', flex: 1 },
  backBtn:      { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '.875rem', padding: 0 },
  formBody:     { display: 'flex', flexDirection: 'column' as const, gap: '1rem' },
  metaGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.5rem 1rem', fontSize: '.8125rem', color: '#374151' },
  tdMono:       { padding: '.4375rem .75rem', fontSize: '.8125rem', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", verticalAlign: 'middle' as const, color: '#374151', borderBottom: '1px solid #f1f5f9' },
  code:         { background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, fontSize: '.8125rem' },
  muted:        { color: '#94a3b8', fontSize: '.875rem' },
  diffGrid:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  diffLabel:    { fontSize: '.75rem', fontWeight: 600, marginBottom: '.25rem', color: '#64748b' },
  diffPre:      { fontSize: '.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '.5rem', overflow: 'auto', maxHeight: 400, margin: 0 },
  pagination:   { display: 'flex', alignItems: 'center', gap: '.5rem', justifyContent: 'center', padding: '.75rem 0', borderTop: '1px solid #e2e8f0', flexShrink: 0 },
  pageBtn:      { padding: '.25rem .6rem', border: '1px solid #e2e8f0', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '.8125rem', color: '#374151' },
  pageInfo:     { fontSize: '.8125rem', color: '#64748b', padding: '0 .5rem' },
}
