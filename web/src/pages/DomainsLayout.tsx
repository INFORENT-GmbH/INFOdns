import { useEffect } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import DomainsPage from './DomainsPage'
import DomainsDashboard from './DomainsDashboard'
import { getDirtyDomainIds } from '../hooks/domainEditCache'

export default function DomainsLayout() {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (getDirtyDomainIds().size > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const match = useMatch('/domains/:id')
  const detailOpen = !!match

  return (
    <div style={{ position: 'fixed', top: 'calc(94px + 1rem)', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 3rem)', maxWidth: 1200, bottom: '1rem', display: 'flex', zIndex: 10, background: 'rgba(255,255,255,0.92)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ width: 300, overflowY: 'auto', borderRight: '1px solid #e5e7eb', flexShrink: 0, background: '#fff' }}>
        <DomainsPage />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: '#fff', padding: '1rem' }}>
        {detailOpen ? <Outlet /> : <DomainsDashboard />}
      </div>
    </div>
  )
}
