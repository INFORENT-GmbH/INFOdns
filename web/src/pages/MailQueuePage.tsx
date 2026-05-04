import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMailQueue, getMailQueueItem, retryMail, type MailQueueItem } from '../api/client'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import ListPage from '../components/ListPage'
import ListTable from '../components/ListTable'
import { useI18n } from '../i18n/I18nContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import * as s from '../styles/shell'

const STATUSES = ['pending', 'processing', 'done', 'failed']
const LIMIT = 50

const MAIL_FILTER_DEFAULTS = { search: '', status: '', template: '' }

export default function MailQueuePage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const {
    filters: mailFilters, setFilter: setMailFilter,
    persist: filtersPersist, setPersist: setFiltersPersist,
    clear: clearFiltersInternal, hasActive: filtersHasActive,
  } = usePersistedFilters('mailQueue', MAIL_FILTER_DEFAULTS)
  const searchFilter   = mailFilters.search
  const statusFilter   = mailFilters.status
  const templateFilter = mailFilters.template
  const setSearchFilter   = (v: string) => { setMailFilter('search', v); setPage(1) }
  const setStatusFilter   = (v: string) => { setMailFilter('status', v); setPage(1) }
  const setTemplateFilter = (v: string) => { setMailFilter('template', v); setPage(1) }
  const clearFilters = () => { clearFiltersInternal(); setPage(1) }
  const [page, setPage] = useState(1)
  const [acting, setActing] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  const params: Record<string, string> = {
    page: String(page),
    limit: String(LIMIT),
    ...(searchFilter   ? { search: searchFilter }     : {}),
    ...(statusFilter   ? { status: statusFilter }     : {}),
    ...(templateFilter ? { template: templateFilter } : {}),
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['mail-queue', params],
    queryFn: () => getMailQueue(params).then(r => r.data),
    placeholderData: (prev) => prev,
    refetchInterval: 10_000,
  })

  const items: MailQueueItem[] = data?.data ?? []
  const totalPages = data?.pages ?? 1
  const total = data?.total ?? 0
  const templates = data?.templates ?? []

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

  const statusBtnLabel = statusFilter || t('mailQueue_allStatuses')
  const templateBtnLabel = templateFilter || t('mailQueue_allTemplates')

  return (
    <ListPage>
        {/* Stats / count bar */}
        <FilterBar>
          <span style={localStyles.countPill}>
            {total > 0
              ? `${total.toLocaleString()} ${t('mailQueue_entries')}`
              : t('mailQueue_noEntries')}
          </span>
        </FilterBar>

        {/* Filter bar */}
        <FilterBar>
          <SearchInput
            value={searchFilter}
            onChange={setSearchFilter}
            placeholder={t('mailQueue_searchPlaceholder')}
            width={240}
          />

          <Dropdown
            label={
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: statusFilter ? '#111827' : '#9ca3af' }}>
                {statusBtnLabel}
              </span>
            }
            active={!!statusFilter}
            onClear={() => setStatusFilter('')}
            width={160}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setStatusFilter(''); close() }}>
                  <span style={{ color: '#6b7280' }}>{t('mailQueue_allStatuses')}</span>
                </DropdownItem>
                {STATUSES.map(opt => (
                  <DropdownItem key={opt} onSelect={() => { setStatusFilter(opt); close() }}>
                    {opt}
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>

          {templates.length > 0 && (
            <Dropdown
              label={
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: templateFilter ? '#111827' : '#9ca3af' }}>
                  {templateBtnLabel}
                </span>
              }
              active={!!templateFilter}
              onClear={() => setTemplateFilter('')}
              width={200}
            >
              {close => (
                <>
                  <DropdownItem onSelect={() => { setTemplateFilter(''); close() }}>
                    <span style={{ color: '#6b7280' }}>{t('mailQueue_allTemplates')}</span>
                  </DropdownItem>
                  {templates.map(tpl => (
                    <DropdownItem key={tpl} onSelect={() => { setTemplateFilter(tpl); close() }}>
                      {tpl}
                    </DropdownItem>
                  ))}
                </>
              )}
            </Dropdown>
          )}

          <FilterPersistControls
            persist={filtersPersist}
            setPersist={setFiltersPersist}
            onClear={clearFilters}
            hasActive={filtersHasActive}
            style={{ marginLeft: 'auto' }}
          />
        </FilterBar>

        {/* Table */}
        <ListTable>
          {isLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', transition: 'opacity .15s', opacity: isFetching ? 0.6 : 1 }}>
              <thead>
                <tr>
                  <th style={s.th}>ID</th>
                  <th style={s.th}>{t('mailQueue_recipient')}</th>
                  <th style={s.th}>{t('mailQueue_template')}</th>
                  <th style={s.th}>{t('status')}</th>
                  <th style={s.th}>{t('mailQueue_retries')}</th>
                  <th style={s.th}>{t('created')}</th>
                  <th style={s.th}>{t('mailQueue_error')}</th>
                  <th style={s.th}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <MailRow
                    key={m.id}
                    m={m}
                    expanded={expanded === m.id}
                    onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                    onRetry={() => handleRetry(m.id)}
                    acting={acting === m.id}
                    statusBadge={statusBadge}
                  />
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#9ca3af' }}>
                      {t('mailQueue_noEntries')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </ListTable>

        {totalPages > 1 && (
          <div style={localStyles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={localStyles.pageBtn}>←</button>
            <span style={localStyles.pageInfo}>{t('mailQueue_page')} {page} {t('mailQueue_of')} {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={localStyles.pageBtn}>→</button>
          </div>
        )}
    </ListPage>
  )
}

function MailRow({
  m, expanded, onToggle, onRetry, acting, statusBadge,
}: {
  m: MailQueueItem
  expanded: boolean
  onToggle: () => void
  onRetry: () => void
  acting: boolean
  statusBadge: (s: string) => React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <React.Fragment>
      <tr>
        <td style={s.td}>{m.id}</td>
        <td style={s.td}>{m.to_email}</td>
        <td style={s.td}><code style={localStyles.code}>{m.template ?? '—'}</code></td>
        <td style={s.td}>{statusBadge(m.status)}</td>
        <td style={s.td}>{m.retries}/{m.max_retries}</td>
        <td style={{ ...s.td, color: '#64748b' }}>{new Date(m.created_at).toLocaleString()}</td>
        <td style={s.td}>
          {m.error && <span style={localStyles.errorText} title={m.error}>{m.error.slice(0, 60)}{m.error.length > 60 ? '…' : ''}</span>}
        </td>
        <td style={s.td}>
          <div style={localStyles.actions}>
            <button onClick={onToggle} style={localStyles.btnView}>
              {expanded ? t('mailQueue_hide') : t('mailQueue_view')}
            </button>
            {m.status === 'failed' && (
              <button onClick={onRetry} disabled={acting} style={localStyles.btnRetry}>
                {acting ? t('mailQueue_retrying') : t('mailQueue_retry')}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={localStyles.detailCell}>
            <MailDetail id={m.id} />
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

function MailDetail({ id }: { id: number }) {
  const { t } = useI18n()
  const { data, isLoading } = useQuery({
    queryKey: ['mail-queue', id],
    queryFn: () => getMailQueueItem(id).then(r => r.data),
  })

  if (isLoading) return <div style={localStyles.muted}>{t('mailQueue_loadingBody')}</div>
  if (!data) return null

  const hasBody = data.body_html || data.body_text

  return (
    <div style={localStyles.detailGrid}>
      {data.render_error && (
        <div style={localStyles.renderError}>
          {t('mailQueue_renderError')}: {data.render_error}
        </div>
      )}
      {data.subject && (
        <Field label={t('mailQueue_subject')}>
          <div style={localStyles.subjectText}>{data.subject}</div>
        </Field>
      )}
      {data.body_html && (
        <Field label={t('mailQueue_html')}>
          <iframe
            srcDoc={data.body_html}
            sandbox=""
            style={localStyles.iframe}
            title={`mail-${id}-html`}
          />
        </Field>
      )}
      {data.body_text && (
        <Field label={t('mailQueue_text')}>
          <pre style={localStyles.pre}>{data.body_text}</pre>
        </Field>
      )}
      {data.payload != null && (
        <Field label={t('mailQueue_payload')}>
          <pre style={localStyles.pre}>{JSON.stringify(data.payload, null, 2)}</pre>
        </Field>
      )}
      {!hasBody && !data.payload && (
        <div style={localStyles.muted}>{t('mailQueue_noBody')}</div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={localStyles.fieldLabel}>{label}</div>
      {children}
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  countPill:   { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  muted:       { color: '#94a3b8', fontSize: '.875rem' },
  code:        { background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, fontSize: '.8rem', fontFamily: 'monospace' },
  errorText:   { color: '#b91c1c', fontSize: '.8rem' },
  actions:     { display: 'flex', gap: '.35rem' },
  btnRetry:    { padding: '.25rem .5rem', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer' },
  btnView:     { padding: '.25rem .5rem', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.75rem', fontWeight: 500, cursor: 'pointer' },
  pagination:  { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.75rem', padding: '.75rem 0', borderTop: '1px solid #e2e8f0', flexShrink: 0 },
  pageBtn:     { padding: '.25rem .5rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: '.8125rem', color: '#374151' },
  pageInfo:    { fontSize: '.8125rem', color: '#64748b' },
  detailCell:  { padding: '.75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' },
  detailGrid:  { display: 'flex', flexDirection: 'column', gap: '.75rem' },
  fieldLabel:  { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 },
  subjectText: { fontSize: '.875rem', color: '#1e293b', fontWeight: 500 },
  pre:         { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: '.5rem .75rem', margin: 0, fontSize: '.75rem', fontFamily: 'monospace', color: '#1e293b', overflow: 'auto', maxHeight: 240, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  iframe:      { width: '100%', minHeight: 320, border: '1px solid #e2e8f0', borderRadius: 4, background: '#fff' },
  renderError: { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 4, padding: '.5rem .75rem', fontSize: '.8125rem' },
}
