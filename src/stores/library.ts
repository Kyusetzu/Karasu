import { create } from "zustand";
import { isTauri } from "@/api/anilist";
import {
  getLibraryIndex,
  playEpisode,
  playNext,
  type LibraryEntry,
} from "@/api/library";

interface LibraryState {
  /** media_id → episode numbers present on disk. */
  episodes: Record<number, number[]>;
  /** The full index, for the library page (titles are joined in the UI). */
  entries: LibraryEntry[];
  /** Last playback failure, surfaced globally so every call site reports it. */
  error: string | null;
  refresh: () => Promise<void>;
  /** Whether an episode beyond `progress` exists locally. */
  hasNext: (mediaId: number, progress: number) => boolean;
  play: (mediaId: number) => Promise<void>;
  playEpisode: (mediaId: number, episode: number) => Promise<void>;
  clearError: () => void;
}

/** Backend errors are plain strings; anything else gets a generic fallback. */
function message(e: unknown): string {
  return typeof e === "string" ? e : "Could not play that episode";
}

export const useLibrary = create<LibraryState>((set, get) => ({
  episodes: {},
  entries: [],
  error: null,

  refresh: async () => {
    if (!isTauri) return;
    try {
      const index = await getLibraryIndex();
      const map: Record<number, number[]> = {};
      for (const e of index) map[e.mediaId] = e.episodes;
      set({ episodes: map, entries: index });
    } catch {
      /* library not scanned yet — ignore */
    }
  },

  hasNext: (mediaId, progress) => {
    const eps = get().episodes[mediaId];
    return !!eps && eps.some((e) => e > progress);
  },

  play: async (mediaId) => {
    try {
      await playNext(mediaId);
      set({ error: null });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  playEpisode: async (mediaId, episode) => {
    try {
      await playEpisode(mediaId, episode);
      set({ error: null });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  clearError: () => set({ error: null }),
}));
