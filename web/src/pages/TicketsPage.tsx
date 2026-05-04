import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTickets, getUsers, createTicket, uploadAttachments, type Ticket } from '../api/client'
import Select from '../components/Select'
import Dropdown, { DropdownItem } from '../components/Dropdown'
import FilterBar from '../components/FilterBar'
import FilterPersistControls from '../components/FilterPersistControls'
import { useI18n } from '../i18n/I18nContext'
import { useAuth } from '../context/AuthContext'
import { usePersistedFilters } from '../hooks/usePersistedFilters'
import { formatApiError } from '../lib/formError'
import * as s from '../styles/shell'

const LIMIT = 50

const TICKET_FILTER_DEFAULTS = { status: '', priority: '', assignee: '' }

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  open:        { bg: '#fef3c7', fg: '#92400e' },
  in_progress: { bg: '#dbeafe', fg: '#1e40af' },
  waiting:     { bg: '#ede9fe', fg: '#5b21b6' },
  closed:      { bg: '#f3f4f6', fg: '#374151' },
}

const PRIORITY_COLORS: Record<string, { bg: string; fg: string }> = {
  low:    { bg: '#f3f4f6', fg: '#374151' },
  normal: { bg: '#d1fae5', fg: '#065f46' },
  high:   { bg: '#fed7aa', fg: '#9a3412' },
  urgent: { bg: '#fee2e2', fg: '#991b1b' },
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const c = STATUS_COLORS[status] ?? { bg: '#f3f4f6', fg: '#374151' }
  return <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 }}>{label}</span>
}

function PriorityBadge({ priority, label }: { priority: string; label: string }) {
  const c = PRIORITY_COLORS[priority] ?? { bg: '#f3f4f6', fg: '#374151' }
  return <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 }}>{label}</span>
}

