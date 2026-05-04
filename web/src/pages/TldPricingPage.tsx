import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  getTldPricing, createTldPricing, updateTldPricing, deleteTldPricing,
  type TldPricing,
} from '../api/client'
import Select from '../components/Select'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import ListTable from '../components/ListTable'
import MasterDetailLayout from '../components/MasterDetailLayout'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

const REGISTRARS = ['', 'CN', 'MARCARIA', 'UD', 'UDR'] as const
const TLD_FILTER_DEFAULTS = { search: '', registrar: '' }
type SelectedId = string | 'new' | null

type EditState = Partial<Omit<TldPricing, 'created_at' | 'updated_at'>>
const EMPTY: EditState = {
  zone: '', tld: '', description: '', cost: null, fee: null,
  default_registrar: null, note: '', price_udr: null, price_cn: null,
  price_marcaria: null, price_ud: null,
}

function num(v: string): number | null {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function dec(v: number | string | null): string | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isNaN(n) ? null : n.toFixed(2)
}

function fmt(v: number | null | undefined): string {
  return v != null ? String(v) : ''
}

export default function TldPricingPage() {
  usePageTitle('TLD Pricing')
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<SelectedId>(null)
  const [form, setForm] = useState<EditState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    filters, setFilter, persist, setPersist, clear: clearFilters, hasActive,
  } = usePersistedFilters('tld-pricing', TLD_FILTER_DEFAULTS)
  const { search, registrar } = filters

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['tld-pricing'],
    queryFn: () => getTldPricing().then(r => r.data),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q && !(
        r.zone.toLowerCase().includes(q) ||
        r.tld.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )) return false
      if (registrar && (r.default_registrar ?? '') !== registrar) return false
      return true
    })
  }, [rows, search, registrar])

  const editTarget: TldPricing | null = useMemo(
    () => typeof selectedId === 'string' && selectedId !== 'new' ? rows.find(r => r.zone === selectedId) ?? null : null,
    [rows, selectedId]
  )

  useEffect(() => {
    setError(null)
    if (selectedId === 'new') setForm(EMPTY)
    else if (editTarget) setForm(editTarget)
  }, [selectedId, editTarget])

  function set(k: keyof EditState, v: unknown) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSaving(true)
    try {
      if (selectedId === 'new') {
        await createTldPricing(form as any)
      } else if (editTarget) {
        const { zone, ...rest } = form
        await updateTldPricing(zone!, rest)
      }
      qc.invalidateQueries({ queryKey: ['tld-pricing'] })
      setSelectedId(null)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(zone: string) {
    if (!confirm(`Delete TLD zone '${zone}'?`)) return
    try {
      await deleteTldPricing(zone)
      qc.invalidateQueries({ queryKey: ['tld-pricing'] })
      if (selectedId === zone) setSelectedId(null)
    } catch (err: any) {
      setError(formatApiError(err))
    }
  }

  const registrarLabel = registrar || 'All registrars'

  // ── Dashboard ──────────────────────────────────────────────────
  const dashboard = (
    <>
      {error && <div style={localStyles.errorBanner}>{error}</div>}
      <FilterBar>
        <span style={localStyles.countPill}>
          {hasActive ? `${filtered.length} of ${rows.length}` : `${rows.length} zones`}
        </span>
      </FilterBar>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={v => setFilter('search', v)}
          placeholder="Search zone, TLD, description…"
          width={260}
        />
        <Dropdown
          label={
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: registrar ? '#111827' : '#9ca3af' }}>
              {registrarLabel}
            </span>
          }
          active={!!registrar}
          onClear={() => setFilter('registrar', '')}
          width={160}
        >
          {close => (
            <>
              <DropdownItem onSelect={() => { setFilter('registrar', ''); close() }}>
                <span style={{ color: '#6b7280' }}>All registrars</span>
              </DropdownItem>
              {REGISTRARS.filter(Boolean).map(r => (
                <DropdownItem key={r} onSelect={() => { setFilter('registrar', r); close() }}>
                  {r}
                </DropdownItem>
              ))}
            </>
          )}
        </Dropdown>
        <FilterPersistControls
          persist={persist}
          setPersist={setPersist}
          onClear={clearFilters}
          hasActive={hasActive}
          style={{ marginLeft: 'auto' }}
        />
        <button style={s.actionBtn} onClick={() => setSelectedId('new')}>+ New TLD</button>
      </FilterBar>
      <ListTable>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>Loading…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={s.th}>Zone</th>
                <th style={s.th}>TLD</th>
                <th style={s.th}>Description</th>
                <th style={s.th}>Cost</th>
                <th style={s.th}>Fee</th>
                <th style={s.th}>Registrar</th>
                <th style={s.th}>UDR</th>
                <th style={s.th}>CN</th>
                <th style={s.th}>Marcaria</th>
                <th style={s.th}>UD</th>
                <th style={s.th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const isSel = selectedId === row.zone
                return (
                  <tr
                    key={row.zone}
                    onClick={() => setSelectedId(row.zone)}
                    style={{ cursor: 'pointer', background: isSel ? '#eff6ff' : undefined }}
                    onMouseOver={e => { if (!isSel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseOut={e => { if (!isSel) e.currentTarget.style.background = '' }}
                  >
                    <td style={s.td}><code style={localStyles.code}>{row.zone}</code></td>
                    <td style={s.td}>{row.tld}</td>
                    <td style={s.td}>{row.description ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={localStyles.tdNum}>{dec(row.cost) ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={localStyles.tdNum}>{row.fee ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={s.td}>
                      {row.default_registrar
                        ? <span style={localStyles.regBadge}>{row.default_registrar}</span>
                        : <span style={localStyles.muted}>—</span>}
                    </td>
                    <td style={localStyles.tdNum}>{dec(row.price_udr) ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={localStyles.tdNum}>{dec(row.price_cn) ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={localStyles.tdNum}>{dec(row.price_marcaria) ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={localStyles.tdNum}>{dec(row.price_ud) ?? <span style={localStyles.muted}>—</span>}</td>
                    <td style={s.td}>{row.note ?? <span style={localStyles.muted}>—</span>}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} style={{ ...s.td, color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>No zones found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </ListTable>
    </>
  )

  // ── Sidebar ────────────────────────────────────────────────────
  const sidebar = (
    <>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={v => setFilter('search', v)}
          placeholder="Search zones…"
          width="100%"
        />
      </FilterBar>
      <FilterBar>
        <button style={{ ...s.actionBtn, width: '100%' }} onClick={() => setSelectedId('new')}>+ New TLD</button>
      </FilterBar>
      <ListTable>
        {filtered.map(row => {
          const isSel = selectedId === row.zone
          return (
            <div
              key={row.zone}
              onClick={() => setSelectedId(row.zone)}
              style={{
                padding: '.5rem .75rem',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                background: isSel ? '#eff6ff' : 'transparent',
              }}
            >
              <div style={{ fontSize: '.8125rem', fontWeight: isSel ? 600 : 500, color: '#1e293b' }}>
                <code style={localStyles.code}>{row.zone}</code>
              </div>
              <div style={{ fontSize: '.7rem', color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.description || row.tld}
              </div>
            </div>
          )
        })}
      </ListTable>
    </>
  )

  // ── Detail pane ────────────────────────────────────────────────
  const isNew = selectedId === 'new'
  const detailPane = (
    <div style={localStyles.detailPane}>
      <div style={localStyles.detailHeader}>
        <button onClick={() => setSelectedId(null)} style={localStyles.backBtn}>← Cancel</button>
        <h3 style={localStyles.detailTitle}>{isNew ? 'New TLD' : (editTarget?.zone ?? '')}</h3>
        {editTarget && (
          <button onClick={() => handleDelete(editTarget.zone)} style={localStyles.btnDelete}>Delete</button>
        )}
      </div>

      <form onSubmit={handleSave} style={localStyles.formBody}>
        {error && <div style={localStyles.error}>{error}</div>}

        <div style={localStyles.grid}>
          <label style={localStyles.label}>
            Zone
            {isNew
              ? <input value={form.zone ?? ''} onChange={e => set('zone', e.target.value)} placeholder="co.uk" required style={localStyles.input} />
              : <code style={{ ...localStyles.code, alignSelf: 'flex-start', padding: '4px 12px', fontSize: '.875rem' }}>{form.zone}</code>}
          </label>
          <label style={localStyles.label}>
            TLD
            <input value={form.tld ?? ''} onChange={e => set('tld', e.target.value)} placeholder="uk" required style={localStyles.input} />
          </label>
        </div>

        <label style={localStyles.label}>
          Description
          <input value={form.description ?? ''} onChange={e => set('description', e.target.value || null)} placeholder="UK domains" style={localStyles.input} />
        </label>

        <div style={localStyles.sectionDivider}><span style={localStyles.sectionLabel}>Pricing</span></div>
        <div style={localStyles.grid}>
          <label style={localStyles.label}>
            Cost
            <input type="number" step="0.01" value={fmt(form.cost ?? null)} onChange={e => set('cost', num(e.target.value))} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            Fee
            <input type="number" step="1" value={fmt(form.fee ?? null)} onChange={e => set('fee', num(e.target.value))} style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            Default registrar
            <Select
              value={form.default_registrar ?? ''}
              onChange={v => set('default_registrar', v || null)}
              options={REGISTRARS.map(r => ({ value: r, label: r || '—' }))}
              style={{ width: '100%' }}
            />
          </label>
        </div>

        <div style={localStyles.sectionDivider}><span style={localStyles.sectionLabel}>Per-registrar prices</span></div>
        <div style={localStyles.grid}>
          <label style={localStyles.label}>
            UDR
            <input type="number" step="0.01" value={fmt(form.price_udr ?? null)} onChange={e => set('price_udr', num(e.target.value))} placeholder="—" style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            CN
            <input type="number" step="0.01" value={fmt(form.price_cn ?? null)} onChange={e => set('price_cn', num(e.target.value))} placeholder="—" style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            Marcaria
            <input type="number" step="0.01" value={fmt(form.price_marcaria ?? null)} onChange={e => set('price_marcaria', num(e.target.value))} placeholder="—" style={localStyles.input} />
          </label>
          <label style={localStyles.label}>
            UD
            <input type="number" step="0.01" value={fmt(form.price_ud ?? null)} onChange={e => set('price_ud', num(e.target.value))} placeholder="—" style={localStyles.input} />
          </label>
        </div>

        <label style={localStyles.label}>
          Note
          <textarea value={form.note ?? ''} onChange={e => set('note', e.target.value || null)} rows={3} placeholder="Internal notes" style={{ ...localStyles.input, resize: 'vertical' }} />
        </label>

        <div style={localStyles.formFooter}>
          <button type="button" onClick={() => setSelectedId(null)} style={s.secondaryBtn}>Cancel</button>
          <button type="submit" disabled={saving} style={s.actionBtn}>{saving ? '…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )

  return (
    <MasterDetailLayout
      dashboard={dashboard}
      sidebar={sidebar}
      detail={detailPane}
      isOpen={selectedId !== null}
    />
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  countPill:    { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  errorBanner:  { color: '#b91c1c', fontSize: '.875rem', padding: '.5rem .75rem', background: '#fee2e2', borderBottom: '1px solid #fecaca', flexShrink: 0 },
  detailPane:   { padding: '1rem 1.5rem' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  detailTitle:  { margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b', flex: 1 },
  backBtn:      { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '.875rem', padding: 0 },
  formBody:     { display: 'flex', flexDirection: 'column' as const, gap: '.75rem', maxWidth: 640 },
  formFooter:   { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', paddingTop: '.75rem', borderTop: '1px solid #f1f5f9' },
  error:        { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  sectionDivider: { borderBottom: '1px solid #f1f5f9', paddingBottom: 2, marginTop: '.5rem' },
  sectionLabel: { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  grid:         { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  label:        { display: 'flex', flexDirection: 'column' as const, gap: '.25rem', fontSize: '.8125rem', fontWeight: 500, color: '#374151' },
  input:        { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },
  muted:        { color: '#94a3b8', fontSize: '.8rem' },
  tdNum:        { padding: '.4rem .6rem', fontSize: '.8rem', verticalAlign: 'middle', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, color: '#1e293b', borderBottom: '1px solid #f1f5f9' },
  code:         { background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, fontSize: '.78rem', fontFamily: 'monospace' },
  regBadge:     { background: '#ede9fe', color: '#5b21b6', padding: '1px 6px', borderRadius: 3, fontSize: '.72rem', fontWeight: 700 },
  btnDelete:    { padding: '.25rem .625rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
}
