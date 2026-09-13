import { create } from "zustand";
import {
  getBlurAdult,
  getContentFilter,
  isTauri,
  setBlurAdult,
  setContentFilter,
} from "@/api/anilist";
import { toLevel, type ContentFilterLevel } from "@/lib/contentFilter";

interface ContentFilterState {
  level: ContentFilterLevel;
  /** Blur explicit artwork until clicked; independent of `level` (`shouldBlur`) and defaulted to true by the backend. */
  blurAdult: boolean;
  /** False until the stored level has been read, so nothing renders early. */
  ready: boolean;
  /** Why the last change did not stick, or null; a silently dropped save here shows content the user asked not to see. */
  error: string | null;
  init: () => Promise<void>;
  setLevel: (level: ContentFilterLevel) => Promise<void>;
  setBlurAdult: (blur: boolean) => Promise<void>;
}

/** One store for the many render sites; `level` starts strict so a launch never flashes blocked content before the read. */
export const useContentFilter = create<ContentFilterState>((set, get) => ({
  level: "strict",
  blurAdult: true,
  ready: false,
  error: null,

  init: async () => {
    if (!isTauri) {
      set({ ready: true });
      return;
    }
    try {
      const [stored, blur] = await Promise.all([getContentFilter(), getBlurAdult()]);
      set({ level: toLevel(stored), blurAdult: blur, ready: true });
    } catch {
      // Keep the safe default rather than opening the filter on an error.
      set({ ready: true });
    }
  },

  /** Paints, then persists, and puts the level back if persisting fails; a swallowed error shows the wrong content. */
  setLevel: async (level) => {
    const previous = get().level;
    set({ level, error: null });
    if (!isTauri) return;
    try {
      await setContentFilter(level);
    } catch (e) {
      set({ level: previous, error: String(e) });
    }
  },

  /** Same revert-on-failure shape, for the same reason. */
  setBlurAdult: async (blur) => {
    const previous = get().blurAdult;
    set({ blurAdult: blur, error: null });
    if (!isTauri) return;
    try {
      await setBlurAdult(blur);
    } catch (e) {
      set({ blurAdult: previous, error: String(e) });
    }
  },
}));
