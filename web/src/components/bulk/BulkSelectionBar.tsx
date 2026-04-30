import { useI18n } from '../../i18n/I18nContext'

interface Props {
  selectedCount: number
  visibleCount: number
  onOpen: () => void
  onClear: () => void
  onFindByRecord: () => void
}

export default function BulkSelectionBar({ selectedCount, visibleCount, onOpen, onClear, onFindByRecord }: Props) {
  const { t } = useI18n()
  const empty = selectedCount === 0

  return (
    <div role="region" aria-label="Bulk selection" style={styles.bar}>
      {empty ? (
        <>
          <span style={styles.hint}>{t('bulk_findByRecordHint')}</span>
          <button type="button" onClick={onFindByRecord} style={{ ...styles.btnPrimary, marginLeft: 'auto' }}>
            {t('bulk_findByRecord')} ▸
          </button>
        </>
      ) : (
        <>
          <span style={styles.countText}>
            {t('bulk_visibleSelected', selectedCount, visibleCount)}
          </span>
          <button type="button" onClick={onFindByRecord} style={styles.btnGhost}>
            {t('bulk_findByRecord')}
          </button>
          <button type="button" onClick={onOpen} style={{ ...styles.btnPrimary, marginLeft: 'auto' }}>
            {t('bulk_actionLabel')} ▸
          </button>
          <button type="button" onClick={onClear} style={styles.btnLink}>
            {t('bulk_clearSelection')}
          </button>
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '.75rem',
    padding: '.5rem .875rem',
    background: '#1e293b',
    color: '#f1f5f9',
    borderTop: '1px solid #0f172a',
    boxShadow: '0 -2px 8px rgba(0,0,0,.08)',
    flexShrink: 0,
  },
  hint: {
    fontSize: '.8125rem',
    color: '#cbd5e1',
  },
  countText: {
    fontSize: '.8125rem',
    fontWeight: 500,
  },
  btnPrimary: {
    padding: '.3125rem .75rem',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: '.8125rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnGhost: {
    padding: '.25rem .625rem',
    background: 'transparent',
    color: '#cbd5e1',
    border: '1px solid #334155',
    borderRadius: 4,
    fontSize: '.75rem',
    cursor: 'pointer',
  },
  btnLink: {
    padding: '.25rem .5rem',
    background: 'transparent',
    color: '#cbd5e1',
    border: 'none',
    fontSize: '.8125rem',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
}
