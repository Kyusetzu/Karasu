import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as api from "@/api/anilist";
import { asScoreFormat, type ScoreFormat } from "@/lib/scoreFormat";
import type { MediaType, Viewer } from "@/api/types";

type ProfileMode = "anilist" | "local" | "none";

interface AuthState {
  viewer: Viewer | null;
  /** "anilist" when connected, "local" for the account-free list, else "none" */
  mode: ProfileMode;
  /** true while the stored session is still being restored */
  loading: boolean;
  /** true once a profile (AniList or local) is active */
  hasProfile: () => boolean;
  init: () => Promise<void>;
  connect: (token: string) => Promise<void>;
  enableLocal: () => Promise<void>;
  logout: () => Promise<void>;
  /** Refetches the viewer — how a scoreFormat change reaches the store. */
  refreshViewer: () => Promise<void>;
}

/** Keep the api-layer routing cache aligned with the store. */
function applyMode(mode: ProfileMode) {
  api.setProfileModeCache(mode);
  return mode;
}

/** Same idea for the score format: the save paths convert through the cached
 *  value, so it must move with the viewer everywhere the viewer does. */
function applyViewer(viewer: Viewer | null): Viewer | null {
  api.setScoreFormatCache(asScoreFormat(viewer?.mediaListOptions?.scoreFormat));
  return viewer;
}

/**
 * The account's score format, for components. Ten-point when there is no
 * account to follow (local mode, signed out) — exactly the old behaviour.
 */
export function useScoreFormat(): ScoreFormat {
  return useAuth((s) => asScoreFormat(s.viewer?.mediaListOptions?.scoreFormat));
}

/**
 * The account's advanced-scoring categories for one media type, or none.
 *
 * Empty whenever the feature is off, which is the only correct gate: AniList
 * seeds `advancedScoring` with five default names on accounts that have never
 * switched it on, so the presence of names says nothing. Empty in local mode
 * and signed out, where the whole idea does not apply.
 */
export function useAdvancedCategories(type: MediaType): string[] {
  return useAuth((s) => {
    const options =
      type === "MANGA"
        ? s.viewer?.mediaListOptions?.mangaList
        : s.viewer?.mediaListOptions?.animeList;
    if (!options?.advancedScoringEnabled) return EMPTY_CATEGORIES;
    const names = options.advancedScoring?.filter((n) => !!n) ?? [];
    return names.length > 0 ? names : EMPTY_CATEGORIES;
  });
}

/**
 * One frozen array, so the selector above returns a stable reference for the
 * common case. A fresh `[]` every call makes zustand see a new value on every
 * store notification and re-render every consumer.
 */
const EMPTY_CATEGORIES: string[] = [];

export const useAuth = create<AuthState>((set, get) => ({
  viewer: null,
  mode: "none",
  loading: true,

  hasProfile: () => {
    const s = get();
    return s.viewer !== null || s.mode === "local";
  },

  init: async () => {
    if (!api.isTauri) {
      set({ loading: false });
      return;
    }
    // The one-click login completes in the backend (callback server) and
    // announces the fresh viewer through this event.
    listen<Viewer>("anilist-auth", (e) =>
      set({ viewer: applyViewer(e.payload), mode: applyMode("anilist") }),
    );
    try {
      const viewer = await api.session();
      if (viewer) {
        set({ viewer: applyViewer(viewer), mode: applyMode("anilist"), loading: false });
        return;
      }
      const stored = await api.getProfileMode();
      const mode: ProfileMode = stored === "local" ? "local" : "none";
      set({ viewer: null, mode: applyMode(mode), loading: false });
    } catch {
      set({ loading: false });
    }
  },

  connect: async (token: string) => {
    const viewer = await api.connect(token);
    set({ viewer: applyViewer(viewer), mode: applyMode("anilist") });
  },

  enableLocal: async () => {
    await api.enableLocalMode();
    applyViewer(null);
    set({ mode: applyMode("local") });
  },

  logout: async () => {
    await api.logout();
    set({ viewer: applyViewer(null), mode: applyMode("none") });
  },

  refreshViewer: async () => {
    const viewer = await api.refreshViewer();
    set({ viewer: applyViewer(viewer) });
  },
}));
