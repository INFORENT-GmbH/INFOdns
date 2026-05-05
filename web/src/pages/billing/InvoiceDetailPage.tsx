import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getInvoice, updateInvoice, addInvoiceItem, deleteInvoiceItem,
  issueInvoice, cancelInvoice, openInvoicePdf,
  getInvoicePayments, createPayment, deletePayment,
  getInvoiceDunning, triggerDunning,
  type InvoiceItemInput, type Payment, type DunningLogEntry,
} from '../../api/client'
import EuroInput from '../../components/EuroInput'
import { formatApiError } from '../../lib/formError'
import * as s from '../../styles/shell'

function fmtCents(c: number, cur = 'EUR'): string {
  const sign = c < 0 ? '-' : ''
  return `${sign}${(Math.abs(c) / 100).toFixed(2)} ${cur}`
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  usePageTitle(id ? `Rechnung #${id}` : 'Rechnung')

  const { data: inv, isLoading } = useQuery({
    queryKey: ['billing', 'invoice', id],
    queryFn: () => getInvoice(Number(id)).then(r => r.data),
    enabled: !!id,
  })

  const showFinance = !!inv && !['draft','cancelled'].includes(inv.status)
  const { data: payments = [] } = useQuery({
    queryKey: ['billing', 'payments', id],
    queryFn: () => getInvoicePayments(Number(id)).then(r => r.data),
    enabled: !!id && showFinance,
  })
  const { data: dunning = [] } = useQuery({
    queryKey: ['billing', 'dunning', id],
    queryFn: () => getInvoiceDunning(Number(id)).then(r => r.data),
    enabled: !!id && showFinance,
  })

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [draftItem, setDraftItem] = useState<InvoiceItemInput>({
    description: '', quantity: 1, unit_price_cents: 0, tax_rate_percent: 19,
  })
  const [headerEdits, setHeaderEdits] = useState<{ customer_notes?: string; postal_delivery?: boolean }>({})

  // Payment form
  const [showAddPayment, setShowAddPayment] = useState(false)
  const [paymentDraft, setPaymentDraft] = useState<{
    paid_at: string; amount_cents: number; method: Payment['method']; reference: string
  }>({
    paid_at: new Date().toISOString().slice(0, 10),
    amount_cents: 0,
    method: 'transfer',
    reference: '',
  })

  useEffect(() => {
    if (inv) setHeaderEdits({})
  }, [inv?.id])

  if (isLoading || !inv) {
    return <div style={{ padding: '2rem', color: '#9ca3af' }}>Loading…</div>
  }

  const isDraft = inv.status === 'draft'

  async function handleAddItem() {
    setBusy(true); setError(null)
    try {
      await addInvoiceItem(inv!.id, draftItem)
      qc.invalidateQueries({ queryKey: ['billing', 'invoice', id] })
      setShowAddItem(false)
      setDraftItem({ description: '', quantity: 1, unit_price_cents: 0, tax_rate_percent: 19 })
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  async function handleDeleteItem(itemId: number) {
    if (!confirm('Position entfernen?')) return
    try {
      await deleteInvoiceItem(inv!.id, itemId)
      qc.invalidateQueries({ queryKey: ['billing', 'invoice', id] })
    } catch (err: any) { setError(formatApiError(err)) }
  }

  async function handleSaveHeader() {
    if (Object.keys(headerEdits).length === 0) return
    setBusy(true); setError(null)
    try {
      await updateInvoice(inv!.id, headerEdits)
      qc.invalidateQueries({ queryKey: ['billing', 'invoice', id] })
      setHeaderEdits({})
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  async function handleIssue() {
    if (!confirm(`Rechnung jetzt ausstellen? Sie bekommt eine fortlaufende Nummer und ist ab dann nicht mehr editierbar (nur stornierbar).`)) return
    setBusy(true); setError(null)
    try {
      const r = await issueInvoice(inv!.id)
      qc.invalidateQueries({ queryKey: ['billing', 'invoice', id] })
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] })
      alert(`Rechnung ${r.data.invoice_number} ausgestellt, fällig am ${r.data.due_date}.`)
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  async function handleAddPayment() {
    if (!inv) return
    setBusy(true); setError(null)
    try {
      await createPayment(inv.id, {
        paid_at: paymentDraft.paid_at,
        amount_cents: paymentDraft.amount_cents,
        method: paymentDraft.method,
        reference: paymentDraft.reference || null,
      })
      qc.invalidateQueries({ queryKey: ['billing', 'invoice', id] })
      qc.invalidateQueries({ queryKey: ['billing', 'payments', id] })
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] })
      setShowAddPayment(false)
      setPaymentDraft({
        paid_at: new Date().toISOString().slice(0, 10),
        amount_cents: 0, method: 'transfer', reference: '',
      })
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  async function handleDeletePayment(paymentId: number) {
    if (!confirm('Zahlung wirklich löschen? Status der Rechnung wird neu berechnet.')) return
    try {
      await deletePayment(paymentId)
      qc.invalidateQueries({ queryKey: ['billing', 'invoice', id] })
      qc.invalidateQueries({ queryKey: ['billing', 'payments', id] })
    } catch (err: any) { setError(formatApiError(err)) }
  }

  async function handleTriggerDunning() {
    if (!inv) return
    if (!confirm('Nächste Mahnstufe auslösen? Bei Stufe ≥ 1 wird eine eigenständige Mahn-Rechnung mit Mahngebühr erstellt.')) return
    setBusy(true); setError(null)
    try {
      const r = await triggerDunning(inv.id)
      qc.invalidateQueries({ queryKey: ['billing', 'invoice', id] })
      qc.invalidateQueries({ queryKey: ['billing', 'dunning', id] })
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] })
      if (r.data.dunning_invoice) {
        if (confirm(`Mahnstufe ${r.data.level} ausgelöst. Die Mahn-Rechnung ${r.data.dunning_invoice.invoice_number} öffnen?`)) {
          navigate(`/billing/invoices/${r.data.dunning_invoice.id}`)
        }
      } else {
        alert(`Mahnstufe ${r.data.level} (Erinnerung) wurde eingetragen — Mail wird durch den Worker versendet.`)
      }
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  async function handleCancel() {
    if (isDraft) {
      if (!confirm('Draft endgültig löschen?')) return
    } else {
      if (!confirm('Rechnung stornieren? Es wird automatisch eine Storno-Rechnung (credit_note) erzeugt.')) return
    }
    const reason = isDraft ? undefined : prompt('Grund für Storno:') ?? undefined
    setBusy(true); setError(null)
    try {
      const r = await cancelInvoice(inv!.id, reason)
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] })
      if (r.data.hard_deleted) {
        navigate('/billing/invoices')
      } else if (r.data.credit_note) {
        navigate(`/billing/invoices/${r.data.credit_note.id}`)
      }
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  const headerDirty = Object.keys(headerEdits).length > 0

  return (
    <div style={localStyles.page}>
      <div style={localStyles.header}>
        <Link to="/billing/invoices" style={localStyles.back}>← Rechnungen</Link>
        <h2 style={localStyles.h2}>
          {inv.invoice_number ? `Rechnung ${inv.invoice_number}` : `Entwurf #${inv.id}`}
        </h2>
        <span style={{ ...localStyles.statusBadge, ...statusStyle(inv.status) }}>{inv.status}</span>
        {inv.kind === 'credit_note' && <span style={{ ...localStyles.statusBadge, background: '#ddd6fe', color: '#5b21b6' }}>Storno</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!isDraft && (
            <button style={s.secondaryBtn} onClick={() => openInvoicePdf(inv.id)} disabled={busy}>
              PDF öffnen
            </button>
          )}
          {isDraft && (
            <button style={s.actionBtn} onClick={handleIssue} disabled={busy || (inv.items?.length ?? 0) === 0}>
              Ausstellen
            </button>
          )}
          {showFinance && inv.kind === 'invoice' && (
            <button style={s.secondaryBtn} onClick={handleTriggerDunning} disabled={busy}>
              Mahnung auslösen
            </button>
          )}
          {inv.status !== 'cancelled' && (
            <button style={localStyles.btnDanger} onClick={handleCancel} disabled={busy}>
              {isDraft ? 'Draft löschen' : 'Stornieren'}
            </button>
          )}
        </div>
      </div>

      {error && <div style={localStyles.error}>{error}</div>}

      <div style={localStyles.metaGrid}>
        <Field label="Tenant"><strong>#{inv.tenant_id}</strong></Field>
        <Field label="Datum">{inv.invoice_date ?? '—'}</Field>
        <Field label="Fälligkeitsdatum">{inv.due_date ?? '—'}</Field>
        <Field label="Steuermodus">{inv.tax_mode}</Field>
        <Field label="Leistungszeitraum">
          {inv.service_period_start && inv.service_period_end
            ? `${inv.service_period_start.slice(0,10)} – ${inv.service_period_end.slice(0,10)}`
            : '—'}
        </Field>
        <Field label="Versand">
          {isDraft ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8125rem' }}>
              <input type="checkbox" checked={headerEdits.postal_delivery ?? !!inv.postal_delivery}
                onChange={e => setHeaderEdits(prev => ({ ...prev, postal_delivery: e.target.checked }))} />
              Postversand (Aufpreis wird beim Issuing berechnet)
            </label>
          ) : (
            inv.postal_delivery ? `Post (${fmtCents(inv.postal_fee_cents, inv.currency)})` : 'E-Mail'
          )}
        </Field>
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
              <th style={s.th}>Beschreibung</th>
              <th style={s.th}>Zeitraum</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Menge</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Einzelpreis</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>USt</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Netto</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Gesamt</th>
              {isDraft && <th style={s.th}></th>}
            </tr>
          </thead>
          <tbody>
            {(inv.items ?? []).map(it => (
              <tr key={it.id}>
                <td style={s.td}>{it.position}</td>
                <td style={s.td}>{it.description}</td>
                <td style={s.td}>
                  {it.period_start && it.period_end
                    ? <span style={localStyles.muted}>{it.period_start.slice(0,10)} – {it.period_end.slice(0,10)}</span>
                    : <span style={localStyles.muted}>—</span>}
                </td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                  {Number(it.quantity).toFixed(it.quantity % 1 === 0 ? 0 : 4)}
                  {it.unit && <span style={localStyles.muted}> {it.unit}</span>}
                </td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCents(it.unit_price_cents, inv.currency)}</td>
                <td style={{ ...s.td, textAlign: 'right' as const, color: '#64748b' }}>{Number(it.tax_rate_percent)}%</td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCents(it.line_subtotal_cents, inv.currency)}</td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 600, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCents(it.line_total_cents, inv.currency)}</td>
                {isDraft && (
                  <td style={s.td}>
                    <button style={localStyles.btnDel} onClick={() => handleDeleteItem(it.id)}>×</button>
                  </td>
                )}
              </tr>
            ))}
            {(inv.items ?? []).length === 0 && (
              <tr><td colSpan={isDraft ? 9 : 8} style={{ ...s.td, color: '#94a3b8', textAlign: 'center', padding: '1.5rem' }}>Keine Positionen</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={isDraft ? 6 : 5}></td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 600 }}>Netto</td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 600 }}>{fmtCents(inv.subtotal_cents, inv.currency)}</td>
              {isDraft && <td></td>}
            </tr>
            <tr>
              <td colSpan={isDraft ? 6 : 5}></td>
              <td style={{ ...s.td, textAlign: 'right' as const, color: '#64748b' }}>USt</td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, color: '#64748b' }}>{fmtCents(inv.tax_total_cents, inv.currency)}</td>
              {isDraft && <td></td>}
            </tr>
            <tr>
              <td colSpan={isDraft ? 6 : 5}></td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 700, fontSize: '.9375rem' }}>Gesamt</td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, fontWeight: 700, fontSize: '.9375rem' }}>{fmtCents(inv.total_cents, inv.currency)}</td>
              {isDraft && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {isDraft && (
        <div style={{ marginTop: '.5rem' }}>
          {showAddItem ? (
            <div style={localStyles.newItemBox}>
              <h4 style={localStyles.h4}>Neue Position</h4>
              <div style={localStyles.itemGrid}>
                <Field label="Beschreibung *">
                  <input value={draftItem.description}
                    onChange={e => setDraftItem(d => ({ ...d, description: e.target.value }))}
                    style={localStyles.input} />
                </Field>
                <Field label="Menge">
                  <input type="number" step="0.0001" value={draftItem.quantity}
                    onChange={e => setDraftItem(d => ({ ...d, quantity: Number(e.target.value) }))}
                    style={localStyles.input} />
                </Field>
                <Field label="Einzelpreis">
                  <EuroInput cents={draftItem.unit_price_cents} allowNegative
                    onChange={c => setDraftItem(d => ({ ...d, unit_price_cents: c }))}
                    style={{ width: '100%' }} />
                </Field>
                <Field label="USt %">
                  <input type="number" step="0.01" value={draftItem.tax_rate_percent}
                    onChange={e => setDraftItem(d => ({ ...d, tax_rate_percent: Number(e.target.value) }))}
                    style={localStyles.input} />
                </Field>
                <Field label="Einheit">
                  <input value={draftItem.unit ?? ''}
                    onChange={e => setDraftItem(d => ({ ...d, unit: e.target.value || null }))}
                    placeholder="Stk, Sek, GB…" style={localStyles.input} />
                </Field>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.75rem' }}>
                <button style={s.secondaryBtn} onClick={() => setShowAddItem(false)}>Abbrechen</button>
                <button style={s.actionBtn} onClick={handleAddItem} disabled={busy || !draftItem.description}>Hinzufügen</button>
              </div>
            </div>
          ) : (
            <button style={s.actionBtn} onClick={() => setShowAddItem(true)}>+ Position</button>
          )}
        </div>
      )}

      <div style={localStyles.notesGrid}>
        <Field label="Notiz für Kunde (erscheint auf Rechnung)">
          {isDraft ? (
            <textarea
              value={headerEdits.customer_notes ?? inv.customer_notes ?? ''}
              onChange={e => setHeaderEdits(prev => ({ ...prev, customer_notes: e.target.value }))}
              rows={3} style={{ ...localStyles.input, resize: 'vertical' as const }} />
          ) : (
            <div style={localStyles.readOnlyArea}>{inv.customer_notes ?? '—'}</div>
          )}
        </Field>
        <Field label="Interne Notiz">
          <div style={localStyles.readOnlyArea}>{inv.notes ?? '—'}</div>
        </Field>
      </div>

      {headerDirty && isDraft && (
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
          <button style={s.secondaryBtn} onClick={() => setHeaderEdits({})}>Verwerfen</button>
          <button style={s.actionBtn} onClick={handleSaveHeader} disabled={busy}>Kopf speichern</button>
        </div>
      )}

      {showFinance && (
        <PaymentsSection
          invoiceTotal={inv.total_cents}
          invoicePaid={inv.paid_cents}
          currency={inv.currency}
          payments={payments}
          onAdd={() => {
            const open = inv.total_cents - inv.paid_cents
            setPaymentDraft(d => ({ ...d, amount_cents: open > 0 ? open : 0 }))
            setShowAddPayment(true)
          }}
          onDelete={handleDeletePayment}
        />
      )}

      {showAddPayment && (
        <AddPaymentBox
          draft={paymentDraft}
          setDraft={setPaymentDraft}
          onCancel={() => setShowAddPayment(false)}
          onSave={handleAddPayment}
          busy={busy}
        />
      )}

      {showFinance && dunning.length > 0 && (
        <DunningSection entries={dunning} />
      )}
    </div>
  )
}

