import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as api from "@/api/anilist";
import type { Viewer } from "@/api/types";

interface AuthState {
  viewer: Viewer | null;
  /** true while the stored session is still being restored */
  loading: boolean;
  init: () => Promise<void>;
  connect: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  viewer: null,
  loading: true,

  init: async () => {
    if (!api.isTauri) {
      set({ loading: false });
      return;
    }
    // The one-click login completes in the backend (callback server) and
    // announces the fresh viewer through this event.
    listen<Viewer>("anilist-auth", (e) => set({ viewer: e.payload }));
    try {
      const viewer = await api.session();
      set({ viewer, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  connect: async (token: string) => {
    const viewer = await api.connect(token);
    set({ viewer });
  },

  logout: async () => {
    await api.logout();
    set({ viewer: null });
  },
}));
