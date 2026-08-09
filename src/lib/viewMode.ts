/**
 * Which view each list screen was left in, remembered per media type.
 *
 * The toggle used to be plain component state, and `<main key={pathname}>`
 * remounts the page on every navigation — so the choice lasted exactly as long
 * as you stayed on the screen. That was tolerable while the list was a denser
 * cover wall; now that it is the detail-and-edit view, being dropped back into
 * the grid every time you come back is a real cost.
 *
 * localStorage per media type, following `presets.ts` (`karasu-presets`) and the
 * theme store's density — per machine, no sync, nothing to migrate. Anime and
 * manga are separate because they are genuinely different habits: a cover wall
 * for browsing anime and a table for maintaining a manga backlog is a coherent
 * preference, not an inconsistency.
 */

export type ViewMode = "grid" | "rows";

const KEY = "karasu-list-view";

/** Grid, because it is the browsing view — the list is the one you choose. */
export const DEFAULT_VIEW: ViewMode = "grid";

function isViewMode(value: unknown): value is ViewMode {
  return value === "grid" || value === "rows";
}

type Store = Record<string, ViewMode>;

function readStore(): Store {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "{}");
    // Object, and every value a mode we know. A hand-edited or
    // half-written-by-an-older-build entry should fall back, not throw on the
    // first render of the screen.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isViewMode(v)) out[k] = v;
    }
    return out;
  } catch {
    // Private-mode localStorage throws on read as well as write.
    return {};
  }
}

export function loadViewMode(mediaType: string): ViewMode {
  return readStore()[mediaType] ?? DEFAULT_VIEW;
}

export function saveViewMode(mediaType: string, mode: ViewMode): void {
  try {
    const store = readStore();
    store[mediaType] = mode;
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Not worth surfacing: the view still changed, it just will not be
    // remembered. Failing the toggle over a storage quota would be worse.
  }
}
