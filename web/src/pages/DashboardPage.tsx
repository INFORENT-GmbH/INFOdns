import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  getDomainStats,
  getNsStatus,
  getAuditLogs,
  getTickets,
  getTicketStats,
  getZoneRenderQueue,
  getBulkJobs,
  getMailQueue,
  type AuditLog,
  type Ticket,
} from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

const NS_LABELS: Record<string, string> = {
  ns1: 'primary',
  ns2: 'ilreah.ns.inforant.de',
  ns3: 'ulren.ns.inforant.de',
}

const COLORS = {
  ok: '#16a34a',
  warn: '#d97706',
  err: '#dc2626',
  info: '#2563eb',
  text: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  border: '#e2e8f0',
  divider: '#f1f5f9',
  card: '#ffffff',
  bg: '#f8fafc',
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

  // Open tickets — top 5 rows for the list, plus a single aggregate call for the
  // priority counts. (Previously this fetched up to 200 rows just to reduce on the
  // client; the dedicated /tickets/stats endpoint returns the same numbers from one
  // SQL query.)
  const { data: openTickets } = useQuery({
    queryKey: ['tickets', { status: 'open', limit: '5' }],
    queryFn: () => getTickets({ status: 'open', page: '1', limit: '5' }).then(r => r.data),
  })
  const { data: ticketStats } = useQuery({
    queryKey: ['ticket-stats'],
    queryFn: () => getTicketStats().then(r => r.data),
  })

  // Pipeline (staff only)
  const { data: renderQueue } = useQuery({
    queryKey: ['zone-render-queue'],
    queryFn: () => getZoneRenderQueue(),
    enabled: isStaff,
    refetchInterval: 15_000,
  })
  const { data: bulkJobs } = useQuery({
    queryKey: ['bulk-jobs'],
    queryFn: () => getBulkJobs().then(r => r.data),
    enabled: isStaff,
  })
  const { data: mailFailed } = useQuery({
    queryKey: ['mail-queue', { status: 'failed', limit: '1' }],
    queryFn: () => getMailQueue({ status: 'failed', page: '1', limit: '1' }).then(r => r.data),
    enabled: isStaff,
    refetchInterval: 60_000,
  })

  const visibleNs = user?.role === 'tenant' ? ['ns2', 'ns3'] : ['ns1', 'ns2', 'ns3']

  // MariaDB SUM() comes back as a string via the mysql2 driver, so any addition
  // on these fields concatenates ("0" + "661" + "0" = "06610"). Coerce up-front.
  const s = useMemo(() => {
    if (!stats) return null
    return {
      total:          Number(stats.total ?? 0),
      active:         Number(stats.active ?? 0),
      pending:        Number(stats.pending ?? 0),
      suspended:      Number(stats.suspended ?? 0),
      zone_error:     Number(stats.zone_error ?? 0),
      zone_dirty:     Number(stats.zone_dirty ?? 0),
      ns_not_ok:      Number(stats.ns_not_ok ?? 0),
      dnssec_enabled: Number(stats.dnssec_enabled ?? 0),
      ns_ref:         Number(stats.ns_ref ?? 0),
      top_tenants:    stats.top_tenants ?? [],
    }
  }, [stats])

  const zoneClean = s ? Math.max(0, s.active - s.zone_error - s.zone_dirty) : 0
  const issuesTotal = s ? s.zone_error + s.ns_not_ok + s.suspended : 0

  // Priority counts come straight from the aggregate endpoint
  const priorityCounts = ticketStats?.by_priority ?? { urgent: 0, high: 0, normal: 0, low: 0 }

  // /zone-render-queue returns up to 200 rows including done/failed — count only
  // actually-queued work so a long history doesn't masquerade as a backlog.
  const renderQueueCount = (renderQueue ?? []).filter(j => j.status === 'pending' || j.status === 'processing').length
  const bulkInFlight = (bulkJobs ?? []).filter(j => j.status === 'pending' || j.status === 'processing').length
  const mailFailedCount = mailFailed?.total ?? 0
  const openTicketsTotal = ticketStats?.open ?? 0

  return (
    <div style={S.page}>
      <h1 style={S.title}>{t('dashboard_title')}</h1>

      {/* Hero stat cards */}
      <div style={S.statGrid}>
        <StatCard
          label={t('dashboard_domains')}
          value={s?.total ?? 0}
          accent={COLORS.info}
          to="/domains"
          sub={s ? `${s.active.toLocaleString()} ${t('dashboard_active').toLowerCase()}` : undefined}
        />
        <StatCard
          label={t('dashboard_zoneOk')}
          value={zoneClean}
          accent={COLORS.ok}
          progress={s && s.active > 0 ? (zoneClean / s.active) * 100 : 0}
          sub={s && s.active > 0 ? `${Math.round((zoneClean / s.active) * 100)}% / ${s.active.toLocaleString()}` : undefined}
        />
        <StatCard
          label={t('dashboard_issues')}
          value={issuesTotal}
          accent={issuesTotal > 0 ? COLORS.err : COLORS.muted}
          to={issuesTotal > 0 ? '/domains' : undefined}
          sub={
            s
              ? [
                  s.zone_error ? `${s.zone_error} ${t('dashboard_zoneErrors').toLowerCase()}` : null,
                  s.ns_not_ok ? `${s.ns_not_ok} NS` : null,
                  s.suspended ? `${s.suspended} ${t('dashboard_suspended').toLowerCase()}` : null,
                ].filter(Boolean).join(' · ') || '—'
              : undefined
          }
        />
        <StatCard
          label={t('dashboard_openTickets')}
          value={openTicketsTotal}
          accent={priorityCounts.urgent > 0 ? COLORS.err : priorityCounts.high > 0 ? COLORS.warn : COLORS.info}
          to="/tickets"
          sub={
            openTicketsTotal > 0
              ? [
                  priorityCounts.urgent ? `${priorityCounts.urgent} ${t('dashboard_priorityUrgent').toLowerCase()}` : null,
                  priorityCounts.high ? `${priorityCounts.high} ${t('dashboard_priorityHigh').toLowerCase()}` : null,
                ].filter(Boolean).join(' · ') || `${t('dashboard_byPriority')}`
              : undefined
          }
        />
      </div>

      {/* Pipeline strip (staff only) */}
      {isStaff && (
        <div style={S.pipelineStrip}>
          <div style={S.pipelineLabel}>{t('dashboard_pipeline')}</div>
          <PipelineStat
            label={t('dashboard_rendersQueued')}
            value={renderQueueCount}
            tone={renderQueueCount > 0 ? 'active' : 'idle'}
          />
          <PipelineStat
            label={t('dashboard_bulkInFlight')}
            value={bulkInFlight}
            tone={bulkInFlight > 0 ? 'active' : 'idle'}
          />
          <PipelineStat
            label={t('dashboard_mailFailed')}
            value={mailFailedCount}
            tone={mailFailedCount > 0 ? 'error' : 'idle'}
            to={mailFailedCount > 0 ? '/mail-queue' : undefined}
          />
        </div>
      )}

      <div style={S.twoCol}>
        {/* Left column */}
        <div style={S.colStack}>
          {/* Zone health */}
          <Panel title={t('dashboard_domainHealth')}>
            {!s || s.total === 0 ? (
              <Empty>—</Empty>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.625rem' }}>
                <HealthBar
                  label={t('zone_clean')}
                  value={zoneClean}
                  total={s.active || 1}
                  color={COLORS.ok}
                />
                <HealthBar
                  label={t('dashboard_dirtyZones')}
                  value={s.zone_dirty}
                  total={s.active || 1}
                  color={COLORS.warn}
                />
                <HealthBar
                  label={t('dashboard_zoneErrors')}
                  value={s.zone_error}
                  total={s.active || 1}
                  color={COLORS.err}
                />
              </div>
            )}
          </Panel>

          {/* Technical health */}
          <Panel title={t('dashboard_technicalHealth')}>
            {!s ? <Empty>—</Empty> : (
              <div style={S.kvGrid}>
                <KV label={t('dashboard_dnssec')} value={s.dnssec_enabled} />
                <KV
                  label={t('dashboard_nsIssues')}
                  value={s.ns_not_ok}
                  warn={s.ns_not_ok > 0}
                />
                <KV label={t('dashboard_nsRef')} value={s.ns_ref} />
                <KV label={t('dashboard_pending')} value={s.pending} />
              </div>
            )}
          </Panel>

          {/* Top tenants — admins only */}
          {isAdmin && s && s.top_tenants && s.top_tenants.length > 0 && (
            <Panel title={t('dashboard_topTenants')}>
              <div style={S.tenantList}>
                {s.top_tenants.slice(0, 8).map((row, i) => {
                  const max = Number(s.top_tenants[0]?.domain_count ?? 0) || 1
                  const count = Number(row.domain_count ?? 0)
                  const pct = Math.round((count / max) * 100)
                  return (
                    <div key={i} style={S.tenantRow}>
                      <span style={S.tenantName}>{row.tenant_name}</span>
                      <div style={S.tenantBarTrack}>
                        <div style={{ ...S.tenantBarFill, width: `${pct}%` }} />
                      </div>
                      <span style={S.tenantCount}>{count.toLocaleString()}</span>
                    </div>
                  )
                })}
              </div>
            </Panel>
          )}
        </div>

        {/* Right column */}
        <div style={S.colStack}>
          {/* NS Status */}
          <Panel title={t('dashboard_nsStatus')}>
            <div style={S.nsList}>
              {visibleNs.map(name => {
                const e = nsStatus?.[name]
                const dotColor = !e ? COLORS.faint : e.ok ? COLORS.ok : COLORS.err
                return (
                  <div key={name} style={S.nsRow}>
                    <span style={{ ...S.nsDot, background: dotColor }} />
                    <span style={S.nsName}>{NS_LABELS[name] ?? name}</span>
                    <span style={S.nsValue}>
                      {!e
                        ? <span style={{ color: COLORS.faint }}>—</span>
                        : e.ok
                          ? <span style={{ color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>{e.latencyMs}ms</span>
                          : <span style={{ color: COLORS.err, fontWeight: 600 }}>{t('layout_down')}</span>}
                    </span>
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* Open tickets */}
          <Panel
            title={t('dashboard_openTickets')}
            action={<Link to="/tickets" style={S.link}>{t('dashboard_viewAll')}</Link>}
          >
            {openTicketsTotal > 0 && (
              <div style={S.priorityRow}>
                <PriorityChip n={priorityCounts.urgent} priority="urgent" />
                <PriorityChip n={priorityCounts.high} priority="high" />
                <PriorityChip n={priorityCounts.normal} priority="normal" />
                <PriorityChip n={priorityCounts.low} priority="low" />
              </div>
            )}
            {!openTickets || openTickets.data.length === 0 ? (
              <Empty>{t('dashboard_noOpenTickets')}</Empty>
            ) : (
              <ul style={S.ticketList}>
                {openTickets.data.map(ticket => (
                  <TicketItem key={ticket.id} ticket={ticket} />
                ))}
              </ul>
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

// ─── Components ──────────────────────────────────────────────

function StatCard({
  label, value, accent, sub, to, progress,
}: {
  label: string
  value: number
  accent: string
  sub?: string
  to?: string
  progress?: number
}) {
  const card = (
    <div style={{ ...S.statCard, ...(to ? S.statCardClickable : {}) }}>
      <div style={{ ...S.statAccent, background: accent }} />
      <div style={S.statBody}>
        <div style={S.statLabel}>{label}</div>
        <div style={{ ...S.statValue, color: accent }}>{value.toLocaleString()}</div>
        {sub !== undefined && <div style={S.statSub}>{sub || ' '}</div>}
        {progress !== undefined && (
          <div style={S.statBarTrack}>
            <div style={{ ...S.statBarFill, width: `${Math.min(100, Math.max(0, progress))}%`, background: accent }} />
          </div>
        )}
      </div>
    </div>
  )
  if (to) return <Link to={to} style={S.cardLink}>{card}</Link>
  return card
}

function PipelineStat({
  label, value, tone, to,
}: { label: string; value: number; tone: 'active' | 'idle' | 'error'; to?: string }) {
  const color =
    tone === 'error' ? COLORS.err :
    tone === 'active' ? COLORS.info :
    COLORS.faint
  const bg =
    tone === 'error' ? '#fee2e2' :
    tone === 'active' ? '#dbeafe' :
    '#f1f5f9'
  const content = (
    <div style={S.pipeStat}>
      <span style={{ ...S.pipeBadge, color, background: bg }}>{value.toLocaleString()}</span>
      <span style={S.pipeLabel}>{label}</span>
    </div>
  )
  if (to) return <Link to={to} style={{ textDecoration: 'none' }}>{content}</Link>
  return content
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
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8125rem', marginBottom: 4 }}>
        <span style={{ color: '#475569' }}>{label}</span>
        <span style={{ color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>
          {value.toLocaleString()} <span style={{ color: COLORS.faint }}>({pct}%)</span>
        </span>
      </div>
      <div style={S.healthTrack}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width .3s ease' }} />
      </div>
    </div>
  )
}

function KV({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={S.kvCell}>
      <div style={{ ...S.kvValue, color: warn ? COLORS.err : COLORS.text }}>{value.toLocaleString()}</div>
      <div style={S.kvLabel}>{label}</div>
    </div>
  )
}

function PriorityChip({ n, priority }: { n: number; priority: Ticket['priority'] }) {
  const cfg: Record<Ticket['priority'], { color: string; bg: string }> = {
    urgent: { color: '#991b1b', bg: '#fee2e2' },
    high:   { color: '#92400e', bg: '#fef3c7' },
    normal: { color: '#1e40af', bg: '#dbeafe' },
    low:    { color: '#374151', bg: '#f3f4f6' },
  }
  const c = cfg[priority]
  const dim = n === 0
  return (
    <span style={{
      fontSize: '.6875rem',
      fontWeight: 600,
      color: dim ? COLORS.faint : c.color,
      background: dim ? '#f8fafc' : c.bg,
      borderRadius: 4,
      padding: '2px 7px',
      letterSpacing: '.02em',
      textTransform: 'capitalize',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {n} {priority}
    </span>
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
    <span style={{
      fontSize: '.6875rem', fontWeight: 600, color: c.color, background: c.bg,
      borderRadius: 3, padding: '1px 6px', textTransform: 'capitalize',
    }}>
      {priority}
    </span>
  )
}

function TicketItem({ ticket }: { ticket: Ticket }) {
  return (
    <li style={S.ticketRow}>
      <Link to={`/tickets/${ticket.id}`} style={{ ...S.link, ...S.ticketSubject }}>
        {ticket.subject || `#${ticket.id}`}
      </Link>
      <PriorityBadge priority={ticket.priority} />
    </li>
  )
}

function ActivityItem({ log }: { log: AuditLog }) {
  const time = new Date(log.created_at).toLocaleString()
  const target = log.entity_type + (log.domain_id ? ` #${log.domain_id}` : '')
  const actionColor = actionTone(log.action)
  return (
    <li style={S.activityItem}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'baseline' }}>
        <span style={{ fontSize: '.8125rem', color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>
          <span style={{ fontWeight: 600, color: actionColor }}>{log.action}</span>
          <span style={{ color: COLORS.muted }}> · {target}</span>
        </span>
        <span style={{ fontSize: '.6875rem', color: COLORS.faint, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{time}</span>
      </div>
    </li>
  )
}

function actionTone(action: string): string {
  const a = action.toLowerCase()
  if (a.startsWith('delete') || a.includes('error') || a.includes('fail')) return COLORS.err
  if (a.startsWith('create') || a.startsWith('add')) return COLORS.ok
  if (a.startsWith('update') || a.startsWith('edit')) return COLORS.info
  return COLORS.text
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: COLORS.faint, fontSize: '.8125rem', textAlign: 'center', padding: '.875rem 0' }}>{children}</div>
}

// ─── Styles ──────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 1280 },
  title: { fontSize: '1.125rem', fontWeight: 700, color: COLORS.text, margin: 0 },

  // Stat cards
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.75rem' },
  cardLink: { textDecoration: 'none', color: 'inherit' },
  statCard: {
    position: 'relative',
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    overflow: 'hidden',
    transition: 'border-color .12s, box-shadow .12s, transform .12s',
  },
  statCardClickable: { cursor: 'pointer' },
  statAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  statBody: { padding: '.875rem 1rem .875rem 1.125rem' },
  statLabel: {
    fontSize: '.6875rem', color: COLORS.muted, textTransform: 'uppercase',
    letterSpacing: '.05em', fontWeight: 600,
  },
  statValue: { fontSize: '1.875rem', fontWeight: 700, lineHeight: 1.05, marginTop: '.25rem', fontVariantNumeric: 'tabular-nums' },
  statSub: { fontSize: '.75rem', color: COLORS.muted, marginTop: '.25rem', minHeight: '1em' },
  statBarTrack: { height: 4, background: COLORS.divider, borderRadius: 2, marginTop: '.5rem', overflow: 'hidden' },
  statBarFill: { height: '100%', borderRadius: 2, transition: 'width .3s ease' },

  // Pipeline strip
  pipelineStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.25rem',
    flexWrap: 'wrap',
    padding: '.625rem .875rem',
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
  },
  pipelineLabel: {
    fontSize: '.6875rem', color: COLORS.muted, textTransform: 'uppercase',
    letterSpacing: '.05em', fontWeight: 700,
    paddingRight: '.5rem',
    borderRight: `1px solid ${COLORS.divider}`,
  },
  pipeStat: { display: 'inline-flex', alignItems: 'center', gap: '.5rem' },
  pipeBadge: {
    fontSize: '.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
    fontVariantNumeric: 'tabular-nums', minWidth: 22, textAlign: 'center',
  },
  pipeLabel: { fontSize: '.8125rem', color: '#334155' },

  // Layout
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' },
  colStack: { display: 'flex', flexDirection: 'column', gap: '1rem' },

  // Panels
  panel: { background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 8, overflow: 'hidden' },
  panelHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '.625rem .875rem', borderBottom: `1px solid ${COLORS.divider}`, background: COLORS.bg,
  },
  panelTitle: {
    fontSize: '.6875rem', fontWeight: 700, color: '#475569',
    textTransform: 'uppercase', letterSpacing: '.05em',
  },
  panelBody: { padding: '.75rem .875rem' },

  link: { color: COLORS.info, textDecoration: 'none', fontSize: '.75rem' },

  // Health bars
  healthTrack: { height: 6, background: COLORS.divider, borderRadius: 3, overflow: 'hidden' },

  // KV grid
  kvGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '.5rem' },
  kvCell: { background: COLORS.bg, borderRadius: 6, padding: '.5rem .625rem' },
  kvValue: { fontSize: '1.125rem', fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' },
  kvLabel: {
    fontSize: '.6875rem', color: COLORS.muted, textTransform: 'uppercase',
    letterSpacing: '.04em', fontWeight: 600, marginTop: 1,
  },

  // Top tenants
  tenantList: { display: 'flex', flexDirection: 'column', gap: '.375rem' },
  tenantRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 80px 48px', alignItems: 'center', gap: '.5rem' },
  tenantName: { fontSize: '.8125rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tenantBarTrack: { height: 6, background: COLORS.divider, borderRadius: 3, overflow: 'hidden' },
  tenantBarFill: { height: '100%', background: COLORS.info, borderRadius: 3 },
  tenantCount: { fontSize: '.8125rem', color: COLORS.muted, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' },

  // NS list
  nsList: { display: 'flex', flexDirection: 'column', gap: '.375rem' },
  nsRow: {
    display: 'grid', gridTemplateColumns: '10px minmax(0, 1fr) auto',
    alignItems: 'center', gap: '.5rem',
    padding: '.25rem 0', borderBottom: `1px solid ${COLORS.divider}`,
  },
  nsDot: { width: 8, height: 8, borderRadius: '50%' },
  nsName: { fontSize: '.8125rem', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nsValue: { fontSize: '.8125rem' },

  // Tickets
  priorityRow: { display: 'flex', flexWrap: 'wrap', gap: '.375rem', marginBottom: '.625rem' },
  ticketList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  ticketRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem',
    padding: '.375rem 0', borderBottom: `1px solid ${COLORS.divider}`,
  },
  ticketSubject: {
    fontSize: '.8125rem', color: COLORS.info,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    minWidth: 0, flex: 1,
  },

  // Activity
  activityList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  activityItem: { padding: '.375rem 0', borderBottom: `1px solid ${COLORS.divider}` },
}
