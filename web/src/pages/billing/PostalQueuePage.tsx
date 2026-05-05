import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getPostalQueue, markInvoicePrinted, openInvoicePdf,
  type PostalQueueRow,
} from '../../api/client'
import { formatApiError } from '../../lib/formError'
import * as s from '../../styles/shell'

function fmtCents(c: number, cur = 'EUR'): string {
  return `${(c / 100).toFixed(2)} ${cur === 'EUR' ? '€' : cur}`
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

export default function PostalQueuePage() {
  usePageTitle('Postversand-Queue')
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['billing', 'postal'],
    queryFn: () => getPostalQueue().then(r => r.data),
  })

  async function markPrinted(id: number) {
    if (!confirm('Rechnung als gedruckt + verschickt markieren?')) return
    setBusyId(id); setError(null)
    try {
      await markInvoicePrinted(id)
      qc.invalidateQueries({ queryKey: ['billing', 'postal'] })
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] })
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusyId(null) }
  }

  return (
    <div style={localStyles.page}>
      <h2 style={localStyles.h2}>Postversand</h2>
      <p style={localStyles.lead}>
        Rechnungen mit Postversand-Markierung, deren PDF bereit zum Druck ist.
        Nach dem physischen Versand auf „Verschickt" klicken — danach gilt die
        Rechnung als zugestellt und das Mahnwesen läuft an.
      </p>

      {error && <div style={localStyles.error}>{error}</div>}

      {isLoading ? (
        <div style={localStyles.muted}>Lade…</div>
      ) : rows.length === 0 ? (
        <div style={localStyles.empty}>Keine Rechnungen warten auf Postversand.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
          <thead>
            <tr>
              <th style={s.th}>Nummer</th>
              <th style={s.th}>Tenant</th>
              <th style={s.th}>Datum</th>
              <th style={s.th}>Fällig</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Betrag</th>
              <th style={s.th}>PDF</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: PostalQueueRow) => (
              <tr key={r.id}>
                <td style={s.td}>
                  <Link to={`/billing/invoices/${r.id}`} style={localStyles.link}>{r.invoice_number}</Link>
                </td>
                <td style={s.td}>{r.tenant_name}</td>
                <td style={s.td}>{fmtDate(r.invoice_date)}</td>
                <td style={s.td}>{fmtDate(r.due_date)}</td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                  {fmtCents(r.total_cents)}
                </td>
                <td style={s.td}>
                  {r.pdf_path
                    ? <button style={s.secondaryBtn} onClick={() => openInvoicePdf(r.id)}>PDF öffnen</button>
                    : <span style={localStyles.muted}>wird erzeugt…</span>}
                </td>
                <td style={s.td}>
                  <button style={s.actionBtn} onClick={() => markPrinted(r.id)}
                    disabled={!r.pdf_path || busyId === r.id}>
                    {busyId === r.id ? '…' : 'Verschickt'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:    { padding: '1.5rem 2rem', maxWidth: 1100, display: 'flex', flexDirection: 'column' as const, gap: '1rem' },
  h2:      { margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  lead:    { margin: 0, fontSize: '.8125rem', color: '#64748b' },
  empty:   { padding: '2rem', textAlign: 'center', color: '#94a3b8', background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 6 },
  muted:   { color: '#9ca3af', fontSize: '.8125rem' },
  link:    { color: '#1e293b', textDecoration: 'none', fontWeight: 600 },
  error:   { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
}
