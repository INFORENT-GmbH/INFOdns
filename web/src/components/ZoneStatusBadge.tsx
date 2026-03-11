const colors = {
  clean:   { bg: '#dcfce7', text: '#15803d' },
  dirty:   { bg: '#fef9c3', text: '#854d0e' },
  error:   { bg: '#fee2e2', text: '#b91c1c' },
}

import { useI18n } from '../i18n/I18nContext'

const statusKey: Record<string, 'zone_clean' | 'zone_dirty' | 'zone_error'> = {
  clean: 'zone_clean',
  dirty: 'zone_dirty',
  error: 'zone_error',
}

export default function ZoneStatusBadge({ status }: { status: string }) {
  const { t } = useI18n()
  const c = colors[status as keyof typeof colors] ?? { bg: '#f3f4f6', text: '#374151' }
  const label = statusKey[status] ? t(statusKey[status]) : status
  return (
    <span style={{ background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 12, fontSize: '.75rem', fontWeight: 600 }}>
      {label}
    </span>
  )
}
