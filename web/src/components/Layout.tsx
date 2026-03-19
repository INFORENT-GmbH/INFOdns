import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useWs } from '../hooks/useWs'
import { useI18n } from '../i18n/I18nContext'
import { getNsStatus } from '../api/client'
import logo from '../assets/logo.png'

export default function Layout() {
  const { user, accessToken, logout } = useAuth()
  const { t, locale, setLocale } = useI18n()
  const wsStatus = useWs(accessToken)
  const navigate = useNavigate()
  const { data: nsStatus } = useQuery({
    queryKey: ['ns-status'],
    queryFn: () => getNsStatus().then(r => r.data),
    staleTime: Infinity,
  })
  const visibleNs = user?.role === 'customer' ? ['ns2', 'ns3'] : ['ns1', 'ns2', 'ns3']

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const isAdminOrOp = user?.role === 'admin' || user?.role === 'operator'

  return (
    <div style={styles.shell}>
      <nav style={styles.nav}>
        <img src={logo} alt="INFOdns" style={styles.brand} />
        <div style={styles.links}>
          <NavLink to="/domains" style={navStyle}>{t('nav_domains')}</NavLink>
          <NavLink to="/jobs" style={navStyle}>{t('nav_jobs')}</NavLink>
          {isAdminOrOp && <NavLink to="/customers" style={navStyle}>{t('nav_customers')}</NavLink>}
          {user?.role === 'admin' && <NavLink to="/users" style={navStyle}>{t('nav_users')}</NavLink>}
          <NavLink to="/audit-logs" style={navStyle}>{t('nav_auditLog')}</NavLink>
        </div>
        <div style={styles.right}>
          <button
            onClick={() => setLocale(locale === 'de' ? 'en' : 'de')}
            style={styles.langBtn}
            title={locale === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
          >
            {locale === 'de' ? '🇬🇧 EN' : '🇩🇪 DE'}
          </button>
          <button onClick={handleLogout} style={styles.logoutBtn}>{t('nav_signOut')}</button>
        </div>
      </nav>
      <div style={styles.nsBar}>
        {visibleNs.map(name => {
          const s = nsStatus?.[name]
          return (
            <span key={name} style={styles.nsEntry}>
              <span style={{ color: !s ? '#9ca3af' : s.ok ? '#16a34a' : '#dc2626' }}>●</span>
              {' '}{name.toUpperCase()}
              {s && <span style={styles.nsLatency}>{s.ok ? `${s.latencyMs}ms` : 'down'}</span>}
            </span>
          )
        })}
      </div>
      {wsStatus === 'reconnecting' && (
        <div style={styles.wsToast}>
          <span style={styles.wsSpinner} />
          {t('ws_reconnecting')}
        </div>
      )}
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
  shell:     { display: 'flex', flexDirection: 'column', minHeight: '100vh' },
  nav:       { display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '.75rem 1.5rem', background: '#fff', borderBottom: '1px solid #e5e7eb' },
  brand:     { height: 32, marginRight: 'auto', display: 'block' },
  links:     { display: 'flex', gap: '1.25rem' },
  right:     { display: 'flex', gap: '.5rem', alignItems: 'center' },
  langBtn:   { background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .6rem', cursor: 'pointer', fontSize: '.8rem' },
  logoutBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .75rem', cursor: 'pointer', fontSize: '.875rem' },
  main:      { padding: '1.5rem', maxWidth: 1200, margin: '0 auto', width: '100%' },
  nsBar:     { display: 'flex', gap: '1.5rem', padding: '.25rem 1.5rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', color: '#6b7280' },
  nsEntry:   { display: 'flex', alignItems: 'center', gap: '.25rem' },
  nsLatency: { color: '#9ca3af', marginLeft: '.25rem' },
  wsToast:   { display: 'flex', alignItems: 'center', gap: '.5rem', background: '#1e293b', color: '#f8fafc', fontSize: '.8125rem', padding: '.5rem 1.5rem', position: 'sticky' as const, top: 0, zIndex: 50 },
  wsSpinner: { display: 'inline-block', width: 10, height: 10, border: '2px solid #94a3b8', borderTopColor: '#f8fafc', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },
}
