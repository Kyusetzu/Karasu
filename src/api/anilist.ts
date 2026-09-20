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
import { commands, unwrap } from "@/api/tauri";

export const isTauri = "__TAURI_INTERNALS__" in window;

// --- Account / Auth -------------------------------------------------------

export interface AuthInfo {
  hasBuiltinClientId: boolean;
  customClientId: string | null;
  /** The redirect URL an API client must register — Rust owns the port. */
  callbackUrl: string;
}

export const authInfo = () => commands.anilistAuthInfo();
export const setClientId = (clientId: string) =>
  unwrap(commands.setClientId(clientId));
export const loginUrl = () => unwrap(commands.anilistLoginUrl());
/** Starts the localhost callback server and returns the authorize URL. */
export const startLogin = () => unwrap(commands.anilistStartLogin());
export const connect = (token: string): Promise<Viewer> =>
  unwrap(commands.anilistConnect(token));
export const session = (): Promise<Viewer | null> => commands.anilistSession();
/** Refetches the viewer and replaces the cached blob, so a scoreFormat change needs no re-login. */
export const refreshViewer = (): Promise<Viewer> => unwrap(commands.refreshViewer());
export const logout = () => commands.anilistLogout();

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
  return guarded(unwrap(commands.anilistQuery(query, variables ?? null, opts?.source ?? null, cache ?? null)));
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

export const getProfileMode = () => commands.getProfileMode();
export const enableLocalMode = () => unwrap(commands.enableLocalMode());

// --- Anime/manga list (loaded via Rust: cache + offline queue) -------------

/** Rust serves its copy while it is younger than fifteen minutes and refreshes older ones behind; `force` always fetches. */
export const fetchMediaList = (userId: number, mediaType: MediaType, opts?: { force?: boolean }): Promise<ListResult> =>
  profileMode === "local"
    ? unwrap(commands.localFetchList(mediaType))
    : // Guarded like `gql`: the one AniList read that bypasses it, and the request behind every list screen.
      guarded(unwrap(commands.fetchMediaList(userId, mediaType, opts?.force ?? false)));

/** The last cached list from SQLite, or `null`; AniList mode only, since the local list is the database. */
export const cachedMediaList = (userId: number, mediaType: MediaType): Promise<ListResult | null> =>
  profileMode === "local"
    ? Promise.resolve(null)
    : commands.cachedMediaList(userId, mediaType);

/** Saves an entry; local mode wants `media` on a first add to render offline, AniList mode ignores it. */
export const saveListEntry = (input: SaveEntryInput, media?: Media): Promise<MutationResult> =>
  profileMode === "local"
    ? // Local mode keeps the display value: its list is the database, with no account format to misread it.
      unwrap(commands.localSaveEntry({ ...input, media, mediaType: media?.type }))
    : unwrap(commands.saveListEntry(withRawScore(input)));

export const deleteListEntry = (id: number): Promise<MutationResult> =>
  profileMode === "local"
    ? unwrap(commands.localDeleteEntry(id))
    : unwrap(commands.deleteListEntry(id));

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

/** One status or score across a whole selection, batched in the backend against the rate budget. */
export const bulkSaveEntries = async (
  entries: { id: number; mediaId: number }[],
  patch: BulkPatch,
): Promise<number> => {
  if (!entries.length) return 0;
  if (profileMode === "local") {
    for (const e of entries) {
      await unwrap(commands.localSaveEntry({ mediaId: e.mediaId, ...patch }));
    }
    return entries.length;
  }
  // Nulls rather than omissions: Rust forwards each into the GraphQL variables, where null means "do not change".
  const res = await unwrap(commands.bulkSaveListEntries({
    ids: entries.map((e) => e.id),
    status: patch.status ?? null,
    scoreRaw: patch.score !== undefined ? toRaw(scoreFormat, patch.score) : null,
    progress: patch.progress ?? null,
    progressVolumes: patch.progressVolumes ?? null,
    repeat: patch.repeat ?? null,
    private: patch.private ?? null,
    startedAt: patch.startedAt ?? null,
    completedAt: patch.completedAt ?? null,
  }));
  if (res.error) throw new BulkSaveError(res.error, res.updated);
  return res.updated;
};

export const flushQueue = () => unwrap(commands.flushQueue());
/** Background notification interval in minutes; 0 = off. */
export const getNotifSchedule = () => commands.getNotifSchedule();
export const setNotifSchedule = (minutes: number) =>
  unwrap(commands.setNotifSchedule(minutes));
/** Discards one queued edit — scoped to the signed-in account in Rust. */
export const discardQueuedEdit = (id: number) =>
  unwrap(commands.discardQueuedEdit(id));

/** What the sync is doing, for the pending panel; it costs no AniList request, which is why polling it is fine. */
export const syncStatus = () => unwrap(commands.syncStatus()) as Promise<SyncStatus>;

/** Fetches a bio image in Rust as a `data:` URI rather than widening the CSP; on failure the caller shows the chip. */
export const fetchBioImage = (url: string) =>
  unwrap(commands.fetchBioImage(url));

/** Blur explicit artwork until clicked. Independent of the filter level. */
export const getBlurAdult = () => commands.getBlurAdult();
export const setBlurAdult = (blur: boolean) =>
  unwrap(commands.setBlurAdult(blur));

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
export const localAllEntries = (): Promise<LocalEntryRow[]> =>
  commands.localAllEntries();

