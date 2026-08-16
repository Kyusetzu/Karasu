export interface Viewer {
  id: number;
  name: string;
  siteUrl: string;
  avatar: { large: string | null } | null;
  /** Carried by `VIEWER_QUERY` so the whole app can follow the account's
   *  score format without a profile fetch. Optional: cached viewer blobs from
   *  before the field existed lack it, and read as ten-point. */
  mediaListOptions?: {
    scoreFormat: string | null;
    /** Per media type, because AniList keeps them per media type. The names
     *  are seeded even when the feature is off, so `advancedScoringEnabled` is
     *  the signal and a non-empty `advancedScoring` is not. */
    animeList?: AdvancedScoringOptions | null;
    mangaList?: AdvancedScoringOptions | null;
  } | null;
  /** Carried by `VIEWER_QUERY` for the airing watcher — see
   *  `alerts/airing.rs`, which holds the copy of the rules that actually
   *  decides. Optional for the same reason as above: a viewer blob cached
   *  before the field existed lacks it, and reads as "AniList will not cover
   *  this", which is the safe answer. */
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
  /** MyAnimeList id — what the MAL XML export keys on. Optional: blobs
      cached before the export existed lack it, and some titles are
      AniList-only and genuinely have none. */
  idMal?: number | null;
  type?: MediaType;
  title: MediaTitle;
  // `extraLarge` and `bannerImage` are optional because only the detail query
  // asks for them. The list and grid queries return hundreds of entries at a
  // time and nothing there renders either field; carrying them cost a
  // deserialise, a re-serialise into the SQLite cache, an IPC hop and a
  // JSON.parse for roughly 160 dead bytes per entry.
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

/**
 * An AniList date that may be only partly known.
 *
 * Every part is nullable because the API genuinely returns "2024" or
 * "March 2024" — a reader who remembers the year but not the day is the normal
 * case, not an edge one. That is why these cannot be `<input type="date">` and
 * why `fuzzyDate` in `lib/format.ts` drops the parts it does not have.
 */
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
  /** Kept off the status lists on anilist.co (custom lists only). Optional:
      SQLite-cached lists from before the field existed lack it. */
  hiddenFromStatusLists?: boolean | null;
  /** Reads as a name→member map (AniList `Json`); *writes* take a plain
      array of member names — the asymmetry is the API's, not ours. */
  customLists?: Record<string, boolean> | null;
  /** Reads as a name→score map (AniList `Json`); *writes* take a **positional**
      `[Float]` ordered by `mediaListOptions.<type>List.advancedScoring` — the
      same asymmetry as `customLists`, but with a sharper edge, since a wrong
      order silently files one category's score under another. `lib/
      advancedScores` is the only place that builds the array. Absent unless
      the account has advanced scoring on: the list query asks for it behind an
      `@include`, because it is +8% of a large list's payload. */
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

/**
 * What the client knows about the ~30/min budget, as of the last response.
 *
 * Everything is nullable and each null means something different. `remaining`
 * and `limit` are null until a response header has actually been seen — the
 * client seeds a 30 to start with, and reporting a seed as a measurement is the
 * one thing a headroom display must not do.
 */
export interface RateSnapshot {
  remaining: number | null;
  limit: number | null;
  /** How long ago those numbers were read off a response. */
  observedAgoMs: number | null;
  /**
   * How much longer the client is parked. **Never derived from `remaining`**:
   * if AniList omits the header on a 429, `remaining` keeps its comfortable
   * pre-429 value while the client waits out a two-minute `Retry-After`.
   */
  throttledForMs: number | null;
  /**
   * Why it is parked, spelled **exactly** as the Rust side emits it.
   *
   * A union rather than `string`, because it was `string` and the panel
   * compared against `"retry-after"` while `client.rs` emits `"retryAfter"` —
   * so for a release every genuine 429 rendered as the app pacing itself, which
   * is the one distinction this field exists to draw. A typo is now a type
   * error instead of a silent mislabel.
   */
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

export interface SyncStatus {
  /** False in local mode, where nothing syncs by design. */
  connected: boolean;
  draining: boolean;
  queued: QueuedEdit[];
  rate: RateSnapshot;
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
  /** The complete set of custom lists this entry belongs to — the API
      replaces membership wholesale, so always send every checked name. */
  customLists?: string[];
  /** Positional, ordered by the account's `advancedScoring` names — build it
      with `lib/advancedScores`'s `toAdvancedArray` and nothing else. Plain
      floats in the display scale: there is no `advancedScoresRaw` on the
      schema, so the `scoreRaw` discipline does not extend here. */
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
    /** AniList derives the overall score from these, so the server's answer is
        the only true one — `useListMutations` reconciles from it rather than
        keeping the optimistic guess. */
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
