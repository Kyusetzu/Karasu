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
  /**
   * AniList has rejected the stored token.
   *
   * One flag for the whole app, because one dead token fails everything at
   * once: `anilist_query` attaches the bearer to every request, including the
   * public ones behind search, the forum and detail pages. Before this, each of
   * those screens rendered its own "Failed to load: Invalid token", which is
   * what made an expired session read as the app randomly breaking.
   *
   * Never set in local mode — there is no token to reject.
   */
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
  // The selector returns something the store already holds **by reference**,
  // and the deriving happens outside it. This is not a style preference.
  //
  // zustand 5 hands the selector straight to React's `useSyncExternalStore`,
  // which re-invokes it in its post-commit consistency check and re-renders
  // whenever the result is not identical to the last one. A selector that ends
  // in `.filter()` allocates a fresh array every time, so it is *never*
  // identical — and the component re-renders until React gives up. Measured on
  // this repo's own React 19.2.7 and zustand 5.0.14: 55 renders, then
  // "Maximum update depth exceeded" (minified error #185 in a shipped build).
  //
  // The first version of this hook derived inside the selector and stabilised
  // only the disabled branch with the frozen constant below — which is to say,
  // it worked for everyone except the accounts the feature exists for.
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

  // Idempotent on purpose: a screen fires several queries and every one of them
  // fails, so this is called in a burst. Setting an already-set flag would
  // re-render every subscriber for nothing.
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
    // The api layer cannot import this store (it imports the api layer), so
    // the rejection arrives through a registered callback — the same shape as
    // `setProfileModeCache`.
    api.setTokenRejectedHandler(() => get().reportSessionExpired());
    // The one-click login completes in the backend (callback server) and
    // announces the fresh viewer through this event.
    listen<Viewer>("anilist-auth", (e) => {
      // Same reason as `connect` below: this is a different account arriving.
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
    // Drop every cached response before the new viewer is visible. The keys
    // that matter here carry no viewer of their own while their payload does,
    // so without this the previous account's entry — progress, score, private
    // notes — keeps rendering under this one, and one Save writes it here.
    api.identityChanged();
    // Cleared here and on the `anilist-auth` event above, which are the only
    // two ways a working token arrives. Leaving it set would strand the banner
    // over a session that has just been fixed.
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
    // The account's responses must not outlive the account: signing back in as
    // someone else would otherwise meet a cache still holding these answers.
    api.identityChanged();
    // Signed out is not "expired": there is no session left to be stale, and
    // the sign-in screen is already the thing the banner would ask for.
    set({ viewer: applyViewer(null), mode: applyMode("none"), sessionExpired: false });
  },

  refreshViewer: async () => {
    const viewer = await api.refreshViewer();
    set({ viewer: applyViewer(viewer) });
  },
}));
