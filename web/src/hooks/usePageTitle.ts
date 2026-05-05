import { useEffect } from 'react'

/**
 * Sets document.title to "INFORENT - <title>".
 * Pass no argument (or undefined) to get just "INFORENT - Manager".
 */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = `INFORENT - ${title ?? 'Manager'}`
    return () => { document.title = 'INFORENT - Manager' }
  }, [title])
}