// ── Sub-Components für Payments + Dunning ──────────────────

function fmtAmount(c: number, cur = 'EUR') {
  const sign = c < 0 ? '-' : ''
  return `${sign}${(Math.abs(c) / 100).toFixed(2)} ${cur === 'EUR' ? '€' : cur}`
}

function PaymentsSection({
  invoiceTotal, invoicePaid, currency, payments, onAdd, onDelete,
}: {
  invoiceTotal: number; invoicePaid: number; currency: string
  payments: Payment[]; onAdd: () => void; onDelete: (id: number) => void
}) {
  const open = invoiceTotal - invoicePaid
  return (
    <section style={localStyles.section}>
      <div style={localStyles.sectionHeader}>
        <h3 style={localStyles.h3}>Zahlungen</h3>
        <span style={open === 0 ? localStyles.pillOk : open > 0 ? localStyles.pillWarn : localStyles.pillCredit}>
          {open === 0 ? 'vollständig bezahlt'
            : open > 0 ? `offen: ${fmtAmount(open, currency)}`
            : `überzahlt: ${fmtAmount(-open, currency)}`}
        </span>
        <button type="button" style={s.actionBtn} onClick={onAdd}>+ Zahlung buchen</button>
      </div>
      {payments.length === 0 ? (
        <p style={localStyles.muted}>Noch keine Zahlungseingänge gebucht.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
          <thead>
            <tr>
              <th style={s.th}>Datum</th>
              <th style={s.th}>Methode</th>
              <th style={s.th}>Verwendungszweck</th>
              <th style={{ ...s.th, textAlign: 'right' as const }}>Betrag</th>
              <th style={s.th}></th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id}>
                <td style={s.td}>{p.paid_at}</td>
                <td style={s.td}>{p.method}</td>
                <td style={s.td}>{p.reference ?? <span style={localStyles.muted}>—</span>}</td>
                <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const,
                             color: p.amount_cents < 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                  {fmtAmount(p.amount_cents, currency)}
                </td>
                <td style={s.td}>
                  <button style={localStyles.btnDelSmall} onClick={() => onDelete(p.id)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function AddPaymentBox({
  draft, setDraft, onCancel, onSave, busy,
}: {
  draft: { paid_at: string; amount_cents: number; method: Payment['method']; reference: string }
  setDraft: React.Dispatch<React.SetStateAction<{ paid_at: string; amount_cents: number; method: Payment['method']; reference: string }>>
  onCancel: () => void; onSave: () => void; busy: boolean
}) {
  return (
    <section style={{ ...localStyles.section, background: '#f8fafc' }}>
      <h4 style={localStyles.h4}>Zahlung erfassen</h4>
      <div style={localStyles.itemGrid}>
        <label style={localStyles.fLabel}>
          <span style={localStyles.fLabelText}>Datum</span>
          <input type="date" value={draft.paid_at}
            onChange={e => setDraft(d => ({ ...d, paid_at: e.target.value }))}
            style={localStyles.input} />
        </label>
        <label style={localStyles.fLabel}>
          <span style={localStyles.fLabelText}>Betrag</span>
          <EuroInput cents={draft.amount_cents} allowNegative
            onChange={c => setDraft(d => ({ ...d, amount_cents: c }))}
            style={{ width: '100%' }} />
        </label>
        <label style={localStyles.fLabel}>
          <span style={localStyles.fLabelText}>Methode</span>
          <select value={draft.method}
            onChange={e => setDraft(d => ({ ...d, method: e.target.value as Payment['method'] }))}
            style={localStyles.input}>
            <option value="transfer">Überweisung</option>
            <option value="sepa">SEPA-Lastschrift</option>
            <option value="cash">Bar</option>
            <option value="card">Karte</option>
            <option value="manual">Manuell</option>
            <option value="offset">Verrechnung</option>
          </select>
        </label>
        <label style={localStyles.fLabel}>
          <span style={localStyles.fLabelText}>Verwendungszweck / Ref</span>
          <input value={draft.reference}
            onChange={e => setDraft(d => ({ ...d, reference: e.target.value }))}
            style={localStyles.input} />
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.75rem' }}>
        <button type="button" style={s.secondaryBtn} onClick={onCancel}>Abbrechen</button>
        <button type="button" style={s.actionBtn} onClick={onSave} disabled={busy}>
          {busy ? '…' : 'Buchen'}
        </button>
      </div>
    </section>
  )
}

function DunningSection({ entries }: { entries: DunningLogEntry[] }) {
  return (
    <section style={localStyles.section}>
      <h3 style={localStyles.h3}>Mahn-Historie</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
        <thead>
          <tr>
            <th style={s.th}>Stufe</th>
            <th style={s.th}>Bezeichnung</th>
            <th style={s.th}>Versendet am</th>
            <th style={{ ...s.th, textAlign: 'right' as const }}>Mahngebühr</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td style={s.td}><strong>{e.level}</strong></td>
              <td style={s.td}>{e.label ?? '—'}</td>
              <td style={s.td}>{e.sent_at?.replace('T', ' ').slice(0, 16) ?? '—'}</td>
              <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>
                {e.fee_added_cents > 0 ? fmtAmount(e.fee_added_cents) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function statusStyle(status: string): React.CSSProperties {
  const map: Record<string, React.CSSProperties> = {
    draft:   { background: '#f1f5f9', color: '#475569' },
    issued:  { background: '#dbeafe', color: '#1e40af' },
    sent:    { background: '#cffafe', color: '#155e75' },
    paid:    { background: '#dcfce7', color: '#15803d' },
    partial: { background: '#fef9c3', color: '#854d0e' },
    overdue: { background: '#fee2e2', color: '#b91c1c' },
    cancelled:   { background: '#f1f5f9', color: '#94a3b8', textDecoration: 'line-through' as const },
    credit_note: { background: '#ede9fe', color: '#5b21b6' },
  }
  return map[status] ?? { background: '#f1f5f9', color: '#1e293b' }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={localStyles.fLabel}>
      <span style={localStyles.fLabelText}>{label}</span>
      {children}
    </label>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:        { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column' as const, gap: '1rem', maxWidth: 1200 },
  header:      { display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' as const },
  back:        { color: '#64748b', textDecoration: 'none', fontSize: '.8125rem' },
  h2:          { margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  statusBadge: { padding: '2px 10px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' as const },
  metaGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem 1rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem 1rem' },
  notesGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem 1rem' },
  fLabel:      { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  fLabelText:  { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  input:       { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem' },
  readOnlyArea:{ padding: '.5rem .75rem', background: '#f8fafc', borderRadius: 4, fontSize: '.8125rem', whiteSpace: 'pre-wrap' as const, color: '#475569', minHeight: 40 },
  taxNote:     { background: '#fef3c7', color: '#92400e', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  newItemBox:  { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.25rem' },
  itemGrid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.75rem 1rem' },
  h4:          { margin: '0 0 .5rem', fontSize: '.875rem', fontWeight: 600, color: '#334155' },
  error:       { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  muted:       { color: '#94a3b8', fontSize: '.75rem' },
  btnDanger:   { padding: '.375rem .875rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  btnDel:      { padding: '.125rem .5rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 3, fontSize: '.875rem', cursor: 'pointer' },
  btnDelSmall: { padding: '0 .4rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
  section:     { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column' as const, gap: '.5rem' },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.5rem' },
  pillOk:      { display: 'inline-block', padding: '2px 10px', background: '#dcfce7', color: '#15803d', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 },
  pillWarn:    { display: 'inline-block', padding: '2px 10px', background: '#fef3c7', color: '#92400e', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 },
  pillCredit:  { display: 'inline-block', padding: '2px 10px', background: '#ede9fe', color: '#5b21b6', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 },
}
