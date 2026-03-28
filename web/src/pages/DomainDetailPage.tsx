import { useState, useRef, useEffect, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { saveDomainEdits, loadDomainEdits, clearDomainEdits, setLiveDirty } from '../hooks/domainEditCache'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDomain, getRecords, createRecord, deleteRecord,
  createBulkJob, previewBulkJob, approveBulkJob, searchByRecord,
  updateDomainLabels, getLabelSuggestions, updateDomain, deleteDomain, getZoneText,
  getCustomers,
  type DnsRecord, type Label, type Domain, type LabelSuggestion, type Customer,
} from '../api/client'
import ZoneStatusBadge from '../components/ZoneStatusBadge'
import LabelChip, { getLabelColors } from '../components/LabelChip'
import ColorPicker from '../components/ColorPicker'
import ImportZoneModal from '../components/ImportZoneModal'
import DnssecModal from '../components/DnssecModal'
import { useI18n } from '../i18n/I18nContext'
import { useAuth } from '../context/AuthContext'

const INLINE_STYLES = `
  .inline-field:hover { border-color: #d1d5db !important; background: #fff !important; }
  .inline-field:focus { border-color: #2563eb !important; background: #fff !important; outline: none !important; box-shadow: 0 0 0 2px #bfdbfe; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .alias-hint { position: relative; display: inline-block; }
  .alias-hint::after {
    content: attr(data-tip);
    position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
    background: #1f2937; color: #f9fafb; font-size: .75rem; font-weight: 400;
    padding: 5px 8px; border-radius: 5px; white-space: normal; width: max-content; max-width: 220px;
    pointer-events: none; opacity: 0; transition: opacity 0s;
  }
  .alias-hint:hover::after { opacity: 1; }
`

const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"


interface EditRow {
  name: string
  type: string
  ttl: string
  value: string
  priority: string
  weight: string
  port: string
}

interface NewRow extends EditRow {
  _newId: string  // client-only key
}

// ── Bulk-edit count button ────────────────────────────────────

