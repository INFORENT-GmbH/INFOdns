import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getTenants, createInvoice, getBillingItems,
  type Tenant, type BillingItem, type InvoiceItemInput,
} from '../../api/client'
import Select, { type SelectOption } from '../../components/Select'
import EuroInput from '../../components/EuroInput'
import { formatApiError } from '../../lib/formError'
import * as s from '../../styles/shell'

export default function InvoiceNewPage() {
  usePageTitle('Neue Rechnung')
  const navigate = useNavigate()

  const [tenantId, setTenantId] = useState<number | ''>('')
  const [postal, setPostal] = useState(false)
  const [customerNotes, setCustomerNotes] = useState('')
  const [pickedItems, setPickedItems] = useState<Set<number>>(new Set())
  const [manualItems, setManualItems] = useState<InvoiceItemInput[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })

  const { data: items = [] } = useQuery({
    queryKey: ['billing', 'items', tenantId, 'active'],
    queryFn: () => tenantId === '' ? Promise.resolve([])
      : getBillingItems({ tenant_id: Number(tenantId), status: 'active' }).then(r => r.data),
    enabled: tenantId !== '',
  })

  useEffect(() => { setPickedItems(new Set()) }, [tenantId])

  function addManual() {
    setManualItems(arr => [...arr, { description: '', quantity: 1, unit_price_cents: 0, tax_rate_percent: 19 }])
  }
  function patchManual(i: number, patch: Partial<InvoiceItemInput>) {
    setManualItems(arr => arr.map((it, idx) => idx === i ? { ...it, ...patch } : it))
  }
  function removeManual(i: number) {
    setManualItems(arr => arr.filter((_, idx) => idx !== i))
  }

  async function handleCreate() {
    if (tenantId === '') return
    setBusy(true); setError(null)
    try {
      // Picked items werden mit quantity=1 + ihrem aktuellen Preis übernommen
      // (NICHT pro-rated — das macht sonst nur der Worker. Für manuelle Rechnungen
      // sind volle Perioden der erwartete Default.)
      const fromPicked: InvoiceItemInput[] = items
        .filter((it: BillingItem) => pickedItems.has(it.id))
        .map((it: BillingItem) => ({
          billing_item_id: it.id,
          description: it.description,
          quantity: 1,
          unit_price_cents: it.unit_price_cents,
          tax_rate_percent: it.tax_rate_percent != null ? Number(it.tax_rate_percent) : 19,
        }))
      const all = [...fromPicked, ...manualItems.filter(i => i.description)]

      const r = await createInvoice({
        tenant_id: Number(tenantId),
        postal_delivery: postal,
        customer_notes: customerNotes || null,
        items: all,
      })
      navigate(`/billing/invoices/${r.data.id}`)
    } catch (err: any) { setError(formatApiError(err)) }
    finally { setBusy(false) }
  }

  return (
    <div style={localStyles.page}>
      <div style={localStyles.header}>
        <Link to="/billing/invoices" style={localStyles.back}>← Rechnungen</Link>
        <h2 style={localStyles.h2}>Neue Rechnung</h2>
      </div>

      {error && <div style={localStyles.error}>{error}</div>}

      <div style={localStyles.section}>
        <Field label="Tenant *">
          <Select
            value={tenantId === '' ? '' : String(tenantId)}
            onChange={v => setTenantId(v === '' ? '' : Number(v))}
            options={tenantOptions(tenants)}
            placeholder="— wählen —"
            style={{ minWidth: 240 }}
          />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8125rem' }}>
          <input type="checkbox" checked={postal} onChange={e => setPostal(e.target.checked)} />
          Postversand (Aufpreis wird beim Issuing zu den Positionen ergänzt)
        </label>
        <Field label="Notiz für Kunde">
          <textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} rows={2} style={{ ...localStyles.input, resize: 'vertical' as const }} />
        </Field>
      </div>

      {tenantId !== '' && (
        <div style={localStyles.section}>
          <h3 style={localStyles.h3}>Aktive Posten dieses Tenants ({items.length})</h3>
          {items.length === 0 ? (
            <p style={localStyles.muted}>Keine aktiven Posten.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr>
                  <th style={s.th}></th>
                  <th style={s.th}>Beschreibung</th>
                  <th style={s.th}>Typ</th>
                  <th style={{ ...s.th, textAlign: 'right' as const }}>Preis</th>
                  <th style={s.th}>Intervall</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it: BillingItem) => (
                  <tr key={it.id}>
                    <td style={s.td}>
                      <input type="checkbox" checked={pickedItems.has(it.id)}
                        onChange={e => {
                          const set = new Set(pickedItems)
                          if (e.target.checked) set.add(it.id); else set.delete(it.id)
                          setPickedItems(set)
                        }} />
                    </td>
                    <td style={s.td}>{it.description}</td>
                    <td style={s.td}>{it.item_type}</td>
                    <td style={{ ...s.td, textAlign: 'right' as const }}>{(it.unit_price_cents/100).toFixed(2)} €</td>
                    <td style={s.td}>{it.interval_count}× {it.interval_unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={localStyles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={localStyles.h3}>Manuelle Positionen</h3>
          <button type="button" style={s.secondaryBtn} onClick={addManual}>+ Position</button>
        </div>
        {manualItems.length === 0 ? (
          <p style={localStyles.muted}>Keine manuellen Positionen.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
            <thead>
              <tr>
                <th style={s.th}>Beschreibung</th>
                <th style={s.th}>Menge</th>
                <th style={s.th}>Einzelpreis (Cent)</th>
                <th style={s.th}>USt %</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {manualItems.map((it, i) => (
                <tr key={i}>
                  <td style={s.td}>
                    <input style={localStyles.cellInput} value={it.description}
                      onChange={e => patchManual(i, { description: e.target.value })} />
                  </td>
                  <td style={s.td}>
                    <input type="number" step="0.0001" style={{ ...localStyles.cellInput, width: 80 }}
                      value={it.quantity}
                      onChange={e => patchManual(i, { quantity: Number(e.target.value) })} />
                  </td>
                  <td style={s.td}>
                    <EuroInput cents={it.unit_price_cents} allowNegative
                      onChange={c => patchManual(i, { unit_price_cents: c })}
                      style={{ width: 130 }} />
                  </td>
                  <td style={s.td}>
                    <input type="number" step="0.01" style={{ ...localStyles.cellInput, width: 60 }}
                      value={it.tax_rate_percent}
                      onChange={e => patchManual(i, { tax_rate_percent: Number(e.target.value) })} />
                  </td>
                  <td style={s.td}>
                    <button type="button" style={localStyles.btnDel} onClick={() => removeManual(i)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
        <Link to="/billing/invoices" style={{ ...s.secondaryBtn, textDecoration: 'none' }}>Abbrechen</Link>
        <button type="button" style={s.actionBtn} onClick={handleCreate}
          disabled={busy || tenantId === '' || (pickedItems.size === 0 && manualItems.filter(i => i.description).length === 0)}>
          {busy ? '…' : 'Draft anlegen'}
        </button>
      </div>
    </div>
  )
}

function tenantOptions(tenants: Tenant[]): SelectOption[] {
  return [
    { value: '', label: '— wählen —' },
    ...tenants.map(t => ({ value: String(t.id), label: t.name })),
  ]
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
  page:        { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column' as const, gap: '1rem', maxWidth: 1100 },
  header:      { display: 'flex', alignItems: 'center', gap: '.75rem' },
  back:        { color: '#64748b', textDecoration: 'none', fontSize: '.8125rem' },
  h2:          { margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  h3:          { margin: 0, fontSize: '.9375rem', fontWeight: 600, color: '#334155' },
  section:     { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column' as const, gap: '.75rem' },
  fLabel:      { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  fLabelText:  { fontSize: '.75rem', fontWeight: 600, color: '#475569' },
  input:       { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem' },
  cellInput:   { padding: '.25rem .5rem', border: '1px solid #cbd5e1', borderRadius: 3, fontSize: '.8125rem', width: '100%', boxSizing: 'border-box' as const },
  error:       { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  muted:       { color: '#94a3b8', fontSize: '.8125rem' },
  btnDel:      { padding: '.125rem .5rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 3, fontSize: '.875rem', cursor: 'pointer' },
}
