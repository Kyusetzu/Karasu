/**
 * A memo over an async loader, keyed by string, that also dedupes the calls
 * in flight.
 *
 * Written for bio images: `RichText` mounts one `InlineImage` per chip and
 * each one asked Rust for its bytes the moment it mounted, so a profile
 * opened twice fetched every image twice, and a feed that re-rendered a row
 * fetched it again. Every answer here is kept — rejections too, because a
 * host that refused a second ago will refuse again and a chip is the right
 * answer both times — and the oldest keys go once `cap` is passed, which is
 * what keeps a long session's memory bounded. `Map` iterates in insertion
 * order, so "oldest" is its first key.
 */
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
      // Stored before it settles: that is the dedupe. A rejection stays in
      // the map as a rejected promise, which every later `get` also receives.
      const p = load(key);
      // Swallow the unhandled-rejection warning on the *cached* copy; the
      // caller's own `.catch` still sees the rejection.
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
