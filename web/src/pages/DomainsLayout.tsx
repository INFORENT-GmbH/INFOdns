import { useEffect } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import DomainsPage from './DomainsPage'
import DomainsDashboard from './DomainsDashboard'
import { getDirtyDomainFqdns } from '../hooks/domainEditCache'
import { useIsMobile } from '../hooks/useIsMobile'

export default function DomainsLayout() {
  const isMobile = useIsMobile()

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
      }}>
        <DomainsPage />
      </div>
      <div style={{
        flex: 1,
        display: isMobile && !detailOpen ? 'none' : 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        background: '#fff',
      }}>
        {detailOpen ? <Outlet /> : <DomainsDashboard />}
      </div>
    </div>
  )
}
