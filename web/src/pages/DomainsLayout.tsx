import { Outlet, useMatch } from 'react-router-dom'
import DomainsPage from './DomainsPage'

export default function DomainsLayout() {
  const match = useMatch('/domains/:id')
  const detailOpen = !!match

  if (detailOpen) {
    return (
      <div style={{ position: 'fixed', top: 94, left: 0, right: 0, bottom: 0, display: 'flex', zIndex: 10, background: '#f3f4f6' }}>
        <div style={{ width: 290, overflowY: 'auto', borderRight: '1px solid #e5e7eb', flexShrink: 0, background: '#fff' }}>
          <DomainsPage condensed />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: '#fff', padding: '1.5rem' }}>
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
