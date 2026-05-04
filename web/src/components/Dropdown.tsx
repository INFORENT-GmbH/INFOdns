import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'

interface Props {
  /** Content rendered inside the trigger button. Usually the current selection or a placeholder. */
  label: ReactNode
  /** True when the trigger should show the active outline (a filter is set). */
  active?: boolean
  /** When provided, a small ✕ button is overlaid at the right edge of the trigger. */
  onClear?: () => void
  clearTitle?: string
  /** Width of the trigger wrapper. Default 200. */
  width?: number | string
  /** Min-width fallback if the wrapper is allowed to shrink. */
  minWidth?: number | string
  /** Align the panel to the trigger's left or right edge. */
  align?: 'left' | 'right'
  /** Max height of the panel. */
  maxHeight?: number
  /** Render prop for the panel; receives a `close` helper. */
  children: (close: () => void) => ReactNode
  /** Style overrides applied to the trigger button. */
  buttonStyle?: CSSProperties
  /** Use a "compact icon" trigger instead of the full input-like trigger (for ⚙ Columns etc). */
  trigger?: 'input' | 'compact'
}

const styles = {
  wrap: { position: 'relative' as const },
  triggerInput: {
    padding: '.3125rem .5rem', border: '1px solid #e2e8f0', borderRadius: 3,
    fontSize: '.8125rem', background: '#fff', outline: 'none',
    width: '100%', boxSizing: 'border-box' as const,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    cursor: 'pointer', textAlign: 'left' as const,
  },
  triggerCompact: {
    padding: '.3125rem .5rem', background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: 3, cursor: 'pointer', fontSize: '.8125rem', color: '#64748b',
    lineHeight: 1, display: 'inline-flex', alignItems: 'center', gap: '.375rem',
  },
  caret: { fontSize: '.65rem', color: '#9ca3af', marginLeft: 4, flexShrink: 0 },
  clearBtn: {
    position: 'absolute' as const, right: 4, top: '50%', transform: 'translateY(-50%)',
    padding: '.2rem .4rem', background: 'none', border: 'none', color: '#9ca3af',
    cursor: 'pointer', fontSize: '.8125rem', lineHeight: 1,
  },
  panelBase: {
    position: 'absolute' as const, top: '100%', marginTop: 2,
    background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,.1)', zIndex: 20,
    overflowY: 'auto' as const, padding: '4px 0',
  },
}

export default function Dropdown({
  label, active, onClear, clearTitle = 'Clear',
  width = 200, minWidth, align = 'left', maxHeight = 240,
  children, buttonStyle, trigger = 'input',
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const wrapStyle: CSSProperties = trigger === 'compact'
    ? styles.wrap
    : { ...styles.wrap, width, ...(minWidth !== undefined ? { minWidth } : {}) }

  const computedButton: CSSProperties = trigger === 'compact'
    ? { ...styles.triggerCompact, ...buttonStyle }
    : {
        ...styles.triggerInput,
        ...(active ? { outline: '2px solid #2563eb' } : {}),
        ...buttonStyle,
      }

  const panelStyle: CSSProperties = {
    ...styles.panelBase,
    maxHeight,
    ...(align === 'right'
      ? { right: 0, left: 'auto' as any, minWidth: width }
      : trigger === 'compact'
        ? { left: 0, minWidth: 200 }
        : { left: 0, right: 0 }),
  }

  return (
    <div ref={wrapRef} style={wrapStyle}>
      <button type="button" onClick={() => setOpen(v => !v)} style={computedButton}>
        {label}
        {trigger === 'input' && (
          <span style={styles.caret}>{onClear && active ? '' : '▼'}</span>
        )}
      </button>
      {onClear && active && trigger === 'input' && (
        <button
          type="button"
          onClick={() => { onClear(); setOpen(false) }}
          style={styles.clearBtn}
          title={clearTitle}
        >✕</button>
      )}
      {open && <div style={panelStyle}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

const itemStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', width: '100%',
  padding: '.25rem .5rem', background: 'none', border: 'none',
  cursor: 'pointer', textAlign: 'left' as const, fontSize: '.8125rem',
}

export function DropdownItem({
  onSelect, children, gap, style,
}: {
  onSelect: () => void
  children: ReactNode
  gap?: string | number
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onSelect() }}
      style={{ ...itemStyle, ...(gap !== undefined ? { gap } : {}), ...style }}
    >
      {children}
    </button>
  )
}

export function DropdownEmpty({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '.5rem .75rem', color: '#9ca3af', fontSize: '.8rem' }}>
      {children}
    </div>
  )
}
