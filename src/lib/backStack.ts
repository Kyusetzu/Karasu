/** The back gesture closes overlays: one same-URL history entry per overlay, unwound on any close so it is net zero. */

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
    /** Called when an overlay opens; the returned release is a no-op after a back-close, so cleanup may call it anyway. */
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
