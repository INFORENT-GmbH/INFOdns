import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** When true, the wrapper just scrolls vertically; when false, it lets children control overflow. */
  scroll?: boolean
  style?: CSSProperties
}

/**
 * The body slot of a ListPage: takes the remaining vertical space and scrolls.
 * Used as a sibling to FilterBar elements inside ListPage.
 */
export default function ListTable({ children, scroll = true, style }: Props) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: scroll ? 'auto' : 'visible',
        overflowX: 'auto',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
