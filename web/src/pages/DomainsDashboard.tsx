import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDomainStats, type Domain } from '../api/client'
import LabelChip from '../components/LabelChip'
import * as s from '../styles/shell'

interface Props {
  domains: Domain[]
  isLoading: boolean
}

type SortKey = 'fqdn' | 'zone_status' | 'ns_ok' | 'dnssec_enabled' | 'status' | 'tenant_name'
type SortDir = 'asc' | 'desc'

const ZONE_STATUS_ORDER: Record<string, number> = { error: 0, dirty: 1, clean: 2 }

const INLINE_STYLES = `
  @keyframes spin { to { transform: rotate(360deg); } }
  .dtv-row { transition: background 0.08s; cursor: pointer; }
  .dtv-row:hover td { background: #f1f5f9; }
  .dtv-sort:hover { color: #1d4ed8; }
`

function StatPill({ label, value, warn }: { label: string; value: number | undefined; warn?: boolean }) {
  if (value === undefined) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.8125rem', color: warn && value > 0 ? '#fff' : '#475569', background: warn && value > 0 ? '#dc2626' : '#e2e8f0', borderRadius: 4, padding: '1px 8px', fontWeight: warn && value > 0 ? 600 : 400 }}>
      {value} {label}
    </span>
  )
}

function WarnPill({ label, value, color = '#dc2626' }: { label: string; value: number | undefined; color?: string }) {
  if (!value) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.8125rem', color: '#fff', background: color, borderRadius: 4, padding: '1px 8px', fontWeight: 600 }}>
      {value} {label}
    </span>
  )
}

function ZoneBadge({ status, suspended }: { status: string; suspended: boolean }) {
  const key = suspended ? 'suspended' : status
  const cfg: Record<string, { color: string; bg: string; label: string; spin?: boolean }> = {
    clean:     { color: '#15803d', bg: '#dcfce7', label: 'clean' },
    dirty:     { color: '#92400e', bg: '#fef3c7', label: 'dirty', spin: true },
    error:     { color: '#991b1b', bg: '#fee2e2', label: 'error' },
    suspended: { color: '#374151', bg: '#f3f4f6', label: 'suspended' },
  }
  const c = cfg[key]
  if (!c) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', fontWeight: 500, color: c.color, background: c.bg, borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap' }}>
      {c.spin
        ? <span style={{ display: 'inline-block', width: '0.5em', height: '0.5em', border: '1.5px solid #ca8a04', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        : <span style={{ fontSize: '.4rem' }}>●</span>}
      {c.label}
    </span>
  )
}

function SortTh({ label, col, sort, setSort }: { label: string; col: SortKey; sort: [SortKey, SortDir]; setSort: (v: [SortKey, SortDir]) => void }) {
  const active = sort[0] === col
  const arrow = active ? (sort[1] === 'asc' ? ' ↑' : ' ↓') : ''
  return (
    <th
      className="dtv-sort"
      onClick={() => setSort([col, active && sort[1] === 'asc' ? 'desc' : 'asc'])}
      style={{ ...s.th, cursor: 'pointer', userSelect: 'none', color: active ? '#2563eb' : '#64748b', whiteSpace: 'nowrap' }}
    >
      {label}{arrow}
    </th>
  )
}

