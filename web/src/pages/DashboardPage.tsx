import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../hooks/usePageTitle'
import { Link } from 'react-router-dom'
import {
  getDomainStats,
  getNsStatus,
  getAuditLogs,
  getTickets,
  type AuditLog,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

const NS_LABELS: Record<string, string> = {
  ns1: 'primary',
  ns2: 'ilreah.ns.inforant.de',
  ns3: 'ulren.ns.inforant.de',
}

export default function DashboardPage() {
  usePageTitle('Dashboard')
  const { t } = useI18n()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isStaff = user?.role === 'admin' || user?.role === 'operator'

  const { data: stats } = useQuery({
    queryKey: ['domain-stats'],
    queryFn: () => getDomainStats().then(r => r.data),
  })

  const { data: nsStatus } = useQuery({
    queryKey: ['ns-status'],
    queryFn: () => getNsStatus().then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: audit } = useQuery({
    queryKey: ['audit-logs', { page: '1', limit: '10' }],
    queryFn: () => getAuditLogs({ page: '1', limit: '10' }).then(r => r.data),
    enabled: isStaff,
  })

  const { data: openTickets } = useQuery({
    queryKey: ['tickets', { status: 'open', limit: '5' }],
    queryFn: () => getTickets({ status: 'open', page: '1', limit: '5' }).then(r => r.data),
  })

  const visibleNs = user?.role === 'tenant' ? ['ns2', 'ns3'] : ['ns1', 'ns2', 'ns3']

  const zoneClean = stats ? Math.max(0, stats.active - (stats.zone_error ?? 0) - (stats.zone_dirty ?? 0)) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1280 }}>
      <h1 style={S.title}>{t('dashboard_title')}</h1>

      {/* Stat cards */}
      <div style={S.statGrid}>
        <StatCard
          label={t('dashboard_domains')}
          value={stats?.total ?? 0}
          to="/domains"
        />
        <StatCard
          label={t('dashboard_active')}
          value={stats?.active ?? 0}
          color="#16a34a"
        />
        <StatCard
          label={t('dashboard_suspended')}
          value={stats?.suspended ?? 0}
          color={stats && stats.suspended > 0 ? '#d97706' : undefined}
        />
        <StatCard
          label={t('dashboard_zoneErrors')}
          value={stats?.zone_error ?? 0}
          color={stats && stats.zone_error > 0 ? '#dc2626' : undefined}
        />
      </div>

      <div style={S.twoCol}>
        {/* Left column */}
        <div style={S.colStack}>
          {/* Zone health */}
          <Panel title={t('dashboard_domainHealth')}>
            {!stats || stats.total === 0 ? (
              <Empty>—</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <HealthBar
                  label={t('zone_clean')}
                  value={zoneClean}
                  total={stats.active || 1}
                  color="#16a34a"
                />
                <HealthBar
                  label={t('dashboard_dirtyZones')}
                  value={stats.zone_dirty}
                  total={stats.active || 1}
                  color="#d97706"
                />
                <HealthBar
                  label={t('dashboard_zoneErrors')}
                  value={stats.zone_error}
                  total={stats.active || 1}
                  color="#dc2626"
                />
              </div>
            )}
          </Panel>

          {/* Technical health */}
          <Panel title={t('dashboard_technicalHealth')}>
            {!stats ? <Empty>—</Empty> : (
              <div style={S.kvGrid}>
                <KV label={t('dashboard_dnssec')} value={stats.dnssec_enabled} />
                <KV
                  label={t('dashboard_nsIssues')}
                  value={stats.ns_not_ok}
                  warn={stats.ns_not_ok > 0}
                />
                <KV label={t('dashboard_nsRef')} value={stats.ns_ref} />
                <KV label={t('dashboard_pending')} value={stats.pending} />
              </div>
            )}
          </Panel>

          {/* Top tenants — admins only */}
          {isAdmin && stats && stats.top_tenants && stats.top_tenants.length > 0 && (
            <Panel title={t('dashboard_topTenants')}>
              <table style={S.table}>
                <tbody>
                  {stats.top_tenants.slice(0, 8).map((row, i) => (
                    <tr key={i}>
                      <td style={S.tdName}>{row.tenant_name}</td>
                      <td style={S.tdCount}>{row.domain_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>

        {/* Right column */}
        <div style={S.colStack}>
          {/* NS Status */}
          <Panel title={t('dashboard_nsStatus')}>
            <table style={S.table}>
              <tbody>
                {visibleNs.map(name => {
                  const e = nsStatus?.[name]
                  return (
                    <tr key={name}>
                      <td style={S.tdName}>
                        <span style={{ color: !e ? '#9ca3af' : e.ok ? '#22c55e' : '#ef4444', marginRight: 6 }}>●</span>
                        {NS_LABELS[name] ?? name}
                      </td>
                      <td style={S.tdCount}>
                        {!e
                          ? <span style={{ color: '#9ca3af' }}>—</span>
                          : e.ok
                            ? <span style={{ color: '#64748b' }}>{e.latencyMs}ms</span>
                            : <span style={{ color: '#dc2626', fontWeight: 600 }}>{t('layout_down')}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>

          {/* Open tickets */}
          <Panel
            title={t('dashboard_openTickets')}
            action={<Link to="/tickets" style={S.link}>{t('dashboard_viewAll')}</Link>}
          >
            {!openTickets || openTickets.data.length === 0 ? (
              <Empty>{t('dashboard_noOpenTickets')}</Empty>
            ) : (
              <table style={S.table}>
                <tbody>
                  {openTickets.data.map(ticket => (
                    <tr key={ticket.id}>
                      <td style={S.tdName}>
                        <Link to={`/tickets/${ticket.id}`} style={S.link}>
                          {ticket.subject || `#${ticket.id}`}
                        </Link>
                      </td>
                      <td style={S.tdCount}>
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {/* Recent activity — staff only */}
          {isStaff && (
            <Panel
              title={t('dashboard_recentActivity')}
              action={<Link to="/audit-logs" style={S.link}>{t('dashboard_viewAll')}</Link>}
            >
              {!audit || audit.data.length === 0 ? (
                <Empty>{t('dashboard_noActivity')}</Empty>
              ) : (
                <ul style={S.activityList}>
                  {audit.data.slice(0, 8).map(log => (
                    <ActivityItem key={log.id} log={log} />
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color, to }: { label: string; value: number; color?: string; to?: string }) {
  const card = (
    <div style={S.statCard}>
      <div style={{ ...S.statValue, color: color ?? '#1e293b' }}>{value.toLocaleString()}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  )
  if (to) return <Link to={to} style={{ textDecoration: 'none' }}>{card}</Link>
  return card
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={S.panel}>
      <div style={S.panelHeader}>
        <span style={S.panelTitle}>{title}</span>
        {action}
      </div>
      <div style={S.panelBody}>{children}</div>
    </div>
  )
}

function HealthBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8125rem', marginBottom: 3 }}>
        <span style={{ color: '#475569' }}>{label}</span>
        <span style={{ color: '#64748b' }}>{value.toLocaleString()} <span style={{ color: '#94a3b8' }}>({pct}%)</span></span>
      </div>
      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

function KV({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={S.kvCell}>
      <div style={{ ...S.kvValue, color: warn ? '#dc2626' : '#1e293b' }}>{value.toLocaleString()}</div>
      <div style={S.kvLabel}>{label}</div>
    </div>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    urgent: { color: '#991b1b', bg: '#fee2e2' },
    high:   { color: '#92400e', bg: '#fef3c7' },
    normal: { color: '#1e40af', bg: '#dbeafe' },
    low:    { color: '#374151', bg: '#f3f4f6' },
  }
  const c = cfg[priority] ?? cfg.normal
  return (
    <span style={{ fontSize: '.7rem', fontWeight: 500, color: c.color, background: c.bg, borderRadius: 3, padding: '1px 6px' }}>
      {priority}
    </span>
  )
}

function ActivityItem({ log }: { log: AuditLog }) {
  const time = new Date(log.created_at).toLocaleString()
  const target = log.entity_type + (log.domain_id ? ` #${log.domain_id}` : '')
  return (
    <li style={S.activityItem}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
        <span style={{ fontSize: '.8125rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 500 }}>{log.action}</span>
          <span style={{ color: '#64748b' }}> · {target}</span>
        </span>
        <span style={{ fontSize: '.7rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{time}</span>
      </div>
    </li>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#94a3b8', fontSize: '.8125rem', textAlign: 'center', padding: '.75rem 0' }}>{children}</div>
}

const S: Record<string, React.CSSProperties> = {
  title: { fontSize: '1.125rem', fontWeight: 700, color: '#0f172a', margin: 0 },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem' },
  statCard: {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.125rem',
    cursor: 'inherit', transition: 'border-color .1s, box-shadow .1s',
  },
  statValue: { fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.1 },
  statLabel: { fontSize: '.75rem', color: '#64748b', marginTop: '.25rem', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' },
  colStack: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  panel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' },
  panelHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '.625rem .875rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc',
  },
  panelTitle: { fontSize: '.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' },
  panelBody: { padding: '.75rem .875rem' },
  table: { width: '100%', borderCollapse: 'collapse' },
  tdName: { padding: '.375rem 0', fontSize: '.8125rem', color: '#1e293b', borderBottom: '1px solid #f1f5f9' },
  tdCount: { padding: '.375rem 0', fontSize: '.8125rem', color: '#475569', textAlign: 'right' as const, borderBottom: '1px solid #f1f5f9' },
  link: { color: '#2563eb', textDecoration: 'none', fontSize: '.75rem' },
  kvGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '.5rem' },
  kvCell: { background: '#f8fafc', borderRadius: 4, padding: '.5rem .625rem' },
  kvValue: { fontSize: '1.125rem', fontWeight: 700, lineHeight: 1.2 },
  kvLabel: { fontSize: '.6875rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600, marginTop: 1 },
  activityList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  activityItem: { padding: '.375rem 0', borderBottom: '1px solid #f1f5f9' },
}
