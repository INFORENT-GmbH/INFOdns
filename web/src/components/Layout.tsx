import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useWs } from '../hooks/useWs'

export default function Layout() {
  const { user, accessToken, logout } = useAuth()
  useWs(accessToken)
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const isAdminOrOp = user?.role === 'admin' || user?.role === 'operator'

  return (
    <div style={styles.shell}>
      <nav style={styles.nav}>
        <span style={styles.brand}>INFOdns</span>
        <div style={styles.links}>
          <NavLink to="/domains" style={navStyle}>Domains</NavLink>
          <NavLink to="/bulk-jobs" style={navStyle}>Bulk Jobs</NavLink>
          {isAdminOrOp && <NavLink to="/customers" style={navStyle}>Customers</NavLink>}
          {user?.role === 'admin' && <NavLink to="/users" style={navStyle}>Users</NavLink>}
          <NavLink to="/audit-logs" style={navStyle}>Audit Log</NavLink>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sign out</button>
      </nav>
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

function navStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return {
    color: isActive ? '#2563eb' : '#374151',
    textDecoration: 'none',
    fontWeight: isActive ? 600 : 400,
    fontSize: '.875rem',
  }
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: 'system-ui,sans-serif' },
  nav: { display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '.75rem 1.5rem', background: '#fff', borderBottom: '1px solid #e5e7eb' },
  brand: { fontWeight: 700, fontSize: '1.125rem', marginRight: 'auto' },
  links: { display: 'flex', gap: '1.25rem' },
  logoutBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .75rem', cursor: 'pointer', fontSize: '.875rem' },
  main: { padding: '1.5rem', maxWidth: 1200, margin: '0 auto', width: '100%' },
}
