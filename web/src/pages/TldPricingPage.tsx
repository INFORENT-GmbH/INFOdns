import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getTldPricing, createTldPricing, updateTldPricing, deleteTldPricing,
  type TldPricing,
} from '../api/client'

const REGISTRARS = ['', 'CN', 'MARCARIA', 'UD', 'UDR'] as const

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

// ── Inline edit row ───────────────────────────────────────────

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
    <tr style={styles.editRow}>
      <td style={styles.td}>
        {isNew
          ? <input style={styles.inputSm} value={d.zone ?? ''} onChange={e => set('zone', e.target.value)} placeholder="e.g. co.uk" />
          : <code style={styles.code}>{d.zone}</code>}
      </td>
      <td style={styles.td}>
        <input style={styles.inputSm} value={d.tld ?? ''} onChange={e => set('tld', e.target.value)} placeholder="e.g. uk" />
      </td>
      <td style={styles.td}>
        <input style={styles.inputSm} value={d.description ?? ''} onChange={e => set('description', e.target.value || null)} placeholder="description" />
      </td>
      <td style={styles.td}>
        <input style={styles.inputNum} value={fmt(d.cost ?? null)} onChange={e => set('cost', num(e.target.value))} placeholder="0.00" type="number" step="0.01" />
      </td>
      <td style={styles.td}>
        <input style={styles.inputNum} value={fmt(d.fee ?? null)} onChange={e => set('fee', num(e.target.value))} placeholder="0" type="number" step="1" />
      </td>
      <td style={styles.td}>
        <select style={styles.inputSm} value={d.default_registrar ?? ''} onChange={e => set('default_registrar', e.target.value || null)}>
          {REGISTRARS.map(r => <option key={r} value={r}>{r || '—'}</option>)}
        </select>
      </td>
      <td style={styles.td}>
        <input style={styles.inputNum} value={fmt(d.price_udr ?? null)} onChange={e => set('price_udr', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={styles.td}>
        <input style={styles.inputNum} value={fmt(d.price_cn ?? null)} onChange={e => set('price_cn', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={styles.td}>
        <input style={styles.inputNum} value={fmt(d.price_marcaria ?? null)} onChange={e => set('price_marcaria', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={styles.td}>
        <input style={styles.inputNum} value={fmt(d.price_ud ?? null)} onChange={e => set('price_ud', num(e.target.value))} placeholder="—" type="number" step="0.01" />
      </td>
      <td style={styles.td}>
        <input style={styles.inputSm} value={d.note ?? ''} onChange={e => set('note', e.target.value || null)} placeholder="note" />
      </td>
      <td style={styles.tdActions}>
        <button style={styles.btnSave} onClick={() => onSave(d)} disabled={saving}>
          {saving ? '…' : 'Save'}
        </button>
        <button style={styles.btnCancel} onClick={onCancel} disabled={saving}>Cancel</button>
      </td>
    </tr>
  )
}

// ── Page ──────────────────────────────────────────────────────

export default function TldPricingPage() {
  const qc = useQueryClient()
  const [editZone, setEditZone] = useState<string | null>(null)
  const [adding, setAdding]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [search, setSearch]     = useState('')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['tld-pricing'],
    queryFn: () => getTldPricing().then(r => r.data),
  })

  const filtered = search
    ? rows.filter(r =>
        r.zone.includes(search) ||
        r.tld.includes(search) ||
        (r.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (r.default_registrar ?? '').includes(search)
      )
    : rows

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
      setError(err.response?.data?.message ?? err.message)
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
      setError(err.response?.data?.message ?? err.message)
    }
  }

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>TLD Pricing</h2>
        <span style={styles.count}>{rows.length} zones</span>
        <input
          style={styles.search}
          placeholder="Filter…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button style={styles.btnAdd} onClick={() => { setAdding(true); setEditZone(null) }}>
          + New TLD
        </button>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      {isLoading ? <p style={styles.muted}>Loading…</p> : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Zone</th>
                <th style={styles.th}>TLD</th>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Cost</th>
                <th style={styles.th}>Fee</th>
                <th style={styles.th}>Registrar</th>
                <th style={styles.th}>UDR</th>
                <th style={styles.th}>CN</th>
                <th style={styles.th}>Marcaria</th>
                <th style={styles.th}>UD</th>
                <th style={styles.th}>Note</th>
                <th style={styles.th}></th>
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
                  <tr key={row.zone} style={styles.tr}>
                    <td style={styles.td}><code style={styles.code}>{row.zone}</code></td>
                    <td style={styles.td}>{row.tld}</td>
                    <td style={styles.td}>{row.description ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdNum}>{dec(row.cost) ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdNum}>{row.fee ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>
                      {row.default_registrar
                        ? <span style={styles.regBadge}>{row.default_registrar}</span>
                        : <span style={styles.muted}>—</span>}
                    </td>
                    <td style={styles.tdNum}>{dec(row.price_udr) ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdNum}>{dec(row.price_cn) ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdNum}>{dec(row.price_marcaria) ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdNum}>{dec(row.price_ud) ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>{row.note ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdActions}>
                      <button style={styles.btnEdit} onClick={() => { setEditZone(row.zone); setAdding(false) }}>Edit</button>
                      <button style={styles.btnDelete} onClick={() => handleDelete(row.zone)}>Delete</button>
                    </td>
                  </tr>
                )
              )}
              {filtered.length === 0 && !adding && (
                <tr><td colSpan={12} style={{ ...styles.td, ...styles.muted, textAlign: 'center' }}>No zones found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header:    { display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  h2:        { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  count:     { fontSize: '.75rem', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10 },
  search:    { padding: '.3rem .6rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8rem', width: 160 },
  btnAdd:    { marginLeft: 'auto', padding: '.35rem .8rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 5, fontSize: '.8rem', fontWeight: 600, cursor: 'pointer' },
  errorText: { color: '#b91c1c', fontSize: '.875rem', marginBottom: '.5rem' },
  muted:     { color: '#9ca3af', fontSize: '.8rem' },
  tableWrap: { overflowX: 'auto' as const },
  table:     { width: '100%', borderCollapse: 'collapse', minWidth: 900 },
  th:        { textAlign: 'left', padding: '.45rem .6rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.7rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const },
  tr:        { borderBottom: '1px solid #f3f4f6' },
  editRow:   { borderBottom: '1px solid #e5e7eb', background: '#fffbeb' },
  td:        { padding: '.4rem .6rem', fontSize: '.8rem', verticalAlign: 'middle' },
  tdNum:     { padding: '.4rem .6rem', fontSize: '.8rem', verticalAlign: 'middle', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const },
  tdActions: { padding: '.4rem .6rem', verticalAlign: 'middle', whiteSpace: 'nowrap' as const },
  code:      { background: '#f3f4f6', padding: '1px 5px', borderRadius: 3, fontSize: '.78rem', fontFamily: 'monospace' },
  regBadge:  { background: '#ede9fe', color: '#5b21b6', padding: '1px 6px', borderRadius: 3, fontSize: '.72rem', fontWeight: 700 },
  inputSm:   { padding: '.2rem .4rem', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '.78rem', width: '100%', minWidth: 60 },
  inputNum:  { padding: '.2rem .4rem', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '.78rem', width: 70, textAlign: 'right' as const },
  btnSave:   { padding: '.2rem .55rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 3, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', marginRight: 3 },
  btnCancel: { padding: '.2rem .55rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
  btnEdit:   { padding: '.2rem .5rem', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer', marginRight: 3 },
  btnDelete: { padding: '.2rem .5rem', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
}
