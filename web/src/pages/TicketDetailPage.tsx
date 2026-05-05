import { useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTicket, getUsers, updateTicket, addTicketMessage, uploadAttachments, downloadAttachment, type TicketMessage, type TicketAttachment } from '../api/client'
import Select from '../components/Select'
import { usePageTitle } from '../hooks/usePageTitle'
import { useI18n } from '../i18n/I18nContext'
import { useAuth } from '../context/AuthContext'
import { formatApiError } from '../lib/formError'

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Badge({ value, colors }: { value: string; colors: Record<string, { bg: string; fg: string }> }) {
  const c = colors[value] ?? { bg: '#f3f4f6', fg: '#374151' }
  return <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 4, fontSize: '.75rem', fontWeight: 600 }}>{value}</span>
}

// Renders a system event message ("Alice changed status from open → closed").
// The body column for events stores JSON: { event, old, new }. We translate the
// event type and value labels rather than the server-side string so the line
// reads correctly in the viewer's locale.
function EventLine({ msg }: { msg: TicketMessage }) {
  const { t } = useI18n()
  let payload: { event?: string; old?: unknown; new?: unknown } = {}
  try { payload = JSON.parse(msg.body) } catch { /* show raw on parse failure */ }

  const author = msg.author_name || msg.author_email || 'system'
  const when = new Date(msg.created_at).toLocaleString()

  const labelFor = (event: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return t('ticketDetail_event_none')
    const s = String(value)
    if (event === 'status_changed')   return t(`ticket_status_${s}` as any) || s
    if (event === 'priority_changed') return t(`ticket_priority_${s}` as any) || s
    if (event === 'assignee_changed') return s // user id; keep raw — UI will show name on next reload
    return s
  }

  const event = payload.event ?? 'unknown'
  const oldLabel = labelFor(event, payload.old)
  const newLabel = labelFor(event, payload.new)
  const verb =
    event === 'status_changed'   ? t('ticketDetail_event_statusChanged') :
    event === 'priority_changed' ? t('ticketDetail_event_priorityChanged') :
    event === 'assignee_changed' ? t('ticketDetail_event_assigneeChanged') :
                                   event

  return (
    <div style={styles.eventLine}>
      <span style={styles.eventText}>
        {author} · {verb}: {oldLabel} → {newLabel}
      </span>
      <span style={styles.eventTime}>{when}</span>
    </div>
  )
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const ticketId = Number(id)
  const { t } = useI18n()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isStaff = user?.role === 'admin' || user?.role === 'operator'

  const [replyBody, setReplyBody]       = useState('')
  const [isInternal, setIsInternal]     = useState(false)
  const [files, setFiles]               = useState<File[]>([])
  const [sending, setSending]           = useState(false)
  const [sendError, setSendError]       = useState<string | null>(null)
  const [updating, setUpdating]         = useState(false)
  const [dragOver, setDragOver]         = useState(false)
  const textareaRef                     = useRef<HTMLTextAreaElement>(null)

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => getTicket(ticketId).then(r => r.data),
  })

  // Window title shows the ticket ID/subject so the browser tab is meaningful when
  // multiple tickets are open. Falls back to the static label while loading.
  usePageTitle(ticket ? `#${ticket.id} — ${ticket.subject}` : 'Support Ticket')

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => getUsers().then(r => r.data),
    enabled: isStaff,
  })

  const staffUsers = (users ?? []).filter(u => u.role === 'admin' || u.role === 'operator')

  async function handleFieldUpdate(field: string, value: unknown) {
    setUpdating(true)
    try {
      await updateTicket(ticketId, { [field]: value } as any)
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['tickets'] })
    } finally {
      setUpdating(false)
    }
  }

  function appendFiles(incoming: File[]) {
    if (incoming.length === 0) return
    setFiles(prev => [...prev, ...incoming].slice(0, 20))
  }

  // Build a quoted reply prefix from a previous message and prepend it to the
  // textarea, focusing it. Mirrors the conventional email-client behavior.
  function quoteMessage(msg: TicketMessage) {
    const author = msg.author_name || msg.author_email || 'Unknown'
    const date = new Date(msg.created_at).toLocaleString()
    const lines = msg.body.split('\n').map(l => `> ${l}`).join('\n')
    const prefix = `${t('ticketDetail_onWrote', author, date)}\n${lines}\n\n`
    setReplyBody(prev => prefix + prev)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(0, 0)
        ta.scrollTop = 0
      }
    })
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer?.files ?? [])
    appendFiles(dropped)
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(e.clipboardData?.files ?? [])
    if (pasted.length > 0) {
      e.preventDefault() // skip pasting filename text
      appendFiles(pasted)
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault()
    if (!replyBody.trim()) return
    setSending(true)
    setSendError(null)
    try {
      const msgResp = await addTicketMessage(ticketId, { body: replyBody, is_internal: isInternal })
      if (files.length > 0) {
        await uploadAttachments(ticketId, msgResp.data.id, files)
      }
      qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      setReplyBody('')
      setIsInternal(false)
      setFiles([])
    } catch (err: any) {
      setSendError(formatApiError(err))
    } finally {
      setSending(false)
    }
  }

  if (isLoading) return <p>{t('loading')}</p>
  if (!ticket)   return <p style={{ color: '#b91c1c' }}>Not found</p>

  const statusLabel   = (s: string) => t(`ticket_status_${s}` as any) || s
  const priorityLabel = (p: string) => t(`ticket_priority_${p}` as any) || p

  return (
    <div style={{ padding: '1rem 1.5rem' }}>
      <div style={styles.breadcrumb}>
        <Link to="/tickets" style={styles.backLink}>{t('ticketDetail_back')}</Link>
      </div>

      <div style={styles.header}>
        <h2 style={styles.h2}>{ticket.subject}</h2>
        <Badge value={ticket.status} colors={STATUS_COLORS} />
        <Badge value={ticket.priority} colors={PRIORITY_COLORS} />
      </div>

      <div style={styles.meta}>
        <span><strong>{t('ticketDetail_requester')}:</strong> {ticket.requester_name || ticket.requester_email}</span>
        <span><strong>{t('tickets_source')}:</strong> {ticket.source}</span>
        <span><strong>{t('created')}:</strong> {new Date(ticket.created_at).toLocaleString()}</span>
      </div>

      {isStaff && (
        <div style={styles.staffControls}>
          <label style={styles.controlLabel}>
            {t('ticketDetail_status')}
            <Select
              style={styles.select}
              value={ticket.status}
              disabled={updating}
              onChange={v => handleFieldUpdate('status', v)}
              options={['open', 'in_progress', 'waiting', 'closed'].map(s => ({ value: s, label: statusLabel(s) }))}
            />
          </label>
          <label style={styles.controlLabel}>
            {t('ticketDetail_priority')}
            <Select
              style={styles.select}
              value={ticket.priority}
              disabled={updating}
              onChange={v => handleFieldUpdate('priority', v)}
              options={['low', 'normal', 'high', 'urgent'].map(p => ({ value: p, label: priorityLabel(p) }))}
            />
          </label>
          <label style={styles.controlLabel}>
            {t('ticketDetail_assignee')}
            <Select
              style={styles.select}
              value={ticket.assigned_to != null ? String(ticket.assigned_to) : ''}
              disabled={updating}
              onChange={v => handleFieldUpdate('assigned_to', v ? Number(v) : null)}
              options={[
                { value: '', label: t('tickets_unassigned') },
                ...staffUsers.map(u => ({ value: String(u.id), label: u.full_name || u.email })),
              ]}
            />
          </label>
        </div>
      )}

      <div style={styles.thread}>
        {ticket.messages.length === 0 ? (
          <p style={styles.muted}>{t('ticketDetail_noMessages')}</p>
        ) : ticket.messages.map((msg: TicketMessage) => {
          if (msg.kind === 'event') {
            return <EventLine key={msg.id} msg={msg} />
          }
          return (
            <div key={msg.id} style={{ ...styles.message, ...(msg.is_internal ? styles.messageInternal : {}) }}>
              <div style={styles.msgHeader}>
                <strong>{msg.author_name || msg.author_email}</strong>
                <span style={styles.muted}>{new Date(msg.created_at).toLocaleString()}</span>
                {msg.is_internal ? (
                  <span style={styles.internalBadge}>{t('ticketDetail_internalNote')}</span>
                ) : (
                  <span style={styles.sourceBadge}>{msg.source}</span>
                )}
                <button
                  type="button"
                  style={styles.quoteBtn}
                  onClick={() => quoteMessage(msg)}
                  title={t('ticketDetail_quoteTitle')}
                >
                  {t('ticketDetail_quote')}
                </button>
              </div>
              <div style={styles.msgBody}>{msg.body}</div>
              {msg.attachments?.length > 0 && (
                <div style={styles.attachList}>
                  {msg.attachments.map((att: TicketAttachment) => (
                    <button
                      key={att.id}
                      style={styles.attachBtn}
                      onClick={() => downloadAttachment(ticket.id, att.id, att.original_name)}
                      type="button"
                    >
                      📎 {att.original_name} <span style={styles.attachSize}>({formatBytes(att.size)})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <form
        onSubmit={handleReply}
        style={{ ...styles.replyForm, ...(dragOver ? styles.replyFormDrag : {}) }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          style={styles.textarea}
          placeholder={t('ticketDetail_replyPh')}
          value={replyBody}
          onChange={e => setReplyBody(e.target.value)}
          onPaste={handlePaste}
          required
          rows={4}
        />
        <div style={styles.fileRow}>
          <label style={styles.fileLabel}>
            📎 {t('ticketDetail_addFiles')}
            <input
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={e => appendFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <span style={styles.dragHint}>{t('ticketDetail_dragHint')}</span>
          {files.length > 0 && (
            <span style={styles.fileNames}>
              {files.map(f => f.name).join(', ')}
              <button type="button" style={styles.fileClear} onClick={() => setFiles([])}>✕</button>
            </span>
          )}
        </div>
        {isStaff && (
          <label style={styles.internalToggle}>
            <input
              type="checkbox"
              checked={isInternal}
              onChange={e => setIsInternal(e.target.checked)}
            />
            {' '}{t('ticketDetail_addInternal')}
          </label>
        )}
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <button type="submit" disabled={sending} style={styles.btnSend}>
            {sending ? t('ticketDetail_sending') : t('ticketDetail_send')}
          </button>
        </div>
        {sendError && <p style={styles.errorText}>{sendError}</p>}
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  breadcrumb:      { marginBottom: '.75rem' },
  backLink:        { color: '#64748b', textDecoration: 'none', fontSize: '.875rem' },
  header:          { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem', flexWrap: 'wrap' as const },
  h2:              { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  meta:            { display: 'flex', gap: '1.5rem', flexWrap: 'wrap' as const, fontSize: '.875rem', color: '#64748b', marginBottom: '1rem' },
  staffControls:   { display: 'flex', gap: '1rem', flexWrap: 'wrap' as const, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem 1rem', marginBottom: '1rem' },
  controlLabel:    { display: 'flex', flexDirection: 'column' as const, gap: '.25rem', fontSize: '.8rem', color: '#64748b', fontWeight: 600 },
  select:          { padding: '.3rem .6rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.875rem', background: '#fff' },
  thread:          { display: 'flex', flexDirection: 'column' as const, gap: '.75rem', marginBottom: '1.5rem' },
  message:         { border: '1px solid #e2e8f0', borderRadius: 6, padding: '.75rem 1rem', background: '#fff' },
  messageInternal: { background: '#fffbeb', borderColor: '#fcd34d' },
  msgHeader:       { display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.5rem', flexWrap: 'wrap' as const, fontSize: '.875rem' },
  msgBody:         { whiteSpace: 'pre-wrap' as const, fontSize: '.875rem', lineHeight: 1.6 },
  muted:           { color: '#94a3b8', fontSize: '.875rem' },
  internalBadge:   { background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 4, fontSize: '.7rem', fontWeight: 700 },
  sourceBadge:     { background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: 4, fontSize: '.7rem' },
  replyForm:       { display: 'flex', flexDirection: 'column' as const, gap: '.5rem' },
  textarea:        { padding: '.375rem .75rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.875rem', resize: 'vertical' as const, fontFamily: 'inherit' },
  internalToggle:  { display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.875rem', color: '#374151', cursor: 'pointer' },
  btnSend:         { padding: '.3125rem .75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  errorText:       { color: '#b91c1c', fontSize: '.875rem', margin: 0 },
  attachList:      { display: 'flex', flexWrap: 'wrap' as const, gap: '.35rem', marginTop: '.5rem' },
  attachBtn:       { background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 8px', fontSize: '.8rem', color: '#2563eb', cursor: 'pointer' },
  attachSize:      { color: '#94a3b8' },
  fileRow:         { display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' as const },
  fileLabel:       { padding: '.25rem .6rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8rem', cursor: 'pointer', color: '#374151' },
  fileNames:       { fontSize: '.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '.35rem' },
  fileClear:       { background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '.85rem', padding: 0 },
  dragHint:        { fontSize: '.75rem', color: '#94a3b8' },
  replyFormDrag:   { outline: '2px dashed #93c5fd', outlineOffset: 2, background: '#eff6ff' },
  quoteBtn:        { marginLeft: 'auto', background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '1px 8px', fontSize: '.7rem', color: '#64748b', cursor: 'pointer' },
  eventLine:       { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem', padding: '.25rem 0', fontSize: '.75rem', color: '#94a3b8' },
  eventText:       { fontStyle: 'italic' as const },
  eventTime:       { color: '#cbd5e1' },
}
