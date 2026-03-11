import { useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDomain, getRecords, createRecord, deleteRecord,
  createBulkJob, previewBulkJob, approveBulkJob, searchByRecord,
  type DnsRecord,
} from '../api/client'
import ZoneStatusBadge from '../components/ZoneStatusBadge'
import { useI18n } from '../i18n/I18nContext'

const INLINE_STYLES = `
  .inline-field:hover { border-color: #d1d5db !important; background: #fff !important; }
  .inline-field:focus { border-color: #2563eb !important; background: #fff !important; outline: none !important; box-shadow: 0 0 0 2px #bfdbfe; }
`

const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']

interface EditRow {
  name: string
  type: string
  ttl: string
  value: string
}

interface NewRow extends EditRow {
  _newId: string  // client-only key
}

// ── Bulk-edit count button ────────────────────────────────────

function BulkEditButton({ rec }: { rec: DnsRecord }) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const rawValue = rec.type === 'MX' ? rec.value : rec.type === 'SRV' ? rec.value : rec.value

  const { data } = useQuery<{ id: number }[]>({
    queryKey: ['record-search-count', rec.type, rec.name, rawValue],
    queryFn: () => searchByRecord({ type: rec.type, name: rec.name, value: rawValue }).then(r => r.data),
    staleTime: 30_000,
  })

  const count = data?.length ?? null

  function handleClick() {
    const params = new URLSearchParams({ type: rec.type, name: rec.name, value: rawValue })
    navigate(`/jobs?${params.toString()}`)
  }

  if (count === null) return null
  return (
    <button onClick={handleClick} style={styles.bulkBtn} title="Bulk edit across domains">
      {t('domainDetail_bulkEditBtn', count)}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function DomainDetailPage() {
  const { id } = useParams<{ id: string }>()
  const domainId = Number(id)
  const qc = useQueryClient()
  const { t } = useI18n()

  // edits: changes to existing records keyed by record id
  const [edits, setEdits] = useState<Record<number, EditRow>>({})
  // pendingDeletes: ids of records marked for deletion
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set())
  // newRows: new records not yet saved
  const [newRows, setNewRows] = useState<NewRow[]>([])

  const [applying, setApplying] = useState(false)
  const applyingRef = useRef(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const { data: domain, isLoading: loadingDomain } = useQuery({
    queryKey: ['domain', domainId],
    queryFn: () => getDomain(domainId).then(r => r.data),
  })

  const { data: records = [], isLoading: loadingRecords } = useQuery({
    queryKey: ['records', domainId],
    queryFn: () => getRecords(domainId).then(r => r.data),
  })

  // ── existing record helpers ──────────────────────────────────────────────

  function getRow(rec: DnsRecord): EditRow {
    return edits[rec.id] ?? {
      name: rec.name,
      type: rec.type,
      ttl: rec.ttl != null ? String(rec.ttl) : '',
      value: formatValue(rec),
    }
  }

  function setField(recId: number, rec: DnsRecord, field: keyof EditRow, value: string) {
    const current = getRow(rec)
    const next = { ...current, [field]: value }
    const original: EditRow = {
      name: rec.name,
      type: rec.type,
      ttl: rec.ttl != null ? String(rec.ttl) : '',
      value: formatValue(rec),
    }
    const isDirty = next.name !== original.name || next.type !== original.type ||
      next.ttl !== original.ttl || next.value !== original.value
    if (isDirty) {
      setEdits(prev => ({ ...prev, [recId]: next }))
    } else {
      setEdits(prev => { const n = { ...prev }; delete n[recId]; return n })
    }
  }

  function markDelete(rec: DnsRecord) {
    setPendingDeletes(prev => new Set(prev).add(rec.id))
    setEdits(prev => { const n = { ...prev }; delete n[rec.id]; return n })
  }

  function unmarkDelete(recId: number) {
    setPendingDeletes(prev => { const s = new Set(prev); s.delete(recId); return s })
  }

  // ── new row helpers ──────────────────────────────────────────────────────

  function addNewRow() {
    setNewRows(prev => [{ _newId: crypto.randomUUID(), name: '@', type: 'A', ttl: '', value: '' }, ...prev])
  }

  function setNewField(newId: string, field: keyof EditRow, value: string) {
    setNewRows(prev => prev.map(r => r._newId === newId ? { ...r, [field]: value } : r))
  }

  function removeNewRow(newId: string) {
    setNewRows(prev => prev.filter(r => r._newId !== newId))
  }

  // ── apply ────────────────────────────────────────────────────────────────

  const dirtyIds = Object.keys(edits).map(Number)
  const hasDirty = dirtyIds.length > 0 || pendingDeletes.size > 0 || newRows.length > 0

  async function handleApply() {
    if (!hasDirty || applyingRef.current) return
    applyingRef.current = true
    setApplying(true)
    setApplyError(null)
    // Snapshot the rows to submit — skip new rows with empty value
    const rowsToCreate = newRows.filter(r => r.value.trim() !== '')
    try {
      // 1. Create new records directly (API enqueues render)
      for (const row of rowsToCreate) {
        const ttlNum = row.ttl === '' ? undefined : Number(row.ttl)
        let body: any = { name: row.name.trim(), type: row.type, value: row.value.trim() }
        if (ttlNum !== undefined) body.ttl = ttlNum
        if (row.type === 'MX') {
          const parts = row.value.trim().split(/\s+/)
          body.priority = Number(parts[0]); body.value = parts.slice(1).join(' ')
        } else if (row.type === 'SRV') {
          const parts = row.value.trim().split(/\s+/)
          body.priority = Number(parts[0]); body.weight = Number(parts[1])
          body.port = Number(parts[2]); body.value = parts.slice(3).join(' ')
        }
        await createRecord(domainId, body)
      }

      // 2. Delete pending deletes directly
      for (const recId of pendingDeletes) {
        await deleteRecord(domainId, recId)
      }

      // 3. Update edited records via bulk job (replace)
      for (const recId of dirtyIds) {
        const rec = (records as DnsRecord[]).find(r => r.id === recId)
        if (!rec) continue
        const row = edits[recId]
        const ttlNum = row.ttl === '' ? null : Number(row.ttl)
        let priority: number | undefined, weight: number | undefined, port: number | undefined, value: string
        if (row.type === 'MX') {
          const parts = row.value.trim().split(/\s+/)
          priority = Number(parts[0]); value = parts.slice(1).join(' ')
        } else if (row.type === 'SRV') {
          const parts = row.value.trim().split(/\s+/)
          priority = Number(parts[0]); weight = Number(parts[1]); port = Number(parts[2])
          value = parts.slice(3).join(' ')
        } else {
          value = row.value.trim()
        }
        const job = await createBulkJob({
          operation: 'replace',
          filter_json: { mode: 'explicit', domain_ids: [domainId] },
          payload_json: {
            match: { name: rec.name, type: rec.type, value_contains: rec.value },
            replace_with: {
              name: row.name.trim(), type: row.type, ttl: ttlNum, value,
              ...(priority !== undefined && { priority }),
              ...(weight !== undefined && { weight }),
              ...(port !== undefined && { port }),
            },
          },
        })
        await previewBulkJob(job.data.id)
        await approveBulkJob(job.data.id)
      }

      const submittedIds = new Set(rowsToCreate.map(r => r._newId))
      setEdits({})
      setPendingDeletes(new Set())
      setNewRows(prev => prev.filter(r => !submittedIds.has(r._newId)))
      qc.invalidateQueries({ queryKey: ['records', domainId] })
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
    } catch (e: any) {
      const data = e?.response?.data
      let msg: string = data?.message ?? data?.error ?? e.message ?? 'Failed to apply changes'
      // Zod errors come back as a JSON string — unwrap to readable text
      try {
        const parsed = JSON.parse(msg)
        if (Array.isArray(parsed)) {
          msg = parsed.map((z: any) => `${z.path?.join('.') || 'field'}: ${z.message}`).join(', ')
        }
      } catch { /* not JSON, use as-is */ }
      setApplyError(msg)
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }

  function handleDiscard() {
    setEdits({})
    setPendingDeletes(new Set())
    setNewRows([])
    setApplyError(null)
  }

  // ── render ───────────────────────────────────────────────────────────────

  if (loadingDomain) return <p>{t('loading')}</p>
  if (!domain) return <p>Domain not found</p>

  const changeCount = dirtyIds.length + pendingDeletes.size + newRows.length

  return (
    <div>
      <style>{INLINE_STYLES}</style>
      <div style={styles.header}>
        <Link to="/domains" style={styles.back}>{t('domainDetail_backLink')}</Link>
        <h2 style={styles.h2}>{domain.fqdn}</h2>
        <ZoneStatusBadge status={domain.zone_status} />
      </div>

      {domain.zone_status === 'error' && (
        <div style={styles.errorBanner}>
          <strong>{t('domainDetail_zoneFailed')}</strong>
          {(domain as any).zone_error && (
            <pre style={{ margin: '.5rem 0 0', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: '.8125rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {(domain as any).zone_error}
            </pre>
          )}
        </div>
      )}

      <div style={styles.meta}>
        <span>{t('customer')}: <strong>{(domain as any).customer_name}</strong></span>
        <span>{t('domainDetail_defaultTtl')} <strong>{domain.default_ttl}s</strong></span>
        <span>{t('serial')}: <code>{domain.last_serial || '—'}</code></span>
        <span>{t('domainDetail_lastRendered')} {domain.last_rendered_at ? new Date(domain.last_rendered_at).toLocaleString() : t('never')}</span>
      </div>

      <div style={styles.tableHeader}>
        <h3 style={styles.h3}>{t('domainDetail_dnsRecords')}</h3>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          {hasDirty && <span style={styles.dirtyHint}>{changeCount} {changeCount > 1 ? t('domainDetail_unsavedChanges') : t('domainDetail_unsavedChange')}</span>}
          {hasDirty && <button onClick={handleDiscard} style={styles.btnSecondary} disabled={applying}>{t('domainDetail_discard')}</button>}
          {hasDirty && (
            <button onClick={handleApply} style={styles.btnPrimary} disabled={applying}>
              {applying ? t('domainDetail_applying') : t('domainDetail_applyChanges')}
            </button>
          )}
          <button onClick={addNewRow} style={hasDirty ? styles.btnSecondary : styles.btnPrimary}>{t('domainDetail_addRecord')}</button>
        </div>
      </div>

      {applyError && <div style={{ ...styles.errorBanner, marginBottom: '1rem' }}>{applyError}</div>}

      {loadingRecords ? <p>{t('domainDetail_loadingRecords')}</p> : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('name')}</th>
              <th style={styles.th}>{t('type')}</th>
              <th style={styles.th}>{t('ttl')}</th>
              <th style={styles.th}>{t('value')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {/* New (unsaved) rows at top */}
            {newRows.map(row => (
              <tr key={row._newId} style={{ ...styles.tr, background: '#f0fdf4', outline: '1px solid #86efac' }}>
                <td style={styles.td}>
                  <input value={row.name} onChange={e => setNewField(row._newId, 'name', e.target.value)}
                    className="inline-field" style={{ ...styles.inlineInput, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} />
                </td>
                <td style={styles.td}>
                  <select value={row.type} onChange={e => setNewField(row._newId, 'type', e.target.value)}
                    className="inline-field" style={styles.inlineSelect}>
                    {RECORD_TYPES.map(rt => <option key={rt}>{rt}</option>)}
                  </select>
                </td>
                <td style={styles.td}>
                  <input value={row.ttl} onChange={e => setNewField(row._newId, 'ttl', e.target.value)}
                    placeholder={t('domainDetail_ttlPlaceholder')} className="inline-field" style={{ ...styles.inlineInput, width: 70 }} />
                </td>
                <td style={{ ...styles.td, ...styles.valueCell }}>
                  <input value={row.value} onChange={e => setNewField(row._newId, 'value', e.target.value)}
                    placeholder={t('domainDetail_valuePlaceholder')} className="inline-field" style={{ ...styles.inlineInput, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", width: '100%' }} />
                </td>
                <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={styles.newBadge}>{t('domainDetail_newBadge')}</span>
                  <button onClick={() => removeNewRow(row._newId)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>✕</button>
                </td>
              </tr>
            ))}

            {/* Existing records */}
            {(records as DnsRecord[]).map(rec => {
              const isDeleted = pendingDeletes.has(rec.id)
              const row = getRow(rec)
              const dirty = !!edits[rec.id]
              const rowStyle = isDeleted
                ? { ...styles.tr, background: '#fef2f2', outline: '1px solid #fca5a5', opacity: 0.6 }
                : dirty
                  ? { ...styles.tr, background: '#fefce8', outline: '1px solid #fde047' }
                  : styles.tr

              return (
                <tr key={rec.id} style={rowStyle}>
                  <td style={styles.td}>
                    <input value={row.name} onChange={e => setField(rec.id, rec, 'name', e.target.value)}
                      disabled={isDeleted} className="inline-field"
                      style={{ ...styles.inlineInput, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} />
                  </td>
                  <td style={styles.td}>
                    <select value={row.type} onChange={e => setField(rec.id, rec, 'type', e.target.value)}
                      disabled={isDeleted} className="inline-field" style={styles.inlineSelect}>
                      {RECORD_TYPES.map(rt => <option key={rt}>{rt}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <input value={row.ttl} onChange={e => setField(rec.id, rec, 'ttl', e.target.value)}
                      disabled={isDeleted} placeholder={t('domainDetail_ttlPlaceholder')} className="inline-field"
                      style={{ ...styles.inlineInput, width: 70 }} />
                  </td>
                  <td style={{ ...styles.td, ...styles.valueCell }}>
                    <input value={row.value} onChange={e => setField(rec.id, rec, 'value', e.target.value)}
                      disabled={isDeleted} className="inline-field"
                      style={{ ...styles.inlineInput, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", width: '100%' }} />
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!isDeleted && <BulkEditButton rec={rec} />}
                    {dirty && !isDeleted && (
                      <button onClick={() => setEdits(prev => { const n = { ...prev }; delete n[rec.id]; return n })}
                        style={{ ...styles.btnIcon, color: '#6b7280' }} title={t('domainDetail_revert')}>↩</button>
                    )}
                    {isDeleted
                      ? <button onClick={() => unmarkDelete(rec.id)} style={{ ...styles.btnIcon, color: '#16a34a' }}>{t('domainDetail_restore')}</button>
                      : <button onClick={() => markDelete(rec)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>{t('delete')}</button>
                    }
                  </td>
                </tr>
              )
            })}

            {records.length === 0 && newRows.length === 0 && (
              <tr><td colSpan={5} style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>{t('domainDetail_noRecords')}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

function formatValue(rec: DnsRecord): string {
  if (rec.type === 'MX') return `${rec.priority} ${rec.value}`
  if (rec.type === 'SRV') return `${rec.priority} ${rec.weight} ${rec.port} ${rec.value}`
  return rec.value
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '.5rem' },
  back: { color: '#6b7280', textDecoration: 'none', fontSize: '.875rem' },
  h2: { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  h3: { margin: 0, fontSize: '1rem', fontWeight: 600 },
  errorBanner: { background: '#fee2e2', color: '#b91c1c', padding: '.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '.875rem' },
  meta: { display: 'flex', gap: '1.5rem', marginBottom: '1.25rem', fontSize: '.875rem', color: '#374151', flexWrap: 'wrap' },
  tableHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' },
  dirtyHint: { fontSize: '.8125rem', color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: 12 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '.375rem .75rem', fontSize: '.875rem' },
  valueCell: { minWidth: 200 },
  newBadge: { fontSize: '.7rem', background: '#dcfce7', color: '#16a34a', padding: '1px 6px', borderRadius: 10, fontWeight: 600, marginRight: 4 },
  inlineInput: { border: '1px solid transparent', borderRadius: 3, padding: '2px 5px', fontSize: '.8125rem', background: 'transparent', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  inlineSelect: { border: '1px solid transparent', borderRadius: 3, padding: '2px 4px', fontSize: '.8125rem', background: 'transparent', outline: 'none', cursor: 'pointer' },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  btnIcon:  { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px' },
  bulkBtn:  { background: '#ede9fe', color: '#6d28d9', border: 'none', borderRadius: 10, fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', cursor: 'pointer', marginRight: 4, whiteSpace: 'nowrap' as const },
}
