// Persists per-domain unsaved record edits while navigating between domains
// in the split-pane view. Cleared when changes are applied or discarded.

export interface PerDomainEdits {
  serial: number  // domain.last_serial at the time these edits were cached
  edits: Record<number, { name: string; type: string; ttl: string; value: string; priority: string; weight: string; port: string }>
  pendingDeletes: number[]
  newRows: ({ _newId: string; name: string; type: string; ttl: string; value: string; priority: string; weight: string; port: string })[]
}

const cache = new Map<number, PerDomainEdits>()

export function saveDomainEdits(id: number, state: PerDomainEdits) {
  if (!Object.keys(state.edits).length && !state.pendingDeletes.length && !state.newRows.length) {
    cache.delete(id)
  } else {
    cache.set(id, state)
  }
}

export function loadDomainEdits(id: number): PerDomainEdits | undefined {
  return cache.get(id)
}

export function clearDomainEdits(id: number) {
  cache.delete(id)
}
