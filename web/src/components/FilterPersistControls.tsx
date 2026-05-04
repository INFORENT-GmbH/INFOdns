import { useI18n } from '../i18n/I18nContext'

export default function FilterPersistControls({
  persist, setPersist, onClear, hasActive, compact = false, style,
}: {
  persist: boolean
  setPersist: (v: boolean) => void
  onClear: () => void
  hasActive: boolean
  compact?: boolean
  style?: React.CSSProperties
}) {
  const { t } = useI18n()
  const fontSize = compact ? '.7rem' : '.75rem'
  const btnPad = compact ? '.15rem .4rem' : '.2rem .55rem'
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', fontSize, color: '#475569', ...style }}>
      <label
        title={t('filters_persistTip')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        <input
          type="checkbox"
          checked={persist}
          onChange={e => setPersist(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        {t('filters_persist')}
      </label>
      <button
        type="button"
        onClick={onClear}
        disabled={!hasActive}
        style={{
          padding: btnPad,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 4,
          fontSize,
          cursor: hasActive ? 'pointer' : 'not-allowed',
          color: hasActive ? '#374151' : '#cbd5e1',
          whiteSpace: 'nowrap',
        }}
      >
        {t('filters_clear')}
      </button>
    </div>
  )
}
