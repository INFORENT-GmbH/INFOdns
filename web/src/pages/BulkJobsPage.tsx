import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getBulkJobs, createBulkJob, previewBulkJob, approveBulkJob,
  getBulkJob, getBulkJobDomains, searchByRecord, type BulkJob,
} from '../api/client'

// ── Types ─────────────────────────────────────────────────────

interface SearchResult {
  id: number
  fqdn: string
  customer_id: number
  customer_name: string
  record_id: number
  record_name: string
  record_type: string
  ttl: number
  priority: number | null
  value: string
}

type Operation = 'add' | 'replace' | 'delete' | 'change_ttl'
type Step = 'search' | 'payload' | 'preview' | 'done'

// ── Status badge ──────────────────────────────────────────────

const statusColors: Record<string, { bg: string; text: string }> = {
  draft:      { bg: '#f3f4f6', text: '#374151' },
  previewing: { bg: '#fef9c3', text: '#854d0e' },
  approved:   { bg: '#dbeafe', text: '#1e40af' },
  running:    { bg: '#ede9fe', text: '#6d28d9' },
  done:       { bg: '#dcfce7', text: '#15803d' },
  failed:     { bg: '#fee2e2', text: '#b91c1c' },
}

function StatusBadge({ status }: { status: string }) {
  const c = statusColors[status] ?? { bg: '#f3f4f6', text: '#374151' }
  return (
    <span style={{ background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 12, fontSize: '.75rem', fontWeight: 600 }}>
      {status}
    </span>
  )
}

// ── Payload form per operation ────────────────────────────────

interface PayloadFormProps {
  operation: Operation
  matchType: string
  matchName: string
  matchValue: string
  onChange: (payload: Record<string, unknown>) => void
}

