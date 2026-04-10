import { useEffect } from 'react'
import { Outlet, useMatch } from 'react-router-dom'
import DomainsPage from './DomainsPage'
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

  if (detailOpen) {
    return (
      <div style={{ position: 'fixed', top: 94, left: 0, right: 0, bottom: 0, display: 'flex', zIndex: 10, background: '#f3f4f6' }}>
        <div style={{ width: 300, overflowY: 'auto', borderRight: '1px solid #e5e7eb', flexShrink: 0, background: '#fff' }}>
          <DomainsPage condensed />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: '#fff', padding: '1rem' }}>
          <Outlet />
        </div>
      </div>
    )
  }

  return (
    <>
      <DomainsPage />
      <Outlet />
    </>
  )
}
