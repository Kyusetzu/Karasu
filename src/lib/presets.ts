/**
 * Saved list filter/sort presets, persisted per media type in localStorage
 * (same lightweight per-machine approach as the language override).
 */
export interface Preset {
  name: string;
  tab: string;
  filter: string;
  sort: string;
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
