export interface Label {
  id: number
  key: string
  value: string
  color?: string | null
  admin_only?: boolean
}

function autoColors(key: string): { bg: string; text: string } {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffffffff
  const hue = Math.abs(hash) % 360
  return { bg: `hsl(${hue}, 60%, 90%)`, text: `hsl(${hue}, 50%, 28%)` }
}

function hexTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55 ? '#fff' : '#1f2937'
}

export function getLabelColors(color: string | null | undefined, key: string): { bg: string; text: string } {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return { bg: color, text: hexTextColor(color) }
  return autoColors(key)
}

interface LabelChipProps {
  label: Label
  onRemove?: (e: React.MouseEvent) => void
}

export default function LabelChip({ label, onRemove }: LabelChipProps) {
  const { bg, text } = getLabelColors(label.color, label.key)
  const display = label.value
    ? <><span style={{ opacity: 0.7 }}>{label.key}</span><span style={{ opacity: 0.4, margin: '0 3px' }}>|</span>{label.value}</>
    : label.key

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: bg, color: text, borderRadius: 12, padding: '1px 8px', fontSize: '.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
      {label.admin_only && <span className="tip" data-tip="Admin only" style={{ opacity: 0.6, fontSize: '.65rem', marginRight: 1 }}>🔒</span>}
      {display}
      {onRemove && (
        <button onClick={e => onRemove(e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: text, padding: '0 0 0 3px', lineHeight: 1, fontSize: '.7rem', display: 'flex', alignItems: 'center' }}>
          ✕
        </button>
      )}
    </span>
  )
}
