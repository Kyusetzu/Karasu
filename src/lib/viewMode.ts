/** Which view each list screen was left in, in localStorage per media type because anime and manga are different habits. */

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
    // An object with every value a known mode; a stray entry falls back rather than throwing on first render.
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
    // Not worth surfacing: the view still changed, and failing the toggle over a storage quota would be worse.
  }
}
