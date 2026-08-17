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
/** Refetches the viewer (one request) and replaces the cached blob — how a
 *  scoreFormat change reaches the store without a re-login. */
export const refreshViewer = () => invoke<Viewer>("refresh_viewer");
export const logout = () => invoke<void>("anilist_logout");

// --- GraphQL --------------------------------------------------------------

/**
 * The stable code `client.rs` returns when AniList rejects the token.
 *
 * Matched exactly rather than by substring: an entry's notes can contain any
 * text at all, and a queued edit whose body happened to mention this must not
 * sign the user out.
 */
export const TOKEN_REJECTED = "anilist.tokenRejected";

export const isTokenRejected = (e: unknown): boolean =>
  (e instanceof Error ? e.message : String(e)).trim() === TOKEN_REJECTED;

/**
 * Told when the token is rejected, so the auth store can raise **one** banner
 * instead of every screen rendering its own load failure.
 *
 * A callback the store registers rather than an import, mirroring
 * `setProfileModeCache` below: `stores/auth` imports this module, so importing
 * the store from here would be a cycle.
 */
let onTokenRejected: () => void = () => {};
export const setTokenRejectedHandler = (fn: () => void) => {
  onTokenRejected = fn;
};

/**
 * Every read goes through here, which is why the rejection is caught here.
 *
 * `anilist_query` attaches the bearer to *every* query — including the public
 * ones behind search, seasonal, the forum and detail pages — so one dead token
 * fails all of them at once. That is why it read as the app randomly breaking
 * rather than as a sign-in problem.
 */
async function guarded<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (isTokenRejected(e)) onTokenRejected();
    throw e;
  }
}

