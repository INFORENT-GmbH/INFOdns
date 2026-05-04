import { useEffect, useMemo, useState } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDomains, getLabelSuggestions, getTenants, type Domain, type LabelSuggestion, type Tenant } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { usePageTitle } from '../hooks/usePageTitle'
import DomainsPage from './DomainsPage'
import DomainsTableView from './DomainsDashboard'
import { getDirtyDomainFqdns } from '../hooks/domainEditCache'
import { useIsMobile } from '../hooks/useIsMobile'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import BulkEditDrawer from '../components/bulk/BulkEditDrawer'
import BulkSelectionBar from '../components/bulk/BulkSelectionBar'
import RecordSearchModal from '../components/bulk/RecordSearchModal'
import type { BulkPayloadSeed, BulkOperation } from '../components/bulk/BulkPayloadForm'

type DomainSort = [string, 'asc' | 'desc']
const DOMAIN_FILTER_DEFAULTS = {
  search:       '',
  labelFilter:  '',
  tenantFilter: [] as number[],
  status:       '',
  zoneStatus:   '',
  nsIssues:     false,
  sort:         ['fqdn', 'asc'] as DomainSort,
}

export default function DomainsLayout() {
  usePageTitle('Domains')
  const { user } = useAuth()
  const isMobile = useIsMobile()

  const {
    filters: domainFilters,
    setFilter: setDomainFilter,
    persist: filtersPersist,
    setPersist: setFiltersPersist,
    clear: clearFilters,
    hasActive: filtersHasActive,
  } = usePersistedFilters('domains', DOMAIN_FILTER_DEFAULTS)
  const { search, labelFilter, tenantFilter, status, zoneStatus, nsIssues, sort } = domainFilters
  const setSearch = (v: string) => setDomainFilter('search', v)
  const setLabelFilter = (v: string) => setDomainFilter('labelFilter', v)
  const setTenantFilter = (v: number[]) => setDomainFilter('tenantFilter', v)
  const setStatus = (v: string) => setDomainFilter('status', v)
  const setZoneStatus = (v: string) => setDomainFilter('zoneStatus', v)
  const setNsIssues = (v: boolean) => setDomainFilter('nsIssues', v)
  const setSort = (v: DomainSort) => setDomainFilter('sort', v)

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkOpen, setBulkOpen]       = useState(false)
  const [searchOpen, setSearchOpen]   = useState(false)
  const [bulkSeed, setBulkSeed]               = useState<BulkPayloadSeed | undefined>(undefined)
  const [bulkInitialOp, setBulkInitialOp]     = useState<BulkOperation | undefined>(undefined)

  function toggleSelected(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setSelectionFromIds(ids: number[]) {
    setSelectedIds(new Set(ids))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function handleRecordSearchApply({ ids, seed }: { ids: number[]; seed: BulkPayloadSeed }) {
    setSelectedIds(new Set(ids))
    setBulkSeed(seed)
    setBulkInitialOp('replace')
    setSearchOpen(false)
    setBulkOpen(true)
  }

  function handleBulkClose() {
    setBulkOpen(false)
    setBulkSeed(undefined)
    setBulkInitialOp(undefined)
  }

  function handleBulkApproved() {
    clearSelection()
    setBulkSeed(undefined)
    setBulkInitialOp(undefined)
  }

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (getDirtyDomainFqdns().size > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const { data: labelSuggestions = [] } = useQuery<LabelSuggestion[]>({
    queryKey: ['label-suggestions'],
    queryFn: () => getLabelSuggestions().then(r => r.data),
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
    enabled: !!user,
  })

  const showDeleted = status === 'deleted'
  const { data: domains = [], isLoading } = useQuery<Domain[]>({
    queryKey: ['domains', search, labelFilter, tenantFilter.join(','), showDeleted],
    queryFn: () => {
      const params: Record<string, string> = { limit: '9999' }
      if (search) params.search = search
      if (labelFilter) params.label = labelFilter
      if (tenantFilter.length > 0) params.tenant_id = tenantFilter.join(',')
      if (showDeleted) params.show_deleted = 'true'
      return getDomains(params).then(r => r.data)
    },
  })

  // Client-side filters (server already applied search/label/tenant).
  // Both the sidebar and the dashboard render this filtered list, so the
  // counts and selection match across views.
  const filteredDomains = useMemo(() => {
    return domains.filter(d => {
      if (status && d.status !== status) return false
      if (zoneStatus && d.zone_status !== zoneStatus) return false
      if (nsIssues && d.ns_ok !== 0) return false
      return true
    })
  }, [domains, status, zoneStatus, nsIssues])

  const filtersActive = !!(search || labelFilter || tenantFilter.length > 0 || status || zoneStatus || nsIssues)
  const { data: totalDomains } = useQuery<Domain[]>({
    queryKey: ['domains', 'total'],
    queryFn: () => getDomains({ limit: '9999' }).then(r => r.data),
    enabled: filtersActive,
  })
  const totalCount = filtersActive ? totalDomains?.length : filteredDomains.length

  const match = useMatch('/domains/:name')
  const detailOpen = !!match

  const selectedDomains = useMemo(
    () => filteredDomains.filter(d => selectedIds.has(d.id)),
    [filteredDomains, selectedIds],
  )

  const sidebar = (
    <DomainsPage
      domains={filteredDomains}
      isLoading={isLoading}
      search={search}
      setSearch={setSearch}
      labelFilter={labelFilter}
      setLabelFilter={setLabelFilter}
      labelSuggestions={labelSuggestions}
      tenantFilter={tenantFilter}
      setTenantFilter={setTenantFilter}
      tenants={tenants}
      status={status}
      setStatus={setStatus}
      zoneStatus={zoneStatus}
      setZoneStatus={setZoneStatus}
      nsIssues={nsIssues}
      setNsIssues={setNsIssues}
      totalCount={totalCount}
      selectedCount={selectedIds.size}
      filtersPersist={filtersPersist}
      setFiltersPersist={setFiltersPersist}
      clearFilters={clearFilters}
      filtersHasActive={filtersHasActive}
    />
  )

  const dashboard = (
    <DomainsTableView
      domains={filteredDomains}
      isLoading={isLoading}
      search={search}
      setSearch={setSearch}
      labelFilter={labelFilter}
      setLabelFilter={setLabelFilter}
      labelSuggestions={labelSuggestions}
      tenantFilter={tenantFilter}
      setTenantFilter={setTenantFilter}
      tenants={tenants}
      status={status}
      setStatus={setStatus}
      zoneStatus={zoneStatus}
      setZoneStatus={setZoneStatus}
      nsIssues={nsIssues}
      setNsIssues={setNsIssues}
      totalCount={totalCount}
      sort={sort}
      setSort={setSort}
      selectedIds={selectedIds}
      onToggleSelected={toggleSelected}
      onSelectAll={() => setSelectionFromIds(domains.map(d => d.id))}
      onClearSelection={clearSelection}
      filtersPersist={filtersPersist}
      setFiltersPersist={setFiltersPersist}
      clearFilters={clearFilters}
      filtersHasActive={filtersHasActive}
    />
  )

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      background: '#fff',
    }}>
      <style>{`
        @keyframes domainPaneFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {!isMobile && (
        <div style={{
          width: detailOpen ? 300 : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          zIndex: 1,
        }}>
          <div style={{
            width: 300,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#fafafa',
            borderRight: '1px solid #e2e8f0',
          }}>
            {sidebar}
          </div>
        </div>
      )}

      {isMobile && !detailOpen && (
        <div style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fafafa',
          animation: 'domainPaneFadeIn 180ms ease-out',
        }}>
          {sidebar}
        </div>
      )}

      <div style={{
        flex: 1,
        display: isMobile && !detailOpen ? 'none' : 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: '#fff',
      }}>
        {detailOpen
          ? <div key="detail" style={{ flex: 1, minHeight: 0, overflowY: 'auto', animation: 'domainPaneFadeIn 200ms ease-out' }}><Outlet /></div>
          : !isMobile && (
              <>
                <div key="dashboard" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'domainPaneFadeIn 200ms ease-out' }}>
                  {dashboard}
                </div>
                <BulkSelectionBar
                  selectedCount={selectedIds.size}
                  visibleCount={selectedDomains.length}
                  onOpen={() => setBulkOpen(true)}
                  onClear={clearSelection}
                  onFindByRecord={() => setSearchOpen(true)}
                />
              </>
            )}
      </div>

      {bulkOpen && (
        <BulkEditDrawer
          selectedIds={Array.from(selectedIds)}
          visibleSelected={selectedDomains}
          seed={bulkSeed}
          initialOperation={bulkInitialOp}
          onClose={handleBulkClose}
          onApproved={handleBulkApproved}
        />
      )}

      {searchOpen && (
        <RecordSearchModal
          onClose={() => setSearchOpen(false)}
          onApply={handleRecordSearchApply}
        />
      )}
    </div>
  )
}
