import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import { getInvoices, type Invoice, type InvoiceStatus } from '../../api/client'
import * as s from '../../styles/shell'

const STATUS_LABEL: Record<InvoiceStatus, { de: string; color: string }> = {
  draft:       { de: 'Entwurf',       color: '#6b7280' },
  issued:      { de: 'gestellt',      color: '#0369a1' },
  sent:        { de: 'versendet',     color: '#0e7490' },
  paid:        { de: 'bezahlt',       color: '#15803d' },
  partial:     { de: 'teilbezahlt',   color: '#a16207' },
  overdue:     { de: 'überfällig',    color: '#b91c1c' },
  cancelled:   { de: 'storniert',     color: '#991b1b' },
  credit_note: { de: 'Gutschrift',    color: '#7c3aed' },
}

function fmtCents(c: number, cur = 'EUR'): string {
  const sign = c < 0 ? '-' : ''
  return `${sign}${(Math.abs(c) / 100).toFixed(2)} ${cur}`
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

export default function PortalInvoicesPage() {
  usePageTitle('Meine Rechnungen')

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['portal', 'invoices'],
    queryFn: () => getInvoices().then(r => r.data),
  })

  // Drafts ausblenden — die hat der Tenant nicht zu sehen.
  const visible = invoices.filter(i => i.status !== 'draft')

  return (
    <div style={localStyles.page}>
      <h2 style={localStyles.h2}>Meine Rechnungen</h2>

      {isLoading ? (
        <div style={localStyles.muted}>Lade…</div>
      ) : visible.length === 0 ? (
        <div style={localStyles.empty}>
          Noch keine Rechnungen. Sobald wir Ihnen eine Rechnung ausstellen, erscheint sie hier.
        </div>
      ) : (
        <div style={s.tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.875rem' }}>
            <thead>
              <tr>
                <th style={s.th}>Nummer</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Datum</th>
                <th style={s.th}>Fällig</th>
                <th style={{ ...s.th, textAlign: 'right' as const }}>Netto</th>
                <th style={{ ...s.th, textAlign: 'right' as const }}>USt</th>
                <th style={{ ...s.th, textAlign: 'right' as const }}>Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((inv: Invoice) => {
                const sl = STATUS_LABEL[inv.status] ?? { de: inv.status, color: '#000' }
                return (
                  <tr key={inv.id}>
                    <td style={s.td}>
                      <Link to={`/portal/invoices/${inv.id}`} style={localStyles.link}>
                        <strong>{inv.invoice_number ?? `#${inv.id}`}</strong>
                      </Link>
                      {inv.kind === 'credit_note' && (
                        <span style={{ ...localStyles.badge, marginLeft: 6, background: '#ddd6fe', color: '#5b21b6' }}>Storno</span>
                      )}
                    </td>
                    <td style={s.td}>
                      <span style={{ ...localStyles.badge, background: sl.color + '22', color: sl.color }}>{sl.de}</span>
                    </td>
                    <td style={s.td}>{fmtDate(inv.invoice_date)}</td>
                    <td style={s.td}>{fmtDate(inv.due_date)}</td>
                    <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                      {fmtCents(inv.subtotal_cents, inv.currency)}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' as const, color: '#64748b', fontVariantNumeric: 'tabular-nums' as const }}>
                      {fmtCents(inv.tax_total_cents, inv.currency)}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const }}>
                      {fmtCents(inv.total_cents, inv.currency)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:    { padding: '1.5rem 2rem', maxWidth: 1100 },
  h2:      { margin: '0 0 1rem', fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  empty:   { padding: '2rem', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 6 },
  muted:   { color: '#9ca3af', padding: '1rem' },
  badge:   { display: 'inline-block', padding: '1px 8px', borderRadius: 3, fontSize: '.6875rem', fontWeight: 600 },
  link:    { color: '#1e293b', textDecoration: 'none' },
}
