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
}

/** Files that parsed to a title the matcher could not place. */
export interface UnmatchedGroup {
  title: string;
  season: number;
  files: LibraryFile[];
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
export const getLibraryIndex = () =>
  invoke<LibraryEntry[]>("get_library_index");
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
export const playNext = (mediaId: number) =>
  invoke<void>("play_next", { mediaId });
export const playEpisode = (mediaId: number, episode: number) =>
  invoke<void>("play_episode", { mediaId, episode });
