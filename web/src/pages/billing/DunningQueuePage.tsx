import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getDunningQueue, triggerDunning,
  type DunningQueueRow,
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

export default function DunningQueuePage() {
  usePageTitle('Mahn-Queue')
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['billing', 'dunning-queue'],
    queryFn: () => getDunningQueue().then(r => r.data),
  })

  async function trigger(row: DunningQueueRow) {
    if (row.dunning_paused) {
      alert('Mahnwesen ist für diesen Tenant pausiert.')
      return
    }
    const nextLevel = row.last_level + 1
    if (!confirm(`Mahnstufe ${nextLevel} für Rechnung ${row.invoice_number} auslösen?`)) return
    setBusyId(row.id); setError(null)
    try {
      await triggerDunning(row.id)
      qc.invalidateQueries({ queryKey: ['billing', 'dunning-queue'] })
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] })
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusyId(null) }
  }

  return (
    <div style={localStyles.page}>
      <h2 style={localStyles.h2}>Überfällige Rechnungen</h2>
      <p style={localStyles.lead}>
        Liste aller offenen Rechnungen mit überschrittenem Fälligkeitsdatum. Der
        Worker eskaliert die Mahnstufen automatisch nach den in den Settings
        konfigurierten Tagen — du kannst hier aber jederzeit manuell die nächste
        Stufe auslösen.
      </p>

      {error && <div style={localStyles.error}>{error}</div>}

      {isLoading ? (
        <div style={localStyles.muted}>Lade…</div>
      ) : rows.length === 0 ? (
        <div style={localStyles.empty}>Keine überfälligen Rechnungen. 🎉</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
          <thead>
            <tr>
              <th style={s.th}>Nummer</th>
              <th style={s.th}>Tenant</th>
              <th style={s.th}>Fällig</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Tage über.</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Offen</th>
              <th style={s.th}>Letzte Stufe</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: DunningQueueRow) => (
              <tr key={r.id} style={r.dunning_paused ? { opacity: .55 } : undefined}>
                <td style={s.td}>
                  <Link to={`/billing/invoices/${r.id}`} style={localStyles.link}>{r.invoice_number}</Link>
                </td>
                <td style={s.td}>
                  {r.tenant_name}
                  {r.dunning_paused === 1 && <span style={localStyles.pausedBadge}>pausiert</span>}
                </td>
                <td style={s.td}>{fmtDate(r.due_date)}</td>
                <td style={{ ...s.td, textAlign: 'right' as const, color: '#b91c1c', fontWeight: 600 }}>
                  {r.days_overdue}
                </td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 600 }}>
                  {fmtCents(r.total_cents - r.paid_cents)}
                </td>
                <td style={s.td}>
                  {r.last_level === -1 ? <span style={localStyles.muted}>—</span> : `Stufe ${r.last_level}`}
                </td>
                <td style={s.td}>
                  <button style={s.actionBtn}
                    disabled={busyId === r.id || r.dunning_paused === 1}
                    onClick={() => trigger(r)}>
                    {busyId === r.id ? '…' : `Stufe ${r.last_level + 1}`}
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
  pausedBadge: { display: 'inline-block', marginLeft: 6, padding: '1px 6px', background: '#fef3c7', color: '#92400e', borderRadius: 3, fontSize: '.6875rem', fontWeight: 600 },
}
