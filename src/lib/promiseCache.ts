/** A memo over an async loader that dedupes in-flight calls and keeps rejections, so a URL is fetched once per session. */
export interface PromiseCache<V> {
  get(key: string): Promise<V>;
  /** How many keys are held, for tests and for a debug readout. */
  readonly size: number;
}

export function createPromiseCache<V>(
  load: (key: string) => Promise<V>,
  cap = 256,
): PromiseCache<V> {
  const held = new Map<string, Promise<V>>();
  return {
    get(key) {
      const hit = held.get(key);
      if (hit) return hit;
      // Stored before it settles, which is the dedupe; a rejection stays and every later `get` receives it too.
      const p = load(key);
      // Swallow the unhandled-rejection warning on the cached copy; the caller's own `.catch` still sees it.
      p.catch(() => {});
      held.set(key, p);
      while (held.size > cap) {
        const oldest = held.keys().next().value;
        if (oldest === undefined) break;
        held.delete(oldest);
      }
      return p;
    },
    get size() {
      return held.size;
    },
  };
}
