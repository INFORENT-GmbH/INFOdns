import type { CSSProperties, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Override the default flex layout. Multi-section pages may pass overflow:auto here. */
  style?: CSSProperties
}

/**
 * Full-bleed list page wrapper. Mirrors DomainsLayout/DomainsDashboard:
 * - absolutely positioned to fill the parent <main>
 * - white background
 * - flex column so children (filter bars + ListTable) stack
 *
 * The parent <main> in Layout.tsx must have `padding: 0` and `position: relative`
 * for this to fill correctly. Layout.tsx already does this for paths in
 * `FULL_BLEED_PATHS`.
 */
export default function ListPage({ children, style }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        ...style,
      }}
    >
      {children}
    </div>
  )
}
