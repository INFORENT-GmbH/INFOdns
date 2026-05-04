import { useEffect, useState } from 'react'

function shallowEqualValue(a: unknown, b: unknown) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  return a === b
}

export function usePersistedFilters<T extends Record<string, unknown>>(
  storageKey: string,
  defaults: T,
) {
  const persistKey = `${storageKey}.persist`
  const valuesKey = `${storageKey}.values`

  const initialPersist = typeof window !== 'undefined' && localStorage.getItem(persistKey) === '1'
  const [persist, setPersistState] = useState(initialPersist)

  const [filters, setFiltersState] = useState<T>(() => {
    if (!initialPersist) return defaults
    const raw = localStorage.getItem(valuesKey)
    if (!raw) return defaults
    try {
      const parsed = JSON.parse(raw)
      return { ...defaults, ...parsed }
    } catch {
      return defaults
    }
  })

  useEffect(() => {
    if (persist) localStorage.setItem(valuesKey, JSON.stringify(filters))
  }, [persist, filters, valuesKey])

  function setPersist(v: boolean) {
    if (v) {
      localStorage.setItem(persistKey, '1')
      localStorage.setItem(valuesKey, JSON.stringify(filters))
    } else {
      localStorage.removeItem(persistKey)
      localStorage.removeItem(valuesKey)
    }
    setPersistState(v)
  }

  function setFilter<K extends keyof T>(key: K, value: T[K]) {
    setFiltersState(prev => ({ ...prev, [key]: value }))
  }

  function clear() {
    setFiltersState(defaults)
  }

  const hasActive = (Object.keys(defaults) as (keyof T)[])
    .some(k => !shallowEqualValue(filters[k], defaults[k]))

  return { filters, setFilter, setFilters: setFiltersState, persist, setPersist, clear, hasActive }
}
