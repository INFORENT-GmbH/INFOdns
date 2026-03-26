// Persists per-domain unsaved record edits while navigating between domains
// in the split-pane view. Cleared when changes are applied or discarded.

export interface PerDomainEdits {
  serial: number  // domain.last_serial at the time these edits were cached
  edits: Record<number, { name: string; type: string; ttl: string; value: string; priority: string; weight: string; port: string }>
  pendingDeletes: number[]
  newRows: ({ _newId: string; name: string; type: string; ttl: string; value: string; priority: string; weight: string; port: string })[]
}

const cache = new Map<number, PerDomainEdits>()

// Live dirty state for the currently open domain — updated on every render by DomainDetailPage
const liveDirty = new Set<number>()

type Listener = () => void
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l()
}

/** Subscribe to dirty state changes. Returns an unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** All domain IDs that currently have unsaved changes (cached or live). */
export function getDirtyDomainIds(): Set<number> {
  const result = new Set<number>()
  for (const [id] of cache) result.add(id)
  for (const id of liveDirty) result.add(id)
  return result
}

/** Called by DomainDetailPage on every render to track live dirty state. */
export function setLiveDirty(domainId: number, dirty: boolean) {
  const changed = dirty ? !liveDirty.has(domainId) : liveDirty.has(domainId)
  if (dirty) liveDirty.add(domainId)
  else liveDirty.delete(domainId)
  if (changed) notify()
}

export function saveDomainEdits(id: number, state: PerDomainEdits) {
  if (!Object.keys(state.edits).length && !state.pendingDeletes.length && !state.newRows.length) {
    cache.delete(id)
  } else {
    cache.set(id, state)
  }
  notify()
}

export function loadDomainEdits(id: number): PerDomainEdits | undefined {
  return cache.get(id)
}

export function clearDomainEdits(id: number) {
  cache.delete(id)
  notify()
}
