// Persists per-domain unsaved record edits while navigating between domains
// in the split-pane view. Cleared when changes are applied or discarded.

export interface PerDomainEdits {
  serial: number  // domain.last_serial at the time these edits were cached
  edits: Record<number, { name: string; type: string; ttl: string; value: string; priority: string; weight: string; port: string }>
  pendingDeletes: number[]
  newRows: ({ _newId: string; name: string; type: string; ttl: string; value: string; priority: string; weight: string; port: string })[]
}

const cache = new Map<string, PerDomainEdits>()

// Live dirty state for the currently open domain — updated on every render by DomainDetailPage
const liveDirty = new Set<string>()

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

/** All domain fqdns that currently have unsaved changes (cached or live). */
export function getDirtyDomainFqdns(): Set<string> {
  const result = new Set<string>()
  for (const [fqdn] of cache) result.add(fqdn)
  for (const fqdn of liveDirty) result.add(fqdn)
  return result
}

/** Called by DomainDetailPage on every render to track live dirty state. */
export function setLiveDirty(fqdn: string, dirty: boolean) {
  const changed = dirty ? !liveDirty.has(fqdn) : liveDirty.has(fqdn)
  if (dirty) liveDirty.add(fqdn)
  else liveDirty.delete(fqdn)
  if (changed) notify()
}

export function saveDomainEdits(fqdn: string, state: PerDomainEdits) {
  if (!Object.keys(state.edits).length && !state.pendingDeletes.length && !state.newRows.length) {
    cache.delete(fqdn)
  } else {
    cache.set(fqdn, state)
  }
  notify()
}

export function loadDomainEdits(fqdn: string): PerDomainEdits | undefined {
  return cache.get(fqdn)
}

export function clearDomainEdits(fqdn: string) {
  cache.delete(fqdn)
  notify()
}
