import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTickets, getUsers, createTicket, uploadAttachments, type Ticket } from '../api/client'
import { useI18n } from '../i18n/I18nContext'
import { useAuth } from '../context/AuthContext'

const LIMIT = 50

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

  const [statusFilter, setStatusFilter]     = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
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

  const { data, isLoading } = useQuery({
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
        await uploadAttachments(resp.data.id, resp.data.messageId, createFiles)
      }
      qc.invalidateQueries({ queryKey: ['tickets'] })
      setForm({ subject: '', body: '', priority: 'normal' })
      setCreateFiles([])
      setShowCreate(false)
    } catch (err: any) {
      setCreateError(err.response?.data?.message ?? 'Error')
    } finally {
      setCreating(false)
    }
  }

  const statusLabel = (s: string) => t(`ticket_status_${s}` as any) || s
  const priorityLabel = (p: string) => t(`ticket_priority_${p}` as any) || p

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>{t('tickets_title')}</h2>
        {total > 0 && <span style={styles.totalBadge}>{total.toLocaleString()}</span>}
        <button onClick={() => setShowCreate(s => !s)} style={styles.btnCreate}>{t('tickets_newTicket')}</button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.createForm}>
          <input
            style={styles.input}
            placeholder={t('tickets_subjectPh')}
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            required
          />
          <textarea
            style={{ ...styles.input, minHeight: 80 }}
            placeholder={t('tickets_bodyPh')}
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            required
          />
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={styles.fileLabel}>
              📎 {t('ticketDetail_addFiles')}
              <input
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={e => setCreateFiles(Array.from(e.target.files ?? []).slice(0, 20))}
              />
            </label>
            {createFiles.length > 0 && (
              <span style={styles.fileNames}>
                {createFiles.map(f => f.name).join(', ')}
                <button type="button" style={styles.fileClear} onClick={() => setCreateFiles([])}>✕</button>
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <select style={styles.select} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {['low', 'normal', 'high', 'urgent'].map(p => (
                <option key={p} value={p}>{priorityLabel(p)}</option>
              ))}
            </select>
            <button type="submit" disabled={creating} style={styles.btnSubmit}>
              {creating ? t('creating') : t('create')}
            </button>
            <button type="button" onClick={() => setShowCreate(false)} style={styles.btnCancel}>{t('cancel')}</button>
          </div>
          {createError && <p style={styles.errorText}>{createError}</p>}
        </form>
      )}

      <div style={styles.filters}>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} style={styles.select}>
          <option value="">{t('tickets_allStatuses')}</option>
          {['open', 'in_progress', 'waiting', 'closed'].map(s => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1) }} style={styles.select}>
          <option value="">{t('tickets_allPriorities')}</option>
          {['low', 'normal', 'high', 'urgent'].map(p => (
            <option key={p} value={p}>{priorityLabel(p)}</option>
          ))}
        </select>
        {isStaff && (
          <select value={assigneeFilter} onChange={e => { setAssigneeFilter(e.target.value); setPage(1) }} style={styles.select}>
            <option value="">{t('tickets_allAssignees')}</option>
            {staffUsers.map(u => (
              <option key={u.id} value={String(u.id)}>{u.full_name || u.email}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? <p>{t('loading')}</p> : tickets.length === 0 ? (
        <p style={styles.muted}>{t('tickets_noTickets')}</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>#</th>
              <th style={styles.th}>{t('tickets_subject')}</th>
              <th style={styles.th}>{t('ticketDetail_status')}</th>
              <th style={styles.th}>{t('ticketDetail_priority')}</th>
              <th style={styles.th}>{t('tickets_requester')}</th>
              {isStaff && <th style={styles.th}>{t('tickets_assignedTo')}</th>}
              <th style={styles.th}>{t('tickets_messages')}</th>
              <th style={styles.th}>{t('tickets_updated')}</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((tk) => (
              <tr key={tk.id} style={styles.tr}>
                <td style={styles.td}>{tk.id}</td>
                <td style={styles.td}>
                  <Link to={`/tickets/${tk.id}`} style={styles.link}>{tk.subject}</Link>
                </td>
                <td style={styles.td}><StatusBadge status={tk.status} label={statusLabel(tk.status)} /></td>
                <td style={styles.td}><PriorityBadge priority={tk.priority} label={priorityLabel(tk.priority)} /></td>
                <td style={styles.td}>
                  <span style={styles.muted}>{tk.requester_name || tk.requester_email}</span>
                </td>
                {isStaff && (
                  <td style={styles.td}>
                    {tk.assigned_to_name ?? <span style={styles.muted}>{t('tickets_unassigned')}</span>}
                  </td>
                )}
                <td style={styles.td}>{tk.message_count}</td>
                <td style={styles.td}>
                  <span style={styles.muted}>{new Date(tk.updated_at).toLocaleString()}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div style={styles.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={styles.pageBtn}>←</button>
          <span style={styles.pageInfo}>{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={styles.pageBtn}>→</button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header:     { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem' },
  h2:         { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  totalBadge: { fontSize: '.75rem', color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10 },
  btnCreate:  { marginLeft: 'auto', padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSubmit:  { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnCancel:  { padding: '.375rem .875rem', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  createForm: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column' as const, gap: '.5rem' },
  input:      { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', width: '100%', boxSizing: 'border-box' as const },
  filters:    { display: 'flex', gap: '.5rem', marginBottom: '1rem', flexWrap: 'wrap' as const },
  select:     { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem' },
  muted:      { color: '#9ca3af', fontSize: '.875rem' },
  fileLabel:  { padding: '.25rem .6rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8rem', cursor: 'pointer', color: '#374151' },
  fileNames:  { fontSize: '.8rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '.35rem' },
  fileClear:  { background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '.85rem', padding: 0 },
  errorText:  { color: '#b91c1c', fontSize: '.875rem', margin: 0 },
  table:      { width: '100%', borderCollapse: 'collapse' },
  th:         { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const },
  tr:         { borderBottom: '1px solid #e5e7eb' },
  td:         { padding: '.625rem .75rem', fontSize: '.875rem', verticalAlign: 'top' },
  link:       { color: '#2563eb', textDecoration: 'none', fontWeight: 500 },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.75rem', marginTop: '1rem' },
  pageBtn:    { padding: '.25rem .5rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' },
  pageInfo:   { fontSize: '.875rem', color: '#6b7280' },
}
