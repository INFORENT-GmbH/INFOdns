import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getTldPricing, createTldPricing, updateTldPricing, deleteTldPricing,
  type TldPricing,
} from '../api/client'
import Select from '../components/Select'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import ListPage from '../components/ListPage'
import ListTable from '../components/ListTable'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

const REGISTRARS = ['', 'CN', 'MARCARIA', 'UD', 'UDR'] as const

const TLD_FILTER_DEFAULTS = { search: '', registrar: '' }

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

function fmt(v: number | null): string {
  return v != null ? String(v) : ''
}

function EditRow({
  initial, isNew, onSave, onCancel, saving,
}: {
  initial: EditState
  isNew: boolean
  onSave: (d: EditState) => void
  onCancel: () => void
  saving: boolean
}) {
  const [d, setD] = useState<EditState>(initial)
  const set = (k: keyof EditState, v: unknown) => setD(prev => ({ ...prev, [k]: v }))

  return (
    <tr style={localStyles.editRow}>
      <td style={s.td}>
        {isNew
          ? <input style={localStyles.inputSm} value={d.zone ?? ''} onChange={e => set('zone', e.target.value)} placeholder="e.g. co.uk" />
          : <code style={localStyles.code}>{d.zone}</code>}
      </td>
      <td style={s.td}>
        <input style={localStyles.inputSm} value={d.tld ?? ''} onChange={e => set('tld', e.target.value)} placeholder="e.g. uk" />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputSm} value={d.description ?? ''} onChange={e => set('description', e.target.value || null)} placeholder="description" />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputNum} value={fmt(d.cost ?? null)} onChange={e => set('cost', num(e.target.value))} placeholder="0.00" type="number" step="0.01" />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputNum} value={fmt(d.fee ?? null)} onChange={e => set('fee', num(e.target.value))} placeholder="0" type="number" step="1" />
      </td>
      <td style={s.td}>
        <Select
          style={localStyles.inputSm}
          value={d.default_registrar ?? ''}
          onChange={v => set('default_registrar', v || null)}
          options={REGISTRARS.map(r => ({ value: r, label: r || '—' }))}
        />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputNum} value={fmt(d.price_udr ?? null)} onChange={e => set('price_udr', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputNum} value={fmt(d.price_cn ?? null)} onChange={e => set('price_cn', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputNum} value={fmt(d.price_marcaria ?? null)} onChange={e => set('price_marcaria', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputNum} value={fmt(d.price_ud ?? null)} onChange={e => set('price_ud', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={s.td}>
        <input style={localStyles.inputSm} value={d.note ?? ''} onChange={e => set('note', e.target.value || null)} placeholder="note" />
      </td>
      <td style={localStyles.tdActions}>
        <button style={localStyles.btnSave} onClick={() => onSave(d)} disabled={saving}>
          {saving ? '…' : 'Save'}
        </button>
        <button style={localStyles.btnCancel} onClick={onCancel} disabled={saving}>Cancel</button>
      </td>
    </tr>
  )
}

export default function TldPricingPage() {
  const qc = useQueryClient()
  const [editZone, setEditZone] = useState<string | null>(null)
  const [adding, setAdding]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

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

  async function handleSave(d: EditState, isNew: boolean) {
    setError(null)
    setSaving(true)
    try {
      if (isNew) {
        await createTldPricing(d as any)
      } else {
        const { zone, ...rest } = d
        await updateTldPricing(zone!, rest)
      }
      qc.invalidateQueries({ queryKey: ['tld-pricing'] })
      setEditZone(null)
      setAdding(false)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(zone: string) {
    if (!confirm(`Delete TLD zone '${zone}'?`)) return
    setError(null)
    try {
      await deleteTldPricing(zone)
      qc.invalidateQueries({ queryKey: ['tld-pricing'] })
    } catch (err: any) {
      setError(formatApiError(err))
    }
  }

  const registrarLabel = registrar || 'All registrars'

  return (
    <ListPage>
      {error && <div style={localStyles.errorBanner}>{error}</div>}

      <FilterBar>
        <span style={localStyles.countPill}>
          {hasActive
            ? `${filtered.length} of ${rows.length}`
            : `${rows.length} zones`}
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

        <button style={s.actionBtn} onClick={() => { setAdding(true); setEditZone(null) }}>
          + New TLD
        </button>
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
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {adding && (
                <EditRow
                  initial={EMPTY}
                  isNew
                  saving={saving}
                  onSave={d => handleSave(d, true)}
                  onCancel={() => setAdding(false)}
                />
              )}
              {filtered.map(row =>
                editZone === row.zone ? (
                  <EditRow
                    key={row.zone}
                    initial={row}
                    isNew={false}
                    saving={saving}
                    onSave={d => handleSave(d, false)}
                    onCancel={() => setEditZone(null)}
                  />
                ) : (
                  <tr key={row.zone}>
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
                    <td style={localStyles.tdActions}>
                      <button style={localStyles.btnEdit} onClick={() => { setEditZone(row.zone); setAdding(false) }}>Edit</button>
                      <button style={localStyles.btnDelete} onClick={() => handleDelete(row.zone)}>Delete</button>
                    </td>
                  </tr>
                )
              )}
              {filtered.length === 0 && !adding && (
                <tr><td colSpan={12} style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>No zones found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </ListTable>
    </ListPage>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  countPill:    { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  errorBanner:  { color: '#b91c1c', fontSize: '.875rem', padding: '.5rem .75rem', background: '#fee2e2', borderBottom: '1px solid #fecaca', flexShrink: 0 },
  muted:        { color: '#94a3b8', fontSize: '.8rem' },
  editRow:      { borderBottom: '1px solid #e2e8f0', background: '#fffbeb' },
  tdNum:        { padding: '.4rem .6rem', fontSize: '.8rem', verticalAlign: 'middle', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, color: '#1e293b', borderBottom: '1px solid #f1f5f9' },
  tdActions:    { padding: '.4rem .6rem', verticalAlign: 'middle', whiteSpace: 'nowrap' as const, borderBottom: '1px solid #f1f5f9' },
  code:         { background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, fontSize: '.78rem', fontFamily: 'monospace' },
  regBadge:     { background: '#ede9fe', color: '#5b21b6', padding: '1px 6px', borderRadius: 3, fontSize: '.72rem', fontWeight: 700 },
  inputSm:      { padding: '.2rem .4rem', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.78rem', width: '100%', minWidth: 60 },
  inputNum:     { padding: '.2rem .4rem', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.78rem', width: 70, textAlign: 'right' as const },
  btnSave:      { padding: '.2rem .55rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 3, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', marginRight: 3 },
  btnCancel:    { padding: '.2rem .55rem', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
  btnEdit:      { padding: '.2rem .5rem', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer', marginRight: 3 },
  btnDelete:    { padding: '.2rem .5rem', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
}
