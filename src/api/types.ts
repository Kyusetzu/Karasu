export interface Viewer {
  id: number;
  name: string;
  siteUrl: string;
  avatar: { large: string | null } | null;
  /** AniList's donator tier, 0 for none; optional so an older cached viewer reads as unknown and keeps the pin. */
  donatorTier?: number | null;
  /** The account's score format without a profile fetch; optional, since an older cached viewer reads as ten-point. */
  mediaListOptions?: {
    scoreFormat: string | null;
    /** Per media type, as AniList keeps them; names are seeded even when off, so `advancedScoringEnabled` is the signal. */
    animeList?: AdvancedScoringOptions | null;
    mangaList?: AdvancedScoringOptions | null;
  } | null;
  /** For the airing watcher (`alerts/airing.rs` decides); optional, so an older cached viewer reads as not covered. */
  options?: {
    airingNotifications: boolean | null;
    notificationOptions: { type: string | null; enabled: boolean | null }[] | null;
  } | null;
}

export interface AdvancedScoringOptions {
  /** The user's own category names — free text, rendered raw. */
  advancedScoring: string[] | null;
  advancedScoringEnabled: boolean | null;
}

export type MediaListStatus =
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "DROPPED"
  | "PAUSED"
  | "REPEATING";

export type MediaType = "ANIME" | "MANGA";

export interface MediaTitle {
  romaji: string | null;
  english: string | null;
  native: string | null;
}

export interface Media {
  id: number;
  /** MyAnimeList id, what the MAL export keys on; optional since older cached blobs lack it and some titles have none. */
  idMal?: number | null;
  type?: MediaType;
  title: MediaTitle;
  // Keep `extraLarge` and `bannerImage` optional: only the detail query asks; a list page would carry dead weight.
  coverImage: { large: string | null; extraLarge?: string | null };
  bannerImage?: string | null;
  episodes: number | null;
  chapters?: number | null;
  volumes?: number | null;
  duration?: number | null;
  format: string | null;
  /** Optional: blobs cached before the origin filter existed lack it. */
  countryOfOrigin?: string | null;
  status: string | null;
  season: string | null;
  seasonYear: number | null;
  averageScore: number | null;
  genres: string[];
  isAdult?: boolean | null;
  synonyms: string[];
  nextAiringEpisode: { episode: number; airingAt: number } | null;
}

/** An AniList date that may be only partly known: a year alone is a normal answer, so every part is nullable. */
export interface FuzzyDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface MediaListEntry {
  id: number;
  mediaId: number;
  status: MediaListStatus;
  score: number;
  progress: number;
  /** Manga only; 0 on anime and on entries saved before schema v7. */
  progressVolumes: number;
  repeat: number;
  notes: string | null;
  updatedAt: number;
  /** Hidden from other users on AniList. */
  private: boolean;
  /** Kept off the status lists on anilist.co (custom lists only); optional because older SQLite-cached lists lack it. */
  hiddenFromStatusLists?: boolean | null;
  /** Reads as a name→member map (AniList `Json`); writes take a plain array of names, the asymmetry is the API's. */
  customLists?: Record<string, boolean> | null;
  /** Read as a name→score map; the write is positional and only `lib/advancedScores` builds it; absent unless enabled. */
  advancedScores?: Record<string, number> | null;
  startedAt: FuzzyDate | null;
  completedAt: FuzzyDate | null;
  media: Media;
}

export interface MediaListGroup {
  name: string;
  status: MediaListStatus | null;
  isCustomList: boolean;
  entries: MediaListEntry[];
}

export interface ListResult {
  fromCache: boolean;
  pending: number;
  lists: MediaListGroup[];
}

/** The rate budget as of the last response; `remaining` and `limit` stay null until a header is seen, never a seed. */
export interface RateSnapshot {
  remaining: number | null;
  limit: number | null;
  /** How long ago those numbers were read off a response. */
  observedAgoMs: number | null;
  /** How much longer the client is parked; never derive it from `remaining`, which a header-less 429 leaves untouched. */
  throttledForMs: number | null;
  /** Why it is parked, spelled exactly as `client.rs` emits it; a union so a mislabel is a type error, not silent. */
  throttleKind: ThrottleKind | null;
}

/** `preflight` = a self-imposed breather; `retryAfter` = AniList said no. */
export type ThrottleKind = "preflight" | "retryAfter";

/** One unsent edit, described rather than carried — the payload stays in Rust. */
export interface QueuedEdit {
  id: number;
  kind: "save" | "delete";
  /** Media id for a save, list-entry id for a delete; null if unparsable. */
  subject: number | null;
  /** The fields this edit changes. Empty for a delete. */
  fields: string[];
  /** Unix *seconds*, from SQLite's clock. */
  queuedAt: number;
}

/** One AniList request the client has finished, for the panel's traffic list. */
export interface RequestLogEntry {
  /** Monotonic within a session — a stable React key, not an AniList id. */
  seq: number;
  /** The root field the request asked for, never the variables: they carry notes and scores. */
  operation: string;
  startedAgoMs: number;
  durationMs: number;
  /** Self-imposed pacing delay before sending, kept apart from `durationMs` because the two have different fixes. */
  pacedMs: number;
  status: number | null;
  remainingAfter: number | null;
  outcome: "ok" | "throttled" | "error";
}

export interface SyncStatus {
  /** False in local mode, where nothing syncs by design. */
  connected: boolean;
  draining: boolean;
  queued: QueuedEdit[];
  rate: RateSnapshot;
  /** Recent traffic, newest first. */
  recent: RequestLogEntry[];
  traffic: TrafficSnapshot;
}

/** Requests per source since the app started; the budget is shared, so the panel says who spent it. */
export interface TrafficSnapshot {
  sources: { source: string; total: number }[];
  /** HTTP 429 answers since the app started. */
  throttled: number;
  remaining: number | null;
  limit: number | null;
}

export interface SaveEntryInput {
  mediaId: number;
  status?: MediaListStatus;
  progress?: number;
  /** Manga only. AniList tracks chapters and volumes as separate axes. */
  progressVolumes?: number;
  score?: number;
  repeat?: number;
  notes?: string;
  private?: boolean;
  hiddenFromStatusLists?: boolean;
  /** Every custom list the entry belongs to: the API replaces membership wholesale, so always send every checked name. */
  customLists?: string[];
  /** Positional, display-scale floats (the schema has no `advancedScoresRaw`); only `lib/advancedScores` may build it. */
  advancedScores?: number[];
  startedAt?: FuzzyDate;
  completedAt?: FuzzyDate;
}

export interface MutationResult {
  queued: boolean;
  entry: {
    id: number;
    mediaId: number;
    status: MediaListStatus;
    progress: number;
    score: number;
    repeat: number;
    notes: string | null;
    updatedAt: number;
    /** AniList derives the overall score from these, so `useListMutations` reconciles from the server's answer. */
    advancedScores?: Record<string, number> | null;
  } | null;
}

export const STATUS_ORDER: MediaListStatus[] = [
  "CURRENT",
  "REPEATING",
  "COMPLETED",
  "PAUSED",
  "DROPPED",
  "PLANNING",
];

/** Preferred display title: English, else romaji, else native. */
export function displayTitle(title: MediaTitle): string {
  return title.english ?? title.romaji ?? title.native ?? "?";
}

/** Maximum progress: episodes (anime) or chapters (manga). */
export function maxProgress(media: {
  episodes: number | null;
  chapters?: number | null;
}): number | null {
  return media.episodes ?? media.chapters ?? null;
}