export default function TicketsPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isStaff = user?.role === 'admin' || user?.role === 'operator'

  const {
    filters: ticketFilters, setFilter: setTicketFilter,
    persist: filtersPersist, setPersist: setFiltersPersist,
    clear: clearFiltersInternal, hasActive: filtersHasActive,
  } = usePersistedFilters('tickets', TICKET_FILTER_DEFAULTS)
  const statusFilter   = ticketFilters.status
  const priorityFilter = ticketFilters.priority
  const assigneeFilter = ticketFilters.assignee
  const setStatusFilter   = (v: string) => { setTicketFilter('status', v); setPage(1) }
  const setPriorityFilter = (v: string) => { setTicketFilter('priority', v); setPage(1) }
  const setAssigneeFilter = (v: string) => { setTicketFilter('assignee', v); setPage(1) }
  const clearFilters = () => { clearFiltersInternal(); setPage(1) }
  const [page, setPage]                     = useState(1)
  const [showCreate, setShowCreate]         = useState(false)
  const [creating, setCreating]             = useState(false)
  const [createError, setCreateError]       = useState<string | null>(null)
  const [form, setForm] = useState({ subject: '', body: '', priority: 'normal' })
  const [createFiles, setCreateFiles] = useState<File[]>([])

  const params: Record<string, string> = {
    page: String(page),
    limit: String(LIMIT),
    ...(statusFilter   ? { status: statusFilter }         : {}),
    ...(priorityFilter ? { priority: priorityFilter }     : {}),
    ...(assigneeFilter ? { assigned_to: assigneeFilter }  : {}),
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['tickets', params],
    queryFn: () => getTickets(params).then(r => r.data),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  })

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
    enabled: isStaff,
  })

  const tickets: Ticket[] = data?.data ?? []
  const totalPages = data?.pages ?? 1
  const total = data?.total ?? 0

  const staffUsers = (users ?? []).filter(u => u.role === 'admin' || u.role === 'operator')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const resp = await createTicket(form)
      if (createFiles.length > 0) {
        try {
          await uploadAttachments(resp.data.id, resp.data.messageId, createFiles)
        } catch {
          qc.invalidateQueries({ queryKey: ['tickets'] })
          setForm({ subject: '', body: '', priority: 'normal' })
          setCreateFiles([])
          setCreateError('Ticket created, but attachments could not be uploaded')
          return
        }
      }
      qc.invalidateQueries({ queryKey: ['tickets'] })
      setForm({ subject: '', body: '', priority: 'normal' })
      setCreateFiles([])
      setShowCreate(false)
    } catch (err: any) {
      setCreateError(formatApiError(err))
    } finally {
      setCreating(false)
    }
  }

  const statusLabel = (s: string) => t(`ticket_status_${s}` as any) || s
  const priorityLabel = (p: string) => t(`ticket_priority_${p}` as any) || p

  const STATUS_OPTIONS = ['open', 'in_progress', 'waiting', 'closed']
  const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'urgent']

  const statusBtnLabel = statusFilter ? statusLabel(statusFilter) : t('tickets_allStatuses')
  const priorityBtnLabel = priorityFilter ? priorityLabel(priorityFilter) : t('tickets_allPriorities')
  const assigneeBtnLabel = assigneeFilter
    ? (staffUsers.find(u => String(u.id) === assigneeFilter)?.full_name
       ?? staffUsers.find(u => String(u.id) === assigneeFilter)?.email
       ?? `#${assigneeFilter}`)
    : t('tickets_allAssignees')

  return (
    <div>
      <div style={s.pageBar}>
        <h2 style={s.pageTitle}>{t('tickets_title')}</h2>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={localStyles.createForm}>
          <input
            style={localStyles.input}
            placeholder={t('tickets_subjectPh')}
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            required
          />
          <textarea
            style={{ ...localStyles.input, minHeight: 80 }}
            placeholder={t('tickets_bodyPh')}
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            required
          />
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={localStyles.fileLabel}>
              📎 {t('ticketDetail_addFiles')}
              <input
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={e => setCreateFiles(Array.from(e.target.files ?? []).slice(0, 20))}
              />
            </label>
            {createFiles.length > 0 && (
              <span style={localStyles.fileNames}>
                {createFiles.map(f => f.name).join(', ')}
                <button type="button" style={localStyles.fileClear} onClick={() => setCreateFiles([])}>✕</button>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <Select
              style={localStyles.selectInForm}
              value={form.priority}
              onChange={v => setForm(f => ({ ...f, priority: v }))}
              options={PRIORITY_OPTIONS.map(p => ({ value: p, label: priorityLabel(p) }))}
            />
            <button type="submit" disabled={creating} style={s.actionBtn}>
              {creating ? t('creating') : t('create')}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} style={s.secondaryBtn}>{t('cancel')}</button>
          </div>
          {createError && <p style={localStyles.errorText}>{createError}</p>}
        </form>
      )}

      <div style={s.panel}>
        {/* Stats / count bar */}
        <FilterBar>
          <span style={localStyles.countPill}>
            {filtersHasActive
              ? t('tickets_filteredCount', tickets.length, total)
              : `${total} ${t('tickets_count')}`}
          </span>
        </FilterBar>

        {/* Filter bar */}
        <FilterBar>
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
                  <span style={{ color: '#6b7280' }}>{t('tickets_allStatuses')}</span>
                </DropdownItem>
                {STATUS_OPTIONS.map(opt => (
                  <DropdownItem key={opt} onSelect={() => { setStatusFilter(opt); close() }}>
                    {statusLabel(opt)}
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>

          <Dropdown
            label={
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: priorityFilter ? '#111827' : '#9ca3af' }}>
                {priorityBtnLabel}
              </span>
            }
            active={!!priorityFilter}
            onClear={() => setPriorityFilter('')}
            width={160}
          >
            {close => (
              <>
                <DropdownItem onSelect={() => { setPriorityFilter(''); close() }}>
                  <span style={{ color: '#6b7280' }}>{t('tickets_allPriorities')}</span>
                </DropdownItem>
                {PRIORITY_OPTIONS.map(opt => (
                  <DropdownItem key={opt} onSelect={() => { setPriorityFilter(opt); close() }}>
                    {priorityLabel(opt)}
                  </DropdownItem>
                ))}
              </>
            )}
          </Dropdown>

          {isStaff && (
            <Dropdown
              label={
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: assigneeFilter ? '#111827' : '#9ca3af' }}>
                  {assigneeBtnLabel}
                </span>
              }
              active={!!assigneeFilter}
              onClear={() => setAssigneeFilter('')}
              width={200}
            >
              {close => (
                <>
                  <DropdownItem onSelect={() => { setAssigneeFilter(''); close() }}>
                    <span style={{ color: '#6b7280' }}>{t('tickets_allAssignees')}</span>
                  </DropdownItem>
                  {staffUsers.map(u => (
                    <DropdownItem key={u.id} onSelect={() => { setAssigneeFilter(String(u.id)); close() }}>
                      {u.full_name || u.email}
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

          <button onClick={() => setShowCreate(s => !s)} style={s.actionBtn}>{t('tickets_newTicket')}</button>
        </FilterBar>

        {/* Table */}
        <div style={s.tableWrap}>
          {isLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', transition: 'opacity .15s', opacity: isFetching ? 0.6 : 1 }}>
              <thead>
                <tr>
                  <th style={s.th}>#</th>
                  <th style={s.th}>{t('tickets_subject')}</th>
                  <th style={s.th}>{t('ticketDetail_status')}</th>
                  <th style={s.th}>{t('ticketDetail_priority')}</th>
                  <th style={s.th}>{t('tickets_requester')}</th>
                  {isStaff && <th style={s.th}>{t('tickets_assignedTo')}</th>}
                  <th style={s.th}>{t('tickets_messages')}</th>
                  <th style={s.th}>{t('tickets_updated')}</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((tk) => (
                  <tr key={tk.id}>
                    <td style={s.td}>{tk.id}</td>
                    <td style={s.td}>
                      <Link to={`/tickets/${tk.id}`} style={localStyles.link}>{tk.subject}</Link>
                    </td>
                    <td style={s.td}><StatusBadge status={tk.status} label={statusLabel(tk.status)} /></td>
                    <td style={s.td}><PriorityBadge priority={tk.priority} label={priorityLabel(tk.priority)} /></td>
                    <td style={{ ...s.td, color: '#64748b' }}>{tk.requester_name || tk.requester_email}</td>
                    {isStaff && (
                      <td style={s.td}>
                        {tk.assigned_to_name ?? <span style={{ color: '#94a3b8' }}>{t('tickets_unassigned')}</span>}
                      </td>
                    )}
                    <td style={s.td}>{tk.message_count}</td>
                    <td style={{ ...s.td, color: '#64748b' }}>{new Date(tk.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
                {tickets.length === 0 && (
                  <tr>
                    <td colSpan={isStaff ? 8 : 7} style={{ ...s.td, textAlign: 'center', color: '#9ca3af' }}>
                      {t('tickets_noTickets')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div style={localStyles.pagination}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={localStyles.pageBtn}>←</button>
            <span style={localStyles.pageInfo}>{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={localStyles.pageBtn}>→</button>
          </div>
        )}
      </div>
    </div>
  )
}

const localStyles: Record<string, React.CSSProperties> = {
  createForm:   { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' },
  input:        { padding: '.375rem .75rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.875rem', width: '100%', boxSizing: 'border-box' },
  selectInForm: { padding: '.3rem .6rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', background: '#fff' },
  fileLabel:    { padding: '.25rem .6rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8rem', cursor: 'pointer', color: '#374151' },
  fileNames:    { fontSize: '.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '.35rem' },
  fileClear:    { background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '.85rem', padding: 0 },
  errorText:    { color: '#b91c1c', fontSize: '.875rem', margin: 0 },
  countPill:    { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  link:         { color: '#2563eb', textDecoration: 'none', fontWeight: 500 },
  pagination:   { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.75rem', padding: '.75rem 0', borderTop: '1px solid #e2e8f0' },
  pageBtn:      { padding: '.25rem .5rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4, cursor: 'pointer', fontSize: '.8125rem', color: '#374151' },
  pageInfo:     { fontSize: '.8125rem', color: '#64748b' },
}
