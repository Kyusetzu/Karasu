import { invoke } from "@tauri-apps/api/core";
import { toRaw, type ScoreFormat } from "@/lib/scoreFormat";
import type {
  FuzzyDate,
  ListResult,
  Media,
  MediaListStatus,
  MediaType,
  MutationResult,
  SaveEntryInput,
  SyncStatus,
  Viewer,
} from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

// --- Account / Auth -------------------------------------------------------

export interface AuthInfo {
  hasBuiltinClientId: boolean;
  customClientId: string | null;
  /** The redirect URL an API client must register — Rust owns the port. */
  callbackUrl: string;
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
/** Refetches the viewer and replaces the cached blob, so a scoreFormat change needs no re-login. */
export const refreshViewer = () => invoke<Viewer>("refresh_viewer");
export const logout = () => invoke<void>("anilist_logout");

// --- GraphQL --------------------------------------------------------------

/** The token-rejected code from `client.rs`; matched exactly, since an entry's notes can contain any text. */
export const TOKEN_REJECTED = "anilist.tokenRejected";

export const isTokenRejected = (e: unknown): boolean =>
  (e instanceof Error ? e.message : String(e)).trim() === TOKEN_REJECTED;

/** Told on a rejected token so the auth store raises one banner; registered, not imported, to avoid a cycle. */
let onTokenRejected: () => void = () => {};
export const setTokenRejectedHandler = (fn: () => void) => {
  onTokenRejected = fn;
};

/** Told on an account change; the cache is cleared, not invalidated, since keys carry no viewer but payloads do. */
let onIdentityChanged: () => void = () => {};
export const setIdentityChangedHandler = (fn: () => void) => {
  onIdentityChanged = fn;
};

/** Raised by the auth store on every sign-in, sign-out and mode switch. */
export const identityChanged = () => onIdentityChanged();

/** Every read passes through here, so the token rejection is caught once rather than on every screen. */
async function guarded<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (isTokenRejected(e)) onTokenRejected();
    throw e;
  }
}

/** What a caller may say about its request: a source name, and how long Rust may keep the answer for an allowlisted source. */
export interface GqlOptions {
  /** `[a-z][a-zA-Z0-9]{0,31}`; anything else is replaced in Rust by the query's root field. */
  source?: string;
  /** Seconds Rust may serve this answer without asking again; ignored unless `source` is on the cache allowlist. */
  ttlSec?: number;
  /** The media a detail answer is about, so an own edit of that entry evicts the cached answer. */
  mediaId?: number;
}

export function gql<T>(query: string, variables?: object, opts?: GqlOptions): Promise<T> {
  const cache = opts?.ttlSec ? { ttlSec: opts.ttlSec, mediaId: opts.mediaId ?? null } : undefined;
  return guarded(invoke<T>("anilist_query", { query, variables, source: opts?.source, cache }));
}

/** Seconds, for the `ttlSec` of an allowlisted `gql` call; the Rust allowlist caps each, so these are the wish. */
export const TTL = {
  minute: 60,
  hour: 3600,
  day: 24 * 3600,
  week: 7 * 24 * 3600,
} as const;

// --- Profile mode (AniList account vs. account-free local list) ------------

export type ProfileMode = "anilist" | "local" | "none";

// Cached by the auth store so the list functions below route without an async lookup per call.
let profileMode: ProfileMode = "anilist";
export const setProfileModeCache = (mode: ProfileMode) => {
  profileMode = mode;
};

// The account's score format, cached by the auth store so the save paths below convert to `scoreRaw`.
let scoreFormat: ScoreFormat = "POINT_10";
export const setScoreFormatCache = (format: ScoreFormat) => {
  scoreFormat = format;
};
export const currentScoreFormat = () => scoreFormat;

/** Converts `score` to `scoreRaw`, as a bare score is read in the account's format; absent stays absent. */
function withRawScore<T extends { score?: number }>(
  input: T,
  format: ScoreFormat = scoreFormat,
): Omit<T, "score"> & { scoreRaw?: number } {
  const { score, ...rest } = input;
  if (score === undefined) return rest;
  return { ...rest, scoreRaw: toRaw(format, score) };
}

export const getProfileMode = () => invoke<ProfileMode>("get_profile_mode");
export const enableLocalMode = () => invoke<void>("enable_local_mode");

// --- Anime/manga list (loaded via Rust: cache + offline queue) -------------

