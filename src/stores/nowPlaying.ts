import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/api/anilist";

export interface NowPlaying {
  process: string;
  streaming: boolean;
  rawTitle: string;
  parsedTitle: string;
  episode: number | null;
  mediaId: number | null;
  matchedTitle: string | null;
  progress: number | null;
  totalEpisodes: number | null;
}

interface NowPlayingState {
  current: NowPlaying | null;
  init: () => Promise<void>;
}

let initialized = false;

export const useNowPlaying = create<NowPlayingState>((set) => ({
  current: null,

  init: async () => {
    if (!isTauri || initialized) return;
    initialized = true;
    await listen<NowPlaying | null>("now-playing", (event) => {
      set({ current: event.payload });
    });
    const current = await invoke<NowPlaying | null>("get_now_playing");
    set({ current });
  },
}));
