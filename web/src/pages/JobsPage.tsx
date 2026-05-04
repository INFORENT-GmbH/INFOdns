import React, { useMemo, useState, useEffect, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  getBulkJobs, createBulkJob, previewBulkJob, approveBulkJob,
  getBulkJob, getBulkJobDomains, searchByRecord, getZoneRenderQueue,
  type BulkJob, type BulkJobDomain, type ZoneRenderJob,
} from '../api/client'
import { useI18n } from '../i18n/I18nContext'
import Select from '../components/Select'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import { useAuth } from '../context/AuthContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

const JOB_STATUS_OPTIONS = ['draft', 'previewing', 'approved', 'running', 'done', 'failed']
const RENDER_STATUS_OPTIONS = ['pending', 'processing', 'done', 'failed']
const JOB_FILTER_DEFAULTS = { status: '' }
const RENDER_FILTER_DEFAULTS = { status: '' }

// ── Types ─────────────────────────────────────────────────────

interface SearchResult {
  id: number
  fqdn: string
  tenant_id: number
  tenant_name: string
  record_id: number
  record_name: string
  record_type: string
  ttl: number
  priority: number | null
  value: string
}

type Operation = 'add' | 'replace' | 'delete' | 'change_ttl'
type Step = 'search' | 'preview' | 'done'

// ── Status badge ──────────────────────────────────────────────

