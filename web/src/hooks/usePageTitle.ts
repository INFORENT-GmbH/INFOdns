import { useEffect } from 'react'

const SUFFIX = 'INFORENT GmbH'

/**
 * Sets document.title to "<title> — INFORENT GmbH".
 * Pass no argument (or undefined) to get just "Manager — INFORENT GmbH".
 */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${SUFFIX}` : `Manager — ${SUFFIX}`
    return () => { document.title = `Manager — ${SUFFIX}` }
  }, [title])
}
