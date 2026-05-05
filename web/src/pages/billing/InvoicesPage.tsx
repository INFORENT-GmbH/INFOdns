import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getInvoices, getTenants,
  type Invoice, type InvoiceStatus, type Tenant,
} from '../../api/client'
import Select, { type SelectOption } from '../../components/Select'
import * as s from '../../styles/shell'

const STATUS_LABEL: Record<InvoiceStatus, { de: string; color: string }> = {
  draft:       { de: 'Entwurf',      color: '#6b7280' },
  issued:      { de: 'gestellt',     color: '#0369a1' },
  sent:        { de: 'versendet',    color: '#0e7490' },
  paid:        { de: 'bezahlt',      color: '#15803d' },
  partial:     { de: 'teilbezahlt',  color: '#a16207' },
  overdue:     { de: 'überfällig',   color: '#b91c1c' },
  cancelled:   { de: 'storniert',    color: '#991b1b' },
  credit_note: { de: 'Gutschrift',   color: '#7c3aed' },
}

function fmtCents(c: number, cur = 'EUR'): string {
  const sign = c < 0 ? '-' : ''
  return `${sign}${(Math.abs(c) / 100).toFixed(2)} ${cur}`
}

function tenantOptions(tenants: Tenant[]): SelectOption[] {
  return [
    { value: '', label: '— alle —' },
    ...tenants.map(t => ({ value: String(t.id), label: t.name })),
  ]
}

const statusOptions: SelectOption[] = [
  { value: '', label: '— alle —' },
  ...Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v.de })),
]

export default function InvoicesPage() {
  usePageTitle('Rechnungen')
  const [filterTenant, setFilterTenant] = useState<number | ''>('')
  const [filterStatus, setFilterStatus] = useState<InvoiceStatus | ''>('')

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })
  const tenantById = useMemo(() => {
    const m = new Map<number, Tenant>()
    for (const t of tenants) m.set(t.id, t)
    return m
  }, [tenants])

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['billing', 'invoices', filterTenant, filterStatus],
    queryFn: () => getInvoices({
      tenant_id: filterTenant === '' ? undefined : Number(filterTenant),
      status:    filterStatus === '' ? undefined : filterStatus,
    }).then(r => r.data),
  })

  return (
    <div style={localStyles.page}>
      <div style={localStyles.header}>
        <h2 style={localStyles.h2}>Rechnungen</h2>
        <Link to="/billing/invoices/new" style={{ ...s.actionBtn, textDecoration: 'none' }}>+ Neue Rechnung</Link>
      </div>

      <div style={localStyles.filters}>
        <label style={localStyles.fLabel}>Tenant
          <Select
            value={filterTenant === '' ? '' : String(filterTenant)}
            onChange={v => setFilterTenant(v === '' ? '' : Number(v))}
            options={tenantOptions(tenants)}
            placeholder="— alle —"
            style={{ minWidth: 200 }}
          />
        </label>
        <label style={localStyles.fLabel}>Status
          <Select
            value={filterStatus}
            onChange={v => setFilterStatus(v as InvoiceStatus | '')}
            options={statusOptions}
            placeholder="— alle —"
            style={{ minWidth: 160 }}
          />
        </label>
        <span style={localStyles.count}>{invoices.length} Rechnungen</span>
      </div>

      <div style={s.tableWrap}>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
            <thead>
              <tr>
                <th style={s.th}>Nummer / Status</th>
                <th style={s.th}>Tenant</th>
                <th style={s.th}>Datum</th>
                <th style={s.th}>Fällig</th>
                <th style={s.th}>Leistungszeitraum</th>
                <th style={{ ...s.th, textAlign: 'right' as const }}>Netto</th>
                <th style={{ ...s.th, textAlign: 'right' as const }}>USt</th>
                <th style={{ ...s.th, textAlign: 'right' as const }}>Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: Invoice) => {
                const sl = STATUS_LABEL[inv.status] ?? { de: inv.status, color: '#000' }
                const tenant = tenantById.get(inv.tenant_id)
                return (
                  <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => window.location.assign(`/billing/invoices/${inv.id}`)}>
                    <td style={s.td}>
                      {inv.invoice_number ? (
                        <strong>{inv.invoice_number}</strong>
                      ) : (
                        <span style={localStyles.muted}>(Entwurf #{inv.id})</span>
                      )}
                      <div>
                        <span style={{ ...localStyles.badge, background: sl.color + '22', color: sl.color }}>{sl.de}</span>
                        {inv.kind === 'credit_note' && <span style={{ ...localStyles.badge, marginLeft: 4, background: '#ddd6fe', color: '#5b21b6' }}>Storno</span>}
                      </div>
                    </td>
                    <td style={s.td}>{tenant?.name ?? `#${inv.tenant_id}`}</td>
                    <td style={s.td}>{inv.invoice_date ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={s.td}>{inv.due_date ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={s.td}>
                      {inv.service_period_start && inv.service_period_end
                        ? `${inv.service_period_start.slice(0,10)} – ${inv.service_period_end.slice(0,10)}`
                        : <span style={localStyles.muted}>—</span>}
                    </td>
                    <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCents(inv.subtotal_cents, inv.currency)}</td>
                    <td style={{ ...s.td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, color: '#64748b' }}>{fmtCents(inv.tax_total_cents, inv.currency)}</td>
                    <td style={{ ...s.td, textAlign: 'right' as const, fontWeight: 700, fontVariantNumeric: 'tabular-nums' as const }}>{fmtCents(inv.total_cents, inv.currency)}</td>
                  </tr>
                )
              })}
              {invoices.length === 0 && (
                <tr><td colSpan={8} style={{ ...s.td, color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>Keine Rechnungen</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:        { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column' as const, gap: '1rem' },
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  h2:          { margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  filters:     { display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' as const },
  fLabel:      { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  input:       { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem' },
  count:       { marginLeft: 'auto', fontSize: '.8125rem', color: '#64748b' },
  badge:       { display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: '.6875rem', fontWeight: 600 },
  muted:       { color: '#94a3b8', fontSize: '.75rem' },
}
