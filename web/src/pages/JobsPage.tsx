import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBulkJobs, getBulkJobDomains, type BulkJob, type BulkJobDomain } from '../api/client'
import { useI18n } from '../i18n/I18nContext'

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

// ── Job detail panel ──────────────────────────────────────────

function JobDetail({ job }: { job: BulkJob }) {
  const { t } = useI18n()

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
      {/* Preview summary boxes */}
      {preview?.summary && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={styles.sectionLabel}>{t('jobs_previewSummary')}</div>
          <div style={styles.summaryRow}>
            <div style={styles.summaryBox}>
              <div style={styles.summaryNum}>{preview.summary.domains_affected ?? 0}</div>
              <div style={styles.summaryLbl}>{t('jobs_domains')}</div>
            </div>
            <div style={styles.summaryBox}>
              <div style={styles.summaryNum}>{preview.summary.records_added ?? 0}</div>
              <div style={styles.summaryLbl}>{t('jobs_recordsAdded')}</div>
            </div>
            <div style={styles.summaryBox}>
              <div style={{ ...styles.summaryNum, color: (preview.summary.records_deleted ?? 0) > 0 ? '#dc2626' : '#111' }}>
                {preview.summary.records_deleted ?? 0}
              </div>
              <div style={styles.summaryLbl}>{t('jobs_recordsDeleted')}</div>
            </div>
            <div style={styles.summaryBox}>
              <div style={styles.summaryNum}>{preview.summary.records_updated ?? 0}</div>
              <div style={styles.summaryLbl}>{t('jobs_ttlChanges')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Per-domain status */}
      {domains.length > 0 && (
        <div>
          <div style={styles.sectionLabel}>{t('jobs_perDomainStatus')}</div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={styles.th}>Domain</th>
                  <th style={styles.th}>{t('jobs_status')}</th>
                  <th style={styles.th}>{t('jobs_changes')}</th>
                  <th style={styles.th}>{t('jobs_error')}</th>
                </tr>
              </thead>
              <tbody>
                {(domains as BulkJobDomain[]).map(d => {
                  // find per-domain preview changes
                  const pd = preview?.per_domain?.find((p: any) => p.domain_id === d.domain_id)
                  return (
                    <tr key={d.id} style={styles.tr}>
                      <td style={styles.td}>{d.fqdn}</td>
                      <td style={styles.td}><StatusBadge status={d.status} /></td>
                      <td style={styles.td}>
                        {pd ? (
                          <span style={{ color: '#6b7280' }}>
                            {pd.changes.length} change{pd.changes.length !== 1 ? 's' : ''}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={styles.td}>
                        {d.error
                          ? <span style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: '.75rem' }}>{d.error}</span>
                          : <span style={{ color: '#9ca3af' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Job-level error */}
      {job.error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.8125rem', fontFamily: 'monospace', marginTop: '.5rem' }}>
          {job.error}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function JobsPage() {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const { data: jobs = [], isLoading } = useQuery<BulkJob[]>({
    queryKey: ['bulk-jobs'],
    queryFn: () => getBulkJobs().then(r => r.data),
    refetchInterval: autoRefresh ? 5000 : false,
  })

  const activeJobs = (jobs as BulkJob[]).filter(j => j.status === 'running' || j.status === 'previewing')

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('jobs_title')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          {activeJobs.length > 0 && (
            <span style={styles.activeBadge}>
              {activeJobs.length} active
            </span>
          )}
          <label style={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              style={{ marginRight: '.35rem' }}
            />
            {t('jobs_autoRefresh')}
          </label>
        </div>
      </div>

      {isLoading ? (
        <p style={styles.muted}>{t('loading')}</p>
      ) : (jobs as BulkJob[]).length === 0 ? (
        <p style={styles.muted}>{t('jobs_noJobs')}</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('jobs_id')}</th>
              <th style={styles.th}>{t('jobs_operation')}</th>
              <th style={styles.th}>{t('jobs_status')}</th>
              <th style={styles.th}>{t('jobs_domains')}</th>
              <th style={styles.th}>{t('jobs_progress')}</th>
              <th style={styles.th}>{t('jobs_created')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {(jobs as BulkJob[]).map(job => (
              <>
                <tr key={job.id} style={styles.tr}>
                  <td style={styles.tdMono}>{job.id}</td>
                  <td style={styles.td}><code style={styles.code}>{job.operation}</code></td>
                  <td style={styles.td}><StatusBadge status={job.status} /></td>
                  <td style={styles.td}>{job.affected_domains ?? '—'}</td>
                  <td style={styles.td}>
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
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <button
                      onClick={() => setExpanded(expanded === job.id ? null : job.id)}
                      style={styles.detailBtn}
                    >
                      {expanded === job.id ? t('jobs_hide') : t('jobs_detail')}
                    </button>
                  </td>
                </tr>
                {expanded === job.id && (
                  <tr key={`${job.id}-detail`}>
                    <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid #e5e7eb' }}>
                      <JobDetail job={job} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  h2:           { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  activeBadge:  { background: '#ede9fe', color: '#6d28d9', padding: '2px 10px', borderRadius: 12, fontSize: '.75rem', fontWeight: 600 },
  toggleLabel:  { display: 'flex', alignItems: 'center', fontSize: '.8125rem', color: '#6b7280', cursor: 'pointer' },
  muted:        { color: '#9ca3af' },
  table:        { width: '100%', borderCollapse: 'collapse' },
  th:           { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr:           { borderBottom: '1px solid #e5e7eb' },
  td:           { padding: '.625rem .75rem', fontSize: '.875rem', verticalAlign: 'middle' },
  tdMono:       { padding: '.625rem .75rem', fontSize: '.8125rem', fontFamily: 'monospace', verticalAlign: 'middle' },
  code:         { background: '#f3f4f6', padding: '1px 5px', borderRadius: 3, fontSize: '.8125rem' },
  detailBtn:    { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: 0, textDecoration: 'underline' },
  progressTrack:{ height: 6, background: '#e5e7eb', borderRadius: 3, width: 80, overflow: 'hidden' },
  progressBar:  { height: '100%', borderRadius: 3, transition: 'width .3s' },
  detailPanel:  { padding: '1rem 1.25rem', background: '#fafafa', borderTop: '1px solid #f0f0f0' },
  sectionLabel: { fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '.5rem' },
  summaryRow:   { display: 'flex', gap: '.75rem', flexWrap: 'wrap' },
  summaryBox:   { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '.625rem 1rem', textAlign: 'center' as const, minWidth: 90 },
  summaryNum:   { fontSize: '1.25rem', fontWeight: 700 },
  summaryLbl:   { fontSize: '.7rem', color: '#6b7280', marginTop: '.2rem' },
}
