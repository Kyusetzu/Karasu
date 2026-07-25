import { invoke } from "@tauri-apps/api/core";

export interface LibraryFile {
  episode: number;
  path: string;
}

export interface LibraryEntry {
  mediaId: number;
  episodes: number[];
  files: LibraryFile[];
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
export const scanLibrary = () => invoke<ScanSummary>("scan_library");
export const playNext = (mediaId: number) =>
  invoke<void>("play_next", { mediaId });
export const playEpisode = (mediaId: number, episode: number) =>
  invoke<void>("play_episode", { mediaId, episode });
