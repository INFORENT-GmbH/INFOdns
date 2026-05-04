import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useWs } from '../hooks/useWs'
import { useI18n } from '../i18n/I18nContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { getNsStatus } from '../api/client'

const nsLabels: Record<string, { display: string; fqdn?: string }> = {
  ns1: { display: 'primary' },
  ns2: { display: 'ilreah', fqdn: 'ilreah.ns.inforant.de' },
  ns3: { display: 'ulren',  fqdn: 'ulren.ns.inforant.de' },
}

export default function Layout() {
  const { user, accessToken, logout, stopImpersonation } = useAuth()
  const { t, locale, setLocale } = useI18n()
  const wsStatus = useWs(accessToken)
  const navigate = useNavigate()
  const location = useLocation()
  const isMobile = useIsMobile()
  const FULL_BLEED_PREFIXES = ['/domains', '/users', '/tenants', '/audit-logs', '/mail-queue', '/jobs', '/registrars', '/tld-pricing', '/templates', '/tickets']
  const fullBleed = FULL_BLEED_PREFIXES.some(p => location.pathname === p || location.pathname.startsWith(`${p}/`))
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [copiedNs, setCopiedNs] = useState<string | null>(null)
  const [hoveredNs, setHoveredNs] = useState<string | null>(null)

  const { data: nsStatus } = useQuery({
    queryKey: ['ns-status'],
    queryFn: () => getNsStatus().then(r => r.data),
  })

  const visibleNs = user?.role === 'tenant' ? ['ns2', 'ns3'] : ['ns1', 'ns2', 'ns3']
  const isImpersonating = !!user?.impersonatingId

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function closeSidebar() {
    setSidebarOpen(false)
  }

  function navItemStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
    return {
      display: 'flex',
      alignItems: 'center',
      height: 34,
      padding: isActive ? '0 12px 0 13px' : '0 12px 0 16px',
      borderLeft: isActive ? '3px solid #3b82f6' : '3px solid transparent',
      background: isActive ? 'rgba(37,99,235,.15)' : 'transparent',
      color: isActive ? '#e2e8f0' : '#94a3b8',
      textDecoration: 'none',
      fontSize: '.8125rem',
      fontWeight: isActive ? 500 : 400,
      cursor: 'pointer',
      whiteSpace: 'nowrap' as const,
      transition: 'background 0.1s, color 0.1s',
    }
  }

  function subNavItemStyle({ isActive }: { isActive: boolean }): React.CSSProperties {
    return {
      ...navItemStyle({ isActive }),
      height: 30,
      padding: isActive ? '0 12px 0 29px' : '0 12px 0 32px',
      fontSize: '.78125rem',
    }
  }

  const sidebarContent = (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
      <style>{`
        .sb-item:hover { background: #263348 !important; color: #e2e8f0 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes modal-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        @keyframes dropdown-in { from { opacity: 0; transform: translateX(-50%) translateY(-4px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>

      <NavLink to="/" end className="sb-item" style={navItemStyle} onClick={closeSidebar}>
        {t('nav_dashboard')}
      </NavLink>

      <div style={styles.sectionHeader}>{t('nav_products')}</div>
      <NavLink to="/domains" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
        {t('nav_domains')}
      </NavLink>
      <NavLink to="/templates" className="sb-item" style={subNavItemStyle} onClick={closeSidebar}>
        {t('nav_templates')}
      </NavLink>

      <div style={styles.sectionHeader}>{t('nav_help')}</div>
      <NavLink to="/tickets" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
        {t('nav_support')}
      </NavLink>

      <div style={styles.sectionHeader}>System</div>
      <NavLink to="/audit-logs" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
        {t('nav_auditLog')}
      </NavLink>

      {user?.role === 'admin' && (<>
        <div style={styles.sectionHeader}>Admin</div>
        <NavLink to="/users" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
          {t('nav_users')}
        </NavLink>
        <NavLink to="/tenants" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
          {t('nav_tenants')}
        </NavLink>
        <NavLink to="/jobs" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
          {t('nav_jobs')}
        </NavLink>
        <NavLink to="/mail-queue" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
          {t('nav_mailQueue')}
        </NavLink>
        <NavLink to="/tld-pricing" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
          TLD Pricing
        </NavLink>
        <NavLink to="/registrars" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
          Registrars
        </NavLink>
        <NavLink to="/import" className="sb-item" style={navItemStyle} onClick={closeSidebar}>
          INFOease Import
        </NavLink>
      </>)}
    </div>
  )

  return (
    <div style={styles.shell}>
      {/* Header */}
      <header style={styles.header}>
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(v => !v)}
            style={styles.hamburger}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
        )}
        <a href="/" style={{ display: 'flex', alignItems: 'center', marginRight: isMobile ? 'auto' : undefined }}>
          <img src="/inforent-original-logo.png" alt="INFORENT" style={styles.logo} />
        </a>

        {!isMobile && <div style={{ flex: 1 }} />}

        {/* NS status */}
        {!isMobile && (
          <div style={styles.nsRow}>
            {visibleNs.map(name => {
              const s = nsStatus?.[name]
              const label = nsLabels[name] ?? { display: name }
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
                  <span style={{ color: !s ? '#4b5563' : s.ok ? '#22c55e' : '#ef4444' }}>●</span>
                  {' '}<span style={{ color: '#475569' }}>{label.display}</span>
                  {s && <span style={{ color: '#94a3b8', marginLeft: '.25rem' }}>{s.ok ? `${s.latencyMs}ms` : t('layout_down')}</span>}
                  {copiedNs === name && <span style={{ color: '#22c55e', marginLeft: '.25rem', fontSize: '.7rem' }}>✓</span>}
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
        )}

        {/* Mobile: NS dots only */}
        {isMobile && (
          <div style={{ display: 'flex', gap: '.375rem', alignItems: 'center', marginRight: '.5rem' }}>
            {visibleNs.map(name => {
              const s = nsStatus?.[name]
              return (
                <span key={name} title={nsLabels[name]?.display} style={{ color: !s ? '#4b5563' : s.ok ? '#22c55e' : '#ef4444', fontSize: '.7rem' }}>●</span>
              )
            })}
          </div>
        )}

        <button
          onClick={() => setLocale(locale === 'de' ? 'en' : 'de')}
          style={styles.headerBtn}
          title={locale === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
        >
          {locale === 'de' ? 'EN' : 'DE'}
        </button>
        <NavLink to="/profile" style={styles.headerBtn} title={t('profile_title')}>
          {t('nav_profile')}
        </NavLink>
        <button onClick={handleLogout} style={styles.headerBtn}>{t('nav_signOut')}</button>
      </header>

      {/* WS reconnecting toast */}
      {wsStatus === 'reconnecting' && (
        <div style={styles.wsToast}>
          <span style={styles.wsSpinner} />
          {t('ws_reconnecting')}
        </div>
      )}

      {/* Impersonation bar */}
      {isImpersonating && (
        <div style={styles.impersonationBar}>
          {t('impersonation_active')}
          <button onClick={async () => { await stopImpersonation(); navigate('/users') }} style={styles.impersonationBtn}>
            {t('impersonation_stop')}
          </button>
        </div>
      )}

      {/* Body: sidebar + content */}
      <div style={styles.body}>
        {/* Mobile backdrop */}
        {isMobile && sidebarOpen && (
          <div
            onClick={closeSidebar}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 199 }}
          />
        )}

        {/* Sidebar */}
        <nav
          style={{
            ...styles.sidebar,
            ...(isMobile ? {
              position: 'fixed' as const,
              top: 48,
              left: 0,
              bottom: 0,
              zIndex: 200,
              transform: sidebarOpen ? 'translateX(0)' : 'translateX(-220px)',
              transition: 'transform .2s ease',
            } : {}),
          }}
        >
          {sidebarContent}
        </nav>

        {/* Content */}
        <main style={{ ...styles.content, padding: fullBleed ? 0 : (isMobile ? '.75rem' : '1.5rem'), position: 'relative' }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: '#0f172a',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '.5rem',
    height: 48,
    flexShrink: 0,
    padding: '0 12px',
    background: '#ffffff',
    borderBottom: '1px solid #e2e8f0',
  },
  logo: {
    height: 28,
    display: 'block',
  },
  hamburger: {
    background: 'none',
    border: 'none',
    color: '#374151',
    fontSize: '1.125rem',
    cursor: 'pointer',
    padding: '4px 6px',
    lineHeight: 1,
    flexShrink: 0,
  },
  nsRow: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
    fontSize: '.75rem',
    marginRight: '.5rem',
  },
  nsEntry: {
    display: 'flex',
    alignItems: 'center',
    gap: '.2rem',
  },
  nsTooltip: {
    position: 'absolute' as const,
    top: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginTop: 4,
    background: '#0f172a',
    color: '#f8fafc',
    padding: '.25rem .5rem',
    borderRadius: 4,
    fontSize: '.7rem',
    whiteSpace: 'nowrap' as const,
    zIndex: 20,
    pointerEvents: 'none' as const,
    border: '1px solid #1e293b',
  },
  headerBtn: {
    background: 'transparent',
    border: '1px solid #d1d5db',
    color: '#475569',
    borderRadius: 4,
    padding: '.25rem .6rem',
    cursor: 'pointer',
    fontSize: '.8rem',
    flexShrink: 0,
    textDecoration: 'none',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: 220,
    flexShrink: 0,
    background: '#1e293b',
    borderRight: '1px solid #2d3748',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  sectionHeader: {
    padding: '1.125rem 16px .375rem',
    fontSize: '.6875rem',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '.06em',
    color: '#475569',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    background: '#f1f5f9',
  },
  wsToast: {
    display: 'flex',
    alignItems: 'center',
    gap: '.5rem',
    background: '#1e293b',
    color: '#f8fafc',
    fontSize: '.8125rem',
    padding: '.5rem 1rem',
    flexShrink: 0,
  },
  wsSpinner: {
    display: 'inline-block',
    width: 10,
    height: 10,
    border: '2px solid #475569',
    borderTopColor: '#f8fafc',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
  impersonationBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '.75rem',
    background: '#fbbf24',
    color: '#78350f',
    fontSize: '.8125rem',
    fontWeight: 600,
    padding: '.4rem 1rem',
    flexShrink: 0,
  },
  impersonationBtn: {
    background: '#78350f',
    color: '#fef3c7',
    border: 'none',
    borderRadius: 4,
    padding: '.2rem .75rem',
    fontSize: '.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
}
