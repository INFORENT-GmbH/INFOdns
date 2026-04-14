import { useQuery } from '@tanstack/react-query'
import { getDomainStats } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import * as s from '../styles/shell'

interface TileProps {
  label: string
  value: number | undefined
  accent?: string
  warnIf?: (v: number) => boolean
  warnColor?: string
}

function Tile({ label, value, accent = '#e2e8f0', warnIf, warnColor }: TileProps) {
  const isWarn = warnIf && value !== undefined && value > 0 && warnIf(value)
  const borderColor = isWarn ? warnColor ?? '#dc2626' : accent
  return (
    <div style={{
      borderLeft: `3px solid ${borderColor}`,
      padding: '.375rem .625rem',
      background: isWarn ? (warnColor === '#d97706' ? '#fffbeb' : '#fef2f2') : '#f8fafc',
      borderRadius: 4,
      minWidth: 0,
    }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.1, color: '#1e293b', letterSpacing: '-0.5px' }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: '.7rem', color: '#64748b', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      padding: '.5rem .75rem',
      borderBottom: '1px solid #e2e8f0',
      fontSize: '.6875rem',
      fontWeight: 700,
      textTransform: 'uppercase' as const,
      letterSpacing: '.06em',
      color: '#64748b',
      background: '#f8fafc',
    }}>
      {label}
    </div>
  )
}

export default function DomainsDashboard() {
  const { user } = useAuth()
  const { t } = useI18n()
  const isAdmin = user?.role === 'admin'

  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['domain-stats'],
    queryFn: () => getDomainStats().then(r => r.data),
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2rem' }}>
        <div style={{ width: 18, height: 18, border: '2px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (isError) {
    return <div style={{ color: '#dc2626', fontSize: '.8125rem', padding: '.75rem' }}>{t('error_generic')}</div>
  }

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      <div style={s.panel}>
        <SectionHeader label={t('dashboard_domainHealth')} />
        <div style={{ padding: '.625rem .75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '.375rem' }}>
          <Tile label={t('dashboard_total')} value={stats?.total} accent="#6366f1" />
          <Tile label={t('dashboard_active')} value={stats?.active} accent="#16a34a" />
          <Tile label={t('dashboard_pending')} value={stats?.pending} accent="#d97706" warnIf={v => v > 0} warnColor="#d97706" />
          <Tile label={t('dashboard_suspended')} value={stats?.suspended} accent="#94a3b8" warnIf={v => v > 0} warnColor="#d97706" />
        </div>
      </div>

      <div style={s.panel}>
        <SectionHeader label={t('dashboard_technicalHealth')} />
        <div style={{ padding: '.625rem .75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '.375rem' }}>
          <Tile label={t('dashboard_zoneErrors')} value={stats?.zone_error} accent="#dc2626" warnIf={v => v > 0} warnColor="#dc2626" />
          <Tile label={t('dashboard_dirtyZones')} value={stats?.zone_dirty} accent="#d97706" warnIf={v => v > 0} warnColor="#d97706" />
          <Tile label={t('dashboard_nsIssues')} value={stats?.ns_not_ok} accent="#dc2626" warnIf={v => v > 0} warnColor="#dc2626" />
          <Tile label={t('dashboard_dnssec')} value={stats?.dnssec_enabled} accent="#16a34a" />
          <Tile label={t('dashboard_nsRef')} value={stats?.ns_ref} accent="#6366f1" />
        </div>
      </div>

      {isAdmin && stats && stats.top_tenants.length > 0 && (
        <div style={s.panel}>
          <SectionHeader label={t('dashboard_topTenants')} />
          <div style={s.tableWrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>{t('dashboard_tenant')}</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>{t('dashboard_domains')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.top_tenants.map(row => (
                  <tr key={row.tenant_name}>
                    <td style={s.td}>{row.tenant_name}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.domain_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
