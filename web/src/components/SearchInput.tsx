import type { CSSProperties } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number | string
  style?: CSSProperties
}

const baseStyle: CSSProperties = {
  padding: '.3125rem .5rem',
  border: '1px solid #e2e8f0',
  borderRadius: 3,
  fontSize: '.8125rem',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
}

export default function SearchInput({ value, onChange, placeholder, width = 200, style }: Props) {
  return (
    <div style={{ position: 'relative', width, flexShrink: 0 }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ ...baseStyle, width: '100%', paddingRight: value ? 24 : undefined, ...style }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear"
          style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            padding: '.2rem .4rem', background: 'none', border: 'none', color: '#9ca3af',
            cursor: 'pointer', fontSize: '.8125rem', lineHeight: 1,
          }}
        >✕</button>
      )}
    </div>
  )
}

export const searchInputStyle = baseStyle
