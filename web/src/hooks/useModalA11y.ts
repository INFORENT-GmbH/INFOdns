import { useEffect, useRef } from 'react'

/**
 * Adds keyboard accessibility to a modal:
 *   - Escape closes the modal
 *   - Tab / Shift+Tab cycle within the modal (focus trap)
 *   - Initial focus is moved into the modal on mount
 *   - On unmount, focus is restored to the element that previously had it
 *
 * Usage:
 *   const ref = useModalA11y(onClose)
 *   return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="my-title">...</div>
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void
) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const root = ref.current
    if (!root) return

    function focusable(): HTMLElement[] {
      if (!root) return []
      const sel =
        'a[href], area[href], input:not([disabled]), select:not([disabled]),' +
        ' textarea:not([disabled]), button:not([disabled]),' +
        ' iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable]'
      return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(el =>
        el.offsetParent !== null || el === document.activeElement
      )
    }

    // Move initial focus into the modal
    const items = focusable()
    if (items.length > 0) items[0].focus()
    else root.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  return ref
}
