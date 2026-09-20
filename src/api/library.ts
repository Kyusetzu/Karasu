import { commands, unwrap } from "@/api/tauri";

export interface LibraryFile {
  episode: number;
  path: string;
}

/** What a release name parsed to — the key a correction is stored under. */
export interface TitleKey {
  title: string;
  /** -1 where the release name carried no season. */
  season: number;
  /** Whether this parse carries the correction; a row merges several parses, so its own `manual` cannot say which. */
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
  /** AniList's unconfirmed guess; `null` when nothing scored well enough, which puts the group in the failed section. */
  suggestion: { mediaId: number; score: number } | null;
}

export const getLibraryPath = () => commands.getLibraryPath();
export const setLibraryPath = (path: string) =>
  unwrap(commands.setLibraryPath(path));
export const pickLibraryFolder = () =>
  commands.pickLibraryFolder();
/** The full index — paths and all. Only the library page needs this. */
export const getLibraryIndex = () =>
  commands.getLibraryIndex() as Promise<LibraryEntry[]>;
/** Just media_id → episodes, which is all the "next episode" affordances read. */
export const getLibraryEpisodes = () =>
  commands.getLibraryEpisodes();
export const getLibraryStatus = () =>
  commands.getLibraryStatus();
export const scanLibrary = () => unwrap(commands.scanLibrary());
export const getLibraryUnmatched = () =>
  commands.getLibraryUnmatched();

/** Points every file that parses to `title`/`season` at `mediaId` and returns the rebuilt index. */
export const setLibraryMatch = (title: string, season: number, mediaId: number) =>
  unwrap(commands.setLibraryMatch(title, season, mediaId));

export const clearLibraryMatch = (title: string, season: number) =>
  unwrap(commands.clearLibraryMatch(title, season));

/** Confirms a season split keyed on the numbers the row shows; the backend persists disk-keyed rules for the next scan. */
export const setLibraryRedirect = (
  mediaId: number,
  from: number,
  to: number,
  dstMediaId: number,
  dstStart: number,
) =>
  unwrap(commands.setLibraryRedirect(mediaId, from, to, dstMediaId, dstStart));

/** One confirmed split, keyed on the parse the clear command deletes by. */
export interface LibraryRedirectRow {
  title: string;
  season: number;
  epFrom: number;
  epTo: number;
  mediaId: number;
  dstStart: number;
}

export const listLibraryRedirects = () =>
  commands.listLibraryRedirects();

/** Removes one split range, giving the files back to whatever the rest of the parse still answers to. */
export const clearLibraryRedirect = (title: string, season: number, epFrom: number) =>
  unwrap(commands.clearLibraryRedirect(title, season, epFrom));

export const playNext = (mediaId: number) =>
  unwrap(commands.playNext(mediaId));
export const playEpisode = (mediaId: number, episode: number) =>
  unwrap(commands.playEpisode(mediaId, episode));