const statusColors: Record<string, { bg: string; text: string }> = {
  draft:      { bg: '#f3f4f6', text: '#374151' },
  previewing: { bg: '#fef9c3', text: '#854d0e' },
  approved:   { bg: '#dbeafe', text: '#1e40af' },
  running:    { bg: '#ede9fe', text: '#6d28d9' },
  done:       { bg: '#dcfce7', text: '#15803d' },
  failed:     { bg: '#fee2e2', text: '#b91c1c' },
  pending:    { bg: '#f3f4f6', text: '#374151' },
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
  const { t } = useI18n()
  const [newName, setNewName]         = useState(matchName)
  const [newType, setNewType]         = useState(matchType)
  const [newValue, setNewValue]       = useState('')
  const [newTtl, setNewTtl]           = useState('3600')
  const [newPriority, setNewPriority] = useState('')
  const [filterName, setFilterName]   = useState(matchName)

  const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']

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

  const showMatchFilter = operation === 'replace' || operation === 'delete' || operation === 'change_ttl'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      {showMatchFilter && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, padding: '.5rem .75rem', fontSize: '.8125rem' }}>
          <strong>{t('bulk_matching')}</strong> {matchType} {t('bulk_records')}
          {matchValue && <> {t('bulk_withValueContaining')} <code style={{ background: '#e5e7eb', padding: '1px 4px', borderRadius: 2 }}>{matchValue}</code></>}
          {' '}{t('bulk_whereName')}
          <input
            value={filterName}
            onChange={e => { setFilterName(e.target.value); emit({ _filterName: e.target.value }) }}
            style={{ marginLeft: '.4rem', padding: '1px 6px', border: '1px solid #d1d5db', borderRadius: 3, fontSize: '.8125rem', width: 80 }}
            placeholder={t('bulk_anyName')}
          />
          <span style={{ color: '#9ca3af', marginLeft: '.4rem' }}>{t('bulk_leaveBlank')}</span>
        </div>
      )}

      {operation === 'change_ttl' && (
        <label style={styles.label}>
          {t('bulk_newTtlSeconds')}
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
            {t('name')}
            <input value={newName}
              onChange={e => { setNewName(e.target.value); emit({ name: e.target.value }) }}
              style={styles.input} placeholder={t('bulk_namePh')} />
          </label>
          <label style={styles.label}>
            {t('type')}
            <Select
              value={newType}
              onChange={v => { setNewType(v); emit({ type: v }) }}
              style={styles.input}
              options={RECORD_TYPES.map(rt => ({ value: rt, label: rt }))}
            />
          </label>
          <label style={styles.label}>
            {t('value')}
            <input value={newValue}
              onChange={e => { setNewValue(e.target.value); emit({ value: e.target.value }) }}
              style={styles.input} placeholder={t('bulk_valuePh')} />
          </label>
          <label style={styles.label}>
            {t('bulk_ttlSeconds')}
            <input type="number" value={newTtl}
              onChange={e => { setNewTtl(e.target.value); emit({ ttl: Number(e.target.value) }) }}
              style={styles.input} />
          </label>
          {(newType === 'MX' || newType === 'SRV') && (
            <label style={styles.label}>
              {t('priority')}
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

// ── Job detail panel ──────────────────────────────────────────

function JobDetail({ job }: { job: BulkJob }) {
  const { t } = useI18n()
  const [expandedDomain, setExpandedDomain] = useState<number | null>(null)

  const { data: domains = [] } = useQuery<BulkJobDomain[]>({
    queryKey: ['bulk-job-domains', job.id],
    queryFn: () => getBulkJobDomains(job.id).then(r => r.data),
    refetchInterval: ['running', 'previewing'].includes(job.status) ? 2000 : false,
  })

  const preview = job.preview_json
    ? (typeof job.preview_json === 'string' ? JSON.parse(job.preview_json) : job.preview_json) as any
    : null

  return (
    <div style={styles.detailPanel}>
      {preview?.summary && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={styles.detailLabel}>{t('jobs_previewSummary')}</div>
          <div style={styles.detailSummaryRow}>
            <div style={styles.detailSummaryBox}>
              <div style={styles.detailSummaryNum}>{preview.summary.domains_affected ?? 0}</div>
              <div style={styles.detailSummaryLbl}>{t('bulk_domainsLabel')}</div>
            </div>
            <div style={styles.detailSummaryBox}>
              <div style={styles.detailSummaryNum}>{preview.summary.records_added ?? 0}</div>
              <div style={styles.detailSummaryLbl}>{t('jobs_recordsAdded')}</div>
            </div>
            <div style={styles.detailSummaryBox}>
              <div style={{ ...styles.detailSummaryNum, color: (preview.summary.records_deleted ?? 0) > 0 ? '#dc2626' : '#111' }}>
                {preview.summary.records_deleted ?? 0}
              </div>
              <div style={styles.detailSummaryLbl}>{t('jobs_recordsDeleted')}</div>
            </div>
            <div style={styles.detailSummaryBox}>
              <div style={styles.detailSummaryNum}>{preview.summary.records_updated ?? 0}</div>
              <div style={styles.detailSummaryLbl}>{t('jobs_ttlChanges')}</div>
            </div>
          </div>
        </div>
      )}

      {(domains as BulkJobDomain[]).length > 0 && (
        <div>
          <div style={styles.detailLabel}>{t('jobs_perDomainStatus')}</div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 4, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={styles.th}>{t('domain')}</th>
                  <th style={styles.th}>{t('jobs_status')}</th>
                  <th style={styles.th}>{t('jobs_changes')}</th>
                  <th style={styles.th}>{t('jobs_error')}</th>
                </tr>
              </thead>
              <tbody>
                {(domains as BulkJobDomain[]).map(d => {
                  const pd = preview?.per_domain?.find((p: any) => p.domain_id === d.domain_id)
                  const isExpanded = expandedDomain === d.domain_id
                  const hasChanges = pd && pd.changes.length > 0
                  return (
                    <Fragment key={d.id}>
                      <tr style={styles.tr}>
                        <td style={styles.td}>{d.fqdn}</td>
                        <td style={styles.td}><StatusBadge status={d.status} /></td>
                        <td style={styles.td}>
                          {hasChanges ? (
                            <button
                              type="button"
                              onClick={() => setExpandedDomain(isExpanded ? null : d.domain_id)}
                              style={{ background: 'none', border: 'none', padding: 0, color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', textDecoration: 'underline dotted' }}
                              title={isExpanded ? 'Hide details' : 'Show details'}
                            >
                              {isExpanded ? '▼' : '▶'} {pd.changes.length}
                            </button>
                          ) : '—'}
                        </td>
                        <td style={styles.td}>
                          {d.error
                            ? <span style={{ color: '#b91c1c', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: '.75rem' }}>{d.error}</span>
                            : <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                      </tr>
                      {isExpanded && hasChanges && (
                        <tr>
                          <td colSpan={4} style={{ ...styles.td, background: '#f8fafc', padding: '.5rem .75rem' }}>
                            <table style={{ width: '100%', fontSize: '.75rem', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                              <tbody>
                                {pd.changes.slice(0, 20).map((c: any, i: number) => (
                                  <tr key={i}>
                                    <td style={{ padding: '.125rem .5rem', color: c.op === 'delete' ? '#b91c1c' : c.op === 'add' ? '#15803d' : '#92400e', width: '5rem', textTransform: 'uppercase', fontSize: '.7rem', fontWeight: 600 }}>{c.op}</td>
                                    <td style={{ padding: '.125rem .5rem', color: '#374151' }}>{JSON.stringify(c.record)}</td>
                                  </tr>
                                ))}
                                {pd.changes.length > 20 && (
                                  <tr><td colSpan={2} style={{ padding: '.25rem .5rem', color: '#6b7280', fontStyle: 'italic' }}>… and {pd.changes.length - 20} more</td></tr>
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {job.error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", marginTop: '.5rem' }}>
          {job.error}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function JobsPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const isStaff = user?.role === 'admin' || user?.role === 'operator'
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [expanded, setExpanded]     = useState<number | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [step, setStep]             = useState<Step>('search')

  const {
    filters: jobFilters, setFilter: setJobFilter,
    persist: jobsPersist, setPersist: setJobsPersist,
    clear: clearJobFilters, hasActive: jobFiltersActive,
  } = usePersistedFilters('jobs', JOB_FILTER_DEFAULTS)
  const {
    filters: renderFilters, setFilter: setRenderFilter,
    persist: renderPersist, setPersist: setRenderPersist,
    clear: clearRenderFilters, hasActive: renderFiltersActive,
  } = usePersistedFilters('render-queue', RENDER_FILTER_DEFAULTS)

  // Search state — seed from URL params when navigated from DomainDetailPage
  const [searchType, setSearchType]   = useState(searchParams.get('type') || 'A')
  const [searchName, setSearchName]   = useState(searchParams.get('name') || '')
  const [searchValue, setSearchValue] = useState(searchParams.get('value') || '')
  const [searchDomain, setSearchDomain] = useState('')

  // Auto-open wizard if URL params were provided
  useEffect(() => {
    if (searchParams.get('type')) {
      setShowWizard(true)
      setSearchParams({}, { replace: true })  // clean URL without triggering re-render loop
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Selection + operation state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [operation, setOperation]     = useState<Operation>('add')
  const [payload, setPayload]         = useState<Record<string, unknown>>({})

  // Job wizard state
  const [currentJobId, setCurrentJobId] = useState<number | null>(null)
  const [busy, setBusy]                 = useState(false)
  const [wizardError, setWizardError]   = useState<string | null>(null)

  const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']

  // ── Queries ──────────────────────────────────────────────────

  const { data: jobs = [], isLoading } = useQuery<BulkJob[]>({
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
    enabled: showWizard,
  })

  const { data: currentJob } = useQuery({
    queryKey: ['bulk-job', currentJobId],
    queryFn: () => getBulkJob(currentJobId!).then(r => r.data),
    enabled: currentJobId !== null && step === 'preview',
    refetchInterval: currentJobId !== null && step === 'preview' ? 2000 : false,
  })

  const { data: jobDomains = [] } = useQuery({
    queryKey: ['bulk-job-domains', currentJobId],
    queryFn: () => getBulkJobDomains(currentJobId!).then(r => r.data),
    enabled: currentJobId !== null && step === 'preview',
  })

  const { data: renderQueue = [] } = useQuery<ZoneRenderJob[]>({
    queryKey: ['zone-render-queue'],
    queryFn: getZoneRenderQueue,
    refetchInterval: 2000,
    enabled: isStaff,
  })

  // ── Derived state ────────────────────────────────────────────

  const domainMap = new Map<number, SearchResult>()
  for (const r of searchResults) {
    if (!domainMap.has(r.id)) domainMap.set(r.id, r)
  }
  const domains = Array.from(domainMap.values()).filter(d =>
    !searchDomain || d.fqdn.includes(searchDomain.toLowerCase())
  )

  const activeJobs = (jobs as BulkJob[]).filter(j => j.status === 'running' || j.status === 'previewing')
  const filteredJobs = useMemo(() => {
    if (!jobFilters.status) return jobs as BulkJob[]
    return (jobs as BulkJob[]).filter(j => j.status === jobFilters.status)
  }, [jobs, jobFilters.status])
  const filteredRenderQueue = useMemo(() => {
    if (!renderFilters.status) return renderQueue as ZoneRenderJob[]
    return (renderQueue as ZoneRenderJob[]).filter(j => j.status === renderFilters.status)
  }, [renderQueue, renderFilters.status])
  const renderActive = (renderQueue as ZoneRenderJob[]).filter(j => j.status === 'pending' || j.status === 'processing')

  const jobStatusBtnLabel = jobFilters.status || t('jobs_allStatuses')
  const renderStatusBtnLabel = renderFilters.status || t('jobs_allStatuses')

  // ── Handlers ─────────────────────────────────────────────────

  function toggleDomain(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handlePreview() {
    if (selectedIds.size === 0) { setWizardError(t('bulk_selectOneDomain')); return }
    setBusy(true)
    setWizardError(null)
    try {
      const res = await createBulkJob({
        operation,
        filter_json: { mode: 'explicit' as const, domain_ids: Array.from(selectedIds) },
        payload_json: payload,
      })
      const jobId = res.data.id
      setCurrentJobId(jobId)
      await previewBulkJob(jobId)
      qc.invalidateQueries({ queryKey: ['bulk-job', jobId] })
      qc.invalidateQueries({ queryKey: ['bulk-job-domains', jobId] })
      setStep('preview')
    } catch (err: any) {
      setWizardError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleApprove() {
    if (!currentJobId) return
    setBusy(true)
    setWizardError(null)
    try {
      await approveBulkJob(currentJobId)
      qc.invalidateQueries({ queryKey: ['bulk-jobs'] })
      setStep('done')
    } catch (err: any) {
      setWizardError(formatApiError(err))
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
    setWizardError(null)
  }

  // ── Render ────────────────────────────────────────────────────

  const previewData = currentJob?.preview_json
    ? (typeof currentJob.preview_json === 'string' ? JSON.parse(currentJob.preview_json) : currentJob.preview_json)
    : null

  return (
    <div>
      <div style={s.pageBar}>
        <h2 style={s.pageTitle}>{t('jobs_title')}</h2>
      </div>

      {/* ── Wizard ── */}
      {showWizard && (
        <div style={styles.wizardCard}>
          <div style={styles.wizardTitle}>
            <span style={{ fontWeight: 700 }}>
              {step === 'search'  && t('bulk_findDomains')}
              {step === 'preview' && t('bulk_previewChanges')}
              {step === 'done'    && t('bulk_done')}
            </span>
            <button onClick={resetWizard} style={styles.closeBtn}>✕</button>
          </div>

          {wizardError && <div style={styles.errorBox}>{wizardError}</div>}

          {/* Step 1: Search + select + configure */}
          {step === 'search' && (
            <>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <label style={styles.label}>
                  {t('type')}
                  <Select
                    value={searchType}
                    onChange={v => { setSearchType(v); setSelectedIds(new Set()) }}
                    style={{ ...styles.input, width: 100 }}
                    options={RECORD_TYPES.map(rt => ({ value: rt, label: rt }))}
                  />
                </label>
                <label style={styles.label}>
                  {t('bulk_recordName')}
                  <input value={searchName} onChange={e => setSearchName(e.target.value)}
                    style={{ ...styles.input, width: 120 }} placeholder={t('bulk_recordNamePh')} />
                </label>
                <label style={styles.label}>
                  {t('bulk_recordValueContains')}
                  <input value={searchValue} onChange={e => setSearchValue(e.target.value)}
                    style={{ ...styles.input, width: 160 }} placeholder="1.2.3.4" />
                </label>
                <label style={styles.label}>
                  {t('bulk_domainContains')}
                  <input value={searchDomain} onChange={e => setSearchDomain(e.target.value)}
                    style={{ ...styles.input, width: 150 }} placeholder={t('bulk_domainContainsPh')} />
                </label>
              </div>

              {searching && <p style={styles.muted}>{t('bulk_searching')}</p>}

              {domains.length > 0 && (
                <>
                  <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '.875rem', color: '#6b7280' }}>
                      {domains.length} {t('bulk_domainsFound')}
                    </span>
                    <button onClick={() => setSelectedIds(new Set(domains.map(d => d.id)))} style={styles.btnMini}>{t('bulk_selectAll')}</button>
                    <button onClick={() => setSelectedIds(new Set())} style={styles.btnMini}>{t('bulk_selectNone')}</button>
                    <span style={{ marginLeft: 'auto', fontSize: '.875rem', fontWeight: 600 }}>
                      {selectedIds.size} {t('bulk_selected')}
                    </span>
                  </div>
                  <div style={styles.domainList}>
                    {domains.map(d => (
                      <label key={d.id} style={styles.domainRow}>
                        <input type="checkbox" checked={selectedIds.has(d.id)} onChange={() => toggleDomain(d.id)} />
                        <span style={{ fontWeight: 500 }}>{d.fqdn}</span>
                        <span style={{ color: '#6b7280', fontSize: '.8125rem' }}>{d.tenant_name}</span>
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
                <p style={styles.muted}>{t('bulk_noMatchingRecords')}</p>
              )}

              {domains.length > 0 && (
                <>
                  <label style={styles.label}>
                    {t('bulk_operation')}
                    <Select
                      value={operation}
                      onChange={v => setOperation(v as Operation)}
                      style={styles.input}
                      options={[
                        { value: 'add', label: t('bulk_opAdd') },
                        { value: 'replace', label: t('bulk_opReplace') },
                        { value: 'delete', label: t('bulk_opDelete') },
                        { value: 'change_ttl', label: t('bulk_opChangeTtl') },
                      ]}
                    />
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
                <button onClick={resetWizard} style={styles.btnSecondary}>{t('cancel')}</button>
                <button
                  onClick={handlePreview}
                  disabled={busy || selectedIds.size === 0}
                  style={styles.btnPrimary}
                >
                  {busy ? t('bulk_computingPreview') : `${t('bulk_previewBtn')} (${selectedIds.size} ${t('bulk_domainsFound')})`}
                </button>
              </div>
            </>
          )}

          {/* Step 2: Preview + approve */}
          {step === 'preview' && (
            <>
              {currentJob ? (
                <>
                  <div style={styles.summaryRow}>
                    <div style={styles.summaryBox}>
                      <div style={styles.summaryNum}>{previewData?.summary?.domains_affected ?? 0}</div>
                      <div style={styles.summaryLbl}>{t('bulk_domainsLabel')}</div>
                    </div>
                    <div style={styles.summaryBox}>
                      <div style={styles.summaryNum}>{previewData?.summary?.records_added ?? 0}</div>
                      <div style={styles.summaryLbl}>{t('bulk_recordsAdded')}</div>
                    </div>
                    <div style={styles.summaryBox}>
                      <div style={{ ...styles.summaryNum, color: previewData?.summary?.records_deleted > 0 ? '#dc2626' : '#111' }}>
                        {previewData?.summary?.records_deleted ?? 0}
                      </div>
                      <div style={styles.summaryLbl}>{t('bulk_recordsDeleted')}</div>
                    </div>
                    <div style={styles.summaryBox}>
                      <div style={styles.summaryNum}>{previewData?.summary?.records_updated ?? 0}</div>
                      <div style={styles.summaryLbl}>{t('bulk_ttlChanges')}</div>
                    </div>
                  </div>

                  {previewData?.per_domain?.length > 0 && (
                    <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={styles.th}>{t('domain')}</th>
                            <th style={styles.th}>{t('changes')}</th>
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

                  {(jobDomains as any[]).some(d => d.status !== 'pending') && (
                    <div style={{ maxHeight: 180, overflow: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={styles.th}>{t('domain')}</th>
                            <th style={styles.th}>{t('status')}</th>
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
                    <button onClick={resetWizard} style={styles.btnSecondary}>{t('cancel')}</button>
                    <button
                      onClick={handleApprove}
                      disabled={busy || currentJob.status !== 'approved'}
                      style={styles.btnPrimary}
                    >
                      {busy ? t('bulk_approving') : t('bulk_approveExecute')}
                    </button>
                  </div>
                </>
              ) : (
                <p style={styles.muted}>{t('bulk_loadingPreview')}</p>
              )}
            </>
          )}

          {/* Step 3: Done */}
          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
              <p style={{ margin: 0, color: '#15803d', fontWeight: 600 }}>{t('bulk_jobApproved')}</p>
              <button onClick={resetWizard} style={styles.btnPrimary}>{t('bulk_done')}</button>
            </div>
          )}
        </div>
      )}

      {/* ── Jobs table ── */}
      <div style={s.panel}>
        <FilterBar>
          <span style={styles.countPill}>
            {jobFiltersActive
              ? t('jobs_filteredCount', filteredJobs.length, (jobs as BulkJob[]).length)
              : `${(jobs as BulkJob[]).length} ${t('jobs_count')}`}
          </span>
          {activeJobs.length > 0 && (
            <span style={styles.activeBadge}>{activeJobs.length} {t('jobs_active')}</span>
          )}
        </FilterBar>

        <FilterBar>
          <Dropdown
            label={
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: jobFilters.status ? '#111827' : '#9ca3af' }}>
                {jobStatusBtnLabel}
              </span>
            }
            active={!!jobFilters.status}
            onClear={() => setJobFilter('status', '')}
            width={160}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setJobFilter('status', ''); close() }}>
                  <span style={{ color: '#6b7280' }}>{t('jobs_allStatuses')}</span>
                </DropdownItem>
                {JOB_STATUS_OPTIONS.map(opt => (
                  <DropdownItem key={opt} onSelect={() => { setJobFilter('status', opt); close() }}>
                    {opt}
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>

          <FilterPersistControls
            persist={jobsPersist}
            setPersist={setJobsPersist}
            onClear={clearJobFilters}
            hasActive={jobFiltersActive}
            style={{ marginLeft: 'auto' }}
          />

          <button onClick={() => setShowWizard(true)} style={s.actionBtn}>{t('bulk_newJob')}</button>
        </FilterBar>

        <div style={s.tableWrap}>
          {isLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={s.th}>{t('jobs_id')}</th>
                  <th style={s.th}>{t('jobs_operation')}</th>
                  <th style={s.th}>{t('jobs_status')}</th>
                  <th style={s.th}>{t('jobs_domains')}</th>
                  <th style={s.th}>{t('jobs_progress')}</th>
                  <th style={s.th}>{t('jobs_created')}</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map(job => (
                  <React.Fragment key={job.id}>
                    <tr>
                      <td style={styles.tdMono}>{job.id}</td>
                      <td style={s.td}><code style={styles.code}>{job.operation}</code></td>
                      <td style={s.td}><StatusBadge status={job.status} /></td>
                      <td style={s.td}>{job.affected_domains ?? '—'}</td>
                      <td style={s.td}>
                        {job.affected_domains ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                            <div style={styles.progressTrack}>
                              <div
                                style={{
                                  ...styles.progressBar,
                                  width: `${Math.round(((job.processed_domains ?? 0) / job.affected_domains) * 100)}%`,
                                  background: job.status === 'failed' ? '#dc2626' : '#2563eb',
                                }}
                              />
                            </div>
                            <span style={{ fontSize: '.8125rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                              {job.processed_domains ?? 0} / {job.affected_domains}
                            </span>
                          </div>
                        ) : '—'}
                      </td>
                      <td style={styles.tdMono}>{new Date(job.created_at).toLocaleString()}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>
                        <button
                          onClick={() => setExpanded(expanded === job.id ? null : job.id)}
                          style={styles.detailBtn}
                        >
                          {expanded === job.id ? t('jobs_hide') : t('jobs_detail')}
                        </button>
                      </td>
                    </tr>
                    {expanded === job.id && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid #e5e7eb' }}>
                          <JobDetail job={job} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {filteredJobs.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#9ca3af' }}>
                      {t('jobs_noJobs')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Zone Render Queue ── */}
      {isStaff && (
        <>
          <div style={{ ...s.pageBar, marginTop: '1.5rem' }}>
            <h3 style={s.pageTitle}>{t('jobs_renderQueue')}</h3>
          </div>
          <div style={s.panel}>
            <FilterBar>
              <span style={styles.countPill}>
                {renderFiltersActive
                  ? t('jobs_filteredCount', filteredRenderQueue.length, (renderQueue as ZoneRenderJob[]).length)
                  : `${(renderQueue as ZoneRenderJob[]).length} ${t('jobs_count')}`}
              </span>
              {renderActive.length > 0 && (
                <span style={styles.activeBadge}>{renderActive.length} {t('jobs_active')}</span>
              )}
            </FilterBar>

            <FilterBar>
              <Dropdown
                label={
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: renderFilters.status ? '#111827' : '#9ca3af' }}>
                    {renderStatusBtnLabel}
                  </span>
                }
                active={!!renderFilters.status}
                onClear={() => setRenderFilter('status', '')}
                width={160}
              >
                {close => (
                  <>
                    <DropdownItem onSelect={() => { setRenderFilter('status', ''); close() }}>
                      <span style={{ color: '#6b7280' }}>{t('jobs_allStatuses')}</span>
                    </DropdownItem>
                    {RENDER_STATUS_OPTIONS.map(opt => (
                      <DropdownItem key={opt} onSelect={() => { setRenderFilter('status', opt); close() }}>
                        {opt}
                      </DropdownItem>
                    ))}
                  </>
                )}
              </Dropdown>

              <FilterPersistControls
                persist={renderPersist}
                setPersist={setRenderPersist}
                onClear={clearRenderFilters}
                hasActive={renderFiltersActive}
                style={{ marginLeft: 'auto' }}
              />
            </FilterBar>

            <div style={s.tableWrap}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>{t('jobs_id')}</th>
                    <th style={s.th}>{t('domain')}</th>
                    <th style={s.th}>{t('tenant')}</th>
                    <th style={s.th}>{t('jobs_status')}</th>
                    <th style={s.th}>{t('priority')}</th>
                    <th style={s.th}>{t('jobs_retries')}</th>
                    <th style={s.th}>{t('jobs_updated')}</th>
                    <th style={s.th}>{t('jobs_error')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRenderQueue.map(job => (
                    <tr key={job.id}>
                      <td style={styles.tdMono}>{job.id}</td>
                      <td style={styles.tdMono}>{job.domain_name}</td>
                      <td style={s.td}>{job.tenant_name}</td>
                      <td style={s.td}><StatusBadge status={job.status} /></td>
                      <td style={s.td}>{job.priority}</td>
                      <td style={s.td}>{job.retries}/{job.max_retries}</td>
                      <td style={styles.tdMono}>{new Date(job.updated_at).toLocaleString()}</td>
                      <td style={{ ...s.td, color: '#b91c1c', fontSize: '.8125rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.error ?? ''}
                      </td>
                    </tr>
                  ))}
                  {filteredRenderQueue.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#9ca3af' }}>
                        {t('jobs_renderQueueEmpty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  countPill:    { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  activeBadge:  { background: '#ede9fe', color: '#6d28d9', padding: '1px 7px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 },
  muted:        { color: '#94a3b8', margin: 0 },
  wizardCard:   { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1.25rem', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 760 },
  wizardTitle:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  closeBtn:     { background: 'none', border: 'none', fontSize: '1rem', cursor: 'pointer', color: '#64748b' },
  errorBox:     { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  label:        { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input:        { padding: '.375rem .75rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.875rem' },
  actions:      { display: 'flex', gap: '.5rem', justifyContent: 'flex-end', paddingTop: '.5rem' },
  btnPrimary:   { padding: '.3125rem .75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  btnSecondary: { padding: '.3125rem .75rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer', color: '#374151' },
  btnMini:      { padding: '.2rem .5rem', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.75rem', cursor: 'pointer' },
  domainList:   { display: 'flex', flexDirection: 'column', gap: '.25rem', maxHeight: 300, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 4, padding: '.5rem' },
  domainRow:    { display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.375rem .5rem', borderRadius: 4, cursor: 'pointer', fontSize: '.875rem', userSelect: 'none' },
  recordPill:   { marginLeft: 'auto', background: '#f1f5f9', borderRadius: 4, padding: '2px 6px', fontSize: '.75rem', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  summaryRow:   { display: 'flex', gap: '1rem' },
  summaryBox:   { flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem', textAlign: 'center' as const },
  summaryNum:   { fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' },
  summaryLbl:   { fontSize: '.75rem', color: '#64748b', marginTop: '.25rem' },
  changePill:   { display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: '.75rem', marginRight: '.25rem', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  table:        { width: '100%', borderCollapse: 'collapse' },
  th:           { textAlign: 'left', padding: '.5rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '.04em' },
  tr:           { borderBottom: '1px solid #f1f5f9' },
  td:           { padding: '.4375rem .75rem', fontSize: '.8125rem', verticalAlign: 'middle', color: '#1e293b' },
  tdMono:       { padding: '.4375rem .75rem', fontSize: '.8125rem', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", verticalAlign: 'middle', color: '#1e293b' },
  code:         { background: '#f1f5f9', padding: '1px 5px', borderRadius: 3, fontSize: '.8125rem' },
  detailBtn:    { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: 0, textDecoration: 'underline' },
  progressTrack:{ height: 6, background: '#e2e8f0', borderRadius: 3, width: 80, overflow: 'hidden' },
  progressBar:  { height: '100%', borderRadius: 3, transition: 'width .3s' },
  detailPanel:  { padding: '1rem 1.25rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0' },
  detailLabel:  { fontSize: '.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em', marginBottom: '.5rem' },
  detailSummaryRow: { display: 'flex', gap: '.75rem', flexWrap: 'wrap' as const },
  detailSummaryBox: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.625rem 1rem', textAlign: 'center' as const, minWidth: 90 },
  detailSummaryNum: { fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' },
  detailSummaryLbl: { fontSize: '.7rem', color: '#64748b', marginTop: '.2rem' },
}
