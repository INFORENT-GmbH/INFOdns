import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBulkJob, previewBulkJob, approveBulkJob,
  getBulkJob, getBulkJobDomains,
  type BulkJob, type BulkJobDomain, type Domain,
} from '../../api/client'
import Select from '../Select'
import { useModalA11y } from '../../hooks/useModalA11y'
import { useI18n } from '../../i18n/I18nContext'
import { formatApiError } from '../../lib/formError'
import BulkPayloadForm, { type BulkOperation, type BulkPayloadResult, type BulkPayloadSeed } from './BulkPayloadForm'

interface Props {
  /** Full set of selected domain IDs (source of truth — persists across filter changes). */
  selectedIds: number[]
  /** Subset of selected domains currently in the loaded/filtered view (for audit display). */
  visibleSelected: Domain[]
  seed?: BulkPayloadSeed
  initialOperation?: BulkOperation
  onClose: () => void
  onApproved: () => void
}

type View = 'configure' | 'preview'

const LARGE_SELECTION_THRESHOLD = 1000

export default function BulkEditDrawer({
  selectedIds, visibleSelected, seed, initialOperation,
  onClose, onApproved,
}: Props) {
  const totalCount  = selectedIds.length
  const hiddenCount = Math.max(0, totalCount - visibleSelected.length)
  const { t } = useI18n()
  const qc = useQueryClient()
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  const [view, setView]                 = useState<View>('configure')
  const [operation, setOperation]       = useState<BulkOperation>(initialOperation ?? 'add')
  const [formResult, setFormResult]     = useState<BulkPayloadResult>({ payload: {}, valid: false })
  const [showDomainList, setShowDomainList] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<number | null>(null)
  const [busy, setBusy]                 = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const { data: currentJob } = useQuery<BulkJob>({
    queryKey: ['bulk-job', currentJobId],
    queryFn: () => getBulkJob(currentJobId!).then(r => r.data),
    enabled: currentJobId !== null && view === 'preview',
    refetchInterval: q => {
      const data = q.state.data as BulkJob | undefined
      return data && ['running', 'previewing'].includes(data.status) ? 2000 : false
    },
  })

  const { data: jobDomains = [] } = useQuery<BulkJobDomain[]>({
    queryKey: ['bulk-job-domains', currentJobId],
    queryFn: () => getBulkJobDomains(currentJobId!).then(r => r.data),
    enabled: currentJobId !== null && view === 'preview',
    refetchInterval: () => {
      const job = qc.getQueryData<BulkJob>(['bulk-job', currentJobId])
      return job && ['running', 'previewing'].includes(job.status) ? 2000 : false
    },
  })

  async function handlePreview() {
    if (!formResult.valid || totalCount === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await createBulkJob({
        operation,
        filter_json: { mode: 'explicit' as const, domain_ids: selectedIds },
        payload_json: formResult.payload,
      })
      const jobId = res.data.id
      setCurrentJobId(jobId)
      await previewBulkJob(jobId)
      qc.invalidateQueries({ queryKey: ['bulk-job', jobId] })
      qc.invalidateQueries({ queryKey: ['bulk-job-domains', jobId] })
      setView('preview')
    } catch (err) {
      setError(formatApiError(err))
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
      onApproved()
      onClose()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const previewData = currentJob?.preview_json
    ? (typeof currentJob.preview_json === 'string' ? JSON.parse(currentJob.preview_json) : currentJob.preview_json) as any
    : null

  const isLarge = totalCount > LARGE_SELECTION_THRESHOLD

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-drawer-title"
        tabIndex={-1}
        style={styles.drawer}
      >
        {/* Header */}
        <div style={styles.header}>
          <h2 id="bulk-drawer-title" style={styles.title}>
            {t('bulk_drawerTitle', totalCount)}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('cancel')} style={styles.closeBtn}>✕</button>
        </div>

        {isLarge && (
          <div style={styles.warning}>{t('bulk_largeWarning', totalCount)}</div>
        )}

        {/* Selected domains collapsible */}
        <div style={styles.selectedSection}>
          <button
            type="button"
            onClick={() => setShowDomainList(v => !v)}
            style={styles.selectedToggle}
            aria-expanded={showDomainList}
          >
            {showDomainList ? '▼' : '▶'} {showDomainList ? t('bulk_hideSelected') : t('bulk_showSelected')}
          </button>
          {showDomainList && (
            <div style={styles.selectedList}>
              {visibleSelected.map(d => (
                <div key={d.id} style={styles.selectedRow}>
                  <span style={styles.selectedFqdn}>{d.fqdn}</span>
                  {d.tenant_name && <span style={styles.selectedTenant}>{d.tenant_name}</span>}
                </div>
              ))}
              {hiddenCount > 0 && (
                <div style={{ ...styles.selectedRow, color: '#9ca3af', fontStyle: 'italic', borderBottom: 'none' }}>
                  + {hiddenCount} not in current filter
                </div>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={styles.body}>
          {error && <div style={styles.errorBox}>{error}</div>}

          {view === 'configure' && (
            <>
              <label style={styles.label}>
                <span style={styles.labelText}>{t('bulk_operation')}</span>
                <Select
                  value={operation}
                  onChange={v => setOperation(v as BulkOperation)}
                  style={{ width: '100%' }}
                  options={[
                    { value: 'add', label: t('bulk_opAdd') },
                    { value: 'replace', label: t('bulk_opReplace') },
                    { value: 'delete', label: t('bulk_opDelete') },
                    { value: 'change_ttl', label: t('bulk_opChangeTtl') },
                  ]}
                />
              </label>

              <BulkPayloadForm operation={operation} seed={seed} onChange={setFormResult} />
            </>
          )}

          {view === 'preview' && (
            <>
              {!currentJob || !previewData ? (
                <p style={styles.muted}>{t('bulk_loadingPreview')}</p>
              ) : (
                <>
                  <div style={styles.summaryRow}>
                    <SummaryBox label={t('bulk_domainsLabel')} value={previewData.summary?.domains_affected ?? 0} />
                    <SummaryBox label={t('bulk_recordsAdded')} value={previewData.summary?.records_added ?? 0} />
                    <SummaryBox label={t('bulk_recordsDeleted')} value={previewData.summary?.records_deleted ?? 0} warn />
                    <SummaryBox label={t('bulk_ttlChanges')} value={previewData.summary?.records_updated ?? 0} />
                  </div>

                  {previewData.per_domain?.length > 0 && (
                    <div style={styles.previewList}>
                      <table style={styles.previewTable}>
                        <thead>
                          <tr>
                            <th style={styles.th}>{t('domain')}</th>
                            <th style={styles.th}>{t('changes')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.per_domain.map((pd: any) => {
                            const jd = (jobDomains as BulkJobDomain[]).find(j => j.domain_id === pd.domain_id)
                            return (
                              <tr key={pd.domain_id}>
                                <td style={styles.td}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {jd && <StatusDot status={jd.status} />}
                                    <span style={{ fontWeight: 500 }}>{pd.fqdn}</span>
                                  </div>
                                </td>
                                <td style={styles.td}>
                                  {pd.changes.slice(0, 3).map((ch: any, i: number) => (
                                    <span key={i} style={{
                                      ...styles.changePill,
                                      background: ch.op === 'add' ? '#dcfce7' : ch.op === 'delete' ? '#fee2e2' : '#dbeafe',
                                      color: ch.op === 'add' ? '#15803d' : ch.op === 'delete' ? '#b91c1c' : '#1e40af',
                                    }}>
                                      {ch.op}{ch.record?.type ? ` ${ch.record.type}` : ''}
                                    </span>
                                  ))}
                                  {pd.changes.length > 3 && (
                                    <span style={styles.moreChanges}>+{pd.changes.length - 3}</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          {view === 'configure' && (
            <>
              <button type="button" onClick={onClose} style={styles.btnSecondary}>{t('cancel')}</button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={busy || !formResult.valid || totalCount === 0}
                style={styles.btnPrimary}
              >
                {busy ? t('bulk_computingPreview') : t('bulk_previewBtn')}
              </button>
            </>
          )}
          {view === 'preview' && (
            <>
              <button
                type="button"
                onClick={() => { setView('configure'); setError(null) }}
                disabled={busy}
                style={styles.btnSecondary}
              >
                {t('bulk_backToEdit')}
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={busy || !currentJob || currentJob.status !== 'approved'}
                style={styles.btnPrimary}
              >
                {busy ? t('bulk_approving') : t('bulk_approveExecute')}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function SummaryBox({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={styles.summaryBox}>
      <div style={{ ...styles.summaryNum, color: warn && value > 0 ? '#dc2626' : '#1e293b' }}>{value}</div>
      <div style={styles.summaryLbl}>{label}</div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#9ca3af',
    done:    '#16a34a',
    failed:  '#dc2626',
  }
  const c = colors[status] ?? '#9ca3af'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c }} title={status} />
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,.35)', zIndex: 60,
    animation: 'bulkDrawerFade 160ms ease-out',
  },
  drawer: {
    position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)',
    background: '#fff', borderLeft: '1px solid #e2e8f0',
    boxShadow: '-8px 0 24px rgba(15,23,42,.1)',
    display: 'flex', flexDirection: 'column', zIndex: 61,
    animation: 'bulkDrawerSlide 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '.875rem 1rem', borderBottom: '1px solid #e2e8f0', flexShrink: 0,
  },
  title:   { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  closeBtn:{ background: 'none', border: 'none', fontSize: '1.125rem', cursor: 'pointer', color: '#64748b', padding: '.25rem .5rem' },
  warning: { background: '#fef3c7', color: '#92400e', padding: '.5rem 1rem', fontSize: '.8125rem', borderBottom: '1px solid #fde68a', flexShrink: 0 },
  selectedSection: { padding: '.5rem 1rem', borderBottom: '1px solid #f1f5f9', flexShrink: 0 },
  selectedToggle: { background: 'none', border: 'none', padding: 0, color: '#475569', fontSize: '.75rem', cursor: 'pointer', fontWeight: 500 },
  selectedList: { marginTop: '.5rem', maxHeight: 140, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 4 },
  selectedRow: { display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.25rem .5rem', fontSize: '.75rem', borderBottom: '1px solid #f3f4f6' },
  selectedFqdn: { fontWeight: 500, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  selectedTenant: { color: '#9ca3af', marginLeft: 'auto', fontSize: '.6875rem' },
  body: { flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.875rem' },
  errorBox: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8125rem' },
  labelText: { fontWeight: 500, color: '#374151' },
  muted: { color: '#94a3b8', margin: 0, fontSize: '.875rem' },
  summaryRow: { display: 'flex', gap: '.5rem' },
  summaryBox: { flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.5rem', textAlign: 'center' },
  summaryNum: { fontSize: '1.25rem', fontWeight: 700 },
  summaryLbl: { fontSize: '.6875rem', color: '#64748b', marginTop: '.25rem' },
  previewList: { border: '1px solid #e2e8f0', borderRadius: 4, maxHeight: 320, overflow: 'auto' },
  previewTable: { width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' },
  th: { textAlign: 'left', padding: '.4rem .5rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em' },
  td: { padding: '.375rem .5rem', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
  changePill: { display: 'inline-block', padding: '1px 5px', borderRadius: 3, fontSize: '.6875rem', marginRight: 4, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  moreChanges: { fontSize: '.6875rem', color: '#9ca3af', fontStyle: 'italic' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '.5rem',
    padding: '.75rem 1rem', borderTop: '1px solid #e2e8f0', flexShrink: 0, background: '#fafafa',
  },
  btnPrimary:   { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer', color: '#374151' },
}
