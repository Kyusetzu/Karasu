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
  /**
   * The full index — paths, scores, sources — for the library page only.
   *
   * Loaded on demand rather than at startup: it carries an absolute path per
   * file, so a large library cost a few hundred kilobytes of JSON across the
   * bridge on every launch for a screen most sessions never open.
   */
  entries: LibraryEntry[];
  /** Whether `entries` has ever been fetched, so `refresh` knows to keep it current. */
  entriesLoaded: boolean;
  /** Fetches the full index. The library page calls this; nothing else needs to. */
  loadEntries: () => Promise<void>;
  /** Last library failure, surfaced globally so every call site reports it. */
  error: string | null;
  /**
   * Report a failure from outside the store. Playback sets `error` on its own,
   * but a manual match is just as capable of failing and had no channel to say
   * so — App already renders this one, so a second would only compete with it.
   */
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
      // Once the library page has asked for the full index, keep it in step —
      // a rescan calls this, and leaving `entries` behind would show that page
      // the pre-scan rows. Nothing fetches it if nobody has needed it yet.
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
