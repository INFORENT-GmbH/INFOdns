import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../../hooks/usePageTitle'
import {
  getBillingItems, createBillingItem, updateBillingItem, deleteBillingItem,
  getTenants, getDomains,
  type BillingItem, type BillingItemType, type BillingIntervalUnit, type BillingItemStatus,
  type Tenant, type Domain,
} from '../../api/client'
import Select, { type SelectOption } from '../../components/Select'
import EuroInput from '../../components/EuroInput'
import { formatApiError } from '../../lib/formError'
import * as s from '../../styles/shell'

const ITEM_TYPE_LABELS: Record<BillingItemType, string> = {
  domain: 'Domain', dnssec: 'DNSSEC', mail_forward: 'Mail-Forward',
  manual: 'Manuell', usage: 'Pay-per-use',
}
const INTERVAL_LABELS: Record<BillingIntervalUnit, string> = {
  second: 'Sekunde', minute: 'Minute', hour: 'Stunde', day: 'Tag',
  week: 'Woche', month: 'Monat', year: 'Jahr', lifetime: 'Lifetime',
}

interface DraftItem {
  tenant_id: number
  item_type: BillingItemType
  ref_table: string | null
  ref_id: number | null
  description: string
  unit_price_cents: number
  tax_rate_percent: string  // string for input handling, '' = NULL
  currency: string
  interval_unit: BillingIntervalUnit
  interval_count: number
  started_at: string
  status: BillingItemStatus
  notes: string
}

function emptyDraft(tenantId: number): DraftItem {
  return {
    tenant_id: tenantId,
    item_type: 'manual',
    ref_table: null,
    ref_id: null,
    description: '',
    unit_price_cents: 0,
    tax_rate_percent: '',
    currency: 'EUR',
    interval_unit: 'year',
    interval_count: 1,
    started_at: new Date().toISOString().slice(0, 10),
    status: 'active',
    notes: '',
  }
}