export function gql<T>(query: string, variables?: object): Promise<T> {
  return guarded(invoke<T>("anilist_query", { query, variables }));
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

// The account's score format, cached the same way and by the same owner (the
// auth store), so the save paths below can convert display-format scores to
// `scoreRaw` without importing a React store into the api layer.
let scoreFormat: ScoreFormat = "POINT_10";
export const setScoreFormatCache = (format: ScoreFormat) => {
  scoreFormat = format;
};
export const currentScoreFormat = () => scoreFormat;

/**
 * `score` (display units) → `scoreRaw` (0–100), leaving everything else
 * untouched. Applied to every AniList-bound save: the bare `score` float is
 * interpreted in the account's format, which is how ten-point writes were
 * silently corrupting non-ten-point accounts. Absent stays absent — "do not
 * change" must not become "clear".
 */
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

export const fetchMediaList = (userId: number, mediaType: MediaType) =>
  profileMode === "local"
    ? invoke<ListResult>("local_fetch_list", { mediaType })
    : // Guarded like `gql`: this is the one AniList read that does not go
      // through it, and it is the request behind every list screen.
      guarded(invoke<ListResult>("fetch_media_list", { userId, mediaType }));

/**
 * The last cached list, read straight from SQLite with no network access.
 * `null` when nothing is cached yet.
 *
 * Only meaningful in AniList mode — the local profile's list *is* the database,
 * so `fetchMediaList` already returns instantly there and priming would just
 * duplicate the read.
 */
export const cachedMediaList = (userId: number, mediaType: MediaType) =>
  profileMode === "local"
    ? Promise.resolve(null)
    : invoke<ListResult | null>("cached_media_list", { userId, mediaType });

/**
 * Saves an entry. In local mode the change goes to the local SQLite list; on
 * a first add pass `media` so the entry renders offline (field-only edits may
 * omit it). AniList mode ignores `media`.
 */
export const saveListEntry = (input: SaveEntryInput, media?: Media) =>
  profileMode === "local"
    ? invoke<MutationResult>("local_save_entry", {
        // Local mode keeps the display value — its list is the database and
        // there is no account format to be misread by.
        input: { ...input, media, mediaType: media?.type },
      })
    : invoke<MutationResult>("save_list_entry", { input: withRawScore(input) });

export const deleteListEntry = (id: number) =>
  profileMode === "local"
    ? invoke<MutationResult>("local_delete_entry", { id })
    : invoke<MutationResult>("delete_list_entry", { id });

/**
 * One status or score across a whole selection.
 *
 * AniList mode sends the entry ids to `UpdateMediaListEntries`, batched in the
 * backend, so a 500-entry selection costs ten requests rather than five hundred
 * against a ~30/min budget. Local mode has no such budget — its list is the
 * SQLite file — so it simply writes each row, keyed on media id the way
 * `local_save_entry` expects.
 */
/**
 * What can be set across a whole selection in one request.
 *
 * Exactly the arguments `UpdateMediaListEntries` accepts *and* that mean
 * something applied to many entries at once — established by introspecting the
 * live schema, because the only way to validate a mutation by running it is to
 * edit real entries.
 *
 * `notes` is absent deliberately, though the schema takes it: tags live inside
 * the notes field, so one bulk set would erase every selected entry's tags, and
 * appending instead is a read-modify-write per entry — the fan-out this whole
 * path exists to avoid.
 */
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

/**
 * A bulk edit that stopped partway, carrying what it *did* write.
 *
 * The backend chunks a selection into ten-ish requests and stops on the first
 * failure, so "it failed" and "nothing changed" are different statements. A
 * caller that rolls its optimistic update back on the second reading puts
 * already-written entries back to their old values on screen while AniList
 * holds the new ones.
 */
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
  // Nulls rather than omissions: the Rust command forwards each straight into
  // the GraphQL variables, and an absent variable and an explicit null mean the
  // same thing to AniList — "do not change this".
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

/**
 * What the sync is doing, for the panel behind the pending line.
 *
 * Costs no AniList request — it reads SQLite and two in-process values — which
 * is the only reason polling it is acceptable at all. The ~30/min budget it
 * reports on is shared with the scrobbler and three alert passes, and a status
 * surface that spent it would be the problem it exists to show.
 */
export const syncStatus = () => invoke<SyncStatus>("sync_status");

/**
 * Fetches a bio image in Rust and returns it as a `data:` URI.
 *
 * Rejects on anything at all — refused host, wrong content type, too large,
 * unreachable — and the caller falls back to the chip. See
 * `commands/images.rs` for what the backend will and will not fetch, and
 * `components/RichText.tsx` for why this exists rather than a wider CSP.
 */
export const fetchBioImage = (url: string) =>
  invoke<string>("fetch_bio_image", { url });

// --- Sign-in merge (local list -> AniList) ---------------------------------

export interface LocalEntryRow {
  mediaId: number;
  mediaType: MediaType;
  status: MediaListStatus;
  progress: number;
  /** Manga's second axis. Emitted by the command since v7 and simply never
      declared here, which is how the merge came to drop it. */
  progressVolumes: number;
  score: number;
  repeat: number;
  notes: string;
  /** Since schema v14 — and the merge has to carry all three across, because
      it deletes the local row once it has pushed. */
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

/** Pushes an entry to AniList, bypassing the local dispatch. Local scores are
 *  always ten-point (there is no account to follow), so the raw conversion is
 *  pinned to POINT_10 whatever the connected account uses. */
export const anilistSaveEntry = (input: SaveEntryInput) =>
  invoke<MutationResult>("save_list_entry", {
    input: withRawScore(input, "POINT_10"),
  });

/** Fetches an AniList list, bypassing the local dispatch (merge only). */
export const anilistFetchList = (userId: number, mediaType: MediaType) =>
  invoke<ListResult>("fetch_media_list", { userId, mediaType });

// --- Update check ----------------------------------------------------------

export interface UpdateInfo {
  current: string;
  latest: string | null;
  url: string | null;
  isNewer: boolean;
  /** The selected channel has no release at all — distinct from being current.
   *  A 404 used to render as "you're on the latest version". */
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

/**
 * What is already downloaded and waiting, if anything.
 *
 * The stash lives in the backend's memory, so a background download at startup
 * is invisible to this page unless it asks.
 */
export const pendingUpdate = () =>
  invoke<DownloadedUpdate | null>("pending_update");

/** Installs the previously-downloaded update and restarts the app. */
export const installPendingUpdate = () =>
  invoke<void>("install_pending_update");

/** Full four-part app version (MAJOR.MINOR.PATCH.COMMIT#) for the About page. */
export const appVersion = () => invoke<string>("app_version");

/**
 * Windows' Accessibility → Text size multiplier (1.0 = 100%). Display scaling
 * needs no help — WebView2 applies that itself — but the text-size slider is
 * separate and the WebView ignores it, so App applies it to the root element.
 */
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

/**
 * Opens a save dialog and writes the image; false if cancelled.
 * The dialog reopens wherever the last export went.
 *
 * `data` is base64 — see `lib/base64.ts` for why bytes are not passed directly.
 */
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

// --- Notification centre ---------------------------------------------------

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  createdMs: number;
  /** What the row opens, or `null`: the app-update notice, a dropped-queue
   *  report and every row written before schema v15 have nowhere to go.
   *  `null` rather than `undefined` — serde emits `None` as JSON null. */
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
