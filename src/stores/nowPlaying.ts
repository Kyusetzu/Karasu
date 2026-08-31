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
  /** The season the parse carried — half the key a correction is stored under. */
  season: number | null;
  /**
   * The episode as resolved — after a correction's offset and after any
   * relations redirect. This is what the card shows and what gets written.
   */
  episode: number | null;
  /**
   * The episode as the source reported it, before either of those.
   *
   * An offset is `chosen - detected`, and `detected` is this one. Measuring
   * against `episode` stored a wrong offset as soon as a correction was edited
   * a second time — and confirming the pre-filled number stored `0`, wiping a
   * correction that was working.
   */
  sourceEpisode: number | null;
  mediaId: number | null;
  matchedTitle: string | null;
  /** True when this match is the user's own correction, not the matcher's. */
  overridden: boolean;
  progress: number | null;
  totalEpisodes: number | null;
}

export type ScrobblePhase =
  | "idle"
  | "watching"
  | "pending"
  | "updating"
  | "updated"
  /** Written locally, waiting for the queue to reach AniList. */
  | "queued"
  | "blocked"
  | "cancelled";

/**
 * Why an auto-update will not happen, as a code and its numbers.
 *
 * Deliberately not a sentence: it used to be English prose formatted in Rust
 * and rendered verbatim, so a German UI read English. The card maps `code`
 * through a literal switch, which is also what keeps every key visible to
 * `i18nKeys.test.ts`.
 */
export type BlockReason =
  | { code: "alreadyWatched"; episode: number; progress: number }
  | { code: "episodeGap"; episode: number; progress: number }
  | { code: "unknownSeason"; season: number }
  | { code: "failed"; message: string };

export interface ScrobbleState {
  phase: ScrobblePhase;
  reason: BlockReason | null;
  /** Whether "Update now" may override the block. Decided in Rust, where the
      command that would carry it out lives. */
  forceable: boolean;
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
  forceable: false,
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

/** One stored detection correction, as the Settings list shows them. */
export interface DetectionOverride {
  /** What detection *saw* — the parsed title the correction fires on. */
  title: string;
  /** `-1` when the parse carried no season. */
  season: number;
  mediaType: "ANIME" | "MANGA";
  mediaId: number;
  displayTitle: string;
  /** Added to the detected episode; 0 when the numbering already lines up. */
  episodeOffset: number;
}

export const listDetectionOverrides = () =>
  invoke<DetectionOverride[]>("list_detection_overrides");

/**
 * "What is playing is actually this." Keyed on the parse, so it holds for
 * every later detection of the same title; applied at once, because the
 * detection loop only rebuilds a match when the title itself changes.
 */
export const setDetectionOverride = (input: {
  title: string;
  season: number | null;
  mediaType: string;
  mediaId: number;
  displayTitle: string;
  /** What to add to the source's episode number. Omitted means "they agree". */
  episodeOffset?: number;
}) => invoke<void>("set_detection_override", input);

export const clearDetectionOverride = (input: {
  title: string;
  season: number | null;
  mediaType: string;
}) => invoke<void>("clear_detection_override", input);

export interface ScrobbleSettings {
  enabled: boolean;
  confirm: boolean;
  delayMin: number;
  /** Whether an episode-gap block lifts itself after five minutes. */
  gapAuto: boolean;
}

export const getScrobbleSettings = () =>
  invoke<ScrobbleSettings>("get_scrobble_settings");
export const setScrobbleSettings = (s: ScrobbleSettings) =>
  invoke<void>("set_scrobble_settings", {
    enabled: s.enabled,
    confirm: s.confirm,
    delayMin: s.delayMin,
    gapAuto: s.gapAuto,
  });

/** Whether the system media-session pass runs (SMTC on Windows, MPRIS on Linux). */
export const getMediaDetection = () => invoke<boolean>("get_media_detection");
export const setMediaDetection = (enabled: boolean) =>
  invoke<void>("set_media_detection", { enabled });

/** One entry of the system media-session list, for the Settings diagnostic. */
export interface MediaSession {
  appId: string;
  title: string;
  artist: string;
  album: string;
  playbackType: string;
  status: string;
  /** What is playing, where the source says. MPRIS only; empty on Windows. */
  url: string;
}

/**
 * What the desktop currently reports. Players fill these fields
 * inconsistently, so this is the honest way to see why something was or
 * wasn't detected.
 */
export const mediaSessions = () => invoke<MediaSession[]>("media_sessions");

export interface JellyfinSettings {
  url: string;
  /** Whether a sign-in is stored. The token itself never leaves the backend. */
  connected: boolean;
  /** The signed-in account, for display only. */
  userName: string;
  /** Empty means "any device of this account". */
  device: string;
  /** This machine's name, offered as the default device. */
  localDevice: string;
}

export interface JellyfinSession {
  user: string;
  device: string;
  client: string;
  /** What that session is playing, or null when idle. */
  playing: string | null;
  /** Whether the device filter accepts this session. */
  matched: boolean;
}

export const getJellyfinSettings = () =>
  invoke<JellyfinSettings>("get_jellyfin_settings");

/** Saves the settings that aren't part of signing in. */
export const setJellyfinSettings = (url: string, device: string) =>
  invoke<void>("set_jellyfin_settings", { url, device });

/**
 * Exchanges a username and password for an access token. Any Jellyfin account
 * works — no administrator rights. The password is sent once and never stored;
 * only the returned token reaches the credential store.
 */
export const jellyfinSignIn = (
  url: string,
  username: string,
  password: string,
) => invoke<JellyfinSettings>("jellyfin_sign_in", { url, username, password });

export const jellyfinSignOut = () =>
  invoke<JellyfinSettings>("jellyfin_sign_out");

/**
 * The signed-in account's own sessions, flagged with whether the device filter
 * accepts each one. Showing the non-matching ones is the point: it's the only
 * way to find out what Jellyfin calls your device.
 */
export const testJellyfin = () => invoke<JellyfinSession[]>("test_jellyfin");
