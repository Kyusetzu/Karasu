import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as api from "@/api/anilist";
import type { Viewer } from "@/api/types";

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
}

/** Keep the api-layer routing cache aligned with the store. */
function applyMode(mode: ProfileMode) {
  api.setProfileModeCache(mode);
  return mode;
}

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
      set({ viewer: e.payload, mode: applyMode("anilist") }),
    );
    try {
      const viewer = await api.session();
      if (viewer) {
        set({ viewer, mode: applyMode("anilist"), loading: false });
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
    set({ viewer, mode: applyMode("anilist") });
  },

  enableLocal: async () => {
    await api.enableLocalMode();
    set({ mode: applyMode("local") });
  },

  logout: async () => {
    await api.logout();
    set({ viewer: null, mode: applyMode("none") });
  },
}));
