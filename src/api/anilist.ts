import { invoke } from "@tauri-apps/api/core";
import type {
  ListResult,
  Media,
  MediaListStatus,
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

// --- Profile mode (AniList account vs. account-free local list) ------------

export type ProfileMode = "anilist" | "local" | "none";

// Cached so the list functions below can route without an async lookup each
// call. Kept in sync by the auth store.
let profileMode: ProfileMode = "anilist";
export const setProfileModeCache = (mode: ProfileMode) => {
  profileMode = mode;
};
export const isLocalMode = () => profileMode === "local";

export const getProfileMode = () => invoke<ProfileMode>("get_profile_mode");
export const enableLocalMode = () => invoke<void>("enable_local_mode");

// --- Anime/manga list (loaded via Rust: cache + offline queue) -------------

export const fetchMediaList = (userId: number, mediaType: MediaType) =>
  profileMode === "local"
    ? invoke<ListResult>("local_fetch_list", { mediaType })
    : invoke<ListResult>("fetch_media_list", { userId, mediaType });

/**
 * Saves an entry. In local mode the change goes to the local SQLite list; on
 * a first add pass `media` so the entry renders offline (field-only edits may
 * omit it). AniList mode ignores `media`.
 */
export const saveListEntry = (input: SaveEntryInput, media?: Media) =>
  profileMode === "local"
    ? invoke<MutationResult>("local_save_entry", {
        input: { ...input, media, mediaType: media?.type },
      })
    : invoke<MutationResult>("save_list_entry", { input });

export const deleteListEntry = (id: number) =>
  profileMode === "local"
    ? invoke<MutationResult>("local_delete_entry", { id })
    : invoke<MutationResult>("delete_list_entry", { id });

export const flushQueue = () => invoke<number>("flush_queue");

// --- Sign-in merge (local list -> AniList) ---------------------------------

export interface LocalEntryRow {
  mediaId: number;
  mediaType: MediaType;
  status: MediaListStatus;
  progress: number;
  score: number;
  repeat: number;
  notes: string;
  updatedAt: number;
  media: Media;
}

/** Every local row (both media types) — for the merge after connecting. */
export const localAllEntries = () =>
  invoke<LocalEntryRow[]>("local_all_entries");

/** Clears one local row regardless of the active profile mode. */
export const localClearEntry = (mediaId: number) =>
  invoke<MutationResult>("local_delete_entry", { id: mediaId });

/** Pushes an entry to AniList, bypassing the local dispatch. */
export const anilistSaveEntry = (input: SaveEntryInput) =>
  invoke<MutationResult>("save_list_entry", { input });

/** Fetches an AniList list, bypassing the local dispatch (merge only). */
export const anilistFetchList = (userId: number, mediaType: MediaType) =>
  invoke<ListResult>("fetch_media_list", { userId, mediaType });

// --- Update check ----------------------------------------------------------

export interface UpdateInfo {
  current: string;
  latest: string | null;
  url: string | null;
  isNewer: boolean;
}

/** `force: true` always hits the network; `false` respects the 24h background throttle. */
export const checkForUpdates = (force: boolean) =>
  invoke<UpdateInfo>("check_for_updates", { force });

/** Full four-part app version (MAJOR.MINOR.PATCH.COMMIT#) for the About page. */
export const appVersion = () => invoke<string>("app_version");

// --- Airing notifications --------------------------------------------------

export const getAiringNotify = () => invoke<boolean>("get_airing_notify");
export const setAiringNotify = (enabled: boolean) =>
  invoke<void>("set_airing_notify", { enabled });

export interface StaleSettings {
  enabled: boolean;
  months: number;
}

export const getStaleSettings = () =>
  invoke<StaleSettings>("get_stale_settings");
export const setStaleSettings = (enabled: boolean, months: number) =>
  invoke<void>("set_stale_settings", { enabled, months });

export const getSequelNotify = () => invoke<boolean>("get_sequel_notify");
export const setSequelNotify = (enabled: boolean) =>
  invoke<void>("set_sequel_notify", { enabled });

/** Opens a save dialog and writes PNG bytes; false if cancelled. */
export const savePng = (data: number[], defaultName: string) =>
  invoke<boolean>("save_png", { data, defaultName });

// --- Notification centre ---------------------------------------------------

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  createdMs: number;
  read: boolean;
}

export const getNotifications = () =>
  invoke<AppNotification[]>("get_notifications");
export const unreadNotificationCount = () =>
  invoke<number>("unread_notification_count");
export const markNotificationRead = (id: number) =>
  invoke<void>("mark_notification_read", { id });
export const markAllNotificationsRead = () =>
  invoke<void>("mark_all_notifications_read");
