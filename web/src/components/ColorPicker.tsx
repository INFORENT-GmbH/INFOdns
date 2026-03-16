import { useState, useRef, useEffect } from 'react'
import { getLabelColors } from './LabelChip'

const PRESET_COLORS = [
  '#f1f5f9', '#fee2e2', '#ffedd5', '#fef9c3', '#dcfce7',
  '#ccfbf1', '#dbeafe', '#ede9fe', '#fce7f3', '#ffe4e6',
]

interface ColorPickerProps {
  value: string | null
  labelKey: string
  onChange: (color: string | null) => void
  label?: string
}

function toHexInput(value: string | null): string {
  if (!value) return '#9ca3af'
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  return '#9ca3af'
}

export default function ColorPicker({ value, labelKey, onChange, label = 'Color' }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  const [hexInput, setHexInput] = useState(() => toHexInput(value))
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => { setHexInput(toHexInput(value)) }, [value])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const { bg, text } = getLabelColors(value, labelKey)

  function handleWheel(hex: string) {
    setHexInput(hex)
    onChange(hex)
  }

  function handleHexText(val: string) {
    setHexInput(val)
    if (/^#[0-9a-fA-F]{6}$/.test(val)) onChange(val)
  }

  const safeHex = /^#[0-9a-fA-F]{6}$/.test(hexInput) ? hexInput : '#9ca3af'

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ height: 22, borderRadius: 4, background: bg, border: `1px solid ${text}`, cursor: 'pointer', padding: '0 6px', fontSize: '.75rem', color: text, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label} <span style={{ fontSize: '.6rem' }}>▾</span>
      </button>

      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 3, zIndex: 200, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', width: 260 }}>

          {/* Presets */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            <button type="button" onClick={() => { onChange(null); setOpen(false) }} title="Auto"
              style={swatch('linear-gradient(135deg, #e5e7eb 50%, #9ca3af 50%)', value === null ? '2px solid #374151' : '1px solid #d1d5db')} />
            {PRESET_COLORS.map(hex => {
              const { text: t } = getLabelColors(hex, '')
              return (
                <button type="button" key={hex} onClick={() => { onChange(hex); setOpen(false) }} title={hex}
                  style={swatch(hex, value === hex ? `2px solid ${t}` : '1px solid #d1d5db')} />
              )
            })}
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #f3f4f6', marginBottom: 8 }} />

          {/* Color wheel + hex input */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ width: 30, height: 28, border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', background: safeHex, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} title="Pick color">
              <span style={{ fontSize: 14, lineHeight: 1, filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.4))' }}>🎨</span>
              <input type="color" value={safeHex} onChange={e => handleWheel(e.target.value)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
            </label>
            <input type="text" value={hexInput} onChange={e => handleHexText(e.target.value)}
              placeholder="#rrggbb" maxLength={7}
              style={{ flex: 1, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', fontFamily: 'ui-monospace, monospace' }} />
            <button type="button" onClick={() => { if (/^#[0-9a-fA-F]{6}$/.test(hexInput)) { onChange(hexInput); setOpen(false) } }}
              style={{ padding: '2px 7px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.8125rem', cursor: 'pointer' }}>
              ✓
            </button>
          </div>

        </div>
      )}
    </span>
  )
}

function swatch(background: string, border: string): React.CSSProperties {
  return { width: 20, height: 20, borderRadius: '50%', background, border, cursor: 'pointer', padding: 0, flexShrink: 0 }
}
