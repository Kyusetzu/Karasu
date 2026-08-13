import { invoke } from "@tauri-apps/api/core";

export interface LibraryFile {
  episode: number;
  path: string;
}

/** What a release name parsed to — the key a correction is stored under. */
export interface TitleKey {
  title: string;
  /** -1 where the release name carried no season. */
  season: number;
  /**
   * Whether this parse is the one carrying a correction. A row can merge
   * several parses and only one of them is usually corrected, so the row's own
   * `manual` cannot say which. Optional only so the two key literals on the
   * library screen, which have no parse to speak for, still typecheck.
   */
  manual?: boolean;
}

/** The community rules' answer for an overflow, offered but never applied. */
export interface SplitHint {
  mediaId: number;
  dstStart: number;
}

/** A folder holding more episodes than its matched entry has. */
export interface Overflow {
  knownEpisodes: number;
  extraFiles: number;
  /** First on-disk episode past the known count. */
  firstExtra: number;
  hint?: SplitHint;
}

export interface LibraryEntry {
  mediaId: number;
  episodes: number[];
  files: LibraryFile[];
  /** Matcher confidence, 0–1. 1 is the exact-title short circuit. */
  score: number;
  /** The release names that led here; what `setLibraryMatch` is keyed on. */
  sources: TitleKey[];
  /** Placed by the user rather than the matcher — no confidence to report. */
  manual: boolean;
  /** Present when the folder overflows the entry — the season-split card's facts. */
  overflow?: Overflow;
}

/** Files that parsed to a title the matcher could not place. */
export interface UnmatchedGroup {
  title: string;
  season: number;
  files: LibraryFile[];
  /**
   * What AniList thinks this is. Unconfirmed — a search hit is a weaker claim
   * than a match against the user's own list, and open search returns
   * *something* for almost any input. `null` when nothing scored well enough,
   * which is what puts a group in the failed section.
   */
  suggestion: { mediaId: number; score: number } | null;
}

export interface LibraryStatus {
  path: string | null;
  /** Video files the last scan walked past, matched or not. */
  filesSeen: number;
  matched: number;
}

export interface ScanSummary {
  entries: LibraryEntry[];
  files: number;
  matched: number;
}

export const getLibraryPath = () => invoke<string | null>("get_library_path");
export const setLibraryPath = (path: string) =>
  invoke<void>("set_library_path", { path });
export const pickLibraryFolder = () =>
  invoke<string | null>("pick_library_folder");
/** The full index — paths and all. Only the library page needs this. */
export const getLibraryIndex = () =>
  invoke<LibraryEntry[]>("get_library_index");
/** Just media_id → episodes, which is all the "next episode" affordances read. */
export const getLibraryEpisodes = () =>
  invoke<Record<number, number[]>>("get_library_episodes");
export const getLibraryStatus = () =>
  invoke<LibraryStatus>("get_library_status");
export const scanLibrary = () => invoke<ScanSummary>("scan_library");
export const getLibraryUnmatched = () =>
  invoke<UnmatchedGroup[]>("get_library_unmatched");

/**
 * Points every file that parses to `title`/`season` at `mediaId`, and returns
 * the rebuilt index so the caller does not have to refetch it.
 */
export const setLibraryMatch = (title: string, season: number, mediaId: number) =>
  invoke<LibraryEntry[]>("set_library_match", { title, season, mediaId });

export const clearLibraryMatch = (title: string, season: number) =>
  invoke<LibraryEntry[]>("clear_library_match", { title, season });

/**
 * Confirms a season split: the row's episodes `from..=to` — the numbers the
 * screen shows, whatever earlier splits renumbered them from — belong to
 * `dstMediaId`, renumbered from `dstStart`. The backend resolves the actual
 * files and persists disk-keyed rules (schema v11), so the next scan agrees.
 */
export const setLibraryRedirect = (
  mediaId: number,
  from: number,
  to: number,
  dstMediaId: number,
  dstStart: number,
) =>
  invoke<LibraryEntry[]>("set_library_redirect", {
    mediaId,
    from,
    to,
    dstMediaId,
    dstStart,
  });

export const clearLibraryRedirect = (title: string, season: number, epFrom: number) =>
  invoke<LibraryEntry[]>("clear_library_redirect", { title, season, epFrom });
export const playNext = (mediaId: number) =>
  invoke<void>("play_next", { mediaId });
export const playEpisode = (mediaId: number, episode: number) =>
  invoke<void>("play_episode", { mediaId, episode });