export default function DomainsTableView({ domains, isLoading }: Props) {
  const navigate = useNavigate()
  const [sort, setSort] = useState<[SortKey, SortDir]>(['fqdn', 'asc'])

  const { data: stats } = useQuery({
    queryKey: ['domain-stats'],
    queryFn: () => getDomainStats().then(r => r.data),
    staleTime: 30_000,
  })

  const sorted = [...domains].sort((a, b) => {
    const [col, dir] = sort
    let cmp = 0
    if (col === 'fqdn') cmp = a.fqdn.localeCompare(b.fqdn)
    else if (col === 'zone_status') {
      const ao = ZONE_STATUS_ORDER[a.status === 'suspended' ? 'suspended' : a.zone_status] ?? 9
      const bo = ZONE_STATUS_ORDER[b.status === 'suspended' ? 'suspended' : b.zone_status] ?? 9
      cmp = ao - bo
    }
    else if (col === 'ns_ok') cmp = (a.ns_ok ?? 1) - (b.ns_ok ?? 1)
    else if (col === 'dnssec_enabled') cmp = (b.dnssec_enabled ?? 0) - (a.dnssec_enabled ?? 0)
    else if (col === 'status') cmp = a.status.localeCompare(b.status)
    else if (col === 'tenant_name') cmp = (a.tenant_name ?? '').localeCompare(b.tenant_name ?? '')
    return dir === 'asc' ? cmp : -cmp
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{INLINE_STYLES}</style>

      {/* Stats bar */}
      <div style={{ ...s.filterBar, gap: '.5rem', flexShrink: 0 }}>
        <StatPill label="domains" value={stats?.total} />
        {stats && stats.active > 0 && (
          <span style={{ fontSize: '.8125rem', color: '#64748b' }}>{stats.active} active</span>
        )}
        {stats && stats.suspended > 0 && (
          <WarnPill label="suspended" value={stats.suspended} color="#d97706" />
        )}
        <WarnPill label="zone errors" value={stats?.zone_error} />
        <WarnPill label="dirty" value={stats?.zone_dirty} color="#d97706" />
        <WarnPill label="NS issues" value={stats?.ns_not_ok} />
        {stats && stats.dnssec_enabled > 0 && (
          <span style={{ fontSize: '.8125rem', color: '#64748b' }}>{stats.dnssec_enabled} DNSSEC</span>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2rem' }}>
            <div style={{ width: 18, height: 18, border: '2px solid #e2e8f0', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : domains.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>No domains found</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <SortTh label="Domain" col="fqdn" sort={sort} setSort={setSort} />
                <SortTh label="Zone" col="zone_status" sort={sort} setSort={setSort} />
                <SortTh label="NS" col="ns_ok" sort={sort} setSort={setSort} />
                <SortTh label="DNSSEC" col="dnssec_enabled" sort={sort} setSort={setSort} />
                <SortTh label="Status" col="status" sort={sort} setSort={setSort} />
                <SortTh label="Tenant" col="tenant_name" sort={sort} setSort={setSort} />
                <th style={s.th}>Labels</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(d => {
                const suspended = d.status === 'suspended'
                return (
                  <tr
                    key={d.id}
                    className="dtv-row"
                    onClick={() => navigate(`/domains/${d.fqdn}`)}
                  >
                    <td style={{ ...s.td, fontWeight: 500 }}>
                      {d.fqdn}
                      {d.ns_reference && (
                        <span style={{ fontWeight: 400, color: '#9ca3af', fontSize: '.75rem' }}>
                          <span style={{ margin: '0 4px' }}>→</span>
                          {d.ns_reference}
                        </span>
                      )}
                    </td>
                    <td style={s.td}>
                      <ZoneBadge status={d.zone_status} suspended={suspended} />
                    </td>
                    <td style={s.td}>
                      {d.ns_ok === 0
                        ? <span style={{ color: '#dc2626', fontWeight: 600, fontSize: '.8125rem' }}>⚠</span>
                        : d.ns_ok === null
                          ? <span style={{ color: '#9ca3af', fontSize: '.8125rem' }}>—</span>
                          : <span style={{ color: '#16a34a', fontSize: '.875rem' }}>✓</span>}
                    </td>
                    <td style={s.td}>
                      {d.dnssec_enabled
                        ? <span style={{ color: '#16a34a', fontSize: '.875rem' }}>✓</span>
                        : <span style={{ color: '#9ca3af', fontSize: '.8125rem' }}>—</span>}
                    </td>
                    <td style={s.td}>
                      {suspended
                        ? <span style={{ fontSize: '.75rem', fontWeight: 500, color: '#92400e', background: '#fef3c7', borderRadius: 3, padding: '1px 6px' }}>suspended</span>
                        : <span style={{ color: '#6b7280', fontSize: '.8125rem' }}>active</span>}
                    </td>
                    <td style={{ ...s.td, color: '#6b7280' }}>{d.tenant_name ?? '—'}</td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {d.labels?.map(l => <LabelChip key={l.id} label={l} />)}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
