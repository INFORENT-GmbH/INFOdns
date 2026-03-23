import { useState, useRef } from 'react'
import { parseZoneImport, type DnsRecord, type ParsedImportRecord, type ImportConflict, type ZoneImportParseResult } from '../api/client'

interface EditRow { name: string; type: string; ttl: string; value: string; priority: string; weight: string; port: string }
interface NewRow extends EditRow { _newId: string }

interface Props {
  domainId: number
  existingRecords: DnsRecord[]
  onStage: (newRows: NewRow[], edits: Record<number, EditRow>) => void
  onClose: () => void
}

type NewEntry = { kind: 'new'; record: ParsedImportRecord; checked: boolean }
type ConflictEntry = { kind: 'conflict'; conflict: ImportConflict; choice: 'keep' | 'overwrite' }
type Entry = NewEntry | ConflictEntry

function formatImportValue(rec: ParsedImportRecord): string {
  if (rec.type === 'MX') return `${rec.priority} ${rec.value}`
  if (rec.type === 'SRV') return `${rec.priority} ${rec.weight} ${rec.port} ${rec.value}`
  return rec.value
}

function formatExistingValue(rec: DnsRecord): string {
  if (rec.type === 'MX') return `${rec.priority} ${rec.value}`
  if (rec.type === 'SRV') return `${rec.priority} ${rec.weight} ${rec.port} ${rec.value}`
  return rec.value
}