export default function BillingItemsPage() {
  usePageTitle('Billing Items')
  const qc = useQueryClient()
  const [filterTenant, setFilterTenant] = useState<number | ''>('')
  const [filterStatus, setFilterStatus] = useState<BillingItemStatus | ''>('active')
  const [filterType, setFilterType] = useState<BillingItemType | ''>('')
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState<DraftItem>(() => emptyDraft(0))
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | 'new' | null>(null)

  // Inline-edit state per row (deferred apply pattern from CLAUDE.md)
  const [edits, setEdits] = useState<Record<number, Partial<BillingItem>>>({})

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
  })
  const tenantById = useMemo(() => {
    const m = new Map<number, Tenant>()
    for (const t of tenants) m.set(t.id, t)
    return m
  }, [tenants])

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['billing', 'items', filterTenant, filterStatus, filterType],
    queryFn: () => getBillingItems({
      tenant_id: filterTenant === '' ? undefined : Number(filterTenant),
      status:    filterStatus === '' ? undefined : filterStatus,
      item_type: filterType === ''   ? undefined : filterType,
    }).then(r => r.data),
  })

  // Domains des im Draft gewählten Tenants — nur geladen wenn item_type='domain'.
  const { data: tenantDomains = [] } = useQuery({
    queryKey: ['domains', 'forTenant', draft.tenant_id],
    queryFn: () => getDomains({ tenant_id: String(draft.tenant_id), limit: '500' }).then(r => r.data),
    enabled: showNew && draft.item_type === 'domain' && draft.tenant_id > 0,
  })

  // Domains die schon einen aktiven Posten haben — nicht doppelt anbieten.
  const alreadyLinked = new Set(
    items
      .filter(it => it.ref_table === 'domains' && it.ref_id != null)
      .map(it => it.ref_id as number)
  )
  const availableDomains = tenantDomains.filter((d: Domain) => !alreadyLinked.has(d.id))

  // Draft tenant default
  useEffect(() => {
    if (showNew && draft.tenant_id === 0 && tenants.length > 0) {
      setDraft(d => ({ ...d, tenant_id: tenants[0].id }))
    }
  }, [showNew, tenants, draft.tenant_id])

  function setEdit(id: number, patch: Partial<BillingItem>) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }
  function discardEdit(id: number) {
    setEdits(prev => { const { [id]: _x, ...rest } = prev; return rest })
  }
  async function saveEdit(item: BillingItem) {
    const patch = edits[item.id]
    if (!patch) return
    setSavingId(item.id); setError(null)
    try {
      await updateBillingItem(item.id, patch as any)
      qc.invalidateQueries({ queryKey: ['billing', 'items'] })
      discardEdit(item.id)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally { setSavingId(null) }
  }

  async function handleCreate() {
    setSavingId('new'); setError(null)
    try {
      const payload: any = {
        ...draft,
        tax_rate_percent: draft.tax_rate_percent === '' ? null : Number(draft.tax_rate_percent),
        unit_price_cents: Math.round(draft.unit_price_cents),
      }
      await createBillingItem(payload)
      qc.invalidateQueries({ queryKey: ['billing', 'items'] })
      setShowNew(false)
      setDraft(emptyDraft(tenants[0]?.id ?? 0))
    } catch (err: any) {
      setError(formatApiError(err))
    } finally { setSavingId(null) }
  }

  async function handleDelete(item: BillingItem) {
    if (!confirm(`Posten "${item.description}" wirklich löschen?`)) return
    try {
      await deleteBillingItem(item.id)
      qc.invalidateQueries({ queryKey: ['billing', 'items'] })
    } catch (err: any) { setError(formatApiError(err)) }
  }

  const dirtyIds = Object.keys(edits).map(Number)

  return (
    <div style={localStyles.page}>
      <div style={localStyles.header}>
        <h2 style={localStyles.h2}>Abrechnungs-Posten</h2>
        <button style={s.actionBtn} onClick={() => setShowNew(true)}>+ Neuer Posten</button>
      </div>

      {error && <div style={localStyles.error}>{error}</div>}
      {dirtyIds.length > 0 && (
        <div style={localStyles.dirtyBar}>
          {dirtyIds.length} Änderung(en) — drücke "Speichern" pro Zeile zum Übernehmen.
        </div>
      )}

      <div style={localStyles.filters}>
        <label style={localStyles.fLabel}>Tenant
          <Select
            value={filterTenant === '' ? '' : String(filterTenant)}
            onChange={v => setFilterTenant(v === '' ? '' : Number(v))}
            options={tenantFilterOptions(tenants)}
            placeholder="— alle —"
            style={{ minWidth: 200 }}
          />
        </label>
        <label style={localStyles.fLabel}>Status
          <Select
            value={filterStatus}
            onChange={v => setFilterStatus(v as BillingItemStatus | '')}
            options={STATUS_FILTER_OPTIONS}
            placeholder="— alle —"
            style={{ minWidth: 140 }}
          />
        </label>
        <label style={localStyles.fLabel}>Typ
          <Select
            value={filterType}
            onChange={v => setFilterType(v as BillingItemType | '')}
            options={TYPE_FILTER_OPTIONS}
            placeholder="— alle —"
            style={{ minWidth: 160 }}
          />
        </label>
        <span style={localStyles.count}>{items.length} Posten</span>
      </div>

      {showNew && (
        <div style={localStyles.newBox}>
          <h3 style={localStyles.h3}>Neuer Posten</h3>
          <div style={localStyles.grid}>
            <Field label="Tenant *">
              <Select
                value={String(draft.tenant_id)}
                onChange={v => setDraft(d => ({ ...d, tenant_id: Number(v) }))}
                options={tenantPickerOptions(tenants)}
                style={{ minWidth: '100%' }}
              />
            </Field>
            <Field label="Typ">
              <Select
                value={draft.item_type}
                onChange={v => setDraft(d => ({
                  ...d,
                  item_type: v as BillingItemType,
                  // Wechsel weg von 'domain' → ref-Felder zurücksetzen
                  ref_table: v === 'domain' ? d.ref_table : null,
                  ref_id:    v === 'domain' ? d.ref_id    : null,
                }))}
                options={TYPE_OPTIONS}
                style={{ minWidth: '100%' }}
              />
            </Field>
            {draft.item_type === 'domain' ? (
              <Field label="Domain *">
                <Select
                  value={draft.ref_id != null ? String(draft.ref_id) : ''}
                  onChange={v => {
                    const dom = availableDomains.find(d => d.id === Number(v))
                    setDraft(d => ({
                      ...d,
                      ref_table: 'domains',
                      ref_id: dom ? dom.id : null,
                      description: dom ? `Domain ${dom.fqdn}` : d.description,
                    }))
                  }}
                  options={domainPickerOptions(availableDomains)}
                  placeholder={availableDomains.length === 0 ? 'Keine freien Domains' : '— wählen —'}
                  style={{ minWidth: '100%' }}
                />
              </Field>
            ) : (
              <Field label="Beschreibung *">
                <input value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} style={localStyles.input} />
              </Field>
            )}
            <Field label="Preis *">
              <EuroInput cents={draft.unit_price_cents}
                onChange={c => setDraft(d => ({ ...d, unit_price_cents: c }))}
                style={{ width: '100%' }} />
            </Field>
            <Field label="Steuersatz (%) — leer = Default">
              <input type="number" step="0.01" value={draft.tax_rate_percent} onChange={e => setDraft(d => ({ ...d, tax_rate_percent: e.target.value }))} style={localStyles.input} />
            </Field>
            <Field label="Intervall *">
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min={1} value={draft.interval_count} onChange={e => setDraft(d => ({ ...d, interval_count: Number(e.target.value) }))} style={{ ...localStyles.input, width: 60 }} />
                <Select
                  value={draft.interval_unit}
                  onChange={v => setDraft(d => ({ ...d, interval_unit: v as BillingIntervalUnit }))}
                  options={INTERVAL_OPTIONS}
                  style={{ flex: 1, minWidth: 110 }}
                />
              </div>
            </Field>
            <Field label="Start-Datum">
              <input type="date" value={draft.started_at} onChange={e => setDraft(d => ({ ...d, started_at: e.target.value }))} style={localStyles.input} />
            </Field>
            <Field label="Status">
              <Select
                value={draft.status}
                onChange={v => setDraft(d => ({ ...d, status: v as BillingItemStatus }))}
                options={STATUS_OPTIONS}
                style={{ minWidth: '100%' }}
              />
            </Field>
          </div>
          <div style={localStyles.formFooter}>
            <button type="button" style={s.secondaryBtn} onClick={() => setShowNew(false)}>Abbrechen</button>
            <button type="button" style={s.actionBtn} onClick={handleCreate}
              disabled={
                savingId === 'new' ||
                !draft.description ||
                (draft.item_type === 'domain' && draft.ref_id == null)
              }>
              {savingId === 'new' ? '…' : 'Anlegen'}
            </button>
          </div>
        </div>
      )}

      <div style={s.tableWrap}>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
            <thead>
              <tr>
                <th style={s.th}>Tenant</th>
                <th style={s.th}>Typ</th>
                <th style={s.th}>Beschreibung</th>
                <th style={s.th}>Preis</th>
                <th style={s.th}>Intervall</th>
                <th style={s.th}>Steuer</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Nächste Fälligkeit</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const merged = { ...item, ...edits[item.id] }
                const dirty = !!edits[item.id]
                return (
                  <tr key={item.id} style={dirty ? { background: '#fffbeb' } : undefined}>
                    <td style={s.td}>{tenantById.get(item.tenant_id)?.name ?? `#${item.tenant_id}`}</td>
                    <td style={s.td}>
                      <span style={localStyles.badge}>{ITEM_TYPE_LABELS[item.item_type]}</span>
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input style={{ ...localStyles.cellInput, flex: 1 }} value={merged.description}
                          onChange={e => setEdit(item.id, { description: e.target.value })} />
                        <a href={`/billing/items/${item.id}`} title="Details öffnen"
                           style={{ color: '#64748b', textDecoration: 'none', fontSize: '.875rem' }}>↗</a>
                      </div>
                    </td>
                    <td style={s.td}>
                      <EuroInput cents={merged.unit_price_cents}
                        onChange={c => setEdit(item.id, { unit_price_cents: c })}
                        style={{ width: 130 }} />
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="number" min={1} style={{ ...localStyles.cellInput, width: 50 }}
                          value={merged.interval_count}
                          onChange={e => setEdit(item.id, { interval_count: Number(e.target.value) })} />
                        <Select
                          value={merged.interval_unit}
                          onChange={v => setEdit(item.id, { interval_unit: v as BillingIntervalUnit })}
                          options={INTERVAL_OPTIONS}
                          style={{ minWidth: 110 }}
                        />
                      </div>
                    </td>
                    <td style={s.td}>
                      <input type="number" step="0.01" style={{ ...localStyles.cellInput, width: 60 }}
                        value={merged.tax_rate_percent ?? ''} placeholder="—"
                        onChange={e => setEdit(item.id, { tax_rate_percent: e.target.value === '' ? null : Number(e.target.value) })} />
                      <span style={localStyles.muted}>%</span>
                    </td>
                    <td style={s.td}>
                      <Select
                        value={merged.status}
                        onChange={v => setEdit(item.id, { status: v as BillingItemStatus })}
                        options={STATUS_OPTIONS}
                        style={{ minWidth: 110 }}
                      />
                    </td>
                    <td style={s.td}>
                      {item.next_due_at
                        ? <span style={localStyles.subText}>{item.next_due_at.replace('T', ' ').slice(0, 16)}</span>
                        : <span style={localStyles.muted}>—</span>}
                      {item.last_billed_until && (
                        <div style={localStyles.subText}>
                          (zuletzt: {item.last_billed_until.replace('T', ' ').slice(0, 10)})
                        </div>
                      )}
                    </td>
                    <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                      {dirty && (
                        <>
                          <button style={s.actionBtn} disabled={savingId === item.id}
                            onClick={() => saveEdit(item)}>
                            {savingId === item.id ? '…' : 'Speichern'}
                          </button>
                          <button style={{ ...s.secondaryBtn, marginLeft: 4 }}
                            onClick={() => discardEdit(item.id)}>Verwerfen</button>
                        </>
                      )}
                      {!dirty && (
                        <button style={localStyles.btnDel} onClick={() => handleDelete(item)}>Löschen</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr><td colSpan={9} style={{ ...s.td, color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>Keine Posten</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Select-Options ──────────────────────────────────────────

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'active',    label: 'aktiv' },
  { value: 'paused',    label: 'pausiert' },
  { value: 'cancelled', label: 'gekündigt' },
]
const STATUS_FILTER_OPTIONS: SelectOption[] = [{ value: '', label: '— alle —' }, ...STATUS_OPTIONS]
const TYPE_OPTIONS: SelectOption[] = Object.entries(ITEM_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))
const TYPE_FILTER_OPTIONS: SelectOption[] = [{ value: '', label: '— alle —' }, ...TYPE_OPTIONS]
const INTERVAL_OPTIONS: SelectOption[] = Object.entries(INTERVAL_LABELS).map(([k, v]) => ({ value: k, label: v }))

function tenantFilterOptions(tenants: Tenant[]): SelectOption[] {
  return [{ value: '', label: '— alle —' }, ...tenants.map(t => ({ value: String(t.id), label: t.name }))]
}
function tenantPickerOptions(tenants: Tenant[]): SelectOption[] {
  return tenants.map(t => ({ value: String(t.id), label: t.name }))
}
function domainPickerOptions(domains: Domain[]): SelectOption[] {
  return domains.map(d => ({ value: String(d.id), label: d.fqdn }))
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <label style={localStyles.fLabel}>
      <span style={localStyles.fLabelText}>{label}</span>
      {children}
    </label>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  page:        { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '1rem' },
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  h2:          { margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#1e293b' },
  h3:          { margin: '0 0 .75rem', fontSize: '.9375rem', fontWeight: 600, color: '#334155' },
  filters:     { display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' },
  count:       { marginLeft: 'auto', fontSize: '.8125rem', color: '#64748b' },
  fLabel:      { display: 'flex', flexDirection: 'column', gap: 4 },
  fLabelText:  { fontSize: '.75rem', fontWeight: 600, color: '#475569' },
  input:       { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem' },
  cellInput:   { padding: '.25rem .5rem', border: '1px solid #cbd5e1', borderRadius: 3, fontSize: '.8125rem' },
  newBox:      { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem 1.25rem' },
  grid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.75rem 1rem' },
  formFooter:  { display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '1rem' },
  error:       { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  dirtyBar:    { background: '#fef3c7', color: '#92400e', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  badge:       { display: 'inline-block', padding: '2px 8px', background: '#e0e7ff', color: '#3730a3', borderRadius: 3, fontSize: '.75rem', fontWeight: 600 },
  muted:       { color: '#94a3b8', fontSize: '.75rem' },
  subText:     { color: '#64748b', fontSize: '.6875rem', marginTop: 2 },
  btnDel:      { padding: '.25rem .5rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
}
