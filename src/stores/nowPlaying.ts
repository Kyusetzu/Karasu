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
  /** The episode as resolved, after the correction's offset and the relations redirect; what the card shows and writes. */
  episode: number | null;
  /** The episode as the source reported it; keep offsets measured against this, or re-editing a correction drifts it. */
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
  /** Due, but another Karasu on the same Jellyfin account goes first; this one writes after a grace if it still must. */
  | "yielding"
  | "pending"
  | "updating"
  | "updated"
  /** Written locally, waiting for the queue to reach AniList. */
  | "queued"
  | "blocked"
  | "cancelled";

/** Why an auto-update will not happen, as a code the card maps through a literal switch; prose would defeat i18n. */
export type BlockReason =
  | { code: "alreadyWatched"; episode: number; progress: number }
  | { code: "episodeGap"; episode: number; progress: number }
  | { code: "unknownSeason"; season: number }
  | { code: "failed"; message: string };

export interface ScrobbleState {
  phase: ScrobblePhase;
  reason: BlockReason | null;
  /** Whether "Update now" may override the block; decided in Rust, where the command that would carry it out lives. */
  forceable: boolean;
  mediaId: number | null;
  episode: number | null;
  updateAtMs: number | null;
  /** When the wait behind `updateAtMs` began; set exactly when it is, so the ring has both ends. */
  armedAtMs: number | null;
  /** The Karasu a `yielding` session waits for; null in every other phase. */
  yieldingTo: { platform: "desktop" | "mobile"; device: string } | null;
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
  armedAtMs: null,
  yieldingTo: null,
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

/** A correction keyed on the parse, applied at once because the loop only rebuilds a match on a title change. */
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

/** The live media sessions; players fill the fields inconsistently, so this is the way to see why detection missed. */
export const mediaSessions = () => invoke<MediaSession[]>("media_sessions");

export interface JellyfinSettings {
  url: string;
  /** Whether a sign-in is stored. The token itself never leaves the backend. */
  connected: boolean;
  /** The signed-in account, for display only. */
  userName: string;
  /** The server's own name, learned at sign-in; empty for an older sign-in. */
  serverName: string;
  /** Empty means "any device of this account". */
  device: string;
  /** This machine's name, offered as the default device. */
  localDevice: string;
  /** The optional second address, tried when the first is out of reach. */
  externalUrl: string;
  /** Whether it has answered as the same server from here; null for none. */
  externalVerified: boolean | null;
  /** Whether it would carry the token over plain http across the internet. */
  externalPlainHttp: boolean;
}

/** The Test-connection answer: the sessions, and which address answered. */
export interface JellyfinTest {
  sessions: JellyfinSession[];
  base: "local" | "external";
  url: string;
}

export interface JellyfinSession {
  user: string;
  device: string;
  client: string;
  deviceId: string;
  /** What that session is playing, or null when idle. */
  playing: string | null;
  /** Whether the device filter accepts this session. */
  matched: boolean;
  /** Set when the row is a Karasu — this one included — with its platform. */
  karasu: "desktop" | "mobile" | null;
  /** Seconds since that row was last heard from, on the server's clock against this instance's own row. */
  activeAgoSec: number | null;
}

export const getJellyfinSettings = () =>
  invoke<JellyfinSettings>("get_jellyfin_settings");

/** A server that answered the LAN broadcast and confirmed itself. */
export interface DiscoveredServer {
  name: string;
  address: string;
  id: string;
  version: string | null;
}

/** What `/System/Info/Public` says a server is. */
export interface JellyfinServerInfo {
  name: string;
  id: string;
  version: string;
}

/** Jellyfin's own UDP discovery plus a confirmation per answer; a button, never something a screen does on its own. */
export const discoverJellyfinServers = () =>
  invoke<DiscoveredServer[]>("discover_jellyfin_servers");

export const probeJellyfinServer = (url: string) =>
  invoke<JellyfinServerInfo>("probe_jellyfin_server", { url });

/** The phone's background arrangements; `supported` is false everywhere else. */
export interface JellyfinBackground {
  enabled: boolean;
  supported: boolean;
  /** Whether Android has exempted Karasu from battery optimisation. */
  batteryExempt: boolean | null;
}

export const getJellyfinBackground = () =>
  invoke<JellyfinBackground>("get_jellyfin_background");

/** Whether a foreground service keeps tracking alive with the screen off; a persistent notification, hence opt-in. */
export const setJellyfinBackground = (enabled: boolean) =>
  invoke<void>("set_jellyfin_background", { enabled });

/** Opens Android's dialog for the battery-optimisation exemption. */
export const requestBatteryExemption = () =>
  invoke<void>("request_battery_exemption");

/** Saves the settings outside sign-in; the external address is checked against the server's identity when reachable. */
export const setJellyfinSettings = (url: string, device: string, externalUrl: string) =>
  invoke<void>("set_jellyfin_settings", { url, device, externalUrl });

/** Exchanges a username and password for a token; the password is sent once and never stored, only the token. */
export const jellyfinSignIn = (
  url: string,
  username: string,
  password: string,
) => invoke<JellyfinSettings>("jellyfin_sign_in", { url, username, password });

export const jellyfinSignOut = () =>
  invoke<JellyfinSettings>("jellyfin_sign_out");

/** The account's sessions, flagged by the device filter; the non-matching ones show what Jellyfin calls your device. */
export const testJellyfin = () => invoke<JellyfinTest>("test_jellyfin");
