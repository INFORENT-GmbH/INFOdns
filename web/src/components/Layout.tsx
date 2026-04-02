import { useState, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useWs } from '../hooks/useWs'
import { useI18n } from '../i18n/I18nContext'
import { getNsStatus } from '../api/client'

const nsLabels: Record<string, { display: string; fqdn?: string }> = {
  ns1: { display: 'primary' },
  ns2: { display: 'ilreah', fqdn: 'ilreah.ns.inforant.de' },
  ns3: { display: 'ulren', fqdn: 'ulren.ns.inforant.de' },
}

export default function Layout() {
  const { user, accessToken, logout, stopImpersonation } = useAuth()
  const { t, locale, setLocale } = useI18n()
  const wsStatus = useWs(accessToken)
  const navigate = useNavigate()
  const [copiedNs, setCopiedNs] = useState<string | null>(null)
  const [hoveredNs, setHoveredNs] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const logsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { pathname } = useLocation()
  const logsActive = pathname.startsWith('/audit-logs') || pathname.startsWith('/mail-queue')

  function openLogs() {
    if (logsTimer.current) clearTimeout(logsTimer.current)
    setShowLogs(true)
  }
  function closeLogs() {
    logsTimer.current = setTimeout(() => setShowLogs(false), 120)
  }
  const { data: nsStatus } = useQuery({
    queryKey: ['ns-status'],
    queryFn: () => getNsStatus().then(r => r.data),
    staleTime: Infinity,
  })
  const visibleNs = user?.role === 'tenant' ? ['ns2', 'ns3'] : ['ns1', 'ns2', 'ns3']
  const isImpersonating = !!user?.impersonatingId

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const isAdminOrOp = user?.role === 'admin' || user?.role === 'operator'

  return (
    <div style={styles.shell}>
      <style>{`
        .tip { position: relative; display: inline-block; }
        .tip::after {
          content: attr(data-tip);
          position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
          background: #1f2937; color: #f9fafb; font-size: .75rem; font-weight: 400;
          padding: 5px 8px; border-radius: 5px; white-space: normal; width: max-content; max-width: 220px;
          pointer-events: none; opacity: 0; transition: opacity 0s; z-index: 9999;
        }
        .tip:hover::after { opacity: 1; }
      `}</style>
      <nav style={styles.nav}>
        <a href="/domains" style={{ marginRight: 'auto', display: 'flex' }}><img src="/logo-wide.png" alt="INFOdns" style={styles.brand} /></a>
        <div style={styles.links}>
          <NavLink to="/domains" style={navStyle}>{t('nav_domains')}</NavLink>
          <NavLink to="/jobs" style={navStyle}>{t('nav_jobs')}</NavLink>
          <NavLink to="/tickets" style={navStyle}>{t('nav_support')}</NavLink>
          {isAdminOrOp && <NavLink to="/tenants" style={navStyle}>{t('nav_tenants')}</NavLink>}
          {user?.role === 'admin' && <NavLink to="/users" style={navStyle}>{t('nav_users')}</NavLink>}
          <div style={{ position: 'relative' }} onMouseEnter={openLogs} onMouseLeave={closeLogs}>
            <span style={{ ...navStyle({ isActive: logsActive }), cursor: 'pointer', userSelect: 'none' }}>
              {t('nav_logs')} ▾
            </span>
            {showLogs && (
              <div style={styles.dropdown} onMouseEnter={openLogs} onMouseLeave={closeLogs}>
                <NavLink to="/audit-logs" style={dropdownItemStyle} onClick={() => setShowLogs(false)}>{t('nav_auditLog')}</NavLink>
                {user?.role === 'admin' && <NavLink to="/mail-queue" style={dropdownItemStyle} onClick={() => setShowLogs(false)}>{t('nav_mailQueue')}</NavLink>}
              </div>
            )}
          </div>
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
          const label = nsLabels[name] ?? { display: name.toUpperCase() }
          const hasFqdn = !!label.fqdn
          return (
            <span
              key={name}
              style={{ ...styles.nsEntry, cursor: hasFqdn ? 'pointer' : 'default', position: 'relative' }}
              onMouseEnter={() => hasFqdn && setHoveredNs(name)}
              onMouseLeave={() => setHoveredNs(null)}
              onClick={() => {
                if (!hasFqdn) return
                navigator.clipboard.writeText(label.fqdn!)
                setCopiedNs(name)
                setTimeout(() => setCopiedNs(prev => prev === name ? null : prev), 1500)
              }}
            >
              <span style={{ color: !s ? '#9ca3af' : s.ok ? '#16a34a' : '#dc2626' }}>●</span>
              {' '}{label.display}
              {s && <span style={styles.nsLatency}>{s.ok ? `${s.latencyMs}ms` : t('layout_down')}</span>}
              {copiedNs === name && <span style={styles.nsCopied}>✓</span>}
              {hoveredNs === name && copiedNs !== name && (
                <span style={styles.nsTooltip}>{t('layout_clickToCopy', label.fqdn)}</span>
              )}
              {copiedNs === name && hoveredNs === name && (
                <span style={styles.nsTooltip}>{t('layout_copied')}</span>
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
      {isImpersonating && (
        <div style={styles.impersonationBar}>
          {t('impersonation_active')}
          <button onClick={async () => { await stopImpersonation(); navigate('/users') }} style={styles.impersonationBtn}>
            {t('impersonation_stop')}
          </button>
        </div>
      )}
      <main style={styles.main}>
        <Outlet />
      </main>
      <footer style={styles.footer}>
        &copy; 1988&ndash;2026 INFORENT GmbH
      </footer>
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

function dropdownItemStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
  return {
    display: 'block',
    padding: '.5rem .875rem',
    color: isActive ? '#2563eb' : '#374151',
    textDecoration: 'none',
    fontWeight: isActive ? 600 : 400,
    fontSize: '.875rem',
    whiteSpace: 'nowrap',
    background: isActive ? '#eff6ff' : 'transparent',
  }
}

const styles: Record<string, React.CSSProperties> = {
  shell:     { display: 'flex', flexDirection: 'column', minHeight: '100vh', maxWidth: 1920 },
  nav:       { display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '.75rem 1.5rem', background: 'linear-gradient(rgba(255,255,255,0.85), rgba(255,255,255,0.65)), url(/header-skyline.png) no-repeat bottom center', backgroundSize: 'auto, 800px 123px', maxWidth: 1920, borderBottom: '1px solid #e5e7eb' },
  brand:     { height: 42, display: 'block' },
  links:     { display: 'flex', gap: '1.25rem' },
  right:     { display: 'flex', gap: '.5rem', alignItems: 'center' },
  langBtn:   { background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .6rem', cursor: 'pointer', fontSize: '.8rem' },
  logoutBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .75rem', cursor: 'pointer', fontSize: '.875rem' },
  main:      { padding: '1.5rem', maxWidth: 1200, margin: '0 auto', width: '100%', background: 'rgba(255,255,255,0.92)', borderRadius: 8, marginTop: '1rem', marginBottom: '1rem' },
  nsBar:     { display: 'flex', gap: '1.5rem', padding: '.25rem 1.5rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', color: '#6b7280' },
  nsEntry:   { display: 'flex', alignItems: 'center', gap: '.25rem' },
  nsLatency: { color: '#9ca3af', marginLeft: '.25rem' },
  nsCopied:  { color: '#16a34a', marginLeft: '.25rem', fontSize: '.7rem' },
  nsTooltip: { position: 'absolute' as const, top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 4, background: '#1e293b', color: '#f8fafc', padding: '.25rem .5rem', borderRadius: 4, fontSize: '.7rem', whiteSpace: 'nowrap' as const, zIndex: 20, pointerEvents: 'none' as const },
  wsToast:   { display: 'flex', alignItems: 'center', gap: '.5rem', background: '#1e293b', color: '#f8fafc', fontSize: '.8125rem', padding: '.5rem 1.5rem', position: 'sticky' as const, top: 0, zIndex: 50 },
  wsSpinner: { display: 'inline-block', width: 10, height: 10, border: '2px solid #94a3b8', borderTopColor: '#f8fafc', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 },
  impersonationBar: { display: 'flex', alignItems: 'center', gap: '.75rem', background: '#fbbf24', color: '#78350f', fontSize: '.8125rem', fontWeight: 600, padding: '.5rem 1.5rem', position: 'sticky' as const, top: 0, zIndex: 49 },
  impersonationBtn: { background: '#78350f', color: '#fef3c7', border: 'none', borderRadius: 4, padding: '.25rem .75rem', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' },
  dropdown:  { position: 'absolute' as const, top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.08)', zIndex: 100, minWidth: 140 },
  footer:    { textAlign: 'center' as const, padding: '.75rem', fontSize: '.75rem', color: '#9ca3af', borderTop: '1px solid #e5e7eb', marginTop: 'auto' },
}
