import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRegistrars, createRegistrar, updateRegistrar, deleteRegistrar,
  type Registrar,
} from '../api/client'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

type EditState = Partial<Omit<Registrar, 'created_at' | 'updated_at'>>
const EMPTY: EditState = { code: '', name: '', url: '', notes: '' }
const REGISTRAR_FILTER_DEFAULTS = { search: '' }

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
  const set = (k: keyof EditState, v: string) =>
    setD(prev => ({ ...prev, [k]: v || null }))

  return (
    <tr style={localStyles.editRow}>
      <td style={s.td}>
        {isNew
          ? <input style={localStyles.input} value={d.code ?? ''} onChange={e => setD(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="CN" maxLength={10} />
          : <code style={localStyles.code}>{d.code}</code>}
      </td>
      <td style={s.td}>
        <input style={{ ...localStyles.input, minWidth: 160 }} value={d.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="Full name" />
      </td>
      <td style={s.td}>
        <input style={{ ...localStyles.input, minWidth: 220 }} value={d.url ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://…" type="url" />
      </td>
      <td style={s.td}>
        <input style={{ ...localStyles.input, minWidth: 200 }} value={d.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Notes" />
      </td>
      <td style={localStyles.tdActions}>
        <button style={localStyles.btnSave} onClick={() => onSave(d)} disabled={saving}>{saving ? '…' : 'Save'}</button>
        <button style={localStyles.btnCancel} onClick={onCancel} disabled={saving}>Cancel</button>
      </td>
    </tr>
  )
}

export default function RegistrarsPage() {
  const qc = useQueryClient()
  const [editCode, setEditCode] = useState<string | null>(null)
  const [adding, setAdding]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const {
    filters, setFilter, persist, setPersist, clear: clearFilters, hasActive,
  } = usePersistedFilters('registrars', REGISTRAR_FILTER_DEFAULTS)
  const { search } = filters

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['registrars'],
    queryFn: () => getRegistrars().then(r => r.data),
  })

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.code.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.url ?? '').toLowerCase().includes(q) ||
      (r.notes ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  async function handleSave(d: EditState, isNew: boolean) {
    setError(null)
    setSaving(true)
    try {
      if (isNew) {
        await createRegistrar(d as any)
      } else {
        const { code, ...rest } = d
        await updateRegistrar(code!, rest)
      }
      qc.invalidateQueries({ queryKey: ['registrars'] })
      setEditCode(null)
      setAdding(false)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(code: string) {
    if (!confirm(`Delete registrar '${code}'?`)) return
    setError(null)
    try {
      await deleteRegistrar(code)
      qc.invalidateQueries({ queryKey: ['registrars'] })
    } catch (err: any) {
      setError(formatApiError(err))
    }
  }

  return (
    <div>
      <div style={s.pageBar}>
        <h2 style={s.pageTitle}>Registrars</h2>
      </div>

      {error && <p style={localStyles.errorText}>{error}</p>}

      <div style={s.panel}>
        {/* Stats / count bar */}
        <FilterBar>
          <span style={localStyles.countPill}>
            {hasActive
              ? `${filteredRows.length} of ${rows.length}`
              : `${rows.length} registrars`}
          </span>
        </FilterBar>

        {/* Filter bar */}
        <FilterBar>
          <SearchInput
            value={search}
            onChange={v => setFilter('search', v)}
            placeholder="Search code, name, URL…"
            width={280}
          />

          <FilterPersistControls
            persist={persist}
            setPersist={setPersist}
            onClear={clearFilters}
            hasActive={hasActive}
            style={{ marginLeft: 'auto' }}
          />

          <button style={s.actionBtn} onClick={() => { setAdding(true); setEditCode(null) }}>
            + New Registrar
          </button>
        </FilterBar>

        {/* Table */}
        <div style={s.tableWrap}>
          {isLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>Loading…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>Code</th>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>URL</th>
                  <th style={s.th}>Notes</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {adding && (
                  <EditRow initial={EMPTY} isNew saving={saving}
                    onSave={d => handleSave(d, true)} onCancel={() => setAdding(false)} />
                )}
                {filteredRows.map(row =>
                  editCode === row.code ? (
                    <EditRow key={row.code} initial={row} isNew={false} saving={saving}
                      onSave={d => handleSave(d, false)} onCancel={() => setEditCode(null)} />
                  ) : (
                    <tr key={row.code}>
                      <td style={s.td}><span style={localStyles.codeBadge}>{row.code}</span></td>
                      <td style={s.td}>{row.name}</td>
                      <td style={s.td}>
                        {row.url
                          ? <a href={row.url} target="_blank" rel="noreferrer" style={localStyles.link}>{row.url}</a>
                          : <span style={localStyles.muted}>—</span>}
                      </td>
                      <td style={s.td}>{row.notes ?? <span style={localStyles.muted}>—</span>}</td>
                      <td style={localStyles.tdActions}>
                        <button style={localStyles.btnEdit} onClick={() => { setEditCode(row.code); setAdding(false) }}>Edit</button>
                        <button style={localStyles.btnDelete} onClick={() => handleDelete(row.code)}>Delete</button>
                      </td>
                    </tr>
                  )
                )}
                {filteredRows.length === 0 && !adding && (
                  <tr><td colSpan={5} style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>No registrars</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  countPill: { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  errorText: { color: '#b91c1c', fontSize: '.875rem', marginBottom: '.5rem' },
  muted:     { color: '#94a3b8', fontSize: '.8rem' },
  editRow:   { borderBottom: '1px solid #e2e8f0', background: '#fffbeb' },
  tdActions: { padding: '.4375rem .75rem', verticalAlign: 'middle', whiteSpace: 'nowrap' as const },
  code:      { background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, fontSize: '.8rem', fontFamily: 'monospace' },
  codeBadge: { background: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: 4, fontSize: '.8rem', fontWeight: 700, fontFamily: 'monospace' },
  link:      { color: '#2563eb', fontSize: '.8rem', textDecoration: 'none' },
  input:     { padding: '.2rem .4rem', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.8rem', width: '100%', boxSizing: 'border-box' as const },
  btnSave:   { padding: '.2rem .55rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 3, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', marginRight: 3 },
  btnCancel: { padding: '.2rem .55rem', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
  btnEdit:   { padding: '.2rem .5rem', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer', marginRight: 3 },
  btnDelete: { padding: '.2rem .5rem', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 3, fontSize: '.75rem', cursor: 'pointer' },
}