function BulkEditButton({ rec }: { rec: DnsRecord }) {
  const { t } = useI18n()
  const navigate = useNavigate()

  const rawValue = rec.type === 'MX' ? rec.value : rec.type === 'SRV' ? rec.value : rec.value

  const { data } = useQuery<{ id: number }[]>({
    queryKey: ['record-search-count', rec.type, rec.name, rawValue],
    queryFn: () => searchByRecord({ type: rec.type, name: rec.name, value: rawValue }).then(r => r.data),
    staleTime: 30_000,
  })

  const count = data?.length ?? null

  function handleClick() {
    const params = new URLSearchParams({ type: rec.type, name: rec.name, value: rawValue })
    navigate(`/jobs?${params.toString()}`)
  }

  if (count === null) return null
  return (
    <button onClick={handleClick} style={styles.bulkBtn} title="Bulk edit across domains">
      {t('domainDetail_bulkEditBtn', count)}
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function DomainDetailPage() {
  const { id } = useParams<{ id: string }>()
  const domainId = Number(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isOperator = user?.role === 'operator'

  // edits: changes to existing records keyed by record id
  const [edits, setEdits] = useState<Record<number, EditRow>>({})
  // pendingDeletes: ids of records marked for deletion
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set())
  // newRows: new records not yet saved
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [zoneModal, setZoneModal] = useState<{ text: string; highlightLine: number } | null>(null)

  const [applying, setApplying] = useState(false)
  const applyingRef = useRef(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [loadedFromCacheSerial, setLoadedFromCacheSerial] = useState<number | null>(null)
  const [pendingRefresh, setPendingRefresh] = useState(false)
  const pendingRefreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [labelKey, setLabelKey] = useState('')
  const [labelValue, setLabelValue] = useState('')
  const [addAdminOnly, setAddAdminOnly] = useState(false)
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null)
  const [editKey, setEditKey] = useState('')
  const [editValue, setEditValue] = useState('')
  const [editColor, setEditColor] = useState<string | null>(null)
  const [editAdminOnly, setEditAdminOnly] = useState(false)
  const [savingLabels, setSavingLabels] = useState(false)
  const [togglingStatus, setTogglingStatus] = useState(false)
  const [togglingDnssec, setTogglingDnssec] = useState(false)
  const [movingCustomer, setMovingCustomer] = useState(false)
  const [editingTtl, setEditingTtl] = useState(false)
  const [ttlDraft, setTtlDraft] = useState('')
  const [savingTtl, setSavingTtl] = useState(false)
  const [showDnssecModal, setShowDnssecModal] = useState(false)
  const [deletingDomain, setDeletingDomain] = useState(false)
  const [showAddKeyDrop, setShowAddKeyDrop] = useState(false)
  const [showEditKeyDrop, setShowEditKeyDrop] = useState(false)

  const { data: domain, isLoading: loadingDomain } = useQuery<Domain>({
    queryKey: ['domain', domainId],
    queryFn: () => getDomain(domainId).then(r => r.data),
  })

  const { data: records = [], isLoading: loadingRecords, dataUpdatedAt } = useQuery({
    queryKey: ['records', domainId],
    queryFn: () => getRecords(domainId).then(r => r.data),
  })

  // Refs always holding the latest state values — used in the effect cleanup below.
  // Assigned in the render body (not in an effect) so they capture current state.
  // Exception: serial is tracked via useEffect so the cleanup sees the OLD domain's
  // serial even after React Query has already switched to the new domain's data.
  const latestEdits = useRef(edits)
  const latestPendingDeletes = useRef(pendingDeletes)
  const latestNewRows = useRef(newRows)
  const lastKnownSerialRef = useRef<number>(0)
  latestEdits.current = edits
  latestPendingDeletes.current = pendingDeletes
  latestNewRows.current = newRows

  useEffect(() => {
    if (domain?.last_serial) lastKnownSerialRef.current = domain.last_serial
  }, [domain?.last_serial])

  // Save/restore per-domain edit state when switching between domains
  useEffect(() => {
    const saved = loadDomainEdits(domainId)
    setEdits(saved?.edits ?? {})
    setPendingDeletes(new Set(saved?.pendingDeletes ?? []))
    setNewRows(saved?.newRows ?? [])
    setApplyError(null)
    setLoadedFromCacheSerial(saved?.serial ?? null)
    return () => {
      setLiveDirty(domainId, false)
      saveDomainEdits(domainId, {
        serial: lastKnownSerialRef.current,
        edits: latestEdits.current,
        pendingDeletes: [...latestPendingDeletes.current],
        newRows: latestNewRows.current,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId])

  // Clear pendingRefresh when records data actually updates (WS-triggered refetch completed)
  useEffect(() => {
    if (pendingRefresh) {
      setPendingRefresh(false)
      clearTimeout(pendingRefreshTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUpdatedAt])


  const { data: labelSuggestions = [] } = useQuery({
    queryKey: ['label-suggestions', domain?.customer_id],
    queryFn: () => getLabelSuggestions(domain?.customer_id).then(r => r.data),
    staleTime: 30_000,
    enabled: !!domain,
  })

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: () => getCustomers().then(r => r.data),
    enabled: isAdmin,
    staleTime: 60_000,
  })

  // ── existing record helpers ──────────────────────────────────────────────

  function getRow(rec: DnsRecord): EditRow {
    return edits[rec.id] ?? {
      name: rec.name,
      type: rec.type,
      ttl: rec.ttl != null ? String(rec.ttl) : '',
      value: rec.value,
      priority: rec.priority != null ? String(rec.priority) : '',
      weight: rec.weight != null ? String(rec.weight) : '',
      port: rec.port != null ? String(rec.port) : '',
    }
  }

  function setField(recId: number, rec: DnsRecord, field: keyof EditRow, value: string) {
    const current = getRow(rec)
    const next = { ...current, [field]: value }
    const original: EditRow = {
      name: rec.name,
      type: rec.type,
      ttl: rec.ttl != null ? String(rec.ttl) : '',
      value: rec.value,
      priority: rec.priority != null ? String(rec.priority) : '',
      weight: rec.weight != null ? String(rec.weight) : '',
      port: rec.port != null ? String(rec.port) : '',
    }
    const isDirty = next.name !== original.name || next.type !== original.type ||
      next.ttl !== original.ttl || next.value !== original.value ||
      next.priority !== original.priority || next.weight !== original.weight || next.port !== original.port
    if (isDirty) {
      setEdits(prev => ({ ...prev, [recId]: next }))
    } else {
      setEdits(prev => { const n = { ...prev }; delete n[recId]; return n })
    }
  }

  function markDelete(rec: DnsRecord) {
    setPendingDeletes(prev => new Set(prev).add(rec.id))
    setEdits(prev => { const n = { ...prev }; delete n[rec.id]; return n })
  }

  function unmarkDelete(recId: number) {
    setPendingDeletes(prev => { const s = new Set(prev); s.delete(recId); return s })
  }

  // ── new row helpers ──────────────────────────────────────────────────────

  function addNewRow() {
    setNewRows(prev => [{ _newId: crypto.randomUUID(), name: '@', type: 'A', ttl: '', value: '', priority: '', weight: '', port: '' }, ...prev])
  }

  function setNewField(newId: string, field: keyof EditRow, value: string) {
    setNewRows(prev => prev.map(r => r._newId === newId ? { ...r, [field]: value } : r))
  }

  function removeNewRow(newId: string) {
    setNewRows(prev => prev.filter(r => r._newId !== newId))
  }

  // ── apply ────────────────────────────────────────────────────────────────

  const dirtyIds = Object.keys(edits).map(Number)
  const hasDirty = dirtyIds.length > 0 || pendingDeletes.size > 0 || newRows.length > 0
  setLiveDirty(domainId, hasDirty)
  const conflictWarning = hasDirty
    && loadedFromCacheSerial !== null
    && loadedFromCacheSerial > 0
    && !!domain?.last_serial
    && loadedFromCacheSerial !== domain.last_serial

  function handleForceReload() {
    handleDiscard()
    qc.invalidateQueries({ queryKey: ['records', domainId] })
    qc.invalidateQueries({ queryKey: ['domain', domainId] })
  }

  const showPriority = (records as DnsRecord[]).some(rec => {
    const rt = getRow(rec).type; return rt === 'MX' || rt === 'SRV'
  }) || newRows.some(r => r.type === 'MX' || r.type === 'SRV')
  const showWeightPort = (records as DnsRecord[]).some(rec => getRow(rec).type === 'SRV')
    || newRows.some(r => r.type === 'SRV')

  async function handleApply() {
    if (!hasDirty || applyingRef.current) return
    applyingRef.current = true
    setApplying(true)
    setApplyError(null)
    // Snapshot the rows to submit — skip new rows with empty value
    const rowsToCreate = newRows.filter(r => r.value.trim() !== '')
    try {
      // 1. Create new records directly (API enqueues render)
      for (const row of rowsToCreate) {
        const ttlNum = row.ttl === '' ? undefined : Number(row.ttl)
        const body: Partial<DnsRecord> = { name: row.name.trim(), type: row.type, value: row.value.trim() }
        // CNAME at apex → submit as ALIAS (CNAME flattening)
        if (body.type === 'CNAME' && body.name === '@') body.type = 'ALIAS'
        if (ttlNum !== undefined) body.ttl = ttlNum
        if (row.type === 'MX') {
          body.priority = Number(row.priority)
        } else if (row.type === 'SRV') {
          body.priority = Number(row.priority)
          body.weight = Number(row.weight)
          body.port = Number(row.port)
        }
        await createRecord(domainId, body)
      }

      // 2. Delete pending deletes directly
      for (const recId of pendingDeletes) {
        await deleteRecord(domainId, recId)
      }

      // 3. Update edited records via bulk job (replace)
      for (const recId of dirtyIds) {
        const rec = (records as DnsRecord[]).find(r => r.id === recId)
        if (!rec) continue
        const row = edits[recId]
        const ttlNum = row.ttl === '' ? null : Number(row.ttl)
        let priority: number | undefined, weight: number | undefined, port: number | undefined, value: string
        if (row.type === 'MX') {
          priority = Number(row.priority)
          value = row.value.trim()
        } else if (row.type === 'SRV') {
          priority = Number(row.priority)
          weight = Number(row.weight)
          port = Number(row.port)
          value = row.value.trim()
        } else {
          value = row.value.trim()
        }
        const job = await createBulkJob({
          operation: 'replace',
          filter_json: { mode: 'explicit', domain_ids: [domainId] },
          payload_json: {
            match: { name: rec.name, type: rec.type, value_contains: rec.value },
            replace_with: {
              name: row.name.trim(), type: row.type === 'CNAME' && row.name.trim() === '@' ? 'ALIAS' : row.type, ttl: ttlNum, value,
              ...(priority !== undefined && { priority }),
              ...(weight !== undefined && { weight }),
              ...(port !== undefined && { port }),
            },
          },
        })
        await previewBulkJob(job.data.id)
        await approveBulkJob(job.data.id)
      }

      const hadEdits = dirtyIds.length > 0
      const submittedIds = new Set(rowsToCreate.map(r => r._newId))
      setEdits({})
      setPendingDeletes(new Set())
      setNewRows(prev => prev.filter(r => !submittedIds.has(r._newId)))
      clearDomainEdits(domainId)
      qc.invalidateQueries({ queryKey: ['records', domainId] })
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
      if (hadEdits) {
        setPendingRefresh(true)
        pendingRefreshTimer.current = setTimeout(() => setPendingRefresh(false), 8_000)
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; error?: string } }; message?: string }
      const data = err?.response?.data
      let msg: string = data?.message ?? data?.error ?? err.message ?? 'Failed to apply changes'
      // Zod errors come back as a JSON string — unwrap to readable text
      try {
        const parsed: unknown = JSON.parse(msg)
        if (Array.isArray(parsed)) {
          msg = parsed.map((z: { path?: string[]; message?: string }) => `${z.path?.join('.') || 'field'}: ${z.message}`).join(', ')
        }
      } catch { /* not JSON, use as-is */ }
      setApplyError(msg)
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }

  function handleDiscard() {
    setEdits({})
    setPendingDeletes(new Set())
    setNewRows([])
    setApplyError(null)
    clearDomainEdits(domainId)
  }

  function handleImportStage(importedNewRows: NewRow[], importedEdits: Record<number, EditRow>) {
    setNewRows(prev => [...importedNewRows, ...prev])
    setEdits(prev => ({ ...prev, ...importedEdits }))
  }

  // ── label helpers ─────────────────────────────────────────────────────────

  const labels: Label[] = domain?.labels ?? []

  function patchLabelsCache(next: Label[]) {
    qc.setQueryData<Domain>(['domain', domainId], old => old ? { ...old, labels: next } : old)
  }

  async function handleAddLabel(e: React.FormEvent) {
    e.preventDefault()
    if (!labelKey.trim() || savingLabels) return
    const next = [...labels, { id: 0, key: labelKey.trim(), value: labelValue.trim(), admin_only: isAdmin && addAdminOnly }]
    patchLabelsCache(next)
    setLabelKey('')
    setLabelValue('')
    setAddAdminOnly(false)
    setSavingLabels(true)
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
      qc.invalidateQueries({ queryKey: ['label-suggestions', domain?.customer_id] })
    }
    try {
      await updateDomainLabels(domainId, next)
      invalidate()
    } catch {
      invalidate()
    } finally {
      setSavingLabels(false)
    }
  }

  async function handleSaveEdit() {
    if (!editKey.trim() || savingLabels) return
    const next = labels.map(l => l.id === editingLabelId
      ? { ...l, key: editKey.trim(), value: editValue.trim(), color: editColor, admin_only: isAdmin ? editAdminOnly : l.admin_only }
      : l)
    patchLabelsCache(next)
    setEditingLabelId(null)
    setSavingLabels(true)
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
      qc.invalidateQueries({ queryKey: ['label-suggestions', domain?.customer_id] })
    }
    try {
      await updateDomainLabels(domainId, next)
      invalidate()
    } catch {
      invalidate()
    } finally {
      setSavingLabels(false)
    }
  }

  async function handleRemoveLabel(id: number) {
    if (savingLabels) return
    const next = labels.filter(l => l.id !== id)
    patchLabelsCache(next)
    setSavingLabels(true)
    try {
      await updateDomainLabels(domainId, next)
    } catch {
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
      qc.invalidateQueries({ queryKey: ['label-suggestions', domain?.customer_id] })
    } finally {
      setSavingLabels(false)
    }
  }

  function KeySuggestionDrop({ input, show, onPick }: { input: string; show: boolean; onPick: (s: LabelSuggestion) => void }) {
    const filtered = labelSuggestions.filter(s => !input.trim() || s.key.toLowerCase().includes(input.trim().toLowerCase()))
    if (!show || filtered.length === 0) return null
    return (
      <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, boxShadow: '0 4px 6px -1px rgba(0,0,0,.1)', minWidth: 160, maxHeight: 200, overflowY: 'auto' }}>
        {filtered.map(s => {
          const { bg } = getLabelColors(s.color, s.key)
          return (
            <div key={s.key} onMouseDown={() => onPick(s)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer', fontSize: '.8125rem' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: bg, flexShrink: 0, border: '1px solid rgba(0,0,0,.08)' }} />
              {s.admin_only && <span style={{ opacity: 0.5, fontSize: '.65rem' }}>🔒</span>}
              <span>{s.key}</span>
            </div>
          )
        })}
      </div>
    )
  }

  // ── Admin domain lifecycle ────────────────────────────────────────────────

  async function handleToggleStatus() {
    if (!domain || togglingStatus) return
    const newStatus = domain.status === 'active' ? 'suspended' : 'active'
    setTogglingStatus(true)
    try {
      await updateDomain(domainId, { status: newStatus } as any)
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
      qc.invalidateQueries({ queryKey: ['domains'] })
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
    } finally {
      setTogglingStatus(false)
    }
  }

  async function handleMoveCustomer(newCustomerId: number) {
    if (!domain || movingCustomer || newCustomerId === domain.customer_id) return
    setMovingCustomer(true)
    try {
      await updateDomain(domainId, { customer_id: newCustomerId } as any)
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
      qc.invalidateQueries({ queryKey: ['domains'] })
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
    } finally {
      setMovingCustomer(false)
    }
  }

  async function handleSaveTtl() {
    if (!domain || savingTtl) return
    const val = parseInt(ttlDraft, 10)
    if (!Number.isInteger(val) || val < 1) { setEditingTtl(false); return }
    if (val === domain.default_ttl) { setEditingTtl(false); return }
    setSavingTtl(true)
    try {
      await updateDomain(domainId, { default_ttl: val } as any)
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
    } finally {
      setSavingTtl(false)
      setEditingTtl(false)
    }
  }

  async function handleToggleDnssec() {
    if (!domain || togglingDnssec) return
    setTogglingDnssec(true)
    try {
      await updateDomain(domainId, { dnssec_enabled: !domain.dnssec_enabled } as any)
      qc.invalidateQueries({ queryKey: ['domain', domainId] })
      qc.invalidateQueries({ queryKey: ['domains'] })
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
    } finally {
      setTogglingDnssec(false)
    }
  }

  async function handleDelete() {
    if (!domain || !window.confirm(`Delete ${domain.fqdn}? It will be permanently purged after 30 days.`)) return
    setDeletingDomain(true)
    try {
      await deleteDomain(domainId)
      navigate('/domains')
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
      setDeletingDomain(false)
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  if (loadingDomain) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', padding: '3rem 0', color: '#6b7280', fontSize: '.875rem' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: 18, height: 18, border: '2px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
      {t('loading')}
    </div>
  )
  if (!domain) return <p>Domain not found</p>

  const changeCount = dirtyIds.length + pendingDeletes.size + newRows.length

  return (
    <div>
      <style>{INLINE_STYLES}</style>
      <div style={styles.header}>
        <button onClick={() => navigate('/domains')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#9ca3af', padding: '0 4px', lineHeight: 1, flexShrink: 0 }} title="Close">×</button>
        <h2 style={styles.h2}>{domain.fqdn}</h2>
        <ZoneStatusBadge status={domain.zone_status} />
        {(isAdmin || isOperator) && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem' }}>
            {isAdmin && domain.status !== 'deleted' && (
              <button
                onClick={handleToggleStatus}
                disabled={togglingStatus}
                style={domain.status === 'suspended' ? styles.btnSuccess : styles.btnWarning}
              >
                {togglingStatus ? '…' : domain.status === 'suspended' ? 'Activate' : 'Suspend'}
              </button>
            )}
            {domain.status !== 'deleted' && (
              <button
                onClick={domain.dnssec_enabled ? () => setShowDnssecModal(true) : handleToggleDnssec}
                disabled={togglingDnssec}
                style={domain.dnssec_enabled ? styles.btnWarning : styles.btnSecondary}
              >
                {togglingDnssec ? '…' : domain.dnssec_enabled ? 'DNSSEC' : 'Enable DNSSEC'}
              </button>
            )}
            {isAdmin && (
              <button onClick={handleDelete} disabled={deletingDomain} style={styles.btnDanger}>
                {deletingDomain ? '…' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>

      {conflictWarning && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '.6rem 1rem', borderRadius: 6, marginBottom: '.75rem', fontSize: '.875rem', display: 'flex', alignItems: 'center', gap: '.75rem', border: '1px solid #fde68a' }}>
          <span>⚠ This zone was updated by someone else while you were away. Your unsaved edits may conflict.</span>
          <button onClick={handleForceReload} style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 4, border: '1px solid #f59e0b', background: '#fff', color: '#92400e', fontSize: '.8125rem', fontWeight: 600, cursor: 'pointer' }}>
            Discard &amp; reload
          </button>
        </div>
      )}

      {domain.status === 'suspended' && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '.6rem 1rem', borderRadius: 6, marginBottom: '.75rem', fontSize: '.875rem', display: 'flex', alignItems: 'center', gap: '.5rem', border: '1px solid #fde68a' }}>
          <strong>Suspended</strong> — zone is not served to secondaries. Click Activate to resume.
        </div>
      )}

      {domain.ns_ok === 0 && domain.status === 'active' && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '.6rem 1rem', borderRadius: 6, marginBottom: '.75rem', fontSize: '.875rem', border: '1px solid #fde68a' }}>
          <strong>NS delegation mismatch</strong> — public DNS returns different nameservers for this domain.
          {domain.expected_ns?.length > 0 && (
            <div style={{ marginTop: '.375rem' }}>
              Set your domain's NS records at your registrar to:
              {domain.expected_ns.map(ns => (
                <code key={ns} style={{ display: 'block', fontFamily: MONO, fontSize: '.8rem', background: '#fef9c3', padding: '2px 6px', borderRadius: 3, marginTop: 2 }}>{ns}.</code>
              ))}
            </div>
          )}
        </div>
      )}

      {domain.zone_status === 'error' && (
        <div style={styles.errorBanner}>
          <strong>{t('domainDetail_zoneFailed')}</strong>
          {domain.zone_error && (
            <pre style={{ margin: '.5rem 0 0', fontFamily: MONO, fontSize: '.8125rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {renderZoneError(domain.zone_error, domainId, setZoneModal)}
            </pre>
          )}
        </div>
      )}

      <div style={styles.meta}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
          <span style={{
            display: 'inline-block', padding: '1px 8px', borderRadius: 10, fontSize: '.75rem', fontWeight: 600,
            background: domain.status === 'active' ? '#dcfce7' : domain.status === 'suspended' ? '#fef3c7' : '#f3f4f6',
            color:      domain.status === 'active' ? '#166534' : domain.status === 'suspended' ? '#92400e' : '#6b7280',
          }}>{domain.status}</span>
        </span>
        {isAdmin ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
            {t('customer')}:
            <select
              value={domain.customer_id}
              disabled={movingCustomer}
              onChange={e => handleMoveCustomer(Number(e.target.value))}
              style={{
                fontSize: 'inherit', fontWeight: 600,
                border: '1px solid transparent', borderRadius: 4,
                background: 'none', cursor: 'pointer', padding: '0 2px',
              }}
            >
              {customers.filter(c => c.is_active || c.id === domain.customer_id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {movingCustomer && <span style={{ color: '#9ca3af' }}>…</span>}
          </span>
        ) : (
          <span>{t('customer')}: <strong>{domain.customer_name}</strong></span>
        )}
        <span>{t('domainDetail_defaultTtl')}{' '}
          {editingTtl ? (
            <input
              type="number" min={1} value={ttlDraft} autoFocus disabled={savingTtl}
              onChange={e => setTtlDraft(e.target.value)}
              onBlur={handleSaveTtl}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveTtl(); if (e.key === 'Escape') setEditingTtl(false) }}
              style={{ width: '5rem', fontWeight: 600, fontSize: 'inherit', padding: '0 2px' }}
            />
          ) : (
            <strong
              style={{ cursor: 'pointer', borderBottom: '1px dashed #9ca3af' }}
              title="Click to edit"
              onClick={() => { setTtlDraft(String(domain.default_ttl)); setEditingTtl(true) }}
            >{domain.default_ttl}s</strong>
          )}
        </span>
        <span>{t('serial')}: <code>{domain.last_serial || '—'}</code></span>
        <span>Added: {new Date(domain.created_at).toLocaleDateString()}</span>
        <span>{t('domainDetail_lastRendered')} {domain.last_rendered_at ? new Date(domain.last_rendered_at).toLocaleString() : t('never')}</span>
      </div>

      {showDnssecModal && (
        <DnssecModal
          fqdn={domain.fqdn}
          defaultTtl={domain.default_ttl}
          dnssecDs={domain.dnssec_ds}
          onDisable={async () => { await handleToggleDnssec(); setShowDnssecModal(false) }}
          disabling={togglingDnssec}
          onClose={() => setShowDnssecModal(false)}
        />
      )}

      <div style={styles.labelsSection}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span style={styles.labelsTitle}>{t('domainDetail_labels')}</span>
          {labels.map(l => l.id === editingLabelId ? (
            <span key={l.id} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
              <datalist id={`edit-vals-${l.id}`}>
                {(labelSuggestions.find(s => s.key === editKey)?.values ?? []).map(v => <option key={v} value={v} />)}
              </datalist>
              <span style={{ position: 'relative' }}>
                <input value={editKey} onChange={e => setEditKey(e.target.value)}
                  onFocus={() => setShowEditKeyDrop(true)} onBlur={() => setTimeout(() => setShowEditKeyDrop(false), 150)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingLabelId(null) }}
                  style={styles.labelInput} autoFocus />
                <KeySuggestionDrop input={editKey} show={showEditKeyDrop} onPick={s => { setEditKey(s.key); setShowEditKeyDrop(false) }} />
              </span>
              <input list={`edit-vals-${l.id}`} value={editValue} onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingLabelId(null) }}
                style={styles.labelInput} />
              <ColorPicker value={editColor} labelKey={editKey} onChange={setEditColor} label={t('domainDetail_labelColor')} />
              {isAdmin && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '.75rem', color: '#6b7280', cursor: 'pointer' }}>
                  <input type="checkbox" checked={editAdminOnly} onChange={e => setEditAdminOnly(e.target.checked)} style={{ margin: 0 }} />
                  {t('domainDetail_labelAdminOnly')}
                </label>
              )}
              <button onClick={handleSaveEdit} disabled={!editKey.trim() || savingLabels} style={styles.labelAddBtn}>{t('save')}</button>
              <button onClick={() => setEditingLabelId(null)} style={styles.labelAddBtn}>{t('cancel')}</button>
            </span>
          ) : (
            <span key={l.id} onClick={() => { setEditingLabelId(l.id); setEditKey(l.key); setEditValue(l.value); setEditColor(l.color ?? null); setEditAdminOnly(!!l.admin_only) }} style={{ cursor: 'text' }}>
              <LabelChip label={l} onRemove={e => { e.stopPropagation(); handleRemoveLabel(l.id) }} />
            </span>
          ))}
          {labelKey === '' && labelValue === ''
            ? <button type="button" onClick={() => setLabelKey(' ')} style={styles.labelNewBtn}>{t('domainDetail_labelNew')}</button>
            : <form onSubmit={handleAddLabel} style={{ display: 'flex', gap: '.25rem', alignItems: 'center' }}>
                <datalist id="label-values-list">
                  {(labelSuggestions.find(s => s.key === labelKey)?.values ?? []).map(v => <option key={v} value={v} />)}
                </datalist>
                <span style={{ position: 'relative' }}>
                  <input placeholder={t('domainDetail_labelKeyPh')} value={labelKey.trim()}
                    onChange={e => setLabelKey(e.target.value)}
                    onFocus={() => setShowAddKeyDrop(true)} onBlur={() => setTimeout(() => setShowAddKeyDrop(false), 150)}
                    style={styles.labelInput} autoFocus />
                  <KeySuggestionDrop input={labelKey} show={showAddKeyDrop} onPick={s => { setLabelKey(s.key); setShowAddKeyDrop(false) }} />
                </span>
                <input list="label-values-list" placeholder={t('domainDetail_labelValuePh')} value={labelValue}
                  onChange={e => setLabelValue(e.target.value)} style={styles.labelInput} />
                {isAdmin && (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '.75rem', color: '#6b7280', cursor: 'pointer' }}>
                    <input type="checkbox" checked={addAdminOnly} onChange={e => setAddAdminOnly(e.target.checked)} style={{ margin: 0 }} />
                    {t('domainDetail_labelAdminOnly')}
                  </label>
                )}
                <button type="submit" disabled={!labelKey.trim() || savingLabels} style={styles.labelAddBtn}>
                  {t('domainDetail_labelAdd')}
                </button>
                <button type="button" onClick={() => { setLabelKey(''); setLabelValue('') }} style={styles.labelAddBtn}>
                  {t('cancel')}
                </button>
              </form>
          }
        </div>
      </div>

      <div style={styles.tableHeader}>
        <h3 style={styles.h3}>{t('domainDetail_dnsRecords')}</h3>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <button onClick={() => setShowImportModal(true)} style={styles.btnSecondary}>Import Zone</button>
          <button onClick={addNewRow} style={hasDirty ? styles.btnSecondary : styles.btnPrimary}>{t('domainDetail_addRecord')}</button>
        </div>
      </div>

      {loadingRecords ? <p>{t('domainDetail_loadingRecords')}</p> : (
        <div style={{ position: 'relative' }}>
        {(applying || pendingRefresh) && (
          <div style={styles.tableOverlay}>
            <div style={styles.spinner} />
            <span style={styles.spinnerText}>{t('domainDetail_updatingRecords')}</span>
          </div>
        )}
        <table style={{ ...styles.table, opacity: (applying || pendingRefresh) ? 0.45 : 1, transition: 'opacity .2s', pointerEvents: (applying || pendingRefresh) ? 'none' : 'auto' }}>
          <thead>
            <tr>
              <th style={styles.th}>{t('name')}</th>
              <th style={styles.th}>{t('type')}</th>
              <th style={styles.th}>{t('ttl')}</th>
              {showPriority   && <th style={{ ...styles.th, width: 70 }}>{t('priority')}</th>}
              {showWeightPort && <th style={{ ...styles.th, width: 58 }}>{t('weight')}</th>}
              {showWeightPort && <th style={{ ...styles.th, width: 58 }}>{t('port')}</th>}
              <th style={styles.th}>{t('value')}</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {/* New (unsaved) rows at top */}
            {newRows.map(row => (
              <tr key={row._newId} style={{ ...styles.tr, background: '#f0fdf4', outline: '1px solid #86efac' }}>
                <td style={styles.td}>
                  <input value={row.name} onChange={e => setNewField(row._newId, 'name', e.target.value)}
                    className="inline-field" style={{ ...styles.inlineInput, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} />
                </td>
                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                  <select value={row.type} onChange={e => setNewField(row._newId, 'type', e.target.value)}
                    className="inline-field" style={styles.inlineSelect}>
                    {RECORD_TYPES.map(rt => <option key={rt}>{rt}</option>)}
                  </select>
                  {row.type === 'CNAME' && row.name.trim() === '@' && (
                    <span className="alias-hint" data-tip="CNAME flattening — resolved to A/AAAA at zone render time, allowing a CNAME-like record at the apex."
                      style={{ marginLeft: 4, cursor: 'help', color: '#9ca3af', fontWeight: 700, fontSize: '.8rem' }}>?</span>
                  )}
                </td>
                <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                  <input value={row.ttl} onChange={e => setNewField(row._newId, 'ttl', e.target.value)}
                    placeholder={t('domainDetail_ttlPlaceholder')} className="inline-field" style={{ ...styles.inlineInput, width: 70 }} />
                  {row.ttl !== '' && (
                    <button onClick={() => setNewField(row._newId, 'ttl', '')}
                      className="alias-hint" data-tip="Reset to domain default" style={{ ...styles.btnIcon, color: '#9ca3af', marginLeft: 2 }}>↺</button>
                  )}
                </td>
                {showPriority && (
                  <td style={styles.td}>
                    {(row.type === 'MX' || row.type === 'SRV') && (
                      <input value={row.priority} onChange={e => setNewField(row._newId, 'priority', e.target.value)}
                        className="inline-field" style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                    )}
                  </td>
                )}
                {showWeightPort && (
                  <td style={styles.td}>
                    {row.type === 'SRV' && (
                      <input value={row.weight} onChange={e => setNewField(row._newId, 'weight', e.target.value)}
                        className="inline-field" style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                    )}
                  </td>
                )}
                {showWeightPort && (
                  <td style={styles.td}>
                    {row.type === 'SRV' && (
                      <input value={row.port} onChange={e => setNewField(row._newId, 'port', e.target.value)}
                        className="inline-field" style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                    )}
                  </td>
                )}
                <td style={{ ...styles.td, ...styles.valueCell }}>
                  <input value={row.value} onChange={e => setNewField(row._newId, 'value', e.target.value)}
                    placeholder={t('domainDetail_valuePlaceholder')} className="inline-field"
                    style={{ ...styles.inlineInput, fontFamily: MONO, width: '100%' }} />
                </td>
                <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <span style={styles.newBadge}>{t('domainDetail_newBadge')}</span>
                  <button onClick={() => removeNewRow(row._newId)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>✕</button>
                </td>
              </tr>
            ))}

            {/* Existing records */}
            {(records as DnsRecord[]).map(rec => {
              const isDeleted = pendingDeletes.has(rec.id)
              const row = getRow(rec)
              const dirty = !!edits[rec.id]
              const rowStyle = isDeleted
                ? { ...styles.tr, background: '#fef2f2', outline: '1px solid #fca5a5', opacity: 0.6 }
                : dirty
                  ? { ...styles.tr, background: '#fefce8', outline: '1px solid #fde047' }
                  : styles.tr

              return (
                <tr key={rec.id} style={rowStyle}>
                  <td style={styles.td}>
                    <input value={row.name} onChange={e => setField(rec.id, rec, 'name', e.target.value)}
                      disabled={isDeleted} className="inline-field"
                      style={{ ...styles.inlineInput, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} />
                  </td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                    <select value={row.type === 'ALIAS' ? 'CNAME' : row.type}
                      onChange={e => setField(rec.id, rec, 'type', e.target.value)}
                      disabled={isDeleted} className="inline-field" style={styles.inlineSelect}>
                      {RECORD_TYPES.map(rt => <option key={rt}>{rt}</option>)}
                    </select>
                    {(row.type === 'ALIAS' || (row.type === 'CNAME' && row.name.trim() === '@')) && (
                      <span className="alias-hint" data-tip="CNAME flattening — resolved to A/AAAA at zone render time, allowing a CNAME-like record at the apex."
                        style={{ marginLeft: 4, cursor: 'help', color: '#9ca3af', fontWeight: 700, fontSize: '.8rem' }}>?</span>
                    )}
                  </td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                    <input value={row.ttl} onChange={e => setField(rec.id, rec, 'ttl', e.target.value)}
                      disabled={isDeleted} placeholder={t('domainDetail_ttlPlaceholder')} className="inline-field"
                      style={{ ...styles.inlineInput, width: 70 }} />
                    {row.ttl !== '' && !isDeleted && (
                      <button onClick={() => setField(rec.id, rec, 'ttl', '')}
                        className="alias-hint" data-tip="Reset to domain default" style={{ ...styles.btnIcon, color: '#9ca3af', marginLeft: 2 }}>↺</button>
                    )}
                  </td>
                  {showPriority && (
                    <td style={styles.td}>
                      {(row.type === 'MX' || row.type === 'SRV') && (
                        <input value={row.priority} onChange={e => setField(rec.id, rec, 'priority', e.target.value)}
                          disabled={isDeleted} className="inline-field" style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                      )}
                    </td>
                  )}
                  {showWeightPort && (
                    <td style={styles.td}>
                      {row.type === 'SRV' && (
                        <input value={row.weight} onChange={e => setField(rec.id, rec, 'weight', e.target.value)}
                          disabled={isDeleted} className="inline-field" style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                      )}
                    </td>
                  )}
                  {showWeightPort && (
                    <td style={styles.td}>
                      {row.type === 'SRV' && (
                        <input value={row.port} onChange={e => setField(rec.id, rec, 'port', e.target.value)}
                          disabled={isDeleted} className="inline-field" style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                      )}
                    </td>
                  )}
                  <td style={{ ...styles.td, ...styles.valueCell }}>
                    <input value={row.value} onChange={e => setField(rec.id, rec, 'value', e.target.value)}
                      disabled={isDeleted} className="inline-field"
                      style={{ ...styles.inlineInput, fontFamily: MONO, width: '100%' }} />
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {!isDeleted && <BulkEditButton rec={rec} />}
                    {dirty && !isDeleted && (
                      <button onClick={() => setEdits(prev => { const n = { ...prev }; delete n[rec.id]; return n })}
                        style={{ ...styles.btnIcon, color: '#6b7280' }} title={t('domainDetail_revert')}>↩</button>
                    )}
                    {isDeleted
                      ? <button onClick={() => unmarkDelete(rec.id)} style={{ ...styles.btnIcon, color: '#16a34a' }}>{t('domainDetail_restore')}</button>
                      : <button onClick={() => markDelete(rec)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>{t('delete')}</button>
                    }
                  </td>
                </tr>
              )
            })}

            {records.length === 0 && newRows.length === 0 && (
              <tr><td colSpan={5 + (showPriority ? 1 : 0) + (showWeightPort ? 2 : 0)} style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>{t('domainDetail_noRecords')}</td></tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {showImportModal && (
        <ImportZoneModal
          domainId={domainId}
          existingRecords={records as DnsRecord[]}
          onStage={handleImportStage}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {hasDirty && (
        <div style={{ position: 'sticky', bottom: 0, marginLeft: '-1.5rem', marginRight: '-1.5rem', background: '#fff', borderTop: '2px solid #2563eb', padding: '.625rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', zIndex: 50, boxShadow: '0 -2px 12px rgba(0,0,0,.08)' }}>
          <span style={styles.dirtyHint}>{changeCount} {changeCount === 1 ? t('domainDetail_unsavedChange') : t('domainDetail_unsavedChanges')}</span>
          {applyError && <span style={{ fontSize: '.8125rem', color: '#b91c1c', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{applyError}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem' }}>
            <button onClick={handleDiscard} style={styles.btnSecondary} disabled={applying}>{t('domainDetail_discard')}</button>
            <button onClick={handleApply} style={styles.btnPrimary} disabled={applying}>
              {applying ? t('domainDetail_applying') : t('domainDetail_applyChanges')}
            </button>
          </div>
        </div>
      )}

      {zoneModal && (
        <ZoneFileModal
          text={zoneModal.text}
          highlightLine={zoneModal.highlightLine}
          onClose={() => setZoneModal(null)}
        />
      )}

    </div>
  )
}



const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '.5rem' },
  back: { color: '#6b7280', textDecoration: 'none', fontSize: '.875rem' },
  h2: { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  h3: { margin: 0, fontSize: '1rem', fontWeight: 600 },
  errorBanner: { background: '#fee2e2', color: '#b91c1c', padding: '.75rem 1rem', borderRadius: 6, marginBottom: '1rem', fontSize: '.875rem' },
  meta: { display: 'flex', gap: '1.5rem', marginBottom: '1.25rem', fontSize: '.875rem', color: '#374151', flexWrap: 'wrap' },
  labelsSection: { marginBottom: '1.25rem', padding: '.625rem .875rem', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' },
  labelsTitle: { fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const },
  labelInput: { padding: '2px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', width: 110 },
  labelAddBtn: { padding: '2px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer' },
  labelNewBtn: { padding: '1px 8px', background: 'none', border: '1px dashed #d1d5db', borderRadius: 12, fontSize: '.75rem', color: '#6b7280', cursor: 'pointer' },
  tableHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' },
  dirtyHint: { fontSize: '.8125rem', color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: 12 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '.375rem .75rem', fontSize: '.875rem' },
  valueCell: { minWidth: 200 },
  newBadge: { fontSize: '.7rem', background: '#dcfce7', color: '#16a34a', padding: '1px 6px', borderRadius: 10, fontWeight: 600, marginRight: 4 },
  inlineInput: { border: '1px solid transparent', borderRadius: 3, padding: '2px 5px', fontSize: '.8125rem', background: 'transparent', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  inlineSelect: { border: '1px solid transparent', borderRadius: 3, padding: '2px 4px', fontSize: '.8125rem', background: 'transparent', outline: 'none', cursor: 'pointer' },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  btnIcon:  { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: '2px 6px' },
  bulkBtn:  { background: '#ede9fe', color: '#6d28d9', border: 'none', borderRadius: 10, fontSize: '.7rem', fontWeight: 600, padding: '2px 8px', cursor: 'pointer', marginRight: 4, whiteSpace: 'nowrap' as const },
  tableOverlay: { position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.5rem' },
  spinner: { width: 28, height: 28, border: '3px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.7s linear infinite' },
  spinnerText: { fontSize: '.8125rem', color: '#6b7280', fontWeight: 500 },
  btnWarning: { padding: '.375rem .875rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSuccess: { padding: '.375rem .875rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnDanger: { padding: '.375rem .875rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
}

// ── Zone error with clickable file paths ──────────────────────

const ZONE_PATH_RE = /(\/tmp\/infodns-[a-f0-9]+\.zone):(\d+)/g

function renderZoneError(
  errorText: string,
  domainId: number,
  setZoneModal: (v: { text: string; highlightLine: number } | null) => void,
): ReactNode[] {
  const parts: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null

  ZONE_PATH_RE.lastIndex = 0
  while ((match = ZONE_PATH_RE.exec(errorText)) !== null) {
    if (match.index > last) parts.push(errorText.slice(last, match.index))
    const lineNum = Number(match[2])
    const matchText = match[0]
    parts.push(
      <button
        key={match.index}
        onClick={async () => {
          try {
            const res = await getZoneText(domainId)
            setZoneModal({ text: res.data.text, highlightLine: lineNum })
          } catch { /* ignore */ }
        }}
        style={{ background: 'none', border: 'none', color: '#7f1d1d', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0 }}
      >
        {matchText}
      </button>
    )
    last = match.index + matchText.length
  }
  if (last < errorText.length) parts.push(errorText.slice(last))
  return parts
}

// ── Zone file viewer modal ────────────────────────────────────

function ZoneFileModal({ text, highlightLine, onClose }: { text: string; highlightLine: number; onClose: () => void }) {
  const lines = text.split('\n')
  const lineRefs = useRef<(HTMLTableRowElement | null)[]>([])

  useEffect(() => {
    lineRefs.current[highlightLine - 1]?.scrollIntoView({ block: 'center' })
  }, [highlightLine])

  return (
    <div style={zm.overlay} onClick={onClose}>
      <div style={zm.modal} onClick={e => e.stopPropagation()}>
        <div style={zm.header}>
          <span style={zm.title}>Zone file — line {highlightLine} highlighted</span>
          <button onClick={onClose} style={zm.closeBtn}>✕</button>
        </div>
        <div style={zm.body}>
          <table style={zm.table}>
            <tbody>
              {lines.map((line, i) => {
                const lineNo = i + 1
                const isHighlight = lineNo === highlightLine
                return (
                  <tr
                    key={i}
                    ref={el => { lineRefs.current[i] = el }}
                    style={isHighlight ? zm.rowHighlight : zm.row}
                  >
                    <td style={zm.lineNo}>{lineNo}</td>
                    <td style={zm.lineContent}>{line || ' '}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const zm: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#1e1e1e', borderRadius: 8, width: '80vw', maxWidth: 900, height: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,.4)', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.75rem 1rem', background: '#2d2d2d', borderBottom: '1px solid #444', flexShrink: 0 },
  title: { color: '#e5e7eb', fontSize: '.875rem', fontWeight: 600 },
  closeBtn: { background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' },
  body: { overflowY: 'auto', flex: 1, padding: '.5rem 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: '.8rem' },
  row: { background: 'transparent' },
  rowHighlight: { background: '#7f1d1d' },
  lineNo: { padding: '1px 1rem 1px .75rem', color: '#6b7280', textAlign: 'right', userSelect: 'none', whiteSpace: 'nowrap', minWidth: 48, verticalAlign: 'top' },
  lineContent: { padding: '1px .75rem 1px 0', color: '#e5e7eb', whiteSpace: 'pre', wordBreak: 'keep-all' },
}
