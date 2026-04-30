import { useEffect, useRef, useState } from 'react'
import Select from '../Select'
import { useI18n } from '../../i18n/I18nContext'

export type BulkOperation = 'add' | 'replace' | 'delete' | 'change_ttl'

const RECORD_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SRV','CAA','PTR','NAPTR','TLSA','SSHFP','DS']

export interface BulkPayloadSeed {
  /** When the form opens via deep-link from a record's "bulk edit" button. */
  matchName?: string
  matchType?: string
  matchValue?: string
}

export interface BulkPayloadResult {
  /** Backend payload object (records | match | replace_with | new_ttl). */
  payload: Record<string, unknown>
  /** True when all required fields are filled per backend constraints. */
  valid: boolean
}

interface Props {
  operation: BulkOperation
  seed?: BulkPayloadSeed
  onChange: (result: BulkPayloadResult) => void
}

export default function BulkPayloadForm({ operation, seed, onChange }: Props) {
  const { t } = useI18n()
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  const [matchName, setMatchName]   = useState(seed?.matchName ?? '')
  const [matchType, setMatchType]   = useState(seed?.matchType ?? '')
  const [matchValue, setMatchValue] = useState(seed?.matchValue ?? '')

  const [newName, setNewName]         = useState(seed?.matchName ?? '')
  const [newType, setNewType]         = useState(seed?.matchType ?? 'A')
  const [newValue, setNewValue]       = useState('')
  const [newTtl, setNewTtl]           = useState('3600')
  const [newPriority, setNewPriority] = useState('')

  useEffect(() => {
    const match: Record<string, unknown> = {}
    if (matchName)  match.name  = matchName
    if (matchType)  match.type  = matchType
    if (matchValue) match.value = matchValue

    if (operation === 'delete') {
      onChangeRef.current({ payload: { match }, valid: !!matchName })
      return
    }
    if (operation === 'change_ttl') {
      const ttl = Number(newTtl)
      onChangeRef.current({
        payload: { match, new_ttl: ttl },
        valid: !!matchName && Number.isFinite(ttl) && ttl > 0,
      })
      return
    }
    const rec: Record<string, unknown> = {
      name: newName,
      type: newType,
      value: newValue,
      ttl: Number(newTtl) || null,
    }
    if ((newType === 'MX' || newType === 'SRV') && newPriority !== '') {
      rec.priority = Number(newPriority)
    } else {
      rec.priority = null
    }

    const recValid = !!newName && !!newType && !!newValue
    if (operation === 'add') {
      onChangeRef.current({ payload: { records: [rec] }, valid: recValid })
      return
    }
    onChangeRef.current({
      payload: { match, replace_with: rec },
      valid: recValid && !!matchName,
    })
  }, [operation, matchName, matchType, matchValue, newName, newType, newValue, newTtl, newPriority])

  const showMatch  = operation === 'replace' || operation === 'delete' || operation === 'change_ttl'
  const showRecord = operation === 'add' || operation === 'replace'
  const showTtl    = operation === 'add' || operation === 'replace' || operation === 'change_ttl'

  const typeOptions = [
    { value: '', label: t('bulk_matchAnyType') },
    ...RECORD_TYPES.map(rt => ({ value: rt, label: rt })),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
      {showMatch && (
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>{t('bulk_matching')}</legend>
          <label style={styles.label}>
            <span style={styles.labelText}>
              {t('bulk_matchNameLabel')} <span style={{ color: '#dc2626' }}>*</span>
            </span>
            <input
              value={matchName}
              onChange={e => setMatchName(e.target.value)}
              placeholder={t('bulk_namePh')}
              style={{
                ...styles.input,
                borderColor: matchName ? '#e2e8f0' : '#fca5a5',
              }}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('bulk_matchTypeLabel')}</span>
            <Select
              value={matchType}
              onChange={setMatchType}
              style={styles.input}
              options={typeOptions}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>
              {t('bulk_matchValueLabel')} <span style={styles.optional}>{t('bulk_matchValueOpt')}</span>
            </span>
            <input
              value={matchValue}
              onChange={e => setMatchValue(e.target.value)}
              placeholder={t('bulk_valuePh')}
              style={styles.input}
            />
          </label>
          {!matchName && (
            <p style={styles.hint}>{t('bulk_matchNameRequired')}</p>
          )}
        </fieldset>
      )}

      {showRecord && (
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>
            {operation === 'add' ? t('bulk_opAdd') : t('bulk_opReplace')}
          </legend>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('name')}</span>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={t('bulk_namePh')}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('type')}</span>
            <Select
              value={newType}
              onChange={setNewType}
              style={styles.input}
              options={RECORD_TYPES.map(rt => ({ value: rt, label: rt }))}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('value')}</span>
            <input
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              placeholder={t('bulk_valuePh')}
              style={styles.input}
            />
          </label>
          {(newType === 'MX' || newType === 'SRV') && (
            <label style={styles.label}>
              <span style={styles.labelText}>{t('priority')}</span>
              <input
                type="number"
                value={newPriority}
                onChange={e => setNewPriority(e.target.value)}
                placeholder="10"
                style={styles.input}
              />
            </label>
          )}
        </fieldset>
      )}

      {showTtl && (
        <label style={styles.label}>
          <span style={styles.labelText}>
            {operation === 'change_ttl' ? t('bulk_newTtlSeconds') : t('bulk_ttlSeconds')}
          </span>
          <input
            type="number"
            value={newTtl}
            onChange={e => setNewTtl(e.target.value)}
            style={styles.input}
          />
        </label>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  fieldset:  { border: '1px solid #e5e7eb', borderRadius: 6, padding: '.625rem .75rem .75rem', display: 'flex', flexDirection: 'column', gap: '.5rem', margin: 0 },
  legend:    { padding: '0 .375rem', fontSize: '.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.04em' },
  label:     { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.8125rem' },
  labelText: { fontWeight: 500, color: '#374151' },
  optional:  { fontWeight: 400, color: '#9ca3af', fontSize: '.75rem' },
  input:     { padding: '.375rem .625rem', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: '.8125rem', width: '100%', boxSizing: 'border-box' },
  hint:      { margin: 0, fontSize: '.75rem', color: '#dc2626' },
}
