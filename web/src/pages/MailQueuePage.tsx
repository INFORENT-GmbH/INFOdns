import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMailQueue, retryMail, type MailQueueItem } from '../api/client'
import Select from '../components/Select'
import { useI18n } from '../i18n/I18nContext'

const STATUSES = ['', 'pending', 'processing', 'done', 'failed']
const LIMIT = 50

export default function MailQueuePage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [acting, setActing] = useState<number | null>(null)

  const params: Record<string, string> = {
    page: String(page),
    limit: String(LIMIT),
    ...(statusFilter ? { status: statusFilter } : {}),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['mail-queue', params],
    queryFn: () => getMailQueue(params).then(r => r.data),
    placeholderData: (prev) => prev,
    refetchInterval: 10_000,
  })

  const items: MailQueueItem[] = data?.data ?? []
  const totalPages = data?.pages ?? 1
  const total = data?.total ?? 0

  async function handleRetry(id: number) {
    setActing(id)
    try {
      await retryMail(id)
      qc.invalidateQueries({ queryKey: ['mail-queue'] })
    } finally {
      setActing(null)
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, { bg: string; fg: string }> = {
      pending:    { bg: '#fef3c7', fg: '#92400e' },
      processing: { bg: '#dbeafe', fg: '#1e40af' },
      done:       { bg: '#d1fae5', fg: '#065f46' },
      failed:     { bg: '#fee2e2', fg: '#991b1b' },
    }
    const c = colors[status] ?? { bg: '#f3f4f6', fg: '#374151' }
    return (
      <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 }}>
        {status}
      </span>
    )
  }

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('mailQueue_title')}</h2>
        {total > 0 && (
          <span style={styles.totalBadge}>{total.toLocaleString()} {t('mailQueue_entries')}</span>
        )}
      </div>

      <div style={styles.filters}>
        <Select
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(1) }}
          style={styles.select}
          options={[
            { value: '', label: t('mailQueue_allStatuses') },
            ...STATUSES.filter(Boolean).map(s => ({ value: s, label: s })),
          ]}
        />
      </div>

      {isLoading ? <p>{t('loading')}</p> : items.length === 0 ? (
        <p style={styles.muted}>{t('mailQueue_noEntries')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}><table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>{t('mailQueue_recipient')}</th>
              <th style={styles.th}>{t('mailQueue_template')}</th>
              <th style={styles.th}>{t('status')}</th>
              <th style={styles.th}>{t('mailQueue_retries')}</th>
              <th style={styles.th}>{t('created')}</th>
              <th style={styles.th}>{t('mailQueue_error')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} style={styles.tr}>
                <td style={styles.td}>{m.id}</td>
                <td style={styles.td}>{m.to_email}</td>
                <td style={styles.td}><code style={styles.code}>{m.template ?? '—'}</code></td>
                <td style={styles.td}>{statusBadge(m.status)}</td>
                <td style={styles.td}>{m.retries}/{m.max_retries}</td>
                <td style={styles.td}>{new Date(m.created_at).toLocaleString()}</td>
                <td style={styles.td}>
                  {m.error && <span style={styles.errorText} title={m.error}>{m.error.slice(0, 60)}{m.error.length > 60 ? '…' : ''}</span>}
                </td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    {m.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(m.id)}
                        disabled={acting === m.id}
                        style={styles.btnRetry}
                      >
                        {acting === m.id ? t('mailQueue_retrying') : t('mailQueue_retry')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>←</button>
          <span style={styles.pageInfo}>{t('mailQueue_page')} {page} {t('mailQueue_of')} {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>→</button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' },
  h2: { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  totalBadge: { fontSize: '.75rem', color: '#475569', background: '#e2e8f0', padding: '1px 7px', borderRadius: 4, fontWeight: 600 },
  filters: { display: 'flex', gap: '.5rem', marginBottom: '1rem', flexWrap: 'wrap', padding: '.5rem .75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6 },
  select: { padding: '.3rem .6rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', background: '#fff' },
  muted: { color: '#94a3b8', fontSize: '.875rem' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, whiteSpace: 'nowrap', letterSpacing: '.04em' },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '.4375rem .75rem', fontSize: '.8125rem', verticalAlign: 'top', color: '#1e293b' },
  code: { background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, fontSize: '.8rem', fontFamily: 'monospace' },
  errorText: { color: '#b91c1c', fontSize: '.8rem' },
  actions: { display: 'flex', gap: '.35rem' },
  btnRetry: { padding: '.25rem .5rem', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer' },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.75rem', marginTop: '1rem' },
  pageBtn: { padding: '.25rem .5rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: '.8125rem', color: '#374151' },
  pageInfo: { fontSize: '.8125rem', color: '#64748b' },
}
