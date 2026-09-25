/** Saved list filter/sort presets, persisted per media type in localStorage. */
export interface Preset {
  name: string;
  tab: string;
  filter: string;
  sort: string;
  /** Absent on older presets, and applying one must clear the filter rather than keep a stale one. */
  tagFilter?: string;
  format?: string;
  country?: string;
  /** A custom list's raw name; absent on presets saved before it was captured, which clear it like the others. */
  list?: string;
  /** "" or absent means the sort key's own default direction. */
  dir?: string;
}

const KEY = "karasu-presets";

type Store = Record<string, Preset[]>;

function readStore(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Store;
  } catch {
    return {};
  }
}

export function loadPresets(mediaType: string): Preset[] {
  return readStore()[mediaType] ?? [];
}

export function savePresets(mediaType: string, presets: Preset[]): void {
  const store = readStore();
  store[mediaType] = presets;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full / unavailable — presets are best-effort */
  }
}