/** Clears one local row regardless of the active profile mode. */
export const localClearEntry = (mediaId: number): Promise<MutationResult> =>
  unwrap(commands.localDeleteEntry(mediaId));

/** Pushes an entry straight to AniList; POINT_10 is pinned because a local list's scores are always ten-point. */
export const anilistSaveEntry = (input: SaveEntryInput): Promise<MutationResult> =>
  unwrap(commands.saveListEntry(withRawScore(input, "POINT_10")));

/** Fetches an AniList list, bypassing the local dispatch (merge only). */
export const anilistFetchList = (userId: number, mediaType: MediaType): Promise<ListResult> =>
  unwrap(commands.fetchMediaList(userId, mediaType, true));

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
  unwrap(commands.checkForUpdates(force));

export type UpdateChannel = "prerelease" | "stable";

export const getUpdateChannel = () =>
  commands.getUpdateChannel() as Promise<UpdateChannel>;
export const setUpdateChannel = (channel: UpdateChannel) =>
  unwrap(commands.setUpdateChannel(channel));

export const getContentFilter = () => commands.getContentFilter();
export const setContentFilter = (level: string) =>
  unwrap(commands.setContentFilter(level));

export const getUpdateCheckAuto = () => commands.getUpdateCheckAuto();
export const setUpdateCheckAuto = (enabled: boolean) =>
  unwrap(commands.setUpdateCheckAuto(enabled));

export interface DownloadedUpdate {
  version: string;
  notes: string | null;
}

/** Downloads the update for the selected channel, if one is newer than the running version. */
export const downloadPendingUpdate = () =>
  unwrap(commands.downloadPendingUpdate());

/** What is already downloaded and waiting, since a background download at startup is invisible unless asked. */
export const pendingUpdate = () =>
  commands.pendingUpdate();

/** Installs the previously-downloaded update and restarts the app. */
export const installPendingUpdate = () =>
  unwrap(commands.installPendingUpdate());

/** The Android APK updater's view: what is pending, how far the download is, and why it stopped. */
export interface ApkUpdateState {
  available: boolean;
  status: "none" | "downloading" | "ready" | "blocked";
  version: string | null;
  reason: "metered" | "space" | "signature" | "stale" | "foreground" | "network" | null;
  needsInstallPermission: boolean;
  received: number;
  total: number;
}

export const apkUpdateState = () => commands.apkUpdateState() as Promise<ApkUpdateState>;
/** Fetches the pending APK; `forceMetered` is the user's own "load over mobile data anyway". */
export const apkDownload = (forceMetered = false) =>
  unwrap(commands.apkDownload(forceMetered)) as Promise<ApkUpdateState>;
/** Opens the system installer on the verified file; rejects with "permission" while the unknown-apps switch is off. */
export const apkInstall = () => unwrap(commands.apkInstall());
export const apkOpenInstallPermission = () => unwrap(commands.apkOpenInstallPermission());
/** The start-time prompt: opens the installer once per pending version when the file is ready. */
export const apkPromptIfReady = () => commands.apkPromptIfReady();
export const getApkDownloadMetered = () => commands.getApkDownloadMetered();
export const setApkDownloadMetered = (enabled: boolean) =>
  unwrap(commands.setApkDownloadMetered(enabled));

/** Full four-part app version (MAJOR.MINOR.PATCH.COMMIT#) for the About page. */
export const appVersion = () => commands.appVersion();
/** The OS accent as `#rrggbb`, or null where the platform has none to publish. */
export const systemAccent = () => commands.systemAccent();

/** Windows' Accessibility text-size multiplier, which WebView2 ignores, so App applies it to the root element. */
export const getTextScale = () => commands.getTextScale();

// --- Airing notifications --------------------------------------------------

export const getAiringNotify = () => commands.getAiringNotify();
export const setAiringNotify = (enabled: boolean) =>
  unwrap(commands.setAiringNotify(enabled));

export interface StaleSettings {
  enabled: boolean;
  months: number;
}

export const getStaleSettings = () =>
  commands.getStaleSettings();
export const setStaleSettings = (enabled: boolean, months: number) =>
  unwrap(commands.setStaleSettings(enabled, months));

export const getSequelNotify = () => commands.getSequelNotify();
export const setSequelNotify = (enabled: boolean) =>
  unwrap(commands.setSequelNotify(enabled));

export type ImageFormat = "png" | "jpeg";

/** Opens a save dialog where the last export went and writes the base64 `data`; false if cancelled. */
export const saveImage = (
  data: string,
  defaultName: string,
  format: ImageFormat,
) => unwrap(commands.saveImage(data, defaultName, format));

/** Text twin of `saveImage` — same dialog, same remembered folder. */
export const saveText = (
  contents: string,
  defaultName: string,
  filterLabel: string,
  extension: string,
) =>
  unwrap(commands.saveText(contents, defaultName, filterLabel, extension));

/** Fired with the zoom Rust applied, so the Appearance select and the Ctrl+plus shortcut stay one setting. */
export const UI_ZOOM_EVENT = "karasu-ui-zoom";
/** The interface size, a percentage kept in Rust because it is applied before the first paint. */
export const getUiZoom = () => commands.getUiZoom();
export const setUiZoom = async (percent: number) => {
  const applied = await unwrap(commands.setUiZoom(percent));
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
  commands.getNotifications() as Promise<AppNotification[]>;
export const markNotificationRead = (id: number) =>
  unwrap(commands.markNotificationRead(id));
export const markAllNotificationsRead = () =>
  unwrap(commands.markAllNotificationsRead());
