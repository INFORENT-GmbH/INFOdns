import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useWs } from '../hooks/useWs'
import { useI18n } from '../i18n/I18nContext'
import { getNsStatus } from '../api/client'
import logo from '../assets/logo.png'

const nsLabels: Record<string, { display: string; fqdn: string }> = {
  ns1: { display: 'NS1', fqdn: 'ns1.inforent.de' },
  ns2: { display: 'ilreah', fqdn: 'ilreah.ns.inforent.de' },
  ns3: { display: 'ulren', fqdn: 'ulren.ns.inforent.de' },
}

export default function Layout() {
  const { user, accessToken, logout } = useAuth()
  const { t, locale, setLocale } = useI18n()
  const wsStatus = useWs(accessToken)
  const navigate = useNavigate()
  const [copiedNs, setCopiedNs] = useState<string | null>(null)
  const [hoveredNs, setHoveredNs] = useState<string | null>(null)
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
          const label = nsLabels[name] ?? { display: name.toUpperCase(), fqdn: name }
          return (
            <span
              key={name}
              style={{ ...styles.nsEntry, cursor: 'pointer', position: 'relative' }}
              onMouseEnter={() => setHoveredNs(name)}
              onMouseLeave={() => setHoveredNs(null)}
              onClick={() => {
                navigator.clipboard.writeText(label.fqdn)
                setCopiedNs(name)
                setTimeout(() => setCopiedNs(prev => prev === name ? null : prev), 1500)
              }}
            >
              <span style={{ color: !s ? '#9ca3af' : s.ok ? '#16a34a' : '#dc2626' }}>●</span>
              {' '}{label.display}
              {s && <span style={styles.nsLatency}>{s.ok ? `${s.latencyMs}ms` : 'down'}</span>}
              {copiedNs === name && <span style={styles.nsCopied}>✓</span>}
              {hoveredNs === name && copiedNs !== name && (
                <span style={styles.nsTooltip}>{label.fqdn} — click to copy</span>
              )}
              {copiedNs === name && hoveredNs === name && (
                <span style={styles.nsTooltip}>Copied!</span>
              )}
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
  nsCopied:  { color: '#16a34a', marginLeft: '.25rem', fontSize: '.7rem' },
  nsTooltip: { position: 'absolute' as const, top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4, background: '#1e293b', color: '#f8fafc', padding: '.25rem .5rem', borderRadius: 4, fontSize: '.7rem', whiteSpace: 'nowrap' as const, zIndex: 10, pointerEvents: 'none' as const },
  wsToast:   { display: 'flex', alignItems: 'center', gap: '.5rem', background: '#1e293b', color: '#f8fafc', fontSize: '.8125rem', padding: '.5rem 1.5rem', position: 'sticky' as const, top: 0, zIndex: 50 },
  wsSpinner: { display: 'inline-block', width: 10, height: 10, border: '2px solid #94a3b8', borderTopColor: '#f8fafc', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },
}
