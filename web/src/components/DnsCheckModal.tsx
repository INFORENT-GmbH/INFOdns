import { useState, useEffect } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { useModalA11y } from '../hooks/useModalA11y'
import { dnsCheck } from '../api/client'
import type { DnsCheckResult, DnsCheckRow, DnsCheckResolverResult } from '../api/client'

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

interface Props {
  domainId: number
  fqdn: string
  onClose: () => void
}

type RowStatus = 'agree' | 'disagree' | 'unsupported'

function rowStatus(row: DnsCheckRow, resolvers: string[]): RowStatus {
  const all = resolvers.map(r => row.answers[r]).filter(Boolean)
  if (all.every(a => a.unsupported)) return 'unsupported'
  const relevant = all.filter(a => !a.unsupported)
  if (relevant.some(a => a.error || a.values.length === 0)) return 'disagree'
  const sig = (a: DnsCheckResolverResult) => [...a.values].sort().join('\x00')
  const first = sig(relevant[0])
  return relevant.every(a => sig(a) === first) ? 'agree' : 'disagree'
}

function CellContent({ result }: { result: DnsCheckResolverResult }) {
  if (result.unsupported) {
    return <span style={{ color: '#9ca3af' }}>–</span>
  }
  if (result.error) {
    return <span style={{ color: '#dc2626', fontStyle: 'italic' }}>{result.error}</span>
  }
  if (result.values.length === 0) {
    return <span style={{ color: '#9ca3af' }}>∅</span>
  }
  return <>{result.values.join(', ')}</>
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: 8,
    padding: '1.25rem',
    width: 'min(1100px, 95vw)',
    maxHeight: '80vh',
    overflowY: 'auto' as const,
    boxShadow: '0 20px 60px rgba(0,0,0,.25)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1rem',
  },
  title: {
    fontWeight: 700,
    fontSize: '1rem',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.25rem',
    cursor: 'pointer',
    color: '#6b7280',
    lineHeight: 1,
    padding: '0 4px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    tableLayout: 'fixed' as const,
    fontSize: '.75rem',
    fontFamily: MONO,
  },
  th: {
    textAlign: 'left' as const,
    padding: '.375rem .5rem',
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '.6875rem',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '.04em',
    color: '#6b7280',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
  },
  thCenter: {
    textAlign: 'center' as const,
  },
  td: {
    padding: '.3rem .5rem',
    borderBottom: '1px solid #f3f4f6',
    verticalAlign: 'top' as const,
    wordBreak: 'break-all' as const,
  },
  tdCenter: {
    textAlign: 'center' as const,
  },
  spinner: {
    width: 28,
    height: 28,
    border: '3px solid #e5e7eb',
    borderTop: '3px solid #2563eb',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    margin: '2rem auto',
  },
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '.75rem',
    padding: '1.5rem 0',
    color: '#6b7280',
    fontSize: '.875rem',
  },
  errorBanner: {
    background: '#fee2e2',
    color: '#b91c1c',
    padding: '.625rem .875rem',
    borderRadius: 6,
    fontSize: '.8125rem',
  },
  empty: {
    textAlign: 'center' as const,
    color: '#9ca3af',
    padding: '1.5rem',
    fontSize: '.875rem',
  },
}

const ROW_BG: Record<RowStatus, string> = {
  agree:       '#f0fdf4',
  disagree:    '#fef2f2',
  unsupported: '#f9fafb',
}

const ROW_BORDER: Record<RowStatus, string> = {
  agree:       '#16a34a',
  disagree:    '#dc2626',
  unsupported: '#e5e7eb',
}

export default function DnsCheckModal({ domainId, fqdn, onClose }: Props) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DnsCheckResult | null>(null)
  const modalRef = useModalA11y<HTMLDivElement>(onClose)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    dnsCheck(domainId)
      .then(data => { if (!cancelled) { setResult(data); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message ?? t('dnsCheck_error')); setLoading(false) } })
    return () => { cancelled = true }
  }, [domainId])

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div ref={modalRef} style={styles.modal} onClick={e => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-labelledby="dns-check-modal-title" tabIndex={-1}>
        <div style={styles.header}>
          <h2 id="dns-check-modal-title" style={styles.title}>{t('dnsCheck_title', fqdn)}</h2>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading && (
          <div style={styles.loadingWrap}>
            <div style={styles.spinner} />
            <span>{t('dnsCheck_loading')}</span>
          </div>
        )}

        {!loading && error && (
          <div style={styles.errorBanner}>{error}</div>
        )}

        {!loading && !error && result && result.results.length === 0 && (
          <div style={styles.empty}>{t('dnsCheck_noRecords')}</div>
        )}

        {!loading && !error && result && result.results.length > 0 && (
          <table style={styles.table}>
            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 70 }} />
              {result.resolvers.map(r => (
                <col key={r} style={{ width: `${Math.floor((100 - 16) / result.resolvers.length)}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th style={styles.th}>{t('dnsCheck_colName')}</th>
                <th style={styles.th}>{t('dnsCheck_colType')}</th>
                {result.resolvers.map(r => (
                  <th key={r} style={{ ...styles.th, ...styles.thCenter }}>{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.results.map((row, i) => {
                const status = rowStatus(row, result.resolvers)
                const rowStyle = {
                  background: ROW_BG[status],
                  borderLeft: `3px solid ${ROW_BORDER[status]}`,
                }
                return (
                  <tr key={i} style={rowStyle}>
                    <td style={styles.td}>{row.name}</td>
                    <td style={styles.td}>{row.type}</td>
                    {result.resolvers.map(r => (
                      <td key={r} style={{ ...styles.td, ...styles.tdCenter }}>
                        <CellContent result={row.answers[r] ?? { values: [], error: 'N/A' }} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
