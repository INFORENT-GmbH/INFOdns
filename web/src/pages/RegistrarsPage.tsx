import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePageTitle } from '../hooks/usePageTitle'
import {
  getRegistrars, createRegistrar, updateRegistrar, deleteRegistrar,
  type Registrar,
} from '../api/client'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import ListTable from '../components/ListTable'
import MasterDetailLayout from '../components/MasterDetailLayout'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

type EditState = Partial<Omit<Registrar, 'created_at' | 'updated_at'>>
const EMPTY: EditState = { code: '', name: '', url: '', notes: '' }
const REGISTRAR_FILTER_DEFAULTS = { search: '' }
type SelectedId = string | 'new' | null

export default function RegistrarsPage() {
  usePageTitle('Registrars')
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<SelectedId>(null)
  const [form, setForm] = useState<EditState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const editTarget: Registrar | null = useMemo(
    () => typeof selectedId === 'string' && selectedId !== 'new' ? rows.find(r => r.code === selectedId) ?? null : null,
    [rows, selectedId]
  )

  useEffect(() => {
    setError(null)
    if (selectedId === 'new') setForm(EMPTY)
    else if (editTarget) setForm(editTarget)
  }, [selectedId, editTarget])

  function set(k: keyof EditState, v: string) {
    setForm(prev => ({ ...prev, [k]: v || null }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setSaving(true)
    try {
      if (selectedId === 'new') {
        await createRegistrar(form as any)
      } else if (editTarget) {
        const { code, ...rest } = form
        await updateRegistrar(code!, rest)
      }
      qc.invalidateQueries({ queryKey: ['registrars'] })
      setSelectedId(null)
    } catch (err: any) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(code: string) {
    if (!confirm(`Delete registrar '${code}'?`)) return
    try {
      await deleteRegistrar(code)
      qc.invalidateQueries({ queryKey: ['registrars'] })
      if (selectedId === code) setSelectedId(null)
    } catch (err: any) {
      setError(formatApiError(err))
    }
  }

  // ── Dashboard ──────────────────────────────────────────────────
  const dashboard = (
    <>
      {error && <div style={localStyles.errorBanner}>{error}</div>}
      <FilterBar>
        <span style={localStyles.countPill}>
          {hasActive ? `${filteredRows.length} of ${rows.length}` : `${rows.length} registrars`}
        </span>
      </FilterBar>
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
        <button style={s.actionBtn} onClick={() => setSelectedId('new')}>+ New Registrar</button>
      </FilterBar>
      <ListTable>
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
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const isSel = selectedId === row.code
                return (
                  <tr
                    key={row.code}
                    onClick={() => setSelectedId(row.code)}
                    style={{ cursor: 'pointer', background: isSel ? '#eff6ff' : undefined }}
                    onMouseOver={e => { if (!isSel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseOut={e => { if (!isSel) e.currentTarget.style.background = '' }}
                  >
                    <td style={s.td}><span style={localStyles.codeBadge}>{row.code}</span></td>
                    <td style={s.td}>{row.name}</td>
                    <td style={s.td}>
                      {row.url
                        ? <a href={row.url} target="_blank" rel="noreferrer" style={localStyles.link} onClick={e => e.stopPropagation()}>{row.url}</a>
                        : <span style={localStyles.muted}>—</span>}
                    </td>
                    <td style={s.td}>{row.notes ?? <span style={localStyles.muted}>—</span>}</td>
                  </tr>
                )
              })}
              {filteredRows.length === 0 && (
                <tr><td colSpan={4} style={{ ...s.td, color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>No registrars</td></tr>
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
          placeholder="Search registrars…"
          width="100%"
        />
      </FilterBar>
      <FilterBar>
        <button style={{ ...s.actionBtn, width: '100%' }} onClick={() => setSelectedId('new')}>+ New Registrar</button>
      </FilterBar>
      <ListTable>
        {filteredRows.map(row => {
          const isSel = selectedId === row.code
          return (
            <div
              key={row.code}
              onClick={() => setSelectedId(row.code)}
              style={{
                padding: '.5rem .75rem',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                background: isSel ? '#eff6ff' : 'transparent',
              }}
            >
              <div style={{ fontSize: '.8125rem', fontWeight: isSel ? 600 : 500, color: '#1e293b' }}>
                <span style={localStyles.codeBadge}>{row.code}</span> {row.name}
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
        <h3 style={localStyles.detailTitle}>{isNew ? 'New Registrar' : (editTarget?.code ?? '')}</h3>
        {editTarget && (
          <button onClick={() => handleDelete(editTarget.code)} style={localStyles.btnDelete}>Delete</button>
        )}
      </div>
      <form onSubmit={handleSave} style={localStyles.formBody}>
        {error && <div style={localStyles.error}>{error}</div>}
        <label style={localStyles.label}>
          Code
          {isNew
            ? <input value={form.code ?? ''} onChange={e => set('code', e.target.value.toUpperCase())} placeholder="CN" maxLength={10} required style={localStyles.input} />
            : <code style={{ ...localStyles.codeBadge, alignSelf: 'flex-start', padding: '4px 12px', fontSize: '.875rem' }}>{form.code}</code>}
        </label>
        <label style={localStyles.label}>
          Name
          <input value={form.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="Full name" required style={localStyles.input} />
        </label>
        <label style={localStyles.label}>
          URL
          <input type="url" value={form.url ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://…" style={localStyles.input} />
        </label>
        <label style={localStyles.label}>
          Notes
          <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Notes" rows={3} style={{ ...localStyles.input, resize: 'vertical' }} />
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
  formBody:     { display: 'flex', flexDirection: 'column' as const, gap: '.75rem', maxWidth: 520 },
  formFooter:   { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', paddingTop: '.75rem', borderTop: '1px solid #f1f5f9' },
  error:        { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  label:        { display: 'flex', flexDirection: 'column' as const, gap: '.25rem', fontSize: '.8125rem', fontWeight: 500, color: '#374151' },
  input:        { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', color: '#1e293b' },
  muted:        { color: '#94a3b8', fontSize: '.8rem' },
  codeBadge:    { background: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: 4, fontSize: '.8rem', fontWeight: 700, fontFamily: 'monospace' },
  link:         { color: '#2563eb', fontSize: '.8rem', textDecoration: 'none' },
  btnDelete:    { padding: '.25rem .625rem', background: '#fff', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
}