function PayloadForm({ operation, matchType, matchName, matchValue, onChange }: PayloadFormProps) {
  const [newName, setNewName]         = useState(matchName)
  const [newType, setNewType]         = useState(matchType)
  const [newValue, setNewValue]       = useState('')
  const [newTtl, setNewTtl]           = useState('3600')
  const [newPriority, setNewPriority] = useState('')
  // Editable match-name for replace/delete/change_ttl so users can narrow which record gets targeted
  const [filterName, setFilterName]   = useState(matchName)

  const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']

  // Emit initial payload on mount
  useEffect(() => { emit() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function emit(overrides: Record<string, unknown> = {}) {
    const effectiveFilterName = (overrides._filterName as string | undefined) ?? filterName
    const match = {
      ...(effectiveFilterName ? { name: effectiveFilterName } : {}),
      ...(matchType  ? { type: matchType }  : {}),
      ...(matchValue ? { value: matchValue } : {}),
    }

    if (operation === 'delete') {
      onChange({ ...overrides, match })
      return
    }
    if (operation === 'change_ttl') {
      onChange({ ...overrides, match, new_ttl: Number(overrides.new_ttl ?? newTtl) })
      return
    }
    // add / replace
    const rec: Record<string, unknown> = {
      name: overrides.name ?? newName,
      type: overrides.type ?? newType,
      value: overrides.value ?? newValue,
      ttl: Number(overrides.ttl ?? newTtl) || null,
      priority: (overrides.priority !== undefined ? overrides.priority : newPriority)
        ? Number(overrides.priority ?? newPriority) : null,
    }
    if (operation === 'add')     onChange({ records: [rec] })
    if (operation === 'replace') onChange({ match, replace_with: rec })
  }

  // Match-name filter shown for operations that target existing records
  const showMatchFilter = operation === 'replace' || operation === 'delete' || operation === 'change_ttl'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      {/* Match criteria summary */}
      {showMatchFilter && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, padding: '.5rem .75rem', fontSize: '.8125rem' }}>
          <strong>Matching:</strong> {matchType} records
          {matchValue && <> with value containing <code style={{ background: '#e5e7eb', padding: '1px 4px', borderRadius: 2 }}>{matchValue}</code></>}
          {' '}where name =
          <input
            value={filterName}
            onChange={e => { setFilterName(e.target.value); emit({ _filterName: e.target.value }) }}
            style={{ marginLeft: '.4rem', padding: '1px 6px', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '.8125rem', width: 80 }}
            placeholder="any"
          />
          <span style={{ color: '#9ca3af', marginLeft: '.4rem' }}>(leave blank to match all names)</span>
        </div>
      )}

      {operation === 'change_ttl' && (
        <label style={styles.label}>
          New TTL (seconds)
          <input
            type="number" value={newTtl}
            onChange={e => { setNewTtl(e.target.value); emit({ new_ttl: Number(e.target.value) }) }}
            style={styles.input}
          />
        </label>
      )}

      {(operation === 'add' || operation === 'replace') && (
        <>
          <label style={styles.label}>
            Name
            <input value={newName}
              onChange={e => { setNewName(e.target.value); emit({ name: e.target.value }) }}
              style={styles.input} placeholder="@ or subdomain" />
          </label>
          <label style={styles.label}>
            Type
            <select value={newType}
              onChange={e => { setNewType(e.target.value); emit({ type: e.target.value }) }}
              style={styles.input}>
              {RECORD_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label style={styles.label}>
            Value
            <input value={newValue}
              onChange={e => { setNewValue(e.target.value); emit({ value: e.target.value }) }}
              style={styles.input} placeholder="e.g. 1.2.3.4" />
          </label>
          <label style={styles.label}>
            TTL (seconds)
            <input type="number" value={newTtl}
              onChange={e => { setNewTtl(e.target.value); emit({ ttl: Number(e.target.value) }) }}
              style={styles.input} />
          </label>
          {(newType === 'MX' || newType === 'SRV') && (
            <label style={styles.label}>
              Priority
              <input type="number" value={newPriority}
                onChange={e => { setNewPriority(e.target.value); emit({ priority: Number(e.target.value) }) }}
                style={styles.input} placeholder="10" />
            </label>
          )}
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function BulkJobsPage() {
  const qc = useQueryClient()
  const [showWizard, setShowWizard] = useState(false)
  const [step, setStep] = useState<Step>('search')

  // Search state
  const [searchType, setSearchType] = useState('A')
  const [searchName, setSearchName] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [searchDomain, setSearchDomain] = useState('')

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [operation, setOperation]     = useState<Operation>('add')
  const [payload, setPayload]         = useState<Record<string, unknown>>({})

  // Job state
  const [currentJobId, setCurrentJobId] = useState<number | null>(null)
  const [busy, setBusy]                 = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']

  // ── Queries ──────────────────────────────────────────────────

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ['bulk-jobs'],
    queryFn: () => getBulkJobs().then(r => r.data),
  })

  const { data: searchResults = [], isFetching: searching } = useQuery<SearchResult[]>({
    queryKey: ['record-search', searchType, searchName, searchValue],
    queryFn: () => searchByRecord({
      type: searchType,
      ...(searchName  ? { name: searchName }  : {}),
      ...(searchValue ? { value: searchValue } : {}),
    }).then(r => r.data),
  })

  const { data: currentJob } = useQuery({
    queryKey: ['bulk-job', currentJobId],
    queryFn: () => getBulkJob(currentJobId!).then(r => r.data),
    enabled: currentJobId !== null && step === 'preview',
  })

  const { data: jobDomains = [] } = useQuery({
    queryKey: ['bulk-job-domains', currentJobId],
    queryFn: () => getBulkJobDomains(currentJobId!).then(r => r.data),
    enabled: currentJobId !== null && step === 'preview',
  })

  // ── Derived state ────────────────────────────────────────────

  // Unique domains from search results, optionally filtered by domain name
  const domainMap = new Map<number, SearchResult>()
  for (const r of searchResults) {
    if (!domainMap.has(r.id)) domainMap.set(r.id, r)
  }
  const domains = Array.from(domainMap.values()).filter(d =>
    !searchDomain || d.fqdn.includes(searchDomain.toLowerCase())
  )

  // ── Handlers ─────────────────────────────────────────────────

  function handleSearch() {
    setSelectedIds(new Set())
  }

  function toggleDomain(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(domains.map(d => d.id)))
  }

  function selectNone() {
    setSelectedIds(new Set())
  }

  async function handlePreview() {
    if (selectedIds.size === 0) { setError('Select at least one domain'); return }
    setBusy(true)
    setError(null)
    try {
      const filterJson = {
        mode: 'explicit' as const,
        domain_ids: Array.from(selectedIds),
      }
      const res = await createBulkJob({ operation, filter_json: filterJson, payload_json: payload })
      const jobId = res.data.id
      setCurrentJobId(jobId)
      await previewBulkJob(jobId)
      qc.invalidateQueries({ queryKey: ['bulk-job', jobId] })
      qc.invalidateQueries({ queryKey: ['bulk-job-domains', jobId] })
      setStep('preview')
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleApprove() {
    if (!currentJobId) return
    setBusy(true)
    setError(null)
    try {
      await approveBulkJob(currentJobId)
      qc.invalidateQueries({ queryKey: ['bulk-jobs'] })
      setStep('done')
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  function resetWizard() {
    setShowWizard(false)
    setStep('search')
    setSearchType('A')
    setSearchName('')
    setSearchValue('')
    setSearchDomain('')
    setSelectedIds(new Set())
    setOperation('add')
    setPayload({})
    setCurrentJobId(null)
    setError(null)
  }

  // ── Render ────────────────────────────────────────────────────

  const previewData = currentJob?.preview_json
    ? (typeof currentJob.preview_json === 'string' ? JSON.parse(currentJob.preview_json) : currentJob.preview_json)
    : null

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>Bulk Jobs</h2>
        <button onClick={() => setShowWizard(true)} style={styles.btnPrimary}>+ New Bulk Job</button>
      </div>

      {showWizard && (
        <div style={styles.wizardCard}>
          {/* Header */}
          <div style={styles.wizardTitle}>
            <span style={{ fontWeight: 700 }}>
              {step === 'search' && 'Find domains by record'}
              {step === 'payload' && 'Configure operation'}
              {step === 'preview' && 'Preview changes'}
              {step === 'done' && 'Done'}
            </span>
            <button onClick={resetWizard} style={styles.closeBtn}>✕</button>
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          {/* ── Step 1: Search + select ── */}
          {step === 'search' && (
            <>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <label style={styles.label}>
                  Type
                  <select value={searchType} onChange={e => { setSearchType(e.target.value); handleSearch() }} style={{ ...styles.input, width: 100 }}>
                    {RECORD_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label style={styles.label}>
                  Record name
                  <input value={searchName} onChange={e => setSearchName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    style={{ ...styles.input, width: 120 }} placeholder="@ or www" />
                </label>
                <label style={styles.label}>
                  Record value contains
                  <input value={searchValue} onChange={e => setSearchValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    style={{ ...styles.input, width: 160 }} placeholder="1.2.3.4" />
                </label>
                <label style={styles.label}>
                  Domain contains
                  <input value={searchDomain} onChange={e => setSearchDomain(e.target.value)}
                    style={{ ...styles.input, width: 150 }} placeholder="example.com" />
                </label>
                <label style={{ ...styles.label, justifyContent: 'flex-end' }}>
                  &nbsp;
                  <button onClick={handleSearch} style={styles.btnPrimary} disabled={searching}>
                    {searching ? 'Searching…' : 'Search'}
                  </button>
                </label>
              </div>

              {domains.length > 0 && (
                <>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '.875rem', color: '#6b7280' }}>
                      {domains.length} domain{domains.length !== 1 ? 's' : ''} found
                    </span>
                    <button onClick={selectAll} style={styles.btnMini}>Select all</button>
                    <button onClick={selectNone} style={styles.btnMini}>None</button>
                    <span style={{ marginLeft: 'auto', fontSize: '.875rem', fontWeight: 600 }}>
                      {selectedIds.size} selected
                    </span>
                  </div>
                  <div style={styles.domainList}>
                    {domains.map(d => (
                      <label key={d.id} style={styles.domainRow}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggleDomain(d.id)}
                        />
                        <span style={{ fontWeight: 500 }}>{d.fqdn}</span>
                        <span style={{ color: '#6b7280', fontSize: '.8125rem' }}>{d.customer_name}</span>
                        <span style={styles.recordPill}>
                          {d.record_type} {d.record_name} {d.value}
                          {d.priority != null ? ` (${d.priority})` : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {searchResults.length === 0 && !searching && (
                <p style={styles.muted}>No matching records found.</p>
              )}

              {/* Operation selector */}
              {domains.length > 0 && (
                <>
                  <label style={styles.label}>
                    Operation
                    <select value={operation} onChange={e => setOperation(e.target.value as Operation)} style={styles.input}>
                      <option value="add">Add record</option>
                      <option value="replace">Replace matching record</option>
                      <option value="delete">Delete matching record</option>
                      <option value="change_ttl">Change TTL</option>
                    </select>
                  </label>

                  <PayloadForm
                    operation={operation}
                    matchType={searchType}
                    matchName={searchName}
                    matchValue={searchValue}
                    onChange={setPayload}
                  />
                </>
              )}

              <div style={styles.actions}>
                <button onClick={resetWizard} style={styles.btnSecondary}>Cancel</button>
                <button
                  onClick={handlePreview}
                  disabled={busy || selectedIds.size === 0}
                  style={styles.btnPrimary}
                >
                  {busy ? 'Computing preview…' : `Preview (${selectedIds.size} domain${selectedIds.size !== 1 ? 's' : ''})`}
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Preview ── */}
          {step === 'preview' && (
            <>
              {currentJob ? (
                <>
                  <div style={styles.summaryRow}>
                    <div style={styles.summaryBox}>
                      <div style={styles.summaryNum}>{previewData?.summary?.domains_affected ?? 0}</div>
                      <div style={styles.summaryLbl}>Domains</div>
                    </div>
                    <div style={styles.summaryBox}>
                      <div style={styles.summaryNum}>{previewData?.summary?.records_added ?? 0}</div>
                      <div style={styles.summaryLbl}>Records added</div>
                    </div>
                    <div style={styles.summaryBox}>
                      <div style={{ ...styles.summaryNum, color: previewData?.summary?.records_deleted > 0 ? '#dc2626' : '#111' }}>
                        {previewData?.summary?.records_deleted ?? 0}
                      </div>
                      <div style={styles.summaryLbl}>Records deleted</div>
                    </div>
                    <div style={styles.summaryBox}>
                      <div style={styles.summaryNum}>{previewData?.summary?.records_updated ?? 0}</div>
                      <div style={styles.summaryLbl}>TTL changes</div>
                    </div>
                  </div>

                  {/* Per-domain change list */}
                  {previewData?.per_domain?.length > 0 && (
                    <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={styles.th}>Domain</th>
                            <th style={styles.th}>Changes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.per_domain.map((pd: any) => (
                            <tr key={pd.domain_id} style={styles.tr}>
                              <td style={styles.td}>{pd.fqdn}</td>
                              <td style={styles.td}>
                                {pd.changes.map((ch: any, i: number) => (
                                  <span key={i} style={{
                                    ...styles.changePill,
                                    background: ch.op === 'add' ? '#dcfce7' : ch.op === 'delete' ? '#fee2e2' : '#dbeafe',
                                    color: ch.op === 'add' ? '#15803d' : ch.op === 'delete' ? '#b91c1c' : '#1e40af',
                                  }}>
                                    {ch.op}
                                    {ch.record?.type ? ` ${ch.record.type} ${ch.record.name ?? ''} ${ch.record.value ?? ''}` : ''}
                                  </span>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Per-domain execution status (if already running/done) */}
                  {(jobDomains as any[]).some(d => d.status !== 'pending') && (
                    <div style={{ maxHeight: 180, overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={styles.th}>Domain</th>
                            <th style={styles.th}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(jobDomains as any[]).map((d: any) => (
                            <tr key={d.id}>
                              <td style={styles.td}>{d.fqdn}</td>
                              <td style={styles.td}><StatusBadge status={d.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div style={styles.actions}>
                    <button onClick={resetWizard} style={styles.btnSecondary}>Cancel</button>
                    <button
                      onClick={handleApprove}
                      disabled={busy || currentJob.status !== 'approved'}
                      style={styles.btnPrimary}
                    >
                      {busy ? 'Approving…' : 'Approve & Execute'}
                    </button>
                  </div>
                </>
              ) : (
                <p style={styles.muted}>Loading preview…</p>
              )}
            </>
          )}

          {/* ── Step 3: Done ── */}
          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
              <p style={{ margin: 0, color: '#15803d', fontWeight: 600 }}>
                Bulk job approved — zones will be updated shortly.
              </p>
              <button onClick={resetWizard} style={styles.btnPrimary}>Done</button>
            </div>
          )}
        </div>
      )}

      {/* ── Jobs table ── */}
      {jobsLoading ? (
        <p style={styles.muted}>Loading…</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Operation</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Domains</th>
              <th style={styles.th}>Progress</th>
              <th style={styles.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {(jobs as BulkJob[]).map(j => (
              <tr key={j.id} style={styles.tr}>
                <td style={styles.td}>{j.id}</td>
                <td style={styles.td}><code>{j.operation}</code></td>
                <td style={styles.td}><StatusBadge status={j.status} /></td>
                <td style={styles.td}>{j.affected_domains ?? '—'}</td>
                <td style={styles.td}>
                  {j.affected_domains
                    ? `${j.processed_domains ?? 0} / ${j.affected_domains}`
                    : '—'}
                </td>
                <td style={styles.td}>{new Date(j.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {(jobs as BulkJob[]).length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>
                  No bulk jobs yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  h2:           { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  wizardCard:   { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 760 },
  wizardTitle:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  closeBtn:     { background: 'none', border: 'none', fontSize: '1rem', cursor: 'pointer', color: '#6b7280' },
  errorBox:     { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  label:        { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  hint:         { margin: 0, color: '#6b7280', fontSize: '.875rem' },
  input:        { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem' },
  actions:      { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', paddingTop: '.5rem' },
  btnPrimary:   { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  btnMini:      { padding: '.2rem .5rem', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer' },
  domainList:   { display: 'flex', flexDirection: 'column', gap: '.25rem', maxHeight: 300, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 4, padding: '.5rem' },
  domainRow:    { display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.375rem .5rem', borderRadius: 4, cursor: 'pointer', fontSize: '.875rem', userSelect: 'none' },
  recordPill:   { marginLeft: 'auto', background: '#f3f4f6', borderRadius: 4, padding: '2px 6px', fontSize: '.75rem', fontFamily: 'monospace' },
  summaryRow:   { display: 'flex', gap: '1rem' },
  summaryBox:   { flex: 1, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '.75rem', textAlign: 'center' as const },
  summaryNum:   { fontSize: '1.5rem', fontWeight: 700 },
  summaryLbl:   { fontSize: '.75rem', color: '#6b7280', marginTop: '.25rem' },
  changePill:   { display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: '.75rem', marginRight: '.25rem', fontFamily: 'monospace', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  table:        { width: '100%', borderCollapse: 'collapse' },
  th:           { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr:           { borderBottom: '1px solid #e5e7eb' },
  td:           { padding: '.625rem .75rem', fontSize: '.875rem' },
  muted:        { color: '#9ca3af', margin: 0 },
}
