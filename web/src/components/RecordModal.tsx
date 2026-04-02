import { useState, useEffect, type FormEvent } from 'react'
import { type DnsRecord } from '../api/client'
import { useI18n } from '../i18n/I18nContext'

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SRV', 'CAA', 'PTR', 'TLSA', 'SSHFP', 'DS', 'NAPTR']

interface Props {
  record?: DnsRecord | null
  onSave: (data: Partial<DnsRecord>) => Promise<void>
  onClose: () => void
}

export default function RecordModal({ record, onSave, onClose }: Props) {
  const { t } = useI18n()
  const isEdit = Boolean(record)
  const [form, setForm] = useState<Partial<DnsRecord>>({
    name: '@', type: 'A', ttl: undefined, priority: undefined,
    weight: undefined, port: undefined, value: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (record) setForm(record)
  }, [record])

  function set(key: keyof DnsRecord, value: unknown) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.message ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const needsPriority = ['MX', 'SRV'].includes(form.type ?? '')
  const needsSrv      = form.type === 'SRV'

  return (
    <div style={styles.overlay} onClick={onClose}>
      <form style={styles.modal} onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 style={styles.title}>{isEdit ? t('modal_editRecord') : t('modal_addRecord')}</h3>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.grid}>
          <label style={styles.label}>
            {t('name')}
            <input value={form.name ?? ''} onChange={e => set('name', e.target.value)} required style={styles.input} placeholder={t('bulk_namePh')} />
          </label>
          <label style={styles.label}>
            {t('type')}
            <select value={form.type ?? 'A'} onChange={e => set('type', e.target.value)} style={styles.input}>
              {RECORD_TYPES.map(tp => <option key={tp}>{tp}</option>)}
            </select>
          </label>
          <label style={styles.label}>
            {t('ttl')} <span style={styles.hint}>{t('modal_ttlHint')}</span>
            <input type="number" value={form.ttl ?? ''} onChange={e => set('ttl', e.target.value ? Number(e.target.value) : undefined)} style={styles.input} placeholder="3600" />
          </label>
          {needsPriority && (
            <label style={styles.label}>
              {t('priority')}
              <input type="number" value={form.priority ?? ''} onChange={e => set('priority', Number(e.target.value))} required style={styles.input} />
            </label>
          )}
          {needsSrv && <>
            <label style={styles.label}>
              {t('weight')}
              <input type="number" value={form.weight ?? ''} onChange={e => set('weight', Number(e.target.value))} required style={styles.input} />
            </label>
            <label style={styles.label}>
              {t('port')}
              <input type="number" value={form.port ?? ''} onChange={e => set('port', Number(e.target.value))} required style={styles.input} />
            </label>
          </>}
        </div>

        <label style={styles.label}>
          {t('value')}
          <textarea
            value={form.value ?? ''}
            onChange={e => set('value', e.target.value)}
            required
            rows={3}
            style={{ ...styles.input, fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", resize: 'vertical' }}
            placeholder={form.type === 'TXT' ? 'v=spf1 include:... ~all' : ''}
          />
        </label>

        <div style={styles.actions}>
          <button type="button" onClick={onClose} style={styles.btnSecondary}>{t('cancel')}</button>
          <button type="submit" disabled={saving} style={styles.btnPrimary}>
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#fff', borderRadius: 8, padding: '1.5rem', width: 560, maxWidth: '95vw', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 8px 32px rgba(0,0,0,.18)', animation: 'modal-in 0.12s ease' },
  title: { margin: 0, fontSize: '1.125rem', fontWeight: 700 },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  hint: { fontWeight: 400, color: '#9ca3af', fontSize: '.75rem' },
  input: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem' },
  actions: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
}
