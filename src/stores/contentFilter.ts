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
  /**
   * Blur explicit artwork until it is clicked. Independent of `level` — see
   * `shouldBlur` — and defaulted to true by the backend.
   */
  blurAdult: boolean;
  /** False until the stored level has been read, so nothing renders early. */
  ready: boolean;
  /**
   * Why the last change did not stick, or null.
   *
   * This setting is the one place in the app where a silently-dropped save has
   * a consequence beyond the setting itself, so it is the one store that keeps
   * an error rather than swallowing it.
   */
  error: string | null;
  init: () => Promise<void>;
  setLevel: (level: ContentFilterLevel) => Promise<void>;
  setBlurAdult: (blur: boolean) => Promise<void>;
}

/**
 * The filter level is needed by roughly a dozen render sites, so it lives in a
 * store rather than each page invoking the backend for itself.
 *
 * `level` starts at "strict" and `ready` at false: the level is read
 * asynchronously, and defaulting to the permissive end would flash blocked
 * content on every launch before the real value arrives.
 */
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

  /**
   * Paints, then persists — and puts the level back if persisting fails.
   *
   * It used to be `.catch(() => {})`. The screen then showed the level the user
   * chose while the database kept the old one, so the choice quietly did not
   * survive a restart: someone who set "strict" got the permissive list back on
   * the next launch with nothing having said otherwise. Reverting is the honest
   * failure, because the wrong direction here is content the user asked not to
   * see.
   */
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