/** Rust serves its copy while it is younger than fifteen minutes and refreshes older ones behind; `force` always fetches. */
export const fetchMediaList = (userId: number, mediaType: MediaType, opts?: { force?: boolean }) =>
  profileMode === "local"
    ? invoke<ListResult>("local_fetch_list", { mediaType })
    : // Guarded like `gql`: the one AniList read that bypasses it, and the request behind every list screen.
      guarded(invoke<ListResult>("fetch_media_list", { userId, mediaType, force: opts?.force ?? false }));

/** The last cached list from SQLite, or `null`; AniList mode only, since the local list is the database. */
export const cachedMediaList = (userId: number, mediaType: MediaType) =>
  profileMode === "local"
    ? Promise.resolve(null)
    : invoke<ListResult | null>("cached_media_list", { userId, mediaType });

/** Saves an entry; local mode wants `media` on a first add to render offline, AniList mode ignores it. */
export const saveListEntry = (input: SaveEntryInput, media?: Media) =>
  profileMode === "local"
    ? invoke<MutationResult>("local_save_entry", {
        // Local mode keeps the display value: its list is the database, with no account format to misread it.
        input: { ...input, media, mediaType: media?.type },
      })
    : invoke<MutationResult>("save_list_entry", { input: withRawScore(input) });

export const deleteListEntry = (id: number) =>
  profileMode === "local"
    ? invoke<MutationResult>("local_delete_entry", { id })
    : invoke<MutationResult>("delete_list_entry", { id });

/** What one request can set across a selection; keep `notes` out, a bulk set would erase every entry's tags. */
export type BulkPatch = Pick<
  SaveEntryInput,
  | "status"
  | "score"
  | "progress"
  | "progressVolumes"
  | "repeat"
  | "private"
  | "startedAt"
  | "completedAt"
>;

/** A bulk edit that stopped partway, carrying what it did write, so a caller does not roll back landed entries. */
export class BulkSaveError extends Error {
  constructor(
    message: string,
    /** Entries AniList accepted before the failure. */
    readonly updated: number,
  ) {
    super(message);
    this.name = "BulkSaveError";
  }
}

interface BulkResult {
  updated: number;
  error?: string;
}

/** One status or score across a whole selection, batched in the backend against the rate budget. */
export const bulkSaveEntries = async (
  entries: { id: number; mediaId: number }[],
  patch: BulkPatch,
): Promise<number> => {
  if (!entries.length) return 0;
  if (profileMode === "local") {
    for (const e of entries) {
      await invoke<MutationResult>("local_save_entry", {
        input: { mediaId: e.mediaId, ...patch },
      });
    }
    return entries.length;
  }
  // Nulls rather than omissions: Rust forwards each into the GraphQL variables, where null means "do not change".
  const res = await invoke<BulkResult>("bulk_save_list_entries", {
    ids: entries.map((e) => e.id),
    status: patch.status ?? null,
    scoreRaw: patch.score !== undefined ? toRaw(scoreFormat, patch.score) : null,
    progress: patch.progress ?? null,
    progressVolumes: patch.progressVolumes ?? null,
    repeat: patch.repeat ?? null,
    private: patch.private ?? null,
    startedAt: patch.startedAt ?? null,
    completedAt: patch.completedAt ?? null,
  });
  if (res.error) throw new BulkSaveError(res.error, res.updated);
  return res.updated;
};

export const flushQueue = () => invoke<number>("flush_queue");
/** Background notification interval in minutes; 0 = off. */
export const getNotifSchedule = () => invoke<number>("get_notif_schedule");
export const setNotifSchedule = (minutes: number) =>
  invoke<void>("set_notif_schedule", { minutes });
/** Discards one queued edit — scoped to the signed-in account in Rust. */
export const discardQueuedEdit = (id: number) =>
  invoke<boolean>("discard_queued_edit", { id });

/** What the sync is doing, for the pending panel; it costs no AniList request, which is why polling it is fine. */
export const syncStatus = () => invoke<SyncStatus>("sync_status");

/** Fetches a bio image in Rust as a `data:` URI rather than widening the CSP; on failure the caller shows the chip. */
export const fetchBioImage = (url: string) =>
  invoke<string>("fetch_bio_image", { url });

/** Blur explicit artwork until clicked. Independent of the filter level. */
export const getBlurAdult = () => invoke<boolean>("get_blur_adult");
export const setBlurAdult = (blur: boolean) =>
  invoke<void>("set_blur_adult", { blur });

// --- Sign-in merge (local list -> AniList) ---------------------------------