export default function ImportZoneModal({ domainId, onStage, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ZoneImportParseResult | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [showSkipped, setShowSkipped] = useState(false)

  async function handleFile(file: File) {
    setFileName(file.name)
    setLoading(true)
    setError(null)
    setResult(null)
    setEntries([])
    try {
      const res = await parseZoneImport(domainId, file)
      setResult(res.data)
      const newEntries: Entry[] = [
        ...res.data.new.map(r => ({ kind: 'new' as const, record: r, checked: true })),
        ...res.data.conflicts.map(c => ({ kind: 'conflict' as const, conflict: c, choice: 'keep' as const })),
      ]
      setEntries(newEntries)
    } catch (e: any) {
      const msg = e.response?.data?.message ?? e.message ?? 'Failed to parse file'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  function toggleNew(idx: number, checked: boolean) {
    setEntries(prev => prev.map((e, i) => i === idx && e.kind === 'new' ? { ...e, checked } : e))
  }

  function selectAll(checked: boolean) {
    setEntries(prev => prev.map(e => e.kind === 'new' ? { ...e, checked } : e))
  }

  function setConflictChoice(idx: number, choice: 'keep' | 'overwrite') {
    setEntries(prev => prev.map((e, i) => i === idx && e.kind === 'conflict' ? { ...e, choice } : e))
  }

  function handleStage() {
    const newRows: NewRow[] = []
    const edits: Record<number, EditRow> = {}

    for (const entry of entries) {
      if (entry.kind === 'new' && entry.checked) {
        const r = entry.record
        newRows.push({
          _newId: crypto.randomUUID(),
          name: r.name,
          type: r.type,
          ttl: r.ttl != null ? String(r.ttl) : '',
          value: r.value,
          priority: r.priority != null ? String(r.priority) : '',
          weight: r.weight != null ? String(r.weight) : '',
          port: r.port != null ? String(r.port) : '',
        })
      } else if (entry.kind === 'conflict' && entry.choice === 'overwrite') {
        const r = entry.conflict.incoming
        edits[entry.conflict.existing.id] = {
          name: r.name,
          type: r.type,
          ttl: r.ttl != null ? String(r.ttl) : '',
          value: r.value,
          priority: r.priority != null ? String(r.priority) : '',
          weight: r.weight != null ? String(r.weight) : '',
          port: r.port != null ? String(r.port) : '',
        }
      }
    }

    onStage(newRows, edits)
    onClose()
  }

  const newEntries = entries.filter((e): e is NewEntry => e.kind === 'new')
  const conflictEntries = entries.filter((e): e is ConflictEntry => e.kind === 'conflict')
  const selectedCount = newEntries.filter(e => e.checked).length + conflictEntries.filter(e => e.choice === 'overwrite').length

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <h3 style={s.title}>Import Zone File</h3>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>

        {/* File picker */}
        <div style={s.filePicker}>
          <button style={s.btnSecondary} onClick={() => fileRef.current?.click()} disabled={loading}>
            {loading ? 'Parsing…' : 'Choose file'}
          </button>
          {fileName && <span style={s.fileLabel}>{fileName}</span>}
          {loading && <div style={s.spinner} />}
          <input
            ref={fileRef}
            type="file"
            accept=".zone,.txt,text/plain,application/octet-stream"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
        </div>

        {error && <div style={s.errorBar}>{error}</div>}

        {result && entries.length === 0 && (
          <p style={{ color: '#6b7280', fontSize: '.875rem', margin: 0 }}>
            No importable records found.{result.skipped.length > 0 ? ' See skipped below.' : ''}
          </p>
        )}

        {newEntries.length > 0 && (
          <section>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>New records ({newEntries.length})</span>
              <button style={s.linkBtn} onClick={() => selectAll(true)}>Select all</button>
              <button style={s.linkBtn} onClick={() => selectAll(false)}>None</button>
            </div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}></th>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>Type</th>
                  <th style={s.th}>TTL</th>
                  <th style={s.th}>Value</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => {
                  if (entry.kind !== 'new') return null
                  return (
                    <tr key={idx} style={entry.checked ? s.rowChecked : s.row}>
                      <td style={s.td}>
                        <input
                          type="checkbox"
                          checked={entry.checked}
                          onChange={e => toggleNew(idx, e.target.checked)}
                        />
                      </td>
                      <td style={{ ...s.td, ...s.mono }}>{entry.record.name}</td>
                      <td style={s.td}><span style={s.typeBadge}>{entry.record.type}</span></td>
                      <td style={{ ...s.td, color: '#6b7280' }}>{entry.record.ttl ?? '—'}</td>
                      <td style={{ ...s.td, ...s.mono, wordBreak: 'break-all' }}>{formatImportValue(entry.record)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}

        {conflictEntries.length > 0 && (
          <section>
            <div style={s.sectionHeader}>
              <span style={s.sectionTitle}>Conflicts ({conflictEntries.length})</span>
              <span style={s.hintText}>A record at this name+type already exists</span>
            </div>
            {entries.map((entry, idx) => {
              if (entry.kind !== 'conflict') return null
              const { conflict, choice } = entry
              return (
                <div key={idx} style={s.conflictCard}>
                  <div style={s.conflictName}>
                    <span style={s.typeBadge}>{conflict.existing.type}</span>
                    <span style={s.mono}>{conflict.existing.name}</span>
                  </div>
                  <table style={{ ...s.table, marginTop: '.25rem' }}>
                    <thead>
                      <tr>
                        <th style={s.th}>Source</th>
                        <th style={s.th}>TTL</th>
                        <th style={s.th}>Value</th>
                        <th style={s.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={choice === 'keep' ? s.rowChecked : s.row}>
                        <td style={s.td}><span style={s.existingBadge}>Existing</span></td>
                        <td style={{ ...s.td, color: '#6b7280' }}>{conflict.existing.ttl ?? '—'}</td>
                        <td style={{ ...s.td, ...s.mono, wordBreak: 'break-all' }}>{formatExistingValue(conflict.existing)}</td>
                        <td style={s.td}>
                          <label style={s.radioLabel}>
                            <input type="radio" name={`conflict-${idx}`} checked={choice === 'keep'} onChange={() => setConflictChoice(idx, 'keep')} />
                            Keep
                          </label>
                        </td>
                      </tr>
                      <tr style={choice === 'overwrite' ? s.rowImport : s.row}>
                        <td style={s.td}><span style={s.incomingBadge}>Incoming</span></td>
                        <td style={{ ...s.td, color: '#6b7280' }}>{conflict.incoming.ttl ?? '—'}</td>
                        <td style={{ ...s.td, ...s.mono, wordBreak: 'break-all' }}>{formatImportValue(conflict.incoming)}</td>
                        <td style={s.td}>
                          <label style={s.radioLabel}>
                            <input type="radio" name={`conflict-${idx}`} checked={choice === 'overwrite'} onChange={() => setConflictChoice(idx, 'overwrite')} />
                            Use
                          </label>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            })}
          </section>
        )}

        {result && result.skipped.length > 0 && (
          <section>
            <button style={s.linkBtn} onClick={() => setShowSkipped(v => !v)}>
              {showSkipped ? '▾' : '▸'} Skipped ({result.skipped.length})
            </button>
            {showSkipped && (
              <ul style={s.skippedList}>
                {result.skipped.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </section>
        )}

        <div style={s.footer}>
          <button style={s.btnSecondary} onClick={onClose}>Cancel</button>
          <button
            style={selectedCount > 0 ? s.btnPrimary : s.btnDisabled}
            disabled={selectedCount === 0}
            onClick={handleStage}
          >
            Stage {selectedCount} record{selectedCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, overflowY: 'auto', padding: '2rem 1rem' },
  modal: { background: '#fff', borderRadius: 8, padding: '1.5rem', width: 720, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 8px 32px rgba(0,0,0,.18)', maxHeight: 'none' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { margin: 0, fontSize: '1.125rem', fontWeight: 700 },
  closeBtn: { background: 'none', border: 'none', fontSize: '1rem', color: '#6b7280', cursor: 'pointer', padding: '0 4px' },
  filePicker: { display: 'flex', alignItems: 'center', gap: '.75rem' },
  fileLabel: { fontSize: '.875rem', color: '#374151' },
  spinner: { width: 18, height: 18, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 },
  errorBar: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.375rem' },
  sectionTitle: { fontWeight: 600, fontSize: '.875rem', color: '#374151' },
  hintText: { fontSize: '.75rem', color: '#9ca3af' },
  linkBtn: { background: 'none', border: 'none', color: '#2563eb', fontSize: '.8125rem', cursor: 'pointer', padding: '0 2px', textDecoration: 'underline' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' },
  th: { textAlign: 'left', padding: '.25rem .5rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.7rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  td: { padding: '.25rem .5rem', verticalAlign: 'top' },
  row: { borderBottom: '1px solid #f3f4f6' },
  rowChecked: { borderBottom: '1px solid #f3f4f6', background: '#f0fdf4' },
  rowImport: { borderBottom: '1px solid #f3f4f6', background: '#eff6ff' },
  mono: { fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  typeBadge: { display: 'inline-block', background: '#f3f4f6', color: '#374151', borderRadius: 4, padding: '1px 5px', fontSize: '.7rem', fontWeight: 600, marginRight: 4 },
  existingBadge: { display: 'inline-block', background: '#fef3c7', color: '#92400e', borderRadius: 4, padding: '1px 5px', fontSize: '.7rem', fontWeight: 600 },
  incomingBadge: { display: 'inline-block', background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '1px 5px', fontSize: '.7rem', fontWeight: 600 },
  conflictCard: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '.5rem .75rem', marginBottom: '.5rem', background: '#fafafa' },
  conflictName: { display: 'flex', alignItems: 'center', gap: '.375rem', marginBottom: '.25rem', fontSize: '.875rem', fontWeight: 600 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: '.25rem', fontSize: '.8125rem', cursor: 'pointer', whiteSpace: 'nowrap' },
  skippedList: { margin: '.25rem 0 0 1rem', padding: 0, listStyle: 'disc', fontSize: '.8125rem', color: '#6b7280' },
  footer: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', paddingTop: '.5rem', borderTop: '1px solid #f3f4f6', marginTop: '.25rem' },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  btnDisabled: { padding: '.375rem .875rem', background: '#e5e7eb', color: '#9ca3af', border: 'none', borderRadius: 4, fontSize: '.875rem', cursor: 'default' },
}
