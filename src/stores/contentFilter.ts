import { create } from "zustand";
import { getContentFilter, isTauri, setContentFilter } from "@/api/anilist";
import { toLevel, type ContentFilterLevel } from "@/lib/contentFilter";

interface ContentFilterState {
  level: ContentFilterLevel;
  /** False until the stored level has been read, so nothing renders early. */
  ready: boolean;
  init: () => Promise<void>;
  setLevel: (level: ContentFilterLevel) => void;
}

/**
 * The filter level is needed by roughly a dozen render sites, so it lives in a
 * store rather than each page invoking the backend for itself.
 *
 * `level` starts at "strict" and `ready` at false: the level is read
 * asynchronously, and defaulting to the permissive end would flash blocked
 * content on every launch before the real value arrives.
 */
export const useContentFilter = create<ContentFilterState>((set) => ({
  level: "strict",
  ready: false,

  init: async () => {
    if (!isTauri) {
      set({ ready: true });
      return;
    }
    try {
      const stored = await getContentFilter();
      set({ level: toLevel(stored), ready: true });
    } catch {
      // Keep the safe default rather than opening the filter on an error.
      set({ ready: true });
    }
  },

  setLevel: (level) => {
    set({ level });
    if (isTauri) setContentFilter(level).catch(() => {});
  },
}));
