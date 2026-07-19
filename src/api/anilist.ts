import { invoke } from "@tauri-apps/api/core";
import type {
  ListResult,
  MediaType,
  MutationResult,
  SaveEntryInput,
  Viewer,
} from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

// --- Account / Auth -------------------------------------------------------

export interface AuthInfo {
  hasBuiltinClientId: boolean;
  customClientId: string | null;
}

export const authInfo = () => invoke<AuthInfo>("anilist_auth_info");
export const setClientId = (clientId: string) =>
  invoke<void>("set_client_id", { clientId });
export const loginUrl = () => invoke<string>("anilist_login_url");
/** Starts the localhost callback server and returns the authorize URL. */
export const startLogin = () => invoke<string>("anilist_start_login");
export const connect = (token: string) =>
  invoke<Viewer>("anilist_connect", { token });
export const session = () => invoke<Viewer | null>("anilist_session");
export const logout = () => invoke<void>("anilist_logout");

// --- GraphQL --------------------------------------------------------------

export function gql<T>(query: string, variables?: object): Promise<T> {
  return invoke<T>("anilist_query", { query, variables });
}

// --- Anime/manga list (loaded via Rust: cache + offline queue) -------------

export const fetchMediaList = (userId: number, mediaType: MediaType) =>
  invoke<ListResult>("fetch_media_list", { userId, mediaType });

export const saveListEntry = (input: SaveEntryInput) =>
  invoke<MutationResult>("save_list_entry", { input });

export const deleteListEntry = (id: number) =>
  invoke<MutationResult>("delete_list_entry", { id });

export const flushQueue = () => invoke<number>("flush_queue");

// --- Playback history (Activity analytics) ---------------------------------

export interface HistoryRow {
  mediaId: number;
  mediaType: MediaType;
  title: string;
  episode: number;
  startedMs: number;
  endedMs: number;
  seconds: number;
}

/** Local playback history since `fromMs` (0 = all), newest first. */
export const getHistory = (fromMs = 0) =>
  invoke<HistoryRow[]>("get_history", { fromMs });

// --- Update check ----------------------------------------------------------

export interface UpdateInfo {
  current: string;
  latest: string | null;
  url: string | null;
  isNewer: boolean;
}

export const checkForUpdates = () => invoke<UpdateInfo>("check_for_updates");

// --- Airing notifications --------------------------------------------------

export const getAiringNotify = () => invoke<boolean>("get_airing_notify");
export const setAiringNotify = (enabled: boolean) =>
  invoke<void>("set_airing_notify", { enabled });
