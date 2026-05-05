import { useMemo, useState } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMailQueue, getMailQueueItem, retryMail, dismissMail, dismissAllFailedMail, type MailQueueItem } from '../api/client'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import ListTable from '../components/ListTable'
import MasterDetailLayout from '../components/MasterDetailLayout'
import { useI18n } from '../i18n/I18nContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import * as s from '../styles/shell'

const STATUSES = ['pending', 'processing', 'done', 'failed', 'dismissed']
const LIMIT = 50

const MAIL_FILTER_DEFAULTS = { search: '', status: '', template: '' }

export default function MailQueuePage() {
  usePageTitle('Mail Queue')
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
  const [selectedId, setSelectedId] = useState<number | null>(null)

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

  const selectedItem = useMemo(
    () => selectedId !== null ? items.find(m => m.id === selectedId) ?? null : null,
    [items, selectedId]
  )

  async function handleRetry(id: number) {
    setActing(id)
    try {
      await retryMail(id)
      qc.invalidateQueries({ queryKey: ['mail-queue'] })
    } finally {
      setActing(null)
    }
  }

  async function handleDismiss(id: number) {
    setActing(id)
    try {
      await dismissMail(id)
      qc.invalidateQueries({ queryKey: ['mail-queue'] })
      // If we just dismissed the currently-selected item it will fall out of the
      // failed filter — close the detail pane so the table reflows cleanly.
      if (selectedId === id) setSelectedId(null)
    } finally {
      setActing(null)
    }
  }

  const [bulkActing, setBulkActing] = useState(false)
  async function handleDismissAllFailed() {
    // Use the unfiltered failed-count here, not the current page — `total` reflects
    // the active filter set, which the user has narrowed to status=failed.
    const n = total
    if (n === 0) return
    if (!window.confirm(t('mailQueue_dismissAllConfirm', n))) return
    setBulkActing(true)
    try {
      const r = await dismissAllFailedMail()
      qc.invalidateQueries({ queryKey: ['mail-queue'] })
      window.alert(t('mailQueue_dismissed', r.data.dismissed))
    } finally {
      setBulkActing(false)
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, { bg: string; fg: string }> = {
      pending:    { bg: '#fef3c7', fg: '#92400e' },
      processing: { bg: '#dbeafe', fg: '#1e40af' },
      done:       { bg: '#d1fae5', fg: '#065f46' },
      failed:     { bg: '#fee2e2', fg: '#991b1b' },
      // Dismissed = manually acknowledged failure. Slate so it reads as
      // "intentionally set aside", clearly different from green 'done'.
      dismissed:  { bg: '#e2e8f0', fg: '#475569' },
    }
    const c = colors[status] ?? { bg: '#f3f4f6', fg: '#374151' }
    return (
      <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 }}>
        {status}
      </span>
    )
  }

  const statusBtnLabel   = statusFilter || t('mailQueue_allStatuses')
  const templateBtnLabel = templateFilter || t('mailQueue_allTemplates')

  // Shared filter bars
  const filterBars = (
    <>
      <FilterBar>
        <span style={localStyles.countPill}>
          {total > 0
            ? `${total.toLocaleString()} ${t('mailQueue_entries')}`
            : t('mailQueue_noEntries')}
        </span>
        {statusFilter === 'failed' && total > 0 && (
          <button
            onClick={handleDismissAllFailed}
            disabled={bulkActing}
            style={localStyles.btnDismissAll}
            title={t('mailQueue_dismissAll')}
          >
            {bulkActing ? t('mailQueue_dismissing') : t('mailQueue_dismissAll')}
          </button>
        )}
      </FilterBar>
      <FilterBar>
        <SearchInput value={searchFilter} onChange={setSearchFilter} placeholder={t('mailQueue_searchPlaceholder')} width={240} />
        <Dropdown
          label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: statusFilter ? '#111827' : '#9ca3af' }}>{statusBtnLabel}</span>}
          active={!!statusFilter}
          onClear={() => setStatusFilter('')}
          width={160}
        >
          {close => (
            <>
              <DropdownItem onSelect={() => { setStatusFilter(''); close() }}><span style={{ color: '#6b7280' }}>{t('mailQueue_allStatuses')}</span></DropdownItem>
              {STATUSES.map(opt => <DropdownItem key={opt} onSelect={() => { setStatusFilter(opt); close() }}>{opt}</DropdownItem>)}
            </>
          )}
        </Dropdown>
        {templates.length > 0 && (
          <Dropdown
            label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: templateFilter ? '#111827' : '#9ca3af' }}>{templateBtnLabel}</span>}
            active={!!templateFilter}
            onClear={() => setTemplateFilter('')}
            width={200}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setTemplateFilter(''); close() }}><span style={{ color: '#6b7280' }}>{t('mailQueue_allTemplates')}</span></DropdownItem>
                {templates.map(tpl => <DropdownItem key={tpl} onSelect={() => { setTemplateFilter(tpl); close() }}>{tpl}</DropdownItem>)}
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
    </>
  )

  const pagination = totalPages > 1 && (
    <div style={localStyles.pagination}>
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={localStyles.pageBtn}>←</button>
      <span style={localStyles.pageInfo}>{t('mailQueue_page')} {page} {t('mailQueue_of')} {totalPages}</span>
      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={localStyles.pageBtn}>→</button>
    </div>
  )

  // ── Dashboard ──────────────────────────────────────────────────
  const dashboard = (
    <>
      {filterBars}
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
              </tr>
            </thead>
            <tbody>
              {items.map(m => {
                const isSel = selectedId === m.id
                return (
                  <tr
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    style={{ cursor: 'pointer', background: isSel ? '#eff6ff' : undefined }}
                    onMouseOver={e => { if (!isSel) e.currentTarget.style.background = '#f1f5f9' }}
                    onMouseOut={e => { if (!isSel) e.currentTarget.style.background = '' }}
                  >
                    <td style={s.td}>{m.id}</td>
                    <td style={s.td}>{m.to_email}</td>
                    <td style={s.td}><code style={localStyles.code}>{m.template ?? '—'}</code></td>
                    <td style={s.td}>{statusBadge(m.status)}</td>
                    <td style={s.td}>{m.retries}/{m.max_retries}</td>
                    <td style={{ ...s.td, color: '#64748b' }}>{new Date(m.created_at).toLocaleString()}</td>
                    <td style={s.td}>
                      {m.error && <span style={localStyles.errorText} title={m.error}>{m.error.slice(0, 60)}{m.error.length > 60 ? '…' : ''}</span>}
                    </td>
                  </tr>
                )
              })}
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#9ca3af' }}>{t('mailQueue_noEntries')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </ListTable>
      {pagination}
    </>
  )

  // ── Sidebar ────────────────────────────────────────────────────
  const sidebar = (
    <>
      <FilterBar>
        <SearchInput value={searchFilter} onChange={setSearchFilter} placeholder={t('mailQueue_searchPlaceholder')} width="100%" />
      </FilterBar>
      <FilterBar>
        <Dropdown
          label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: statusFilter ? '#111827' : '#9ca3af' }}>{statusBtnLabel}</span>}
          active={!!statusFilter}
          onClear={() => setStatusFilter('')}
          width="100%"
        >
          {close => (
            <>
              <DropdownItem onSelect={() => { setStatusFilter(''); close() }}><span style={{ color: '#6b7280' }}>{t('mailQueue_allStatuses')}</span></DropdownItem>
              {STATUSES.map(opt => <DropdownItem key={opt} onSelect={() => { setStatusFilter(opt); close() }}>{opt}</DropdownItem>)}
            </>
          )}
        </Dropdown>
      </FilterBar>
      <ListTable>
        {items.map(m => {
          const isSel = selectedId === m.id
          return (
            <div
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              style={{
                padding: '.5rem .75rem',
                cursor: 'pointer',
                borderBottom: '1px solid #f1f5f9',
                background: isSel ? '#eff6ff' : 'transparent',
              }}
            >
              <div style={{ fontSize: '.8125rem', fontWeight: isSel ? 600 : 500, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.to_email}
              </div>
              <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                {statusBadge(m.status)}
                {m.template && <code style={localStyles.code}>{m.template}</code>}
              </div>
            </div>
          )
        })}
      </ListTable>
      {pagination}
    </>
  )

  // ── Detail pane ────────────────────────────────────────────────
  const detailPane = (
    <div style={localStyles.detailPane}>
      <div style={localStyles.detailHeader}>
        <button onClick={() => setSelectedId(null)} style={localStyles.backBtn}>← {t('cancel')}</button>
        <h3 style={localStyles.detailTitle}>{selectedItem ? `Mail #${selectedItem.id}` : ''}</h3>
        {selectedItem && statusBadge(selectedItem.status)}
        {selectedItem?.status === 'failed' && (
          <>
            <button onClick={() => handleRetry(selectedItem.id)} disabled={acting === selectedItem.id} style={localStyles.btnRetry}>
              {acting === selectedItem.id ? t('mailQueue_retrying') : t('mailQueue_retry')}
            </button>
            <button onClick={() => handleDismiss(selectedItem.id)} disabled={acting === selectedItem.id} style={localStyles.btnDismiss}>
              {acting === selectedItem.id ? t('mailQueue_dismissing') : t('mailQueue_dismiss')}
            </button>
          </>
        )}
      </div>
      {selectedItem && (
        <>
          <div style={localStyles.metaGrid}>
            <div><strong>{t('mailQueue_recipient')}:</strong> {selectedItem.to_email}</div>
            <div><strong>{t('mailQueue_template')}:</strong> {selectedItem.template ? <code style={localStyles.code}>{selectedItem.template}</code> : '—'}</div>
            <div><strong>{t('mailQueue_retries')}:</strong> {selectedItem.retries}/{selectedItem.max_retries}</div>
            <div><strong>{t('created')}:</strong> {new Date(selectedItem.created_at).toLocaleString()}</div>
            {selectedItem.error && (
              <div style={{ gridColumn: '1 / -1' }}><strong>{t('mailQueue_error')}:</strong> <span style={localStyles.errorText}>{selectedItem.error}</span></div>
            )}
          </div>
          <MailDetail id={selectedItem.id} />
        </>
      )}
    </div>
  )

  return (
    <MasterDetailLayout
      dashboard={dashboard}
      sidebar={sidebar}
      detail={detailPane}
      isOpen={selectedId !== null}
    />
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
  countPill:    { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  detailPane:   { padding: '1rem 1.5rem' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  detailTitle:  { margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b', flex: 1 },
  backBtn:      { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '.875rem', padding: 0 },
  metaGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.5rem 1rem', fontSize: '.8125rem', color: '#374151', marginBottom: '1rem' },
  muted:        { color: '#94a3b8', fontSize: '.875rem' },
  code:         { background: '#f1f5f9', padding: '1px 6px', borderRadius: 3, fontSize: '.8rem', fontFamily: 'monospace' },
  errorText:    { color: '#b91c1c', fontSize: '.8rem' },
  btnRetry:     { padding: '.25rem .625rem', background: '#fbbf24', color: '#78350f', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 600, cursor: 'pointer' },
  btnDismiss:   { padding: '.25rem .625rem', background: '#fff', color: '#374151', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '.8125rem', fontWeight: 600, cursor: 'pointer' },
  btnDismissAll:{ padding: '.25rem .625rem', background: '#fff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', marginLeft: '.5rem' },
  pagination:   { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.75rem', padding: '.75rem 0', borderTop: '1px solid #e2e8f0', flexShrink: 0 },
  pageBtn:      { padding: '.25rem .5rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: '.8125rem', color: '#374151' },
  pageInfo:     { fontSize: '.8125rem', color: '#64748b' },
  detailGrid:   { display: 'flex', flexDirection: 'column' as const, gap: '.75rem' },
  fieldLabel:   { fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '.04em', marginBottom: 4 },
  subjectText:  { fontSize: '.875rem', color: '#1e293b', fontWeight: 500 },
  pre:          { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, padding: '.5rem .75rem', margin: 0, fontSize: '.75rem', fontFamily: 'monospace', color: '#1e293b', overflow: 'auto', maxHeight: 280, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  iframe:       { width: '100%', minHeight: 320, border: '1px solid #e2e8f0', borderRadius: 4, background: '#fff' },
  renderError:  { background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 4, padding: '.5rem .75rem', fontSize: '.8125rem' },
}
