import { useMemo } from "react";
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
  /** AniList rejected the stored token (never set in local mode); one flag, since the bearer rides every request. */
  sessionExpired: boolean;
  /** true once a profile (AniList or local) is active */
  hasProfile: () => boolean;
  init: () => Promise<void>;
  connect: (token: string) => Promise<void>;
  enableLocal: () => Promise<void>;
  logout: () => Promise<void>;
  /** Refetches the viewer — how a scoreFormat change reaches the store. */
  refreshViewer: () => Promise<void>;
  /** Raised by the api layer when a request comes back `anilist.tokenRejected`. */
  reportSessionExpired: () => void;
}

/** Keep the api-layer routing cache aligned with the store. */
function applyMode(mode: ProfileMode) {
  api.setProfileModeCache(mode);
  return mode;
}

/** Keep the api-layer score-format cache moving with the viewer, since the save paths convert through it. */
function applyViewer(viewer: Viewer | null): Viewer | null {
  api.setScoreFormatCache(asScoreFormat(viewer?.mediaListOptions?.scoreFormat));
  return viewer;
}

/** The account's score format for components, ten-point when there is no account to follow. */
export function useScoreFormat(): ScoreFormat {
  return useAuth((s) => asScoreFormat(s.viewer?.mediaListOptions?.scoreFormat));
}

/** Advanced-scoring categories for one media type; gate on the enabled flag, since AniList seeds names anyway. */
export function useAdvancedCategories(type: MediaType): string[] {
  // Keep the selector returning a store-held reference; a fresh array per call re-renders until React gives up.
  const options = useAuth((s) =>
    type === "MANGA"
      ? s.viewer?.mediaListOptions?.mangaList
      : s.viewer?.mediaListOptions?.animeList,
  );
  return useMemo(() => {
    if (!options?.advancedScoringEnabled) return EMPTY_CATEGORIES;
    const names = options.advancedScoring?.filter((n) => !!n) ?? [];
    return names.length > 0 ? names : EMPTY_CATEGORIES;
  }, [options]);
}

/** One frozen array, so "no categories" is also a stable reference. */
const EMPTY_CATEGORIES: string[] = [];

export const useAuth = create<AuthState>((set, get) => ({
  viewer: null,
  mode: "none",
  loading: true,
  sessionExpired: false,

  // Idempotent on purpose: a screen's failing queries call this in a burst, and re-setting would re-render for nothing.
  reportSessionExpired: () => {
    if (!get().sessionExpired) set({ sessionExpired: true });
  },

  hasProfile: () => {
    const s = get();
    return s.viewer !== null || s.mode === "local";
  },

  init: async () => {
    if (!api.isTauri) {
      set({ loading: false });
      return;
    }
    // The api layer cannot import this store (it imports the api layer), so the rejection arrives by callback.
    api.setTokenRejectedHandler(() => get().reportSessionExpired());
    // The one-click login completes in the backend and announces the fresh viewer through this event.
    listen<Viewer>("anilist-auth", (e) => {
      // A different account is arriving, so drop the cached responses before its viewer is visible.
      api.identityChanged();
      set({
        viewer: applyViewer(e.payload),
        mode: applyMode("anilist"),
        sessionExpired: false,
      });
    });
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
    // Keep this before the set; query keys carry no viewer, so a stale entry would render and save under this account.
    api.identityChanged();
    // Cleared wherever a working token arrives, or the banner would strand over a session just fixed.
    set({
      viewer: applyViewer(viewer),
      mode: applyMode("anilist"),
      sessionExpired: false,
    });
  },

  enableLocal: async () => {
    await api.enableLocalMode();
    api.identityChanged();
    applyViewer(null);
    set({ mode: applyMode("local") });
  },

  logout: async () => {
    await api.logout();
    // The account's responses must not outlive the account, or the next sign-in meets a cache full of them.
    api.identityChanged();
    // Signed out is not "expired": the sign-in screen is already what the banner would ask for.
    set({ viewer: applyViewer(null), mode: applyMode("none"), sessionExpired: false });
  },

  refreshViewer: async () => {
    const viewer = await api.refreshViewer();
    set({ viewer: applyViewer(viewer) });
  },
}));
