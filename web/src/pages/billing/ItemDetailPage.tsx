import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getBillingItem, getItemUsage, getItemUsageSummary,
  recordUsage, deleteUsage,
  type UsageMetric, type UsageSummaryRow,
} from '../../api/client'
import { formatApiError } from '../../lib/formError'
import * as s from '../../styles/shell'

const SUB_DAY = new Set(['second','minute','hour'])

function fmtCents(c: number, cur = 'EUR') {
  return `${(c / 100).toFixed(2)} ${cur === 'EUR' ? '€' : cur}`
}
function fmtDateTime(s: string | null) {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 19)
}
function fmtQty(n: number) {
  return Number(n).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 6 })
}

export default function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const itemId = Number(id)
  usePageTitle(itemId ? `Posten #${itemId}` : 'Posten')
  const qc = useQueryClient()

  const { data: item } = useQuery({
    queryKey: ['billing', 'item', itemId],
    queryFn: () => getBillingItem(itemId).then(r => r.data),
    enabled: !!itemId,
  })

  const isSubDay = item ? SUB_DAY.has(item.interval_unit) : false

  const { data: usage = [] } = useQuery({
    queryKey: ['billing', 'item', itemId, 'usage'],
    queryFn: () => getItemUsage(itemId).then(r => r.data),
    enabled: isSubDay,
  })
  const { data: summary = [] } = useQuery({
    queryKey: ['billing', 'item', itemId, 'usage-summary'],
    queryFn: () => getItemUsageSummary(itemId).then(r => r.data),
    enabled: isSubDay,
  })

  const [draftQty, setDraftQty] = useState<string>('1')
  const [draftWhen, setDraftWhen] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAdd() {
    if (!item) return
    const q = Number(draftQty.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0) {
      setError('Menge muss > 0 sein.')
      return
    }
    setBusy(true); setError(null)
    try {
      await recordUsage({
        billing_item_id: item.id,
        quantity: q,
        recorded_at: draftWhen || undefined,
      })
      qc.invalidateQueries({ queryKey: ['billing', 'item', itemId, 'usage'] })
      qc.invalidateQueries({ queryKey: ['billing', 'item', itemId, 'usage-summary'] })
      setDraftQty('1')
      setDraftWhen('')
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  async function handleDelete(uid: number) {
    if (!confirm('Datenpunkt löschen?')) return
    try {
      await deleteUsage(uid)
      qc.invalidateQueries({ queryKey: ['billing', 'item', itemId, 'usage'] })
      qc.invalidateQueries({ queryKey: ['billing', 'item', itemId, 'usage-summary'] })
    } catch (err: any) { setError(formatApiError(err)) }
  }

  if (!item) return <div style={{ padding: '2rem', color: '#9ca3af' }}>Lade…</div>

  return (
    <div style={localStyles.page}>
      <div style={localStyles.header}>
        <Link to="/billing/items" style={localStyles.back}>← Posten</Link>
        <h2 style={localStyles.h2}>{item.description}</h2>
        <span style={localStyles.statusBadge}>{item.item_type}</span>
        <span style={localStyles.statusBadge}>{item.status}</span>
      </div>

      <div style={localStyles.metaGrid}>
        <Field label="Tenant"><strong>#{item.tenant_id}</strong></Field>
        <Field label="Preis pro Einheit">{fmtCents(item.unit_price_cents, item.currency)}</Field>
        <Field label="Intervall">{item.interval_count}× {item.interval_unit}</Field>
        <Field label="Gestartet">{fmtDateTime(item.started_at)}</Field>
        <Field label="Endet">{fmtDateTime(item.ends_at)}</Field>
        <Field label="Zuletzt abgerechnet">{fmtDateTime(item.last_billed_until)}</Field>
        <Field label="Nächste Fälligkeit">{fmtDateTime(item.next_due_at)}</Field>
      </div>

      {!isSubDay && (
        <div style={localStyles.notice}>
          Verbrauchs-Tracking ist nur für sekünden-/minuten-/stündliche Posten aktiv.
          Dieser Posten ({item.interval_unit}) wird über den regulären Billing-Poller abgerechnet.
        </div>
      )}

      {isSubDay && (
        <>
          {error && <div style={localStyles.error}>{error}</div>}

          <section style={localStyles.section}>
            <h3 style={localStyles.h3}>Verbrauch eintragen</h3>
            <p style={localStyles.lead}>
              Manueller Eintrag für Tests / Korrekturen. Externe Reporter sollten
              <code style={localStyles.code}>POST /api/v1/billing/usage</code> nutzen.
            </p>
            <div style={localStyles.addRow}>
              <label style={localStyles.fLabel}>
                <span style={localStyles.fLabelText}>Menge ({item.interval_unit})</span>
                <input value={draftQty} onChange={e => setDraftQty(e.target.value)}
                  style={{ ...localStyles.input, width: 130, textAlign: 'right' as const }} />
              </label>
              <label style={localStyles.fLabel}>
                <span style={localStyles.fLabelText}>Zeitpunkt (leer = jetzt)</span>
                <input type="datetime-local" value={draftWhen}
                  onChange={e => setDraftWhen(e.target.value)} style={localStyles.input} />
              </label>
              <button type="button" style={s.actionBtn} onClick={handleAdd} disabled={busy}>
                {busy ? '…' : 'Buchen'}
              </button>
            </div>
          </section>

          {summary.length > 0 && (
            <section style={localStyles.section}>
              <h3 style={localStyles.h3}>Monats-Übersicht</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Monat</th>
                    <th style={{ ...s.th, textAlign: 'right' as const }}>Datenpunkte</th>
                    <th style={{ ...s.th, textAlign: 'right' as const }}>Summe Menge</th>
                    <th style={{ ...s.th, textAlign: 'right' as const }}>Geschätzter Betrag</th>
                    <th style={s.th}>Abgerechnet</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row: UsageSummaryRow) => {
                    const consumed = Number(row.consumed_count)
                    const total = Number(row.data_points)
                    const status = consumed === 0
                      ? <span style={localStyles.muted}>offen</span>
                      : consumed === total
                        ? <span style={localStyles.pillOk}>komplett</span>
                        : <span style={localStyles.pillWarn}>{consumed}/{total}</span>
                    const qty = Number(row.total_quantity)
                    const amount = qty * item.unit_price_cents
                    return (
                      <tr key={row.bucket}>
                        <td style={s.td}>{row.bucket}</td>
                        <td style={{ ...s.td, textAlign: 'right' as const }}>{total}</td>
                        <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                          {fmtQty(qty)}
                        </td>
                        <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                          {fmtCents(Math.round(amount), item.currency)}
                        </td>
                        <td style={s.td}>{status}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section style={localStyles.section}>
            <h3 style={localStyles.h3}>Datenpunkte (letzte 500)</h3>
            {usage.length === 0 ? (
              <p style={localStyles.muted}>Noch keine Datenpunkte.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Zeitpunkt</th>
                    <th style={{ ...s.th, textAlign: 'right' as const }}>Menge</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u: UsageMetric) => (
                    <tr key={u.id}>
                      <td style={s.td}>{u.recorded_at}</td>
                      <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                        {fmtQty(Number(u.quantity))}
                      </td>
                      <td style={s.td}>
                        {u.consumed_invoice_id
                          ? <Link to={`/billing/invoices/${u.consumed_invoice_id}`} style={localStyles.link}>
                              auf #{u.consumed_invoice_id}
                            </Link>
                          : <span style={localStyles.muted}>offen</span>}
                      </td>
                      <td style={s.td}>
                        {!u.consumed_invoice_id && (
                          <button style={localStyles.btnDel} onClick={() => handleDelete(u.id)}>×</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
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
  statusBadge: { padding: '2px 10px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' as const, background: '#e0e7ff', color: '#3730a3' },
  metaGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem 1rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem 1rem' },
  fLabel:      { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  fLabelText:  { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  input:       { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem' },
  notice:      { background: '#f0f9ff', color: '#075985', padding: '.75rem 1rem', borderRadius: 6, fontSize: '.8125rem' },
  error:       { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  section:     { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column' as const, gap: '.5rem' },
  h3:          { margin: 0, fontSize: '.9375rem', fontWeight: 600, color: '#334155' },
  lead:        { margin: 0, fontSize: '.75rem', color: '#94a3b8' },
  code:        { background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, fontFamily: 'monospace', fontSize: '.75rem', marginLeft: 4 },
  addRow:      { display: 'flex', gap: '.75rem', alignItems: 'flex-end', flexWrap: 'wrap' as const, marginTop: '.5rem' },
  link:        { color: '#2563eb', textDecoration: 'none' },
  muted:       { color: '#94a3b8', fontSize: '.75rem' },
  pillOk:      { display: 'inline-block', padding: '1px 8px', background: '#dcfce7', color: '#15803d', borderRadius: 3, fontSize: '.6875rem', fontWeight: 600 },
  pillWarn:    { display: 'inline-block', padding: '1px 8px', background: '#fef3c7', color: '#92400e', borderRadius: 3, fontSize: '.6875rem', fontWeight: 600 },
  btnDel:      { padding: '.125rem .5rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 3, fontSize: '.875rem', cursor: 'pointer' },
}
