import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getImportPreview,
  runImport,
  type ImportTenantRow,
  type ImportTldPricingRow,
  type ImportDomainRow,
  type ImportRecordRow,
  type ImportRunResult,
  type ImportStatus,
} from '../api/client'

// ── Status badge ──────────────────────────────────────────────

function StatusBadge({ status }: { status: ImportStatus }) {
  const map: Record<ImportStatus, { bg: string; fg: string; label: string }> = {
    insert:    { bg: '#d1fae5', fg: '#065f46', label: 'new' },
    update:    { bg: '#fef3c7', fg: '#92400e', label: 'update' },
    skip:      { bg: '#f3f4f6', fg: '#6b7280', label: 'exists' },
    overwrite: { bg: '#dbeafe', fg: '#1e40af', label: 'overwrite' },
  }
  const c = map[status]
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '2px 7px', borderRadius: 4, fontSize: '.7rem', fontWeight: 700 }}>
      {c.label}
    </span>
  )
}

type TabKey = 'tenants' | 'tld_pricing' | 'domains' | 'records'

// ── Main page ─────────────────────────────────────────────────

export default function ImportPage() {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabKey>('tenants')
  const [phase, setPhase] = useState<'preview' | 'results'>('preview')
  const [results, setResults] = useState<ImportRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [selTenants,  setSelTenants]  = useState<Set<number>>(new Set())
  const [selTldZones, setSelTldZones] = useState<Set<string>>(new Set())
  const [selDomains,  setSelDomains]  = useState<Set<string>>(new Set())
  const [selRecords,  setSelRecords]  = useState<Set<string>>(new Set())

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['import-preview'],
    queryFn: () => getImportPreview().then(r => r.data),
    retry: 0,
  })

  // ── Select-all helpers ────────────────────────────────────

  function toggleAllTenants(checked: boolean) {
    setSelTenants(checked ? new Set(data!.tenants.map(r => r.id)) : new Set())
  }
  function toggleAllTlds(checked: boolean) {
    setSelTldZones(checked ? new Set(data!.tld_pricing.map(r => r.zone)) : new Set())
  }
  function toggleAllDomains(checked: boolean) {
    const fqdns = data!.domains.map(r => r.fqdn)
    setSelDomains(checked ? new Set(fqdns) : new Set())
    setSelRecords(prev => {
      const next = new Set(prev)
      fqdns.forEach(f => checked ? next.add(f) : next.delete(f))
      return next
    })
  }
  function toggleAllRecords(checked: boolean) {
    setSelRecords(checked ? new Set(data!.records.map(r => r.domain_fqdn)) : new Set())
  }

  function toggle<T>(set: Set<T>, val: T, setter: (s: Set<T>) => void) {
    const next = new Set(set)
    if (next.has(val)) next.delete(val)
    else next.add(val)
    setter(next)
  }

  function toggleDomain(fqdn: string) {
    const adding = !selDomains.has(fqdn)
    toggle(selDomains, fqdn, setSelDomains)
    setSelRecords(prev => {
      const next = new Set(prev)
      adding ? next.add(fqdn) : next.delete(fqdn)
      return next
    })
  }

  // ── Run import ────────────────────────────────────────────

  async function handleRun() {
    setRunError(null)
    setRunning(true)
    try {
      const res = await runImport({
        tenant_ids:   selTenants.size   > 0 ? [...selTenants]  : undefined,
        tld_zones:    selTldZones.size  > 0 ? [...selTldZones] : undefined,
        domain_fqdns: selDomains.size   > 0 ? [...selDomains]  : undefined,
        record_fqdns: selRecords.size   > 0 ? [...selRecords]  : undefined,
      })
      setResults(res.data)
      setPhase('results')
    } catch (err: any) {
      setRunError(err.response?.data?.message ?? err.message)
    } finally {
      setRunning(false)
    }
  }

  function handleBack() {
    setPhase('preview')
    setResults(null)
    qc.invalidateQueries({ queryKey: ['import-preview'] })
  }

  const totalSelected =
    selTenants.size + selTldZones.size + selDomains.size + selRecords.size

  // ── Results view ──────────────────────────────────────────

  if (phase === 'results' && results) {
    return (
      <div>
        <h2 style={styles.h2}>Import complete</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Entity</th>
              <th style={styles.th}>Inserted</th>
              <th style={styles.th}>Updated</th>
              <th style={styles.th}>Skipped / Deleted</th>
            </tr>
          </thead>
          <tbody>
            <tr style={styles.tr}><td style={styles.td}>Tenants</td><td style={styles.td}>{results.tenants.inserted}</td><td style={styles.td}>{results.tenants.updated}</td><td style={styles.td}>—</td></tr>
            <tr style={styles.tr}><td style={styles.td}>TLD Pricing</td><td style={styles.td}>{results.tld_pricing.inserted}</td><td style={styles.td}>{results.tld_pricing.updated}</td><td style={styles.td}>—</td></tr>
            <tr style={styles.tr}><td style={styles.td}>Domains</td><td style={styles.td}>{results.domains.inserted}</td><td style={styles.td}>—</td><td style={styles.td}>{results.domains.skipped} skipped</td></tr>
            <tr style={styles.tr}><td style={styles.td}>DNS Records</td><td style={styles.td}>{results.records.inserted}</td><td style={styles.td}>—</td><td style={styles.td}>{results.records.deleted} deleted</td></tr>
          </tbody>
        </table>
        <button style={styles.btnSecondary} onClick={handleBack}>Back to preview</button>
      </div>
    )
  }

  // ── Loading / error ───────────────────────────────────────

  if (isLoading) return <div style={styles.muted}>Loading isp database…</div>

  if (isError) {
    const msg = (error as any)?.response?.data?.message ?? (error as any)?.message ?? 'Unknown error'
    return (
      <div>
        <p style={styles.errorText}>{msg}</p>
        <button style={styles.btnSecondary} onClick={() => refetch()}>Retry</button>
      </div>
    )
  }

  if (!data) return null

  // Unique domain fqdns in records (for select-all logic)
  const uniqueRecordDomains = [...new Set(data.records.map(r => r.domain_fqdn))]

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'tenants',    label: 'Tenants',     count: data.tenants.length },
    { key: 'tld_pricing', label: 'TLD Pricing', count: data.tld_pricing.length },
    { key: 'domains',    label: 'Domains',     count: data.domains.length },
    { key: 'records',    label: 'DNS Records', count: data.records.length },
  ]

  // ── Preview view ──────────────────────────────────────────

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>Import from isp database</h2>
        <button style={styles.btnRefresh} onClick={() => refetch()}>Refresh</button>
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            style={activeTab === tab.key ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            <span style={activeTab === tab.key ? styles.tabCountActive : styles.tabCount}>
              {tab.count.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div style={styles.panel}>

        {/* Tenants */}
        {activeTab === 'tenants' && (
          <>
            <div style={styles.selectAllRow}>
              <label style={styles.checkLabel}>
                <input type="checkbox"
                  checked={selTenants.size === data.tenants.length && data.tenants.length > 0}
                  onChange={e => toggleAllTenants(e.target.checked)} />
                Select all
              </label>
              <span style={styles.selCount}>{selTenants.size} selected</span>
            </div>
            <table style={styles.table}>
              <thead><tr>
                <th style={styles.th}></th>
                <th style={styles.th}>ID</th>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Status</th>
              </tr></thead>
              <tbody>
                {data.tenants.map((row: ImportTenantRow) => (
                  <tr key={row.id} style={styles.tr}>
                    <td style={styles.tdCheck}><input type="checkbox" checked={selTenants.has(row.id)} onChange={() => toggle(selTenants, row.id, setSelTenants)} /></td>
                    <td style={styles.td}>{row.id}</td>
                    <td style={styles.td}><code style={styles.code}>{row.name}</code></td>
                    <td style={styles.td}><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* TLD Pricing */}
        {activeTab === 'tld_pricing' && (
          <>
            <div style={styles.selectAllRow}>
              <label style={styles.checkLabel}>
                <input type="checkbox"
                  checked={selTldZones.size === data.tld_pricing.length && data.tld_pricing.length > 0}
                  onChange={e => toggleAllTlds(e.target.checked)} />
                Select all
              </label>
              <span style={styles.selCount}>{selTldZones.size} selected</span>
            </div>
            <table style={styles.table}>
              <thead><tr>
                <th style={styles.th}></th>
                <th style={styles.th}>Zone</th>
                <th style={styles.th}>TLD</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Cost</th>
                <th style={styles.th}>Fee</th>
                <th style={styles.th}>Registrar</th>
                <th style={styles.th}>Status</th>
              </tr></thead>
              <tbody>
                {data.tld_pricing.map((row: ImportTldPricingRow) => (
                  <tr key={row.zone} style={styles.tr}>
                    <td style={styles.tdCheck}><input type="checkbox" checked={selTldZones.has(row.zone)} onChange={() => toggle(selTldZones, row.zone, setSelTldZones)} /></td>
                    <td style={styles.td}><code style={styles.code}>{row.zone}</code></td>
                    <td style={styles.td}>{row.tld}</td>
                    <td style={styles.td}>{row.description ?? '—'}</td>
                    <td style={styles.td}>{row.cost != null ? row.cost.toFixed(2) : '—'}</td>
                    <td style={styles.td}>{row.fee ?? '—'}</td>
                    <td style={styles.td}>{row.default_registrar ?? '—'}</td>
                    <td style={styles.td}><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Domains */}
        {activeTab === 'domains' && (
          <>
            <div style={styles.selectAllRow}>
              <label style={styles.checkLabel}>
                <input type="checkbox"
                  checked={selDomains.size === data.domains.length && data.domains.length > 0}
                  onChange={e => toggleAllDomains(e.target.checked)} />
                Select all
              </label>
              <span style={styles.selCount}>{selDomains.size} selected</span>
            </div>
            <table style={styles.table}>
              <thead><tr>
                <th style={styles.th}></th>
                <th style={styles.th}>FQDN</th>
                <th style={styles.th}>Tenant ID</th>
                <th style={styles.th}>Publish</th>
                <th style={styles.th}>Brand</th>
                <th style={styles.th}>Cost Center</th>
                <th style={styles.th}>Status</th>
              </tr></thead>
              <tbody>
                {data.domains.map((row: ImportDomainRow) => (
                  <tr key={row.fqdn} style={styles.tr}>
                    <td style={styles.tdCheck}><input type="checkbox" checked={selDomains.has(row.fqdn)} onChange={() => toggleDomain(row.fqdn)} /></td>
                    <td style={styles.td}><code style={styles.code}>{row.fqdn}</code></td>
                    <td style={styles.td}>{row.tenant_id}</td>
                    <td style={styles.td}>{row.publish ? 'yes' : 'no'}</td>
                    <td style={styles.td}>{row.brand ?? '—'}</td>
                    <td style={styles.td}>{row.cost_center ?? '—'}</td>
                    <td style={styles.td}><StatusBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* DNS Records */}
        {activeTab === 'records' && (
          <>
            <div style={styles.selectAllRow}>
              <label style={styles.checkLabel}>
                <input type="checkbox"
                  checked={selRecords.size === uniqueRecordDomains.length && uniqueRecordDomains.length > 0}
                  onChange={e => toggleAllRecords(e.target.checked)} />
                Select all domains
              </label>
              <span style={styles.selCount}>{selRecords.size} of {uniqueRecordDomains.length} domains selected</span>
            </div>
            <table style={styles.table}>
              <thead><tr>
                <th style={styles.th}></th>
                <th style={styles.th}>Domain</th>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>TTL</th>
                <th style={styles.th}>Priority</th>
                <th style={styles.th}>Value</th>
              </tr></thead>
              <tbody>
                {data.records.map((row: ImportRecordRow, i: number) => {
                  const prevDomain = i > 0 ? data.records[i - 1].domain_fqdn : null
                  const isFirstOfDomain = row.domain_fqdn !== prevDomain
                  const checked = selRecords.has(row.domain_fqdn)
                  return (
                    <tr key={i} style={{ ...styles.tr, ...(isFirstOfDomain && i > 0 ? styles.domainBorder : {}) }}>
                      <td style={styles.tdCheck}>
                        {isFirstOfDomain && (
                          <input type="checkbox" checked={checked}
                            onChange={() => toggle(selRecords, row.domain_fqdn, setSelRecords)} />
                        )}
                      </td>
                      <td style={styles.td}>
                        {isFirstOfDomain && <code style={styles.code}>{row.domain_fqdn}</code>}
                      </td>
                      <td style={styles.td}><code style={styles.code}>{row.name}</code></td>
                      <td style={styles.td}><span style={styles.typeTag}>{row.type}</span></td>
                      <td style={styles.td}>{row.ttl ?? '—'}</td>
                      <td style={styles.td}>{row.priority ?? '—'}</td>
                      <td style={{ ...styles.td, ...styles.valueCell }}>{row.value}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        {runError && <p style={styles.errorText}>{runError}</p>}
        <div style={styles.footerRow}>
          <span style={styles.muted}>
            {[
              selTenants.size   > 0 && `${selTenants.size} tenant${selTenants.size   !== 1 ? 's' : ''}`,
              selTldZones.size  > 0 && `${selTldZones.size} TLD zone${selTldZones.size !== 1 ? 's' : ''}`,
              selDomains.size   > 0 && `${selDomains.size} domain${selDomains.size   !== 1 ? 's' : ''}`,
              selRecords.size   > 0 && `${selRecords.size} record set${selRecords.size !== 1 ? 's' : ''}`,
            ].filter(Boolean).join(' · ') || 'Nothing selected'}
          </span>
          <button
            style={totalSelected === 0 || running ? styles.btnDisabled : styles.btnRun}
            disabled={totalSelected === 0 || running}
            onClick={handleRun}
          >
            {running ? 'Running…' : 'Run Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header:       { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  h2:           { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  btnRefresh:   { padding: '.25rem .6rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8rem', cursor: 'pointer', color: '#374151' },
  tabBar:       { display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 0 },
  tab:          { padding: '.5rem 1.1rem', background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: -2, fontSize: '.8125rem', color: '#64748b', cursor: 'pointer', fontWeight: 500 },
  tabActive:    { padding: '.5rem 1.1rem', background: 'none', border: 'none', borderBottom: '2px solid #2563eb', marginBottom: -2, fontSize: '.8125rem', color: '#2563eb', cursor: 'pointer', fontWeight: 600 },
  tabCount:     { marginLeft: '.4rem', background: '#e2e8f0', color: '#475569', padding: '1px 6px', borderRadius: 4, fontSize: '.7rem', fontWeight: 600 },
  tabCountActive: { marginLeft: '.4rem', background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 4, fontSize: '.7rem', fontWeight: 600 },
  panel:        { border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden', overflowX: 'auto' },
  selectAllRow: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '.45rem .85rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  checkLabel:   { display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8rem', cursor: 'pointer' },
  selCount:     { fontSize: '.75rem', color: '#94a3b8', marginLeft: 'auto' },
  table:        { width: '100%', borderCollapse: 'collapse' },
  th:           { textAlign: 'left', padding: '.5rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', letterSpacing: '.04em' },
  tr:           { borderBottom: '1px solid #f1f5f9' },
  domainBorder: { borderTop: '2px solid #e2e8f0' },
  td:           { padding: '.4375rem .75rem', fontSize: '.8rem', verticalAlign: 'middle', color: '#1e293b' },
  tdCheck:      { padding: '.4375rem .75rem', width: 28, verticalAlign: 'middle' },
  code:         { background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, fontSize: '.78rem', fontFamily: 'monospace' },
  typeTag:      { background: '#ede9fe', color: '#5b21b6', padding: '1px 6px', borderRadius: 3, fontSize: '.72rem', fontWeight: 700, fontFamily: 'monospace' },
  valueCell:    { maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontFamily: 'monospace', fontSize: '.75rem' },
  footer:       { marginTop: '1.25rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' },
  footerRow:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' },
  muted:        { fontSize: '.8rem', color: '#94a3b8' },
  errorText:    { color: '#b91c1c', fontSize: '.875rem', marginBottom: '.5rem' },
  btnRun:       { padding: '.3125rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  btnDisabled:  { padding: '.3125rem 1rem', background: '#e2e8f0', color: '#94a3b8', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'not-allowed' },
  btnSecondary: { marginTop: '1rem', padding: '.3125rem .85rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer', color: '#374151' },
}
