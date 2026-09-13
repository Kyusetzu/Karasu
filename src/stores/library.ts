import { create } from "zustand";
import { isTauri } from "@/api/anilist";
import {
  getLibraryEpisodes,
  getLibraryIndex,
  playEpisode,
  playNext,
  type LibraryEntry,
} from "@/api/library";

interface LibraryState {
  /** media_id → episode numbers present on disk. */
  episodes: Record<number, number[]>;
  /** The full index for the library page only, loaded on demand because it carries an absolute path per file. */
  entries: LibraryEntry[];
  /** Whether `entries` has ever been fetched, so `refresh` knows to keep it current. */
  entriesLoaded: boolean;
  /** Fetches the full index. The library page calls this; nothing else needs to. */
  loadEntries: () => Promise<void>;
  /** Last library failure, surfaced globally so every call site reports it. */
  error: string | null;
  /** Reports a failure from outside the store, such as a manual match, through the one channel App already renders. */
  setError: (message: string) => void;
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
  entriesLoaded: false,
  error: null,

  refresh: async () => {
    if (!isTauri) return;
    try {
      set({ episodes: await getLibraryEpisodes() });
      // Once the library page has asked for the full index, a rescan keeps it in step; nobody fetches it before then.
      if (get().entriesLoaded) set({ entries: await getLibraryIndex() });
    } catch {
      /* library not scanned yet — ignore */
    }
  },

  loadEntries: async () => {
    if (!isTauri) return;
    try {
      set({ entries: await getLibraryIndex(), entriesLoaded: true });
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

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),
}));
