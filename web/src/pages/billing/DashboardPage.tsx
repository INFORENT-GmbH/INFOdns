import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import { getBillingDashboardStats } from '../../api/client'
import * as s from '../../styles/shell'

function fmtEuro(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.floor(abs / 100)
  const remainder = abs % 100
  const eurosStr = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}${eurosStr},${String(remainder).padStart(2, '0')} €`
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

export default function BillingDashboardPage() {
  usePageTitle('Abrechnungs-Dashboard')

  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'dashboard-stats'],
    queryFn: () => getBillingDashboardStats().then(r => r.data),
  })

  if (isLoading || !data) {
    return <div style={{ padding: '2rem', color: '#9ca3af' }}>Lade…</div>
  }

  return (
    <div style={localStyles.page}>
      <h2 style={localStyles.h2}>Abrechnungs-Übersicht</h2>

      <div style={localStyles.kpiGrid}>
        <Kpi label="MRR" value={fmtEuro(data.mrr_cents)}
          hint="Monthly recurring (Tag/Woche/Monat/Jahr-Posten, normalisiert auf Monat)" />
        <Kpi label="ARR" value={fmtEuro(data.arr_cents)}
          hint="MRR × 12 — Indikator, ohne Pay-per-use & Lifetime" tint="#0369a1" />
        <Kpi label="Offene Forderungen" value={fmtEuro(data.outstanding_cents)}
          hint={`${data.open_count} Rechnung(en)`} tint="#a16207" />
        <Kpi label="Davon überfällig" value={fmtEuro(data.overdue_cents)}
          hint={`${data.overdue_count} Rechnung(en) — siehe Mahn-Queue`}
          tint="#b91c1c" />
      </div>

      <div style={localStyles.kpiGrid}>
        <Kpi label="Diesen Monat ausgestellt" value={fmtEuro(data.this_month.issued_sum)}
          hint={`${data.this_month.issued_count} Rechnung(en)`} />
        <Kpi label="Diesen Monat eingegangen" value={fmtEuro(data.this_month.paid_sum)}
          hint="Zahlungseingänge auf Rechnungen dieses Monats" tint="#15803d" />
        <Kpi label="Aktive Lifetime-Posten" value={String(data.lifetime_active_count)}
          hint="Einmalig — nicht in MRR enthalten" />
        <Kpi label="Aktive Pay-per-use-Posten" value={String(data.usage_active_count)}
          hint="Werden monatlich aggregiert" />
      </div>

      {data.trend.length > 0 && (
        <section style={localStyles.section}>
          <h3 style={localStyles.h3}>Trend (letzte 6 Monate)</h3>
          <div style={localStyles.trendBars}>
            {data.trend.map(t => {
              const max = Math.max(...data.trend.map(x => Number(x.sum_cents))) || 1
              const h = Math.max(4, Math.round(Number(t.sum_cents) / max * 100))
              return (
                <div key={t.bucket} style={{ ...localStyles.trendCol }}>
                  <div style={{ ...localStyles.trendBar, height: `${h}%` }} title={fmtEuro(Number(t.sum_cents))} />
                  <div style={localStyles.trendLabel}>{t.bucket.slice(5)}</div>
                  <div style={localStyles.trendValue}>{fmtEuro(Number(t.sum_cents))}</div>
                  <div style={localStyles.trendCount}>{t.count} Rechn.</div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <section style={localStyles.section}>
          <h3 style={localStyles.h3}>Top überfällige Tenants</h3>
          {data.top_overdue.length === 0 ? (
            <p style={localStyles.muted}>Keine offenen Forderungen.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr>
                  <th style={s.th}>Tenant</th>
                  <th style={{ ...s.th, textAlign: 'right' as const }}>Anzahl</th>
                  <th style={{ ...s.th, textAlign: 'right' as const }}>Summe</th>
                  <th style={s.th}>Älteste Fälligkeit</th>
                </tr>
              </thead>
              <tbody>
                {data.top_overdue.map(t => (
                  <tr key={t.tenant_id}>
                    <td style={s.td}>{t.tenant_name}</td>
                    <td style={{ ...s.td, textAlign: 'right' as const }}>{t.overdue_count}</td>
                    <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const,
                                 fontWeight: 600, color: '#b91c1c' }}>
                      {fmtEuro(Number(t.overdue_cents))}
                    </td>
                    <td style={s.td}>{fmtDate(t.oldest_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 8 }}>
            <Link to="/billing/dunning" style={localStyles.link}>→ Mahn-Queue</Link>
          </div>
        </section>

        <section style={localStyles.section}>
          <h3 style={localStyles.h3}>Letzte Rechnungen</h3>
          {data.recent.length === 0 ? (
            <p style={localStyles.muted}>Noch keine Rechnungen ausgestellt.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr>
                  <th style={s.th}>Nummer</th>
                  <th style={s.th}>Tenant</th>
                  <th style={s.th}>Datum</th>
                  <th style={s.th}>Status</th>
                  <th style={{ ...s.th, textAlign: 'right' as const }}>Betrag</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map(r => (
                  <tr key={r.id}>
                    <td style={s.td}>
                      <Link to={`/billing/invoices/${r.id}`} style={localStyles.link}>
                        {r.invoice_number}
                      </Link>
                    </td>
                    <td style={s.td}>{r.tenant_name}</td>
                    <td style={s.td}>{fmtDate(r.invoice_date)}</td>
                    <td style={s.td}>{r.status}</td>
                    <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 600 }}>
                      {fmtEuro(Number(r.total_cents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value, hint, tint = '#1e293b' }: {
  label: string; value: string; hint?: string; tint?: string
}) {
  return (
    <div style={localStyles.kpi}>
      <div style={localStyles.kpiLabel}>{label}</div>
      <div style={{ ...localStyles.kpiValue, color: tint }}>{value}</div>
      {hint && <div style={localStyles.kpiHint}>{hint}</div>}
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:        { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column' as const, gap: '1.5rem', maxWidth: 1200 },
  h2:          { margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  h3:          { margin: '0 0 .5rem', fontSize: '.9375rem', fontWeight: 600, color: '#334155' },
  section:     { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.25rem' },
  kpiGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.75rem' },
  kpi:         { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.875rem 1rem', display: 'flex', flexDirection: 'column' as const, gap: 4 },
  kpiLabel:    { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  kpiValue:    { fontSize: '1.375rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const },
  kpiHint:     { fontSize: '.75rem', color: '#94a3b8' },
  trendBars:   { display: 'flex', alignItems: 'flex-end', gap: 12, padding: '12px 0', height: 200 },
  trendCol:    { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' },
  trendBar:    { width: '60%', background: '#3b82f6', borderRadius: '4px 4px 0 0', transition: 'height .2s' },
  trendLabel:  { fontSize: '.75rem', fontWeight: 600, color: '#475569' },
  trendValue:  { fontSize: '.6875rem', color: '#1e293b', fontVariantNumeric: 'tabular-nums' as const },
  trendCount:  { fontSize: '.625rem', color: '#94a3b8' },
  link:        { color: '#2563eb', textDecoration: 'none', fontSize: '.8125rem' },
  muted:       { color: '#94a3b8', fontSize: '.8125rem' },
}
