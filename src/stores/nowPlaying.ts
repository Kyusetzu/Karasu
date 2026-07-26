import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/api/anilist";

export interface NowPlaying {
  process: string;
  streaming: boolean;
  mediaType: "ANIME" | "MANGA";
  rawTitle: string;
  parsedTitle: string;
  episode: number | null;
  mediaId: number | null;
  matchedTitle: string | null;
  progress: number | null;
  totalEpisodes: number | null;
}

export type ScrobblePhase =
  | "idle"
  | "watching"
  | "pending"
  | "updating"
  | "updated"
  | "blocked"
  | "cancelled";

export interface ScrobbleState {
  phase: ScrobblePhase;
  reason: string | null;
  mediaId: number | null;
  episode: number | null;
  updateAtMs: number | null;
}

interface NowPlayingStore {
  current: NowPlaying | null;
  scrobble: ScrobbleState;
  init: () => Promise<void>;
}

const IDLE: ScrobbleState = {
  phase: "idle",
  reason: null,
  mediaId: null,
  episode: null,
  updateAtMs: null,
};

let initialized = false;

export const useNowPlaying = create<NowPlayingStore>((set) => ({
  current: null,
  scrobble: IDLE,

  init: async () => {
    if (!isTauri || initialized) return;
    initialized = true;
    await listen<NowPlaying | null>("now-playing", (event) => {
      set({ current: event.payload });
    });
    await listen<ScrobbleState>("scrobble-state", (event) => {
      set({ scrobble: event.payload ?? IDLE });
    });
    const current = await invoke<NowPlaying | null>("get_now_playing");
    set({ current });
  },
}));

export const scrobbleNow = () => invoke<void>("scrobble_now");
export const scrobbleCancel = () => invoke<void>("scrobble_cancel");

export interface ScrobbleSettings {
  enabled: boolean;
  confirm: boolean;
  delayMin: number;
}

export const getScrobbleSettings = () =>
  invoke<ScrobbleSettings>("get_scrobble_settings");
export const setScrobbleSettings = (s: ScrobbleSettings) =>
  invoke<void>("set_scrobble_settings", {
    enabled: s.enabled,
    confirm: s.confirm,
    delayMin: s.delayMin,
  });

/** Whether the Windows media-session detection pass runs. */
export const getSmtcEnabled = () => invoke<boolean>("get_smtc_enabled");
export const setSmtcEnabled = (enabled: boolean) =>
  invoke<void>("set_smtc_enabled", { enabled });

/** One entry of the Windows media-session list, for the Settings diagnostic. */
export interface SmtcSession {
  appId: string;
  title: string;
  artist: string;
  album: string;
  playbackType: string;
  status: string;
}

/**
 * What Windows currently reports. Players fill these fields inconsistently,
 * so this is the honest way to see why something was or wasn't detected.
 */
export const smtcSessions = () => invoke<SmtcSession[]>("smtc_sessions");

export interface JellyfinSettings {
  url: string;
  /** Whether a key is stored. The key itself never leaves the backend. */
  hasKey: boolean;
  /** Required — detection stays off until a user is picked. */
  userId: string;
  /** Empty means "any device of that user". */
  device: string;
  /** This machine's name, offered as the default device. */
  localDevice: string;
}

export interface JellyfinUser {
  id: string;
  name: string;
}

export interface JellyfinSession {
  user: string;
  device: string;
  client: string;
  /** What that session is playing, or null when idle. */
  playing: string | null;
  /** Whether the configured user/device filter accepts this session. */
  matched: boolean;
}

export const getJellyfinSettings = () =>
  invoke<JellyfinSettings>("get_jellyfin_settings");

/** Pass `apiKey: null` to save the rest without touching the stored key. */
export const setJellyfinSettings = (
  url: string,
  apiKey: string | null,
  userId: string,
  device: string,
) => invoke<void>("set_jellyfin_settings", { url, apiKey, userId, device });

/** The server's users, for the picker. Needs only a URL and key. */
export const jellyfinUsers = () => invoke<JellyfinUser[]>("jellyfin_users");

/**
 * Every session the server reports, flagged with whether the filter accepts
 * it — including other people's. Showing the non-matching ones is the point:
 * it's the only way to find out what Jellyfin calls your device.
 */
export const testJellyfin = () => invoke<JellyfinSession[]>("test_jellyfin");
