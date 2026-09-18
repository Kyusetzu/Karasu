/** The whole-app sync runs one at a time; every surface that can start one shares this flag instead of its own. */

let syncing = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** True while a sync runs, wherever it began — the sidebar, the tray, a shortcut, or the phone's pull gesture. */
export function isSyncing(): boolean {
  return syncing;
}

/** Takes the lock, or answers false because another surface holds it; a false answer must not start a second sync. */
export function acquire(): boolean {
  if (syncing) return false;
  syncing = true;
  emit();
  return true;
}

/** Idempotent, so a `finally` that somehow runs twice cannot unbalance the lock. */
export function release(): void {
  if (!syncing) return;
  syncing = false;
  emit();
}

/** The shape `useSyncExternalStore` takes, so every consumer re-renders on the same flag. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
