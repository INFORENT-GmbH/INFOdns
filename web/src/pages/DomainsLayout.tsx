import { useEffect, useState } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDomains, getLabelSuggestions, getTenants, type Domain, type LabelSuggestion, type Tenant } from '../api/client'
import { useAuth } from '../context/AuthContext'
import DomainsPage from './DomainsPage'
import DomainsTableView from './DomainsDashboard'
import { getDirtyDomainFqdns } from '../hooks/domainEditCache'
import { useIsMobile } from '../hooks/useIsMobile'

export default function DomainsLayout() {
  const { user } = useAuth()
  const isMobile = useIsMobile()

  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [tenantFilter, setTenantFilter] = useState<number[]>([])

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
    staleTime: 30_000,
  })

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
    enabled: !!user,
  })

  const { data: domains = [], isLoading } = useQuery<Domain[]>({
    queryKey: ['domains', search, labelFilter, tenantFilter.join(',')],
    queryFn: () => {
      const params: Record<string, string> = { limit: '9999' }
      if (search) params.search = search
      if (labelFilter) params.label = labelFilter
      if (tenantFilter.length > 0) params.tenant_id = tenantFilter.join(',')
      return getDomains(params).then(r => r.data)
    },
  })

  const match = useMatch('/domains/:name')
  const detailOpen = !!match

  return (
    <div style={{
      position: 'fixed',
      top: 48,
      left: isMobile ? 0 : 220,
      right: 0,
      bottom: 0,
      display: 'flex',
      zIndex: 10,
      background: '#fff',
    }}>
      <div style={{
        width: isMobile ? '100%' : 300,
        display: isMobile && detailOpen ? 'none' : 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        borderRight: '1px solid #e2e8f0',
        flexShrink: 0,
        background: '#fafafa',
        position: 'relative',
        zIndex: 1,
      }}>
        <DomainsPage
          domains={domains}
          isLoading={isLoading}
          search={search}
          setSearch={setSearch}
          labelFilter={labelFilter}
          setLabelFilter={setLabelFilter}
          labelSuggestions={labelSuggestions}
          tenantFilter={tenantFilter}
          setTenantFilter={setTenantFilter}
          tenants={tenants}
        />
      </div>
      <div style={{
        flex: 1,
        display: isMobile && !detailOpen ? 'none' : 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        background: '#fff',
      }}>
        {detailOpen
          ? <Outlet />
          : <DomainsTableView domains={domains} isLoading={isLoading} />}
      </div>
    </div>
  )
}
