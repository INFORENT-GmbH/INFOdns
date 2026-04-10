import { useQuery } from '@tanstack/react-query'
import { getDomainStats } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

interface TileProps {
  label: string
  value: number | undefined
  accent?: string
  warnIf?: (v: number) => boolean
  warnColor?: string
}

function Tile({ label, value, accent = '#e5e7eb', warnIf, warnColor }: TileProps) {
  const isWarn = warnIf && value !== undefined && value > 0 && warnIf(value)
  const borderColor = isWarn ? warnColor ?? '#dc2626' : accent
  return (
    <div style={{
      borderLeft: `3px solid ${borderColor}`,
      padding: '.375rem .625rem',
      background: isWarn ? (warnColor === '#d97706' ? '#fffbeb' : '#fef2f2') : '#f9fafb',
      borderRadius: 4,
      minWidth: 0,
    }}>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.1, color: '#111827', letterSpacing: '-0.5px' }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: '.7rem', color: '#6b7280', marginTop: 2 }}>{label}</div>
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
        <div style={{ width: 18, height: 18, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (isError) {
    return <div style={{ color: '#dc2626', fontSize: '.8125rem', padding: '.5rem' }}>{t('error_generic')}</div>
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ fontSize: '.65rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: '#9ca3af', marginBottom: '.375rem' }}>
        {t('dashboard_domainHealth')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '.375rem', marginBottom: '.75rem' }}>
        <Tile label={t('dashboard_total')} value={stats?.total} accent="#6366f1" />
        <Tile label={t('dashboard_active')} value={stats?.active} accent="#16a34a" />
        <Tile label={t('dashboard_pending')} value={stats?.pending} accent="#d97706" warnIf={v => v > 0} warnColor="#d97706" />
        <Tile label={t('dashboard_suspended')} value={stats?.suspended} accent="#9ca3af" warnIf={v => v > 0} warnColor="#d97706" />
      </div>

      <div style={{ fontSize: '.65rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: '#9ca3af', marginBottom: '.375rem' }}>
        {t('dashboard_technicalHealth')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '.375rem', marginBottom: '.75rem' }}>
        <Tile label={t('dashboard_zoneErrors')} value={stats?.zone_error} accent="#dc2626" warnIf={v => v > 0} warnColor="#dc2626" />
        <Tile label={t('dashboard_dirtyZones')} value={stats?.zone_dirty} accent="#d97706" warnIf={v => v > 0} warnColor="#d97706" />
        <Tile label={t('dashboard_nsIssues')} value={stats?.ns_not_ok} accent="#dc2626" warnIf={v => v > 0} warnColor="#dc2626" />
        <Tile label={t('dashboard_dnssec')} value={stats?.dnssec_enabled} accent="#16a34a" />
        <Tile label={t('dashboard_nsRef')} value={stats?.ns_ref} accent="#6366f1" />
      </div>

      {isAdmin && stats && stats.top_tenants.length > 0 && (
        <>
          <div style={{ fontSize: '.65rem', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', color: '#9ca3af', marginBottom: '.375rem' }}>
            {t('dashboard_topTenants')}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, fontSize: '.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left' as const, padding: '.2rem .375rem', fontWeight: 600, color: '#6b7280', fontSize: '.7rem' }}>{t('dashboard_tenant')}</th>
                <th style={{ textAlign: 'right' as const, padding: '.2rem .375rem', fontWeight: 600, color: '#6b7280', fontSize: '.7rem' }}>{t('dashboard_domains')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_tenants.map(row => (
                <tr key={row.tenant_name} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '.2rem .375rem', color: '#111827' }}>{row.tenant_name}</td>
                  <td style={{ padding: '.2rem .375rem', textAlign: 'right' as const, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>{row.domain_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
