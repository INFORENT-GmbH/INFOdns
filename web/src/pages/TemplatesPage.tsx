import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  createTemplateRecord, updateTemplateRecord, deleteTemplateRecord,
  getTenants,
  type DnsTemplate, type DnsTemplateRecord,
} from '../api/client'
import { useMemo } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAuth } from '../context/AuthContext'
import Select from '../components/Select'
import SearchInput from '../components/SearchInput'
import FilterBar from '../components/FilterBar'
import ListTable from '../components/ListTable'
import MasterDetailLayout from '../components/MasterDetailLayout'
import * as sh from '../styles/shell'
import { formatApiError } from '../lib/formError'

const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS','ALIAS']
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

const INLINE_STYLES = `
  .inline-field:hover { border-color: #d1d5db !important; background: #fff !important; }
  .inline-field:focus { border-color: #2563eb !important; background: #fff !important; outline: none !important; box-shadow: 0 0 0 2px #bfdbfe; }
`

function typeNeedsPriority(type: string) { return type === 'MX' || type === 'SRV' }
function typeNeedsWeightPort(type: string) { return type === 'SRV' }

interface RecordFormRow {
  name: string
  type: string
  ttl: string
  value: string
  priority: string
  weight: string
  port: string
}

interface NewRow extends RecordFormRow {
  _newId: string
}

