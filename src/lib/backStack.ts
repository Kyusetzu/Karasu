/**
 * The Android back gesture, taught to close overlays.
 *
 * Every overlay closes on Escape — a key phones do not have. On Android the
 * system back gesture walks the WebView's history instead, which with a
 * HashRouter means "leave the page" while a dialog is still covering it. So
 * an opening overlay pushes one history entry at the *current* URL (the hash
 * is unchanged: no navigation fires, `<main key={pathname}>` keeps its key),
 * and the back gesture pops that entry — the popstate closes the topmost
 * overlay and goes no further.
 *
 * Closing by any other means (Escape, backdrop, an action) has to unwind the
 * entry it pushed, or every opened-and-closed dialog would cost one extra
 * back press later. `release()` calls `history.back()` and arms a one-shot
 * swallow so our own listener ignores the resulting popstate. If a navigation
 * buried the entry first (`history.state` no longer carries the token), the
 * entry is left where it lies: popping would eat a real history step. The one
 * inert same-URL entry that remains costs a single extra back press that the
 * router treats as a no-op — the documented, accepted edge.
 *
 * Everything here is pure against an injected history so the races live under
 * unit tests instead of on the phone. `hooks/useBackClose` is the React glue.
 */

export interface HistoryLike {
  pushState(data: unknown, unused: string): void;
  back(): void;
  readonly state: unknown;
}

interface Entry {
  token: number;
  close: () => void;
}

const isOurs = (state: unknown, token: number): boolean =>
  typeof state === "object" &&
  state !== null &&
  (state as { karasuBack?: unknown }).karasuBack === token;

export function createBackStack(h: HistoryLike) {
  const stack: Entry[] = [];
  let nextToken = 1;
  let swallow = 0;

  return {
    /**
     * Called when an overlay opens. Returns the release for when it closes by
     * any means other than the back gesture; releasing after a back-close is
     * a no-op, so callers may do it unconditionally from cleanup.
     */
    register(close: () => void): () => void {
      const entry: Entry = { token: nextToken++, close };
      h.pushState({ karasuBack: entry.token }, "");
      stack.push(entry);
      return () => {
        const i = stack.indexOf(entry);
        if (i === -1) return; // already closed by the back gesture
        stack.splice(i, 1);
        if (isOurs(h.state, entry.token)) {
          swallow++;
          h.back();
        }
      };
    },

    /** The single popstate listener feeds every event through here. */
    onPopState(): "closed" | "swallowed" | "passthrough" {
      if (swallow > 0) {
        swallow--;
        return "swallowed";
      }
      const top = stack.pop();
      if (top) {
        top.close();
        return "closed";
      }
      return "passthrough";
    },
  };
}