export interface LocalEntryRow {
  mediaId: number;
  mediaType: MediaType;
  status: MediaListStatus;
  progress: number;
  /** Manga's second axis; keep it declared here, or the merge drops it. */
  progressVolumes: number;
  score: number;
  repeat: number;
  notes: string;
  /** The merge must carry these three across, because it deletes the local row once pushed. */
  private: boolean;
  startedAt: FuzzyDate | null;
  completedAt: FuzzyDate | null;
  updatedAt: number;
  media: Media;
}

/** Every local row (both media types) — for the merge after connecting. */
export const localAllEntries = () =>
  invoke<LocalEntryRow[]>("local_all_entries");

/** Clears one local row regardless of the active profile mode. */
export const localClearEntry = (mediaId: number) =>
  invoke<MutationResult>("local_delete_entry", { id: mediaId });

/** Pushes an entry straight to AniList; POINT_10 is pinned because a local list's scores are always ten-point. */
export const anilistSaveEntry = (input: SaveEntryInput) =>
  invoke<MutationResult>("save_list_entry", {
    input: withRawScore(input, "POINT_10"),
  });

/** Fetches an AniList list, bypassing the local dispatch (merge only). */
export const anilistFetchList = (userId: number, mediaType: MediaType) =>
  invoke<ListResult>("fetch_media_list", { userId, mediaType, force: true });

// --- Update check ----------------------------------------------------------

export interface UpdateInfo {
  current: string;
  latest: string | null;
  url: string | null;
  isNewer: boolean;
  /** The selected channel has no release at all, which is distinct from being current. */
  channelEmpty: boolean;
}

/** `force: true` always hits the network; `false` respects the 24h background throttle. */
export const checkForUpdates = (force: boolean) =>
  invoke<UpdateInfo>("check_for_updates", { force });

export type UpdateChannel = "prerelease" | "stable";

export const getUpdateChannel = () =>
  invoke<UpdateChannel>("get_update_channel");
export const setUpdateChannel = (channel: UpdateChannel) =>
  invoke<void>("set_update_channel", { channel });

export const getContentFilter = () => invoke<string>("get_content_filter");
export const setContentFilter = (level: string) =>
  invoke<void>("set_content_filter", { level });

export const getUpdateCheckAuto = () => invoke<boolean>("get_update_check_auto");
export const setUpdateCheckAuto = (enabled: boolean) =>
  invoke<void>("set_update_check_auto", { enabled });

export interface DownloadedUpdate {
  version: string;
  notes: string | null;
}

/** Downloads the update for the selected channel, if one is newer than the running version. */
export const downloadPendingUpdate = () =>
  invoke<DownloadedUpdate | null>("download_pending_update");

/** What is already downloaded and waiting, since a background download at startup is invisible unless asked. */
export const pendingUpdate = () =>
  invoke<DownloadedUpdate | null>("pending_update");

/** Installs the previously-downloaded update and restarts the app. */
export const installPendingUpdate = () =>
  invoke<void>("install_pending_update");

/** Full four-part app version (MAJOR.MINOR.PATCH.COMMIT#) for the About page. */
export const appVersion = () => invoke<string>("app_version");

/** Windows' Accessibility text-size multiplier, which WebView2 ignores, so App applies it to the root element. */
export const getTextScale = () => invoke<number>("get_text_scale");

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

export type ImageFormat = "png" | "jpeg";

/** Opens a save dialog where the last export went and writes the base64 `data`; false if cancelled. */
export const saveImage = (
  data: string,
  defaultName: string,
  format: ImageFormat,
) => invoke<boolean>("save_image", { data, defaultName, format });

/** Text twin of `saveImage` — same dialog, same remembered folder. */
export const saveText = (
  contents: string,
  defaultName: string,
  filterLabel: string,
  extension: string,
) =>
  invoke<boolean>("save_text", { contents, defaultName, filterLabel, extension });

/** Fired with the zoom Rust applied, so the Appearance select and the Ctrl+plus shortcut stay one setting. */
export const UI_ZOOM_EVENT = "karasu-ui-zoom";
/** The interface size, a percentage kept in Rust because it is applied before the first paint. */
export const getUiZoom = () => invoke<number>("get_ui_zoom");
export const setUiZoom = async (percent: number) => {
  const applied = await invoke<number>("set_ui_zoom", { percent });
  window.dispatchEvent(new CustomEvent<number>(UI_ZOOM_EVENT, { detail: applied }));
  return applied;
};

// --- Notification centre ---------------------------------------------------

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  createdMs: number;
  /** What the row opens, or `null` (never `undefined`, serde emits JSON null) when it has nowhere to go. */
  mediaId: number | null;
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