export default function TemplatesPage() {
  usePageTitle('DNS Templates')
  const { t } = useI18n()
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isOperator = user?.role === 'operator'
  const canWrite = isAdmin || isOperator

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newTenantId, setNewTenantId] = useState<number | ''>('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Inline editing for template header
  const [editName, setEditName] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState<string | null>(null)
  const [savingHeader, setSavingHeader] = useState(false)

  // Deferred record editing (DomainDetailPage pattern)
  const [edits, setEdits] = useState<Record<number, RecordFormRow>>({})
  const [pendingDeletes, setPendingDeletes] = useState<Set<number>>(new Set())
  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [focusedValue, setFocusedValue] = useState<number | string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => getTemplates().then(r => r.data),
  })

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return templates
    return templates.filter((tmpl: DnsTemplate) =>
      tmpl.name.toLowerCase().includes(q) ||
      (tmpl.description ?? '').toLowerCase().includes(q)
    )
  }, [templates, search])

  const { data: detail } = useQuery({
    queryKey: ['template', selectedId],
    queryFn: () => getTemplate(selectedId!).then(r => r.data),
    enabled: selectedId !== null,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => getTenants().then(r => r.data),
    enabled: isAdmin,
  })

  function canEditTemplate(tmpl: DnsTemplate) {
    if (isAdmin) return true
    if (isOperator) return tmpl.tenant_id !== null && tmpl.tenant_id === user?.tenantId
    return false
  }

  function tenantName(id: number | null) {
    if (id === null) return t('templates_global')
    const found = tenants.find(ten => ten.id === id)
    return found?.name ?? String(id)
  }

  // ── Record helpers ────────────────────────────────────────────

  function getRow(rec: DnsTemplateRecord): RecordFormRow {
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

  function setField(id: number, rec: DnsTemplateRecord, field: keyof RecordFormRow, value: string) {
    const current = getRow(rec)
    const next = { ...current, [field]: value }
    const original: RecordFormRow = {
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
    setEdits(prev => {
      if (isDirty) return { ...prev, [id]: next }
      const { [id]: _, ...rest } = prev
      return rest
    })
  }

  function setNewField(newId: string, field: keyof RecordFormRow, value: string) {
    setNewRows(prev => prev.map(r => r._newId === newId ? { ...r, [field]: value } : r))
  }

  function addNewRow() {
    setNewRows(prev => [{ _newId: crypto.randomUUID(), name: '', type: 'A', ttl: '', value: '', priority: '', weight: '', port: '' }, ...prev])
  }

  function buildPayload(row: RecordFormRow) {
    const p: any = { name: row.name, type: row.type, value: row.value }
    if (row.ttl) p.ttl = Number(row.ttl)
    if (typeNeedsPriority(row.type)) p.priority = Number(row.priority) || 0
    if (typeNeedsWeightPort(row.type)) { p.weight = Number(row.weight) || 0; p.port = Number(row.port) || 0 }
    return p
  }

  async function handleApply() {
    if (!selectedId) return
    setApplying(true); setApplyError(null)
    try {
      for (const id of pendingDeletes) await deleteTemplateRecord(selectedId, id)
      for (const row of newRows) await createTemplateRecord(selectedId, buildPayload(row))
      for (const [id, row] of Object.entries(edits)) await updateTemplateRecord(selectedId, Number(id), buildPayload(row))
      qc.invalidateQueries({ queryKey: ['template', selectedId] })
      qc.invalidateQueries({ queryKey: ['templates'] })
      setEdits({}); setPendingDeletes(new Set()); setNewRows([])
    } catch (err: any) {
      setApplyError(formatApiError(err))
    } finally {
      setApplying(false)
    }
  }

  function handleDiscard() {
    setEdits({}); setPendingDeletes(new Set()); setNewRows([]); setApplyError(null)
  }

  const hasDirty = Object.keys(edits).length > 0 || pendingDeletes.size > 0 || newRows.length > 0
  const changeCount = newRows.length + pendingDeletes.size + Object.keys(edits).length

  const showPriority = (detail?.records ?? []).some(r => {
    const rt = getRow(r).type; return rt === 'MX' || rt === 'SRV'
  }) || newRows.some(r => r.type === 'MX' || r.type === 'SRV')

  const showWeightPort = (detail?.records ?? []).some(r => getRow(r).type === 'SRV') || newRows.some(r => r.type === 'SRV')

  // ── Template header handlers ──────────────────────────────────

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true); setCreateError(null)
    try {
      const tenantId = isAdmin ? (newTenantId === '' ? null : Number(newTenantId)) : user?.tenantId ?? null
      const res = await createTemplate({ name: newName.trim(), description: newDesc.trim() || null, tenant_id: tenantId })
      qc.invalidateQueries({ queryKey: ['templates'] })
      setShowNewForm(false)
      setNewName(''); setNewDesc(''); setNewTenantId('')
      setSelectedId(res.data.id)
    } catch (err: any) {
      setCreateError(formatApiError(err))
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteTemplate(tmpl: DnsTemplate) {
    if (!confirm(t('templates_deleteConfirm'))) return
    await deleteTemplate(tmpl.id)
    qc.invalidateQueries({ queryKey: ['templates'] })
    if (selectedId === tmpl.id) setSelectedId(null)
  }

  async function saveHeader() {
    if (!detail || !selectedId) return
    setSavingHeader(true)
    try {
      await updateTemplate(selectedId, {
        name: editName ?? detail.name,
        description: editDesc !== null ? (editDesc.trim() || null) : detail.description,
      })
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['template', selectedId] })
    } finally {
      setSavingHeader(false)
      setEditName(null); setEditDesc(null)
    }
  }

  function selectTemplate(id: number) {
    setSelectedId(id)
    setEditName(null); setEditDesc(null)
    setEdits({}); setPendingDeletes(new Set()); setNewRows([])
    setFocusedValue(null); setApplyError(null)
  }

  // Reusable bits ──────────────────────────────────────────────────
  const newFormUI = showNewForm && (
    <form onSubmit={handleCreate} style={styles.formCard}>
      {createError && <div style={styles.error}>{createError}</div>}
      <input
        placeholder={t('templates_namePh')}
        value={newName}
        onChange={e => setNewName(e.target.value)}
        required
        style={styles.formInput}
      />
      <input
        placeholder={t('templates_descPh')}
        value={newDesc}
        onChange={e => setNewDesc(e.target.value)}
        style={styles.formInput}
      />
      {isAdmin && (
        <Select
          value={newTenantId === '' ? '__global__' : String(newTenantId)}
          onChange={v => setNewTenantId(v === '__global__' ? '' : Number(v))}
          options={[
            { value: '__global__', label: t('templates_global') },
            ...tenants.map(ten => ({ value: String(ten.id), label: ten.name })),
          ]}
          style={{ width: '100%' }}
        />
      )}
      <div style={styles.actions}>
        <button type="button" onClick={() => setShowNewForm(false)} style={styles.btnSecondary}>{t('cancel')}</button>
        <button type="submit" disabled={creating} style={styles.btnPrimary}>{creating ? t('creating') : t('create')}</button>
      </div>
    </form>
  )

  // ── Sidebar: compact list (300px wide when detail is open) ──────
  const sidebar = (
    <>
      <style>{INLINE_STYLES}</style>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('templates_searchPlaceholder') || 'Search templates…'}
          width="100%"
        />
      </FilterBar>
      {canWrite && (
        <FilterBar>
          <button
            onClick={() => { setShowNewForm(true); setCreateError(null); setNewName(''); setNewDesc(''); setNewTenantId('') }}
            style={{ ...sh.actionBtn, width: '100%' }}
          >
            {t('templates_newTemplate')}
          </button>
        </FilterBar>
      )}
      {newFormUI}
      {isLoading ? (
        <p style={{ padding: '.5rem', fontSize: '.8125rem' }}>{t('loading')}</p>
      ) : (
        <ListTable>
          <table style={styles.table}>
            <tbody>
              {filteredTemplates.map((tmpl: DnsTemplate) => (
                <tr
                  key={tmpl.id}
                  style={{ ...styles.tr, background: selectedId === tmpl.id ? '#eff6ff' : undefined, cursor: 'pointer' }}
                  onClick={() => selectTemplate(tmpl.id)}
                >
                  <td style={styles.td}>
                    <div style={{ fontWeight: selectedId === tmpl.id ? 600 : 400 }}>{tmpl.name}</div>
                    <div style={{ fontSize: '.75rem', color: '#64748b', marginTop: 2 }}>
                      <span style={styles.badge}>{tenantName(tmpl.tenant_id)}</span>
                      <span style={{ marginLeft: 6 }}>{tmpl.record_count} records</span>
                    </div>
                  </td>
                  {canEditTemplate(tmpl) && (
                    <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleDeleteTemplate(tmpl)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>{t('delete')}</button>
                    </td>
                  )}
                </tr>
              ))}
              {filteredTemplates.length === 0 && (
                <tr><td style={{ ...styles.td, color: '#94a3b8', textAlign: 'center', padding: '1rem' }}>{search ? t('templates_noneFound') || 'No templates match' : ''}</td></tr>
              )}
            </tbody>
          </table>
        </ListTable>
      )}
    </>
  )

  // ── Dashboard: full-width table when no detail is selected ──────
  const dashboard = (
    <>
      <style>{INLINE_STYLES}</style>
      <FilterBar>
        <span style={styles.countPill}>{filteredTemplates.length} {filteredTemplates.length === 1 ? 'template' : 'templates'}</span>
      </FilterBar>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('templates_searchPlaceholder') || 'Search templates…'}
          width={280}
        />
        {canWrite && (
          <button
            onClick={() => { setShowNewForm(true); setCreateError(null); setNewName(''); setNewDesc(''); setNewTenantId('') }}
            style={{ ...sh.actionBtn, marginLeft: 'auto' }}
          >
            {t('templates_newTemplate')}
          </button>
        )}
      </FilterBar>
      {newFormUI}
      <ListTable>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={sh.th}>{t('name')}</th>
                <th style={sh.th}>Description</th>
                <th style={sh.th}>{t('tenant')}</th>
                <th style={sh.th}>Records</th>
                <th style={{ ...sh.th, width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.map((tmpl: DnsTemplate) => (
                <tr
                  key={tmpl.id}
                  style={{ ...styles.tr, cursor: 'pointer' }}
                  onClick={() => selectTemplate(tmpl.id)}
                  onMouseOver={e => (e.currentTarget.style.background = '#f1f5f9')}
                  onMouseOut={e => (e.currentTarget.style.background = '')}
                >
                  <td style={{ ...sh.td, fontWeight: 500 }}>{tmpl.name}</td>
                  <td style={{ ...sh.td, color: '#64748b' }}>{tmpl.description ?? <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                  <td style={sh.td}><span style={styles.badge}>{tenantName(tmpl.tenant_id)}</span></td>
                  <td style={sh.td}>{tmpl.record_count}</td>
                  <td style={{ ...sh.td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                    {canEditTemplate(tmpl) && (
                      <button onClick={() => handleDeleteTemplate(tmpl)} style={{ ...styles.btnIcon, color: '#b91c1c' }}>{t('delete')}</button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredTemplates.length === 0 && (
                <tr><td colSpan={5} style={{ ...sh.td, color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>{search ? t('templates_noneFound') || 'No templates match' : t('templates_selectToView')}</td></tr>
              )}
            </tbody>
          </table>
        )}
      </ListTable>
    </>
  )

  // ── Detail pane (shown when selectedId is set) ──────────────────
  const detailPane = (
    <div style={styles.main}>
          {!detail ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9ca3af', fontSize: '.875rem' }}>{t('loading')}</div>
          ) : (
            <>
              {/* Header: name + description */}
              <div style={styles.detailHeader}>
                {editName !== null ? (
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={saveHeader}
                    autoFocus
                    style={{ ...styles.formInput, fontSize: '1rem', fontWeight: 600, maxWidth: 320 }}
                  />
                ) : (
                  <h3
                    style={{ ...styles.h3, cursor: canEditTemplate(detail) ? 'text' : 'default' }}
                    onClick={() => canEditTemplate(detail) && setEditName(detail.name)}
                    title={canEditTemplate(detail) ? t('edit') : undefined}
                  >
                    {detail.name}
                  </h3>
                )}
                <span style={styles.badge}>{tenantName(detail.tenant_id)}</span>
                {savingHeader && <span style={{ fontSize: '.75rem', color: '#64748b' }}>{t('saving')}</span>}
              </div>
              {editDesc !== null ? (
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  onBlur={saveHeader}
                  rows={2}
                  style={{ ...styles.formInput, width: '100%', resize: 'vertical', marginBottom: '.5rem' }}
                />
              ) : (
                <p
                  style={{ fontSize: '.8125rem', color: '#64748b', margin: '0 0 .75rem', cursor: canEditTemplate(detail) ? 'text' : 'default', minHeight: '1.25rem' }}
                  onClick={() => canEditTemplate(detail) && setEditDesc(detail.description ?? '')}
                >
                  {detail.description || (canEditTemplate(detail) ? <em>{t('templates_descPh')}</em> : null)}
                </p>
              )}

              {/* Record table header */}
              <div style={styles.tableHeader}>
                <span style={{ fontSize: '.875rem', fontWeight: 600, color: '#1e293b' }}>Records</span>
                {canEditTemplate(detail) && (
                  <button onClick={addNewRow} style={styles.btnSecondary}>{t('templates_addRecord')}</button>
                )}
              </div>

              <div style={{ overflowX: 'auto', position: 'relative' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, width: '18%' }}>{t('name')}</th>
                      <th style={{ ...styles.th, whiteSpace: 'nowrap', width: 1 }}>{t('type')}</th>
                      <th style={styles.th}>{t('ttl')}</th>
                      {showPriority   && <th style={{ ...styles.th, width: 70 }}>Priority</th>}
                      {showWeightPort && <th style={{ ...styles.th, width: 58 }}>Weight</th>}
                      {showWeightPort && <th style={{ ...styles.th, width: 58 }}>Port</th>}
                      <th style={styles.th}>Value</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* New (unsaved) rows at top */}
                    {newRows.map(row => (
                      <tr key={row._newId} style={{ ...styles.tr, background: '#f0fdf4', outline: '1px solid #86efac' }}>
                        <td style={styles.td}>
                          <input value={row.name} onChange={e => setNewField(row._newId, 'name', e.target.value)}
                            className="inline-field" style={{ ...styles.inlineInput, fontFamily: MONO }} />
                        </td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          <Select
                            value={row.type}
                            onChange={v => setNewField(row._newId, 'type', v)}
                            variant="ghost"
                            options={RECORD_TYPES.map(rt => ({ value: rt, label: rt }))}
                            style={{ fontSize: '.8125rem' }}
                          />
                        </td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                          <input value={row.ttl} onChange={e => setNewField(row._newId, 'ttl', e.target.value)}
                            placeholder="default" className="inline-field" style={{ ...styles.inlineInput, width: 70 }} />
                          {row.ttl !== '' && (
                            <button onClick={() => setNewField(row._newId, 'ttl', '')}
                              style={{ ...styles.btnIcon, color: '#9ca3af', marginLeft: 2 }}>↺</button>
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
                          <div style={styles.valueCellWrap}>
                            <input value={row.value} onChange={e => setNewField(row._newId, 'value', e.target.value)}
                              className="inline-field"
                              onFocus={() => setFocusedValue(row._newId)}
                              onBlur={() => setFocusedValue(null)}
                              style={{ ...styles.inlineInput, fontFamily: MONO, position: 'absolute', left: 0, top: 0,
                                width: focusedValue === row._newId ? `${Math.max(row.value.length * 7.8 + 24, 200)}px` : '100%',
                                zIndex: focusedValue === row._newId ? 30 : undefined,
                                boxShadow: focusedValue === row._newId ? '0 0 0 2px #bfdbfe, 0 2px 8px rgba(0,0,0,.12)' : undefined,
                              }} />
                          </div>
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={styles.newBadge}>NEW</span>
                          <button onClick={() => setNewRows(prev => prev.filter(r => r._newId !== row._newId))}
                            style={{ ...styles.btnIcon, color: '#b91c1c' }}>✕</button>
                        </td>
                      </tr>
                    ))}

                    {/* Existing records */}
                    {detail.records.map(rec => {
                      const isDeleted = pendingDeletes.has(rec.id)
                      const row = getRow(rec)
                      const dirty = !!edits[rec.id]
                      const canEdit = canEditTemplate(detail)
                      const rowStyle = isDeleted
                        ? { ...styles.tr, background: '#fef2f2', outline: '1px solid #fca5a5', opacity: 0.6 }
                        : dirty
                          ? { ...styles.tr, background: '#fefce8', outline: '1px solid #fde047' }
                          : styles.tr

                      return (
                        <tr key={rec.id} style={rowStyle}>
                          <td style={styles.td}>
                            <input value={row.name} onChange={e => setField(rec.id, rec, 'name', e.target.value)}
                              disabled={isDeleted || !canEdit} className="inline-field"
                              style={{ ...styles.inlineInput, fontFamily: MONO }} />
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                            <Select
                              value={row.type}
                              onChange={v => setField(rec.id, rec, 'type', v)}
                              disabled={isDeleted || !canEdit}
                              variant="ghost"
                              options={RECORD_TYPES.map(rt => ({ value: rt, label: rt }))}
                              style={{ fontSize: '.8125rem' }}
                            />
                          </td>
                          <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                            <input value={row.ttl} onChange={e => setField(rec.id, rec, 'ttl', e.target.value)}
                              disabled={isDeleted || !canEdit} placeholder="default" className="inline-field"
                              style={{ ...styles.inlineInput, width: 70 }} />
                            {row.ttl !== '' && !isDeleted && canEdit && (
                              <button onClick={() => setField(rec.id, rec, 'ttl', '')}
                                style={{ ...styles.btnIcon, color: '#9ca3af', marginLeft: 2 }}>↺</button>
                            )}
                          </td>
                          {showPriority && (
                            <td style={styles.td}>
                              {(row.type === 'MX' || row.type === 'SRV') && (
                                <input value={row.priority} onChange={e => setField(rec.id, rec, 'priority', e.target.value)}
                                  disabled={isDeleted || !canEdit} className="inline-field"
                                  style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                              )}
                            </td>
                          )}
                          {showWeightPort && (
                            <td style={styles.td}>
                              {row.type === 'SRV' && (
                                <input value={row.weight} onChange={e => setField(rec.id, rec, 'weight', e.target.value)}
                                  disabled={isDeleted || !canEdit} className="inline-field"
                                  style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                              )}
                            </td>
                          )}
                          {showWeightPort && (
                            <td style={styles.td}>
                              {row.type === 'SRV' && (
                                <input value={row.port} onChange={e => setField(rec.id, rec, 'port', e.target.value)}
                                  disabled={isDeleted || !canEdit} className="inline-field"
                                  style={{ ...styles.inlineInput, width: '100%', fontFamily: MONO }} />
                              )}
                            </td>
                          )}
                          <td style={{ ...styles.td, ...styles.valueCell }}>
                            <div style={styles.valueCellWrap}>
                              <input value={row.value} onChange={e => setField(rec.id, rec, 'value', e.target.value)}
                                disabled={isDeleted || !canEdit} className="inline-field"
                                onFocus={() => setFocusedValue(rec.id)}
                                onBlur={() => setFocusedValue(null)}
                                style={{ ...styles.inlineInput, fontFamily: MONO, position: 'absolute', left: 0, top: 0,
                                  width: focusedValue === rec.id ? `${Math.max(row.value.length * 7.8 + 24, 200)}px` : '100%',
                                  zIndex: focusedValue === rec.id ? 30 : undefined,
                                  boxShadow: focusedValue === rec.id ? '0 0 0 2px #bfdbfe, 0 2px 8px rgba(0,0,0,.12)' : undefined,
                                }} />
                            </div>
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {canEdit && dirty && !isDeleted && (
                              <button onClick={() => setEdits(prev => { const n = { ...prev }; delete n[rec.id]; return n })}
                                style={{ ...styles.btnIcon, color: '#6b7280' }} title="Revert">↩</button>
                            )}
                            {canEdit && (isDeleted
                              ? <button onClick={() => setPendingDeletes(prev => { const s = new Set(prev); s.delete(rec.id); return s })}
                                  style={{ ...styles.btnIcon, color: '#16a34a' }}>Restore</button>
                              : <button onClick={() => setPendingDeletes(prev => new Set([...prev, rec.id]))}
                                  style={{ ...styles.btnIcon, color: '#b91c1c' }}>{t('delete')}</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}

                    {detail.records.length === 0 && newRows.length === 0 && (
                      <tr>
                        <td colSpan={4 + (showPriority ? 1 : 0) + (showWeightPort ? 2 : 0) + 1}
                          style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>
                          {t('templates_noRecords')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Sticky footer for deferred apply */}
              {hasDirty && canEditTemplate(detail) && (
                <div style={{ position: 'sticky', bottom: 0, marginLeft: '-1rem', marginRight: '-1rem', background: '#fff', borderTop: '2px solid #2563eb', padding: '.4rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', zIndex: 50, boxShadow: '0 -2px 12px rgba(0,0,0,.08)' }}>
                  <span style={styles.dirtyHint}>{changeCount} unsaved change{changeCount !== 1 ? 's' : ''}</span>
                  {applyError && <span style={{ fontSize: '.8125rem', color: '#b91c1c', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{applyError}</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem' }}>
                    <button onClick={handleDiscard} style={styles.btnSecondary} disabled={applying}>Discard</button>
                    <button onClick={handleApply} style={styles.btnPrimary} disabled={applying}>
                      {applying ? 'Saving…' : 'Apply changes'}
                    </button>
                  </div>
                </div>
              )}
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

const styles: Record<string, React.CSSProperties> = {
  countPill:  { display: 'inline-flex', alignItems: 'center', fontSize: '.8125rem', color: '#475569', background: '#e2e8f0', borderRadius: 4, padding: '1px 8px' },
  main:       { padding: '1rem' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.625rem .75rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', gap: '.5rem' },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.25rem', flexWrap: 'wrap' },
  tableHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.5rem .75rem', borderBottom: '1px solid #e2e8f0', marginTop: '.5rem' },
  h2: { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  h3: { margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b' },
  formCard: { padding: '.75rem', borderBottom: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '.5rem' },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.4rem .625rem', borderRadius: 4, fontSize: '.8125rem' },
  formInput: { padding: '.375rem .75rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', width: '100%', boxSizing: 'border-box' },
  inlineInput: { border: '1px solid transparent', borderRadius: 3, padding: '1px 4px', fontSize: '.75rem', background: 'transparent', outline: 'none', width: '100%', boxSizing: 'border-box' },
  valueCell: { minWidth: 200, position: 'relative' },
  valueCellWrap: { position: 'relative', height: 20 },
  newBadge: { fontSize: '.65rem', background: '#dcfce7', color: '#16a34a', padding: '1px 5px', borderRadius: 10, fontWeight: 600, marginRight: 4 },
  dirtyHint: { fontSize: '.75rem', color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: 12 },
  actions: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },
  btnPrimary: { padding: '.25rem .625rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.25rem .625rem', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer' },
  btnIcon: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.75rem', padding: '1px 5px' },
  badge: { display: 'inline-block', background: '#f1f5f9', color: '#475569', borderRadius: 10, padding: '1px 6px', fontSize: '.75rem', fontWeight: 500 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.4375rem .75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '.6875rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap', letterSpacing: '.04em' },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '.3rem .75rem', fontSize: '.8125rem', color: '#1e293b', verticalAlign: 'middle' },
}
