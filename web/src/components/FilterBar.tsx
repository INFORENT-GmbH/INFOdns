import type { CSSProperties, ReactNode } from 'react'
import * as s from '../styles/shell'

interface Props {
  children: ReactNode
  style?: CSSProperties
}

export default function FilterBar({ children, style }: Props) {
  return (
    <div
      style={{
        ...s.filterBar,
        gap: '.5rem',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
