import { create } from "zustand";
import { isTauri } from "@/api/anilist";
import { getLibraryIndex, playNext } from "@/api/library";

interface LibraryState {
  /** media_id → episode numbers present on disk. */
  episodes: Record<number, number[]>;
  refresh: () => Promise<void>;
  /** Whether an episode beyond `progress` exists locally. */
  hasNext: (mediaId: number, progress: number) => boolean;
  play: (mediaId: number) => Promise<void>;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  episodes: {},

  refresh: async () => {
    if (!isTauri) return;
    try {
      const index = await getLibraryIndex();
      const map: Record<number, number[]> = {};
      for (const e of index) map[e.mediaId] = e.episodes;
      set({ episodes: map });
    } catch {
      /* library not scanned yet — ignore */
    }
  },

  hasNext: (mediaId, progress) => {
    const eps = get().episodes[mediaId];
    return !!eps && eps.some((e) => e > progress);
  },

  play: (mediaId) => playNext(mediaId),
}));
