import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getRegistrars, createRegistrar, updateRegistrar, deleteRegistrar,
  type Registrar,
} from '../api/client'
import { formatApiError } from '../lib/formError'

type EditState = Partial<Omit<Registrar, 'created_at' | 'updated_at'>>
const EMPTY: EditState = { code: '', name: '', url: '', notes: '' }

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
    <tr style={styles.editRow}>
      <td style={styles.td}>
        {isNew
          ? <input style={styles.input} value={d.code ?? ''} onChange={e => setD(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="CN" maxLength={10} />
          : <code style={styles.code}>{d.code}</code>}
      </td>
      <td style={styles.td}>
        <input style={{ ...styles.input, minWidth: 160 }} value={d.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="Full name" />
      </td>
      <td style={styles.td}>
        <input style={{ ...styles.input, minWidth: 220 }} value={d.url ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://…" type="url" />
      </td>
      <td style={styles.td}>
        <input style={{ ...styles.input, minWidth: 200 }} value={d.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Notes" />
      </td>
      <td style={styles.tdActions}>
        <button style={styles.btnSave} onClick={() => onSave(d)} disabled={saving}>{saving ? '…' : 'Save'}</button>
        <button style={styles.btnCancel} onClick={onCancel} disabled={saving}>Cancel</button>
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

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['registrars'],
    queryFn: () => getRegistrars().then(r => r.data),
  })

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
      <div style={styles.header}>
        <h2 style={styles.h2}>Registrars</h2>
        <span style={styles.count}>{rows.length}</span>
        <button style={styles.btnAdd} onClick={() => { setAdding(true); setEditCode(null) }}>
          + New Registrar
        </button>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      {isLoading ? <p style={styles.muted}>Loading…</p> : (
        <div style={{ overflowX: 'auto' }}><table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Code</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>URL</th>
              <th style={styles.th}>Notes</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {adding && (
              <EditRow initial={EMPTY} isNew saving={saving}
                onSave={d => handleSave(d, true)} onCancel={() => setAdding(false)} />
            )}
            {rows.map(row =>
              editCode === row.code ? (
                <EditRow key={row.code} initial={row} isNew={false} saving={saving}
                  onSave={d => handleSave(d, false)} onCancel={() => setEditCode(null)} />
              ) : (
                <tr key={row.code} style={styles.tr}>
                  <td style={styles.td}><span style={styles.codeBadge}>{row.code}</span></td>
                  <td style={styles.td}>{row.name}</td>
                  <td style={styles.td}>
                    {row.url
                      ? <a href={row.url} target="_blank" rel="noreferrer" style={styles.link}>{row.url}</a>
                      : <span style={styles.muted}>—</span>}
                  </td>
                  <td style={styles.td}>{row.notes ?? <span style={styles.muted}>—</span>}</td>
                  <td style={styles.tdActions}>
                    <button style={styles.btnEdit} onClick={() => { setEditCode(row.code); setAdding(false) }}>Edit</button>
                    <button style={styles.btnDelete} onClick={() => handleDelete(row.code)}>Delete</button>
                  </td>
                </tr>
              )
            )}
            {rows.length === 0 && !adding && (
              <tr><td colSpan={5} style={{ ...styles.td, ...styles.muted, textAlign: 'center' }}>No registrars</td></tr>
            )}
          </tbody>
        </table></div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header:    { display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '1rem', flexWrap: 'wrap' },
  h2:        { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  count:     { fontSize: '.75rem', color: '#475569', background: '#e2e8f0', padding: '1px 7px', borderRadius: 4, fontWeight: 600 },
  btnAdd:    { marginLeft: 'auto', padding: '.3125rem .75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  errorText: { color: '#b91c1c', fontSize: '.875rem', marginBottom: '.5rem' },
  muted:     { color: '#94a3b8', fontSize: '.8rem' },
  table:     { width: '100%', borderCollapse: 'collapse' },
  th:        { textAlign: 'left', padding: '.5rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', letterSpacing: '.04em' },
  tr:        { borderBottom: '1px solid #f1f5f9' },
  editRow:   { borderBottom: '1px solid #e2e8f0', background: '#fffbeb' },
  td:        { padding: '.4375rem .75rem', fontSize: '.8125rem', verticalAlign: 'middle', color: '#1e293b' },
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
