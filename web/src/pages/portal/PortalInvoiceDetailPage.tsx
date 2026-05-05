import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import { getInvoice, openInvoicePdf } from '../../api/client'
import * as s from '../../styles/shell'

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

export default function PortalInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  usePageTitle(id ? `Rechnung #${id}` : 'Rechnung')
  const [busy, setBusy] = useState(false)

  const { data: inv, isLoading, error } = useQuery({
    queryKey: ['portal', 'invoice', id],
    queryFn: () => getInvoice(Number(id)).then(r => r.data),
    enabled: !!id,
  })

  if (isLoading) return <div style={{ padding: '2rem', color: '#9ca3af' }}>Lade…</div>
  if (error || !inv) return <div style={{ padding: '2rem', color: '#b91c1c' }}>Rechnung nicht gefunden.</div>
  if (inv.status === 'draft') {
    // Drafts gehören dem Admin. Tenant sollte sie nicht sehen.
    return <div style={{ padding: '2rem', color: '#94a3b8' }}>Diese Rechnung ist noch nicht ausgestellt.</div>
  }

  async function handleDownload() {
    if (!inv) return
    setBusy(true)
    try {
      await openInvoicePdf(inv.id)
    } finally { setBusy(false) }
  }

  const recipient = inv.billing_address_snapshot ?? {}

  return (
    <div style={localStyles.page}>
      <div style={localStyles.header}>
        <Link to="/portal/invoices" style={localStyles.back}>← Meine Rechnungen</Link>
        <h2 style={localStyles.h2}>
          {inv.kind === 'credit_note' ? 'Gutschrift' :
           inv.kind === 'dunning_invoice' ? 'Mahnung' : 'Rechnung'} {inv.invoice_number}
        </h2>
        <div style={{ marginLeft: 'auto' }}>
          <button style={s.actionBtn} onClick={handleDownload} disabled={busy}>
            {busy ? 'Lade…' : 'PDF herunterladen'}
          </button>
        </div>
      </div>

      <div style={localStyles.metaGrid}>
        <Field label="Datum">{fmtDate(inv.invoice_date)}</Field>
        <Field label="Fällig">{fmtDate(inv.due_date)}</Field>
        <Field label="Status">{inv.status}</Field>
        {inv.service_period_start && inv.service_period_end && (
          <Field label="Leistungszeitraum">
            {fmtDate(inv.service_period_start)} – {fmtDate(inv.service_period_end)}
          </Field>
        )}
        {recipient && (recipient.company_name || recipient.name) && (
          <Field label="Adressiert an">
            <div style={{ whiteSpace: 'pre-line' as const, fontSize: '.8125rem' }}>
              {[recipient.company_name, [recipient.first_name, recipient.last_name].filter(Boolean).join(' '),
                recipient.street, [recipient.zip, recipient.city].filter(Boolean).join(' ')]
                .filter(Boolean).join('\n')}
            </div>
          </Field>
        )}
      </div>

      {inv.tax_note && (
        <div style={localStyles.taxNote}>
          <strong>Steuerlicher Hinweis:</strong> {inv.tax_note}
        </div>
      )}

      <div style={s.tableWrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: 30 }}>#</th>
              <th style={s.th}>Leistung</th>
              <th style={s.th}>Zeitraum</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Menge</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Einzel</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>USt%</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Summe</th>
            </tr>
          </thead>
          <tbody>
            {(inv.items ?? []).map(it => (
              <tr key={it.id}>
                <td style={s.td}>{it.position}</td>
                <td style={s.td}>{it.description}</td>
                <td style={s.td}>
                  {it.period_start && it.period_end
                    ? <span style={localStyles.muted}>{fmtDate(it.period_start)} – {fmtDate(it.period_end)}</span>
                    : <span style={localStyles.muted}>—</span>}
                </td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                  {Number(it.quantity).toFixed(it.quantity % 1 === 0 ? 0 : 4)}
                  {it.unit && <span style={localStyles.muted}> {it.unit}</span>}
                </td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                  {fmtCents(it.unit_price_cents, inv.currency)}
                </td>
                <td style={{ ...s.td, textAlign: 'right' as const, color: '#64748b' }}>{Number(it.tax_rate_percent)}%</td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 600, fontVariantNumeric: 'tabular-nums' as const }}>
                  {fmtCents(it.line_total_cents, inv.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}></td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 600 }}>Netto</td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 600 }}>
                {fmtCents(inv.subtotal_cents, inv.currency)}
              </td>
            </tr>
            <tr>
              <td colSpan={5}></td>
              <td style={{ ...s.td, textAlign: 'right' as const, color: '#64748b' }}>USt</td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, color: '#64748b' }}>
                {fmtCents(inv.tax_total_cents, inv.currency)}
              </td>
            </tr>
            <tr>
              <td colSpan={5}></td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 700, fontSize: '.9375rem' }}>Gesamt</td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 700, fontSize: '.9375rem' }}>
                {fmtCents(inv.total_cents, inv.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {inv.customer_notes && (
        <div style={localStyles.notes}>{inv.customer_notes}</div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={localStyles.fLabel}>
      <span style={localStyles.fLabelText}>{label}</span>
      <span>{children}</span>
    </label>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:        { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column' as const, gap: '1rem', maxWidth: 1100 },
  header:      { display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' as const },
  back:        { color: '#64748b', textDecoration: 'none', fontSize: '.8125rem' },
  h2:          { margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  metaGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem 1rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem 1rem' },
  fLabel:      { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  fLabelText:  { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  taxNote:     { background: '#fef3c7', color: '#92400e', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  notes:       { background: '#f8fafc', padding: '.75rem 1rem', borderRadius: 6, fontSize: '.8125rem', color: '#475569', whiteSpace: 'pre-line' as const },
  muted:       { color: '#94a3b8', fontSize: '.75rem' },
}
