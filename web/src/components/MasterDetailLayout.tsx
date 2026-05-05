import type { ReactNode } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'

interface Props {
  /**
   * Full-width view shown on desktop when no detail is open. If omitted, the
   * `sidebar` is rendered full-width instead (Templates-style: list always visible).
   */
  dashboard?: ReactNode
  /**
   * Compact list shown as a 300px sidebar when a detail is open. On mobile
   * it's the full-width view when no detail is open.
   */
  sidebar: ReactNode
  /** Detail pane shown to the right (or full-width on mobile) when isOpen. */
  detail: ReactNode
  /** Whether a detail item is currently selected. */
  isOpen: boolean
}

/**
 * Mirrors DomainsLayout: full-bleed master/detail container.
 *
 *  Desktop, no detail:  [   dashboard (or sidebar if no dashboard)   ]
 *  Desktop, with detail: [ sidebar ][        detail                  ]
 *  Mobile,  no detail:  [   sidebar (always)                         ]
 *  Mobile,  with detail: [   detail (full-width)                     ]
 *
 * The parent <main> in Layout.tsx must have `padding: 0` and `position: relative`
 * for this to fill correctly. Add the page's path to FULL_BLEED_PREFIXES.
 */
export default function MasterDetailLayout({ dashboard, sidebar, detail, isOpen }: Props) {
  const isMobile = useIsMobile()
  const hasSeparateDashboard = dashboard !== undefined

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      background: '#fff',
    }}>
      <style>{`
        @keyframes mdlFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Desktop sidebar: animated width 0 → 300 when detail opens */}
      {!isMobile && hasSeparateDashboard && (
        <div style={{
          width: isOpen ? 300 : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          zIndex: 1,
        }}>
          <div style={{
            width: 300,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#fafafa',
            borderRight: '1px solid #e2e8f0',
          }}>
            {sidebar}
          </div>
        </div>
      )}

      {/* Desktop sidebar (always-visible mode, no separate dashboard) */}
      {!isMobile && !hasSeparateDashboard && (
        <div style={{
          width: 300,
          flexShrink: 0,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fafafa',
          borderRight: '1px solid #e2e8f0',
        }}>
          {sidebar}
        </div>
      )}

      {/* Mobile sidebar — full-width when no detail */}
      {isMobile && !isOpen && (
        <div style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fafafa',
          animation: 'mdlFadeIn 180ms ease-out',
        }}>
          {sidebar}
        </div>
      )}

      {/* Main pane — dashboard or detail */}
      <div style={{
        flex: 1,
        display: isMobile && !isOpen ? 'none' : 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: '#fff',
      }}>
        {isOpen
          ? <div key="detail" style={{ flex: 1, minHeight: 0, overflowY: 'auto', animation: 'mdlFadeIn 200ms ease-out' }}>{detail}</div>
          : (!isMobile && hasSeparateDashboard && (
              <div key="dashboard" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'mdlFadeIn 200ms ease-out' }}>
                {dashboard}
              </div>
            ))}
      </div>
    </div>
  )
}
