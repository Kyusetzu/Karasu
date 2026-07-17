import { create } from "zustand";
import * as api from "@/api/anilist";
import type { Viewer } from "@/api/types";

interface AuthState {
  viewer: Viewer | null;
  /** true, solange die gespeicherte Session noch geladen wird */
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
