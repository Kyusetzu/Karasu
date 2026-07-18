import { invoke } from "@tauri-apps/api/core";
import type {
  ListResult,
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
export const connect = (token: string) =>
  invoke<Viewer>("anilist_connect", { token });
export const session = () => invoke<Viewer | null>("anilist_session");
export const logout = () => invoke<void>("anilist_logout");

// --- GraphQL --------------------------------------------------------------

export function gql<T>(query: string, variables?: object): Promise<T> {
  return invoke<T>("anilist_query", { query, variables });
}

// --- Anime-Liste (Laden über Rust: Cache + Offline-Queue) ------------------

export const fetchAnimeList = (userId: number) =>
  invoke<ListResult>("fetch_anime_list", { userId });

export const saveListEntry = (input: SaveEntryInput) =>
  invoke<MutationResult>("save_list_entry", { input });

export const deleteListEntry = (id: number) =>
  invoke<MutationResult>("delete_list_entry", { id });

export const flushQueue = () => invoke<number>("flush_queue");
