// Module-level navigation guard for the split-pane domain detail panel.
// DomainDetailPage registers a guard when it has unsaved changes;
// DomainsPage checks it before navigating to a different domain.

let guardFn: (() => boolean) | null = null

export function registerNavGuard(fn: (() => boolean) | null) {
  guardFn = fn
}

/** Returns true if navigation should proceed (no guard, or user confirmed). */
export function checkNavGuard(): boolean {
  return !guardFn || guardFn()
}
