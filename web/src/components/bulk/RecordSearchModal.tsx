import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchByRecord, type RecordSearchResult } from '../../api/client'
import Select from '../Select'
import { useModalA11y } from '../../hooks/useModalA11y'
import { useI18n } from '../../i18n/I18nContext'
import type { BulkPayloadSeed } from './BulkPayloadForm'

interface Props {
  onClose: () => void
  onApply: (params: { ids: number[]; seed: BulkPayloadSeed }) => void
}

const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']

export default function RecordSearchModal({ onClose, onApply }: Props) {
  const { t } = useI18n()
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  const [type, setType]   = useState('A')
  const [name, setName]   = useState('')
  const [value, setValue] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [excluded, setExcluded]   = useState<Set<number>>(new Set())

  const queryParams = useMemo(() => ({
    type,
    ...(name  ? { name }  : {}),
    ...(value ? { value } : {}),
  }), [type, name, value])

  const { data: results = [], isFetching } = useQuery<RecordSearchResult[]>({
    queryKey: ['record-search', type, name, value],
    queryFn: () => searchByRecord(queryParams).then(r => r.data),
    enabled: submitted,
  })

  const uniqueDomains = useMemo(() => {
    const seen = new Map<number, RecordSearchResult>()
    for (const r of results) if (!seen.has(r.id)) seen.set(r.id, r)
    return Array.from(seen.values())
  }, [results])

  const includedIds = useMemo(
    () => uniqueDomains.filter(d => !excluded.has(d.id)).map(d => d.id),
    [uniqueDomains, excluded],
  )

  function toggleExclude(id: number) {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault()
    setExcluded(new Set())
    setSubmitted(true)
  }

  function handleApply() {
    if (includedIds.length === 0) return
    onApply({
      ids: includedIds,
      seed: { matchName: name, matchType: type, matchValue: value },
    })
  }

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-search-title"
        tabIndex={-1}
        style={styles.modal}
      >
        <div style={styles.header}>
          <h2 id="record-search-title" style={styles.title}>{t('bulk_searchTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('cancel')} style={styles.closeBtn}>✕</button>
        </div>

        <form onSubmit={handleSearch} style={styles.searchForm}>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('bulk_searchType')}</span>
            <Select
              value={type}
              onChange={setType}
              style={{ width: '100%' }}
              options={RECORD_TYPES.map(rt => ({ value: rt, label: rt }))}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('bulk_searchName')}</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('bulk_recordNamePh')}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('bulk_searchValue')}</span>
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={t('bulk_valuePh')}
              style={styles.input}
            />
          </label>
          <button type="submit" style={styles.btnSearch} disabled={isFetching}>
            {isFetching ? t('bulk_searching') : t('bulk_searchRun')}
          </button>
        </form>

        <div style={styles.body}>
          {!submitted && (
            <p style={styles.muted}>{t('bulk_searchEmpty')}</p>
          )}
          {submitted && !isFetching && uniqueDomains.length === 0 && (
            <p style={styles.muted}>{t('bulk_searchNoResults')}</p>
          )}
          {submitted && uniqueDomains.length > 0 && (
            <>
              <div style={styles.summaryRow}>
                <span style={styles.summaryItem}>{t('bulk_searchResults', results.length)}</span>
                <span style={styles.summaryDivider}>·</span>
                <span style={styles.summaryItem}>{t('bulk_uniqueDomains', uniqueDomains.length)}</span>
              </div>
              <div style={styles.list}>
                {uniqueDomains.map(d => {
                  const records = results.filter(r => r.id === d.id)
                  const isIncluded = !excluded.has(d.id)
                  return (
                    <label key={d.id} style={styles.row}>
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={() => toggleExclude(d.id)}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={styles.rowMain}>
                        <div style={styles.rowFqdn}>
                          <span style={{ fontWeight: 500 }}>{d.fqdn}</span>
                          {d.tenant_name && <span style={styles.rowTenant}>{d.tenant_name}</span>}
                        </div>
                        <div style={styles.rowRecords}>
                          {records.map(r => (
                            <code key={r.record_id} style={styles.recordPill}>
                              {r.record_type} {r.record_name} {r.value}
                              {r.priority != null ? ` (${r.priority})` : ''}
                            </code>
                          ))}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.btnSecondary}>{t('cancel')}</button>
          <button
            type="button"
            onClick={handleApply}
            disabled={includedIds.length === 0}
            style={styles.btnPrimary}
          >
            {t('bulk_useSelected', includedIds.length)}
          </button>
        </div>
      </div>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.35)', zIndex: 60 },
  modal: {
    position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    width: 'min(640px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 64px)',
    background: '#fff', borderRadius: 8, boxShadow: '0 24px 48px rgba(15,23,42,.18)',
    display: 'flex', flexDirection: 'column', zIndex: 61, outline: 'none',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '.875rem 1rem', borderBottom: '1px solid #e2e8f0', flexShrink: 0,
  },
  title: { margin: 0, fontSize: '.9375rem', fontWeight: 700, color: '#1e293b' },
  closeBtn: { background: 'none', border: 'none', fontSize: '1.125rem', cursor: 'pointer', color: '#64748b', padding: '.25rem .5rem' },
  searchForm: {
    display: 'grid', gridTemplateColumns: '110px 1fr 1fr auto', gap: '.5rem', alignItems: 'end',
    padding: '.75rem 1rem', borderBottom: '1px solid #f1f5f9', flexShrink: 0,
  },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.75rem' },
  labelText: { fontWeight: 500, color: '#374151' },
  input: { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', width: '100%', boxSizing: 'border-box' },
  btnSearch: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer', height: 30 },
  body: { flex: 1, overflowY: 'auto', padding: '.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '.5rem', minHeight: 200 },
  muted: { color: '#94a3b8', margin: 0, fontSize: '.875rem', textAlign: 'center', padding: '2rem 0' },
  summaryRow: { display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.75rem', color: '#475569' },
  summaryItem: { fontWeight: 500 },
  summaryDivider: { color: '#cbd5e1' },
  list: { border: '1px solid #e2e8f0', borderRadius: 4, overflow: 'auto', maxHeight: 360 },
  row: {
    display: 'flex', alignItems: 'flex-start', gap: '.625rem',
    padding: '.5rem .625rem', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
    fontSize: '.8125rem',
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 },
  rowFqdn: { display: 'flex', alignItems: 'baseline', gap: '.5rem' },
  rowTenant: { fontSize: '.6875rem', color: '#9ca3af' },
  rowRecords: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  recordPill: {
    background: '#f1f5f9', borderRadius: 3, padding: '1px 5px', fontSize: '.6875rem',
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    color: '#334155',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '.5rem',
    padding: '.75rem 1rem', borderTop: '1px solid #e2e8f0', flexShrink: 0, background: '#fafafa',
  },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.8125rem', fontWeight: 500, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer', color: '#374151' },
}
