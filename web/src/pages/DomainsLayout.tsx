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

  const sidebar = (
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
  )

  const dashboard = (
    <DomainsTableView
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
  )

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
            overflowY: 'auto',
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
          overflowY: 'auto',
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
        overflowY: 'auto',
        background: '#fff',
      }}>
        {detailOpen
          ? <div key="detail" style={{ animation: 'domainPaneFadeIn 200ms ease-out' }}><Outlet /></div>
          : !isMobile && (
              <div key="dashboard" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'domainPaneFadeIn 200ms ease-out' }}>
                {dashboard}
              </div>
            )}
      </div>
    </div>
  )
}
