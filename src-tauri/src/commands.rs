use crate::anilist::{
    auth,
    client::{AniList, ApiError},
};
use crate::db::Db;
use serde_json::{json, Value};
use tauri::{Manager, State};

/// Built-in AniList client ID (Taiga principle: one shared app for all
/// users; the ID is public, not a secret). Empty = users need their own
/// client ID. Set once by the maintainer.
pub const BUILTIN_ANILIST_CLIENT_ID: &str = "46231";

const VIEWER_QUERY: &str = "
query {
  Viewer {
    id
    name
    siteUrl
    avatar { large }
  }
}";

#[derive(serde::Serialize)]
pub struct AuthInfo {
    /// true if a client ID is compiled in (login works without any setup)
    #[serde(rename = "hasBuiltinClientId")]
    pub has_builtin_client_id: bool,
    #[serde(rename = "customClientId")]
    pub custom_client_id: Option<String>,
}

#[tauri::command]
pub fn anilist_auth_info(db: State<'_, Db>) -> AuthInfo {
    AuthInfo {
        has_builtin_client_id: !BUILTIN_ANILIST_CLIENT_ID.is_empty(),
        custom_client_id: db.kv_get("anilist_client_id"),
    }
}

#[tauri::command]
pub fn set_client_id(db: State<'_, Db>, client_id: String) -> Result<(), String> {
    let trimmed = client_id.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err(
            "The client ID is the number from your AniList developer settings".into(),
        );
    }
    db.kv_set("anilist_client_id", trimmed)
}

#[tauri::command]
pub fn anilist_login_url(db: State<'_, Db>) -> Result<String, String> {
    let client_id = db
        .kv_get("anilist_client_id")
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| BUILTIN_ANILIST_CLIENT_ID.to_string());
    if client_id.is_empty() {
        return Err("No AniList client ID configured".into());
    }
    Ok(auth::authorize_url(&client_id))
}

/// Validates a token against the Viewer query, stores it in the Windows
/// Credential Manager and caches the viewer. Shared by the manual paste flow
/// and the one-click callback server.
pub async fn connect_with_token(db: &Db, api: &AniList, input: &str) -> Result<Value, String> {
    // Accepts a raw token as well as the full redirect URL
    let token = auth::extract_token(input);
    if token.is_empty() {
        return Err("Please paste the token from the AniList page".into());
    }
    let data = api.query(Some(&token), VIEWER_QUERY, json!({})).await?;
    let viewer = data
        .get("Viewer")
        .filter(|v| !v.is_null())
        .cloned()
        .ok_or("Token invalid or expired")?;
    auth::save_token(&token)?;
    db.kv_set("anilist_viewer", &viewer.to_string())?;
    // A successful connection makes AniList the active profile. Any local
    // entries stay untouched until an explicit merge (see local_merge_*).
    db.kv_set("profile_mode", "anilist")?;
    Ok(viewer)
}

#[tauri::command]
pub async fn anilist_connect(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    token: String,
) -> Result<Value, String> {
    connect_with_token(&db, &api, &token).await
}

/// Starts the one-click login: spins up the localhost callback server and
/// returns the AniList authorize URL for the frontend to open in the browser.
#[tauri::command]
pub fn anilist_start_login(
    app: tauri::AppHandle,
    db: State<'_, Db>,
) -> Result<String, String> {
    let url = anilist_login_url(db)?;
    crate::anilist::login::start(app)?;
    Ok(url)
}

/// Returns the cached viewer if a token is stored — without an API call,
/// so app startup works offline and doesn't burn rate limit.
#[tauri::command]
pub fn anilist_session(db: State<'_, Db>) -> Option<Value> {
    auth::load_token()?;
    let cached = db.kv_get("anilist_viewer")?;
    serde_json::from_str(&cached).ok()
}

#[tauri::command]
pub fn anilist_logout(db: State<'_, Db>) {
    auth::delete_token();
    db.kv_delete("anilist_viewer");
}

/// Generic GraphQL proxy: the frontend supplies query + variables, the
/// backend attaches the token and handles rate limiting.
#[tauri::command]
pub async fn anilist_query(
    api: State<'_, AniList>,
    query: String,
    variables: Option<Value>,
) -> Result<Value, String> {
    let token = auth::load_token();
    Ok(api
        .query(
            token.as_deref(),
            &query,
            variables.unwrap_or_else(|| json!({})),
        )
        .await?)
}

// --- Media list: loading with cache, mutations with offline queue -----------

const LIST_QUERY: &str = "
query ($userId: Int!, $type: MediaType!) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      name
      status
      isCustomList
      entries {
        id
        mediaId
        status
        score(format: POINT_10)
        progress
        repeat
        notes
        updatedAt
        media {
          id
          type
          title { romaji english native }
          coverImage { large extraLarge }
          bannerImage
          episodes
          chapters
          volumes
          duration
          format
          status
          season
          seasonYear
          averageScore
          genres
          synonyms
          nextAiringEpisode { episode airingAt }
        }
      }
    }
  }
}";

fn validate_media_type(media_type: &str) -> Result<&str, String> {
    match media_type {
        "ANIME" | "MANGA" => Ok(media_type),
        _ => Err(format!("Invalid media type: {media_type}")),
    }
}

const SAVE_MUTATION: &str = "
mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float, $repeat: Int, $notes: String) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score, repeat: $repeat, notes: $notes) {
    id mediaId status progress repeat notes updatedAt
    score(format: POINT_10)
  }
}";

const DELETE_MUTATION: &str = "
mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) { deleted }
}";

#[derive(serde::Serialize)]
pub struct ListResult {
    /// true if the data comes from the local cache (offline)
    #[serde(rename = "fromCache")]
    from_cache: bool,
    /// number of changes not yet synced
    pending: usize,
    lists: Value,
}

/// Loads the anime/manga list; offline, the last known state is served
/// from SQLite. The offline queue is drained first so that the server
/// response already includes the user's own pending changes.
#[tauri::command]
pub async fn fetch_media_list(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    user_id: i64,
    media_type: String,
) -> Result<ListResult, String> {
    let media_type = validate_media_type(&media_type)?;
    let token = auth::load_token();
    let _ = process_queue(&db, &api, token.as_deref()).await;

    match api
        .query(
            token.as_deref(),
            LIST_QUERY,
            json!({ "userId": user_id, "type": media_type }),
        )
        .await
    {
        Ok(data) => {
            let lists = data
                .pointer("/MediaListCollection/lists")
                .cloned()
                .unwrap_or_else(|| json!([]));
            let _ = db.cache_list(user_id, media_type, &lists.to_string());
            Ok(ListResult {
                from_cache: false,
                pending: db.queue_len(),
                lists,
            })
        }
        Err(ApiError::Network(_)) => {
            let cached = db
                .cached_list(user_id, media_type)
                .ok_or("Offline and no local list cache available yet")?;
            Ok(ListResult {
                from_cache: true,
                pending: db.queue_len(),
                lists: serde_json::from_str(&cached)
                    .map_err(|e| format!("Cache corrupted: {e}"))?,
            })
        }
        Err(e) => Err(e.into()),
    }
}

#[derive(serde::Serialize)]
pub struct MutationResult {
    /// true if the change was queued offline
    pub(crate) queued: bool,
    pub(crate) entry: Option<Value>,
}

/// Core of list saving, also used by the scrobbler: straight to the API
/// when online, into the queue when offline (order is preserved).
pub(crate) async fn save_entry_core(
    db: &Db,
    api: &AniList,
    token: &str,
    input: Value,
) -> Result<MutationResult, String> {
    if db.queue_len() > 0 && process_queue(db, api, Some(token)).await.is_err() {
        db.queue_push("save", &input.to_string())?;
        return Ok(MutationResult { queued: true, entry: None });
    }

    match api.query(Some(token), SAVE_MUTATION, input.clone()).await {
        Ok(data) => Ok(MutationResult {
            queued: false,
            entry: data.get("SaveMediaListEntry").cloned(),
        }),
        Err(ApiError::Network(_)) => {
            db.queue_push("save", &input.to_string())?;
            Ok(MutationResult { queued: true, entry: None })
        }
        Err(e) => Err(e.into()),
    }
}

/// Saves a list entry (status/progress/score). Offline, the change is
/// queued and synced later.
#[tauri::command]
pub async fn save_list_entry(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    input: Value,
) -> Result<MutationResult, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    save_entry_core(&db, &api, &token, input).await
}

#[tauri::command]
pub async fn delete_list_entry(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    id: i64,
) -> Result<MutationResult, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    let input = json!({ "id": id });

    if db.queue_len() > 0 && process_queue(&db, &api, Some(&token)).await.is_err() {
        db.queue_push("delete", &input.to_string())?;
        return Ok(MutationResult { queued: true, entry: None });
    }

    match api.query(Some(&token), DELETE_MUTATION, input.clone()).await {
        Ok(_) => Ok(MutationResult { queued: false, entry: None }),
        Err(ApiError::Network(_)) => {
            db.queue_push("delete", &input.to_string())?;
            Ok(MutationResult { queued: true, entry: None })
        }
        Err(e) => Err(e.into()),
    }
}

// --- Local-only profile mode ------------------------------------------------

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Current profile mode: "anilist" (default) or "local".
#[tauri::command]
pub fn get_profile_mode(db: State<'_, Db>) -> String {
    db.kv_get("profile_mode")
        .unwrap_or_else(|| "anilist".to_string())
}

/// Switches into account-free local mode. Connecting AniList later flips it
/// back to "anilist" (and offers to merge — see the frontend merge flow).
#[tauri::command]
pub fn enable_local_mode(db: State<'_, Db>) -> Result<(), String> {
    db.kv_set("profile_mode", "local")
}

/// Loads the local list for a media type, shaped exactly like the online
/// `ListResult` so the UI is identical.
#[tauri::command]
pub fn local_fetch_list(
    db: State<'_, Db>,
    media_type: String,
) -> Result<ListResult, String> {
    let media_type = validate_media_type(&media_type)?;
    let lists: Value = serde_json::from_str(&db.local_list_json(media_type))
        .unwrap_or_else(|_| json!([]));
    Ok(ListResult {
        from_cache: false,
        pending: 0,
        lists,
    })
}

/// Saves a local entry. On a first add the caller supplies `media` (the
/// AniList media object) so the list renders offline; field-only edits may
/// omit it and the stored metadata is kept.
#[tauri::command]
pub fn local_save_entry(
    db: State<'_, Db>,
    input: Value,
) -> Result<MutationResult, String> {
    let media_id = input
        .get("mediaId")
        .and_then(|v| v.as_i64())
        .ok_or("mediaId required")?;
    let media_type = input
        .get("mediaType")
        .and_then(|v| v.as_str())
        .or_else(|| input.pointer("/media/type").and_then(|v| v.as_str()))
        .map(str::to_string)
        .or_else(|| db.local_find_type(media_id))
        .ok_or("mediaType required for a new local entry")?;
    validate_media_type(&media_type)?;

    let status = input.get("status").and_then(|v| v.as_str()).unwrap_or("PLANNING");
    let progress = input.get("progress").and_then(|v| v.as_i64()).unwrap_or(0);
    let score = input.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let repeat = input.get("repeat").and_then(|v| v.as_i64()).unwrap_or(0);
    let notes = input.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    let media_json = input
        .get("media")
        .filter(|m| !m.is_null())
        .map(|m| m.to_string());
    let ts = now_ms();

    db.local_upsert(
        media_id,
        &media_type,
        status,
        progress,
        score,
        repeat,
        notes,
        media_json.as_deref(),
        ts,
    )?;

    Ok(MutationResult {
        queued: false,
        entry: Some(json!({
            "id": media_id,
            "mediaId": media_id,
            "status": status,
            "progress": progress,
            "score": score,
            "repeat": repeat,
            "notes": notes,
            "updatedAt": ts / 1000,
        })),
    })
}

/// Deletes a local entry. In local mode the frontend entry id equals the
/// media id.
#[tauri::command]
pub fn local_delete_entry(db: State<'_, Db>, id: i64) -> Result<MutationResult, String> {
    if let Some(media_type) = db.local_find_type(id) {
        db.local_delete(id, &media_type)?;
    }
    Ok(MutationResult { queued: false, entry: None })
}

/// All local rows across both media types, for the sign-in merge. Each row
/// carries its media metadata so the frontend can present a conflict prompt.
#[tauri::command]
pub fn local_all_entries(db: State<'_, Db>) -> Value {
    let rows: Vec<Value> = db
        .local_all()
        .into_iter()
        .map(|r| {
            let media: Value = r
                .media_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or(Value::Null);
            json!({
                "mediaId": r.media_id,
                "mediaType": r.media_type,
                "status": r.status,
                "progress": r.progress,
                "score": r.score,
                "repeat": r.repeat,
                "notes": r.notes,
                "updatedAt": r.updated_ms / 1000,
                "media": media,
            })
        })
        .collect();
    json!(rows)
}

/// Drains the offline queue in order. Network errors abort (the rest stays
/// queued); API errors drop the entry so the queue can never get stuck.
async fn process_queue(
    db: &Db,
    api: &AniList,
    token: Option<&str>,
) -> Result<usize, String> {
    let mut flushed = 0;
    for (id, kind, payload) in db.queue_all() {
        let variables: Value =
            serde_json::from_str(&payload).unwrap_or_else(|_| json!({}));
        let mutation = if kind == "delete" { DELETE_MUTATION } else { SAVE_MUTATION };
        match api.query(token, mutation, variables).await {
            Ok(_) => {
                db.queue_remove(id);
                flushed += 1;
            }
            Err(ApiError::Network(m)) => return Err(m),
            Err(ApiError::Api(_)) => db.queue_remove(id),
        }
    }
    Ok(flushed)
}

/// Manually triggered sync of the offline queue (e.g. a button in the UI).
#[tauri::command]
pub async fn flush_queue(
    db: State<'_, Db>,
    api: State<'_, AniList>,
) -> Result<usize, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    process_queue(&db, &api, Some(&token)).await
}

/// Currently detected playback (poll loop state).
#[tauri::command]
pub fn get_now_playing(
    state: State<'_, crate::scrobbler::PlaybackState>,
) -> Option<crate::scrobbler::NowPlaying> {
    state.0.lock().unwrap().clone()
}

// --- Scrobbler settings and control ------------------------------------------

#[derive(serde::Serialize)]
pub struct ScrobbleSettings {
    pub enabled: bool,
    /// true = require confirmation in the UI before updating
    pub confirm: bool,
    /// threshold in minutes; 0 = automatic (2/3 of the episode length)
    #[serde(rename = "delayMin")]
    pub delay_min: u32,
}

pub(crate) fn read_scrobble_settings(db: &Db) -> ScrobbleSettings {
    ScrobbleSettings {
        enabled: db.kv_get("scrobble_enabled").as_deref() != Some("0"),
        confirm: db.kv_get("scrobble_confirm").as_deref() == Some("1"),
        delay_min: db
            .kv_get("scrobble_delay_min")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
    }
}

#[tauri::command]
pub fn get_scrobble_settings(db: State<'_, Db>) -> ScrobbleSettings {
    read_scrobble_settings(&db)
}

#[tauri::command]
pub fn set_scrobble_settings(
    db: State<'_, Db>,
    enabled: bool,
    confirm: bool,
    delay_min: u32,
) -> Result<(), String> {
    db.kv_set("scrobble_enabled", if enabled { "1" } else { "0" })?;
    db.kv_set("scrobble_confirm", if confirm { "1" } else { "0" })?;
    db.kv_set("scrobble_delay_min", &delay_min.to_string())
}

#[derive(serde::Serialize)]
pub struct DiscordSettings {
    pub enabled: bool,
    #[serde(rename = "appId")]
    pub app_id: String,
    /// true if an application ID is compiled in
    #[serde(rename = "hasBuiltinAppId")]
    pub has_builtin_app_id: bool,
}

#[tauri::command]
pub fn get_discord_settings(db: State<'_, Db>) -> DiscordSettings {
    DiscordSettings {
        enabled: db.kv_get("discord_enabled").as_deref() == Some("1"),
        app_id: db.kv_get("discord_app_id").unwrap_or_default(),
        has_builtin_app_id: !crate::discord::BUILTIN_DISCORD_APP_ID.is_empty(),
    }
}

#[tauri::command]
pub fn set_discord_settings(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    enabled: bool,
    app_id: String,
) -> Result<(), String> {
    db.kv_set("discord_enabled", if enabled { "1" } else { "0" })?;
    db.kv_set("discord_app_id", app_id.trim())?;
    // Apply the new state to the presence immediately
    let now = app
        .state::<crate::scrobbler::PlaybackState>()
        .0
        .lock()
        .unwrap()
        .clone();
    crate::discord::sync(&app, now.as_ref());
    Ok(())
}

/// Reports the page the user is currently on, so the idle Discord presence
/// can show "Looking at <page>".
#[tauri::command]
pub fn set_ui_page(app: tauri::AppHandle, page: String) {
    *app.state::<crate::discord::UiPage>().0.lock().unwrap() = page;
    crate::discord::sync_current(&app);
}

// --- Portable mode -----------------------------------------------------------

#[derive(serde::Serialize)]
pub struct PortableStatus {
    pub portable: bool,
    /// Absolute path where the database currently lives.
    pub dir: String,
}

#[tauri::command]
pub fn get_portable_status(app: tauri::AppHandle) -> PortableStatus {
    let portable = crate::portable::is_portable();
    let dir = if portable {
        crate::portable::portable_data_dir()
    } else {
        app.path().app_data_dir().ok()
    }
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or_default();
    PortableStatus { portable, dir }
}

/// Enables portable mode: writes the marker, copies the current database
/// next to the exe and moves the token into the encrypted portable file.
/// Takes effect after a restart.
#[tauri::command]
pub fn enable_portable(app: tauri::AppHandle) -> Result<(), String> {
    crate::portable::create_marker()?;
    let dest_dir = crate::portable::portable_data_dir().ok_or("No portable path")?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let src = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("karasu.db");
    let dest = dest_dir.join("karasu.db");
    if src.exists() && !dest.exists() {
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    }
    crate::anilist::auth::migrate_to_portable_file()?;
    Ok(())
}

/// Disables portable mode (removes the marker). Takes effect after a restart.
#[tauri::command]
pub fn disable_portable() -> Result<(), String> {
    crate::portable::remove_marker()
}

/// Whether new-episode desktop notifications are enabled (default on).
#[tauri::command]
pub fn get_airing_notify(db: State<'_, Db>) -> bool {
    db.kv_get("airing_notify").as_deref() != Some("0")
}

#[tauri::command]
pub fn set_airing_notify(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("airing_notify", if enabled { "1" } else { "0" })
}

#[derive(serde::Serialize)]
pub struct StaleSettings {
    enabled: bool,
    months: i64,
}

/// On-hold reminder settings (disabled by default).
#[tauri::command]
pub fn get_stale_settings(db: State<'_, Db>) -> StaleSettings {
    StaleSettings {
        enabled: db.kv_get("stale_notify").as_deref() == Some("1"),
        months: crate::stale::stale_months(&db),
    }
}

#[tauri::command]
pub fn set_stale_settings(
    db: State<'_, Db>,
    enabled: bool,
    months: i64,
) -> Result<(), String> {
    db.kv_set("stale_notify", if enabled { "1" } else { "0" })?;
    db.kv_set("stale_months", &months.clamp(1, 24).to_string())
}

/// Whether sequel-announcement notifications are enabled (default off).
#[tauri::command]
pub fn get_sequel_notify(db: State<'_, Db>) -> bool {
    db.kv_get("sequel_notify").as_deref() == Some("1")
}

#[tauri::command]
pub fn set_sequel_notify(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("sequel_notify", if enabled { "1" } else { "0" })
}

/// Opens a native save dialog and writes PNG bytes (e.g. the yearly wrap-up
/// card). Returns false if the user cancelled.
#[tauri::command]
pub fn save_png(
    app: tauri::AppHandle,
    data: Vec<u8>,
    default_name: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("PNG image", &["png"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok());
    match path {
        Some(p) => std::fs::write(&p, &data)
            .map(|_| true)
            .map_err(|e| format!("Could not save image: {e}")),
        None => Ok(false),
    }
}

#[tauri::command]
pub fn get_autostart(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|e| e.to_string())
}

// --- Notification centre -----------------------------------------------------

/// Recent notifications, newest first (for the bell dropdown).
#[tauri::command]
pub fn get_notifications(db: State<'_, Db>) -> Vec<crate::db::NotificationRow> {
    db.notif_all(100)
}

#[tauri::command]
pub fn unread_notification_count(db: State<'_, Db>) -> i64 {
    db.notif_unread_count()
}

#[tauri::command]
pub fn mark_notification_read(db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.notif_mark_read(id)
}

#[tauri::command]
pub fn mark_all_notifications_read(db: State<'_, Db>) -> Result<(), String> {
    db.notif_mark_all_read()
}

// --- Version -----------------------------------------------------------------

/// Monotonic commit counter — the 4th version segment
/// (`MAJOR.MINOR.PATCH.COMMIT#`). Bumped by one on every commit.
pub const COMMIT_NUMBER: u32 = 64;

/// Full four-part display version, e.g. `0.1.1.38`. The `MAJOR.MINOR.PATCH`
/// core comes from the crate version (kept in sync across the manifests).
pub fn app_version_string() -> String {
    format!("{}.{}", env!("CARGO_PKG_VERSION"), COMMIT_NUMBER)
}

/// The running four-part version, shown in the About window.
#[tauri::command]
pub fn app_version() -> String {
    app_version_string()
}

// --- Update check ------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    /// The running app version.
    pub current: String,
    /// Latest published release tag (without a leading "v"), if any.
    pub latest: Option<String>,
    /// Release page URL.
    pub url: Option<String>,
    #[serde(rename = "isNewer")]
    pub is_newer: bool,
}

/// Update channel: `"prerelease"` (the rolling `latest` tag, default — the
/// only channel with real releases today) or `"stable"` (GitHub's
/// latest-non-prerelease alias, for whenever stable tags start being
/// published).
#[tauri::command]
pub fn get_update_channel(db: State<'_, Db>) -> String {
    db.kv_get("update_channel")
        .unwrap_or_else(|| "prerelease".to_string())
}

#[tauri::command]
pub fn set_update_channel(db: State<'_, Db>, channel: String) -> Result<(), String> {
    if channel != "prerelease" && channel != "stable" {
        return Err("Unknown update channel".into());
    }
    db.kv_set("update_channel", &channel)
}

/// Whether Karasu checks for updates automatically (once/day on startup).
/// Manual checks from the About page always work regardless.
#[tauri::command]
pub fn get_update_check_auto(db: State<'_, Db>) -> bool {
    db.kv_get("update_check_auto").as_deref() != Some("0")
}

#[tauri::command]
pub fn set_update_check_auto(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("update_check_auto", if enabled { "1" } else { "0" })
}

fn update_channel_api_url(channel: &str) -> &'static str {
    match channel {
        "stable" => "https://api.github.com/repos/Kyusetzu/Karasu/releases/latest",
        _ => "https://api.github.com/repos/Kyusetzu/Karasu/releases/tags/latest",
    }
}

/// The `latest.json` manifest the in-app updater downloads from, matching `channel`.
fn update_channel_manifest_url(channel: &str) -> &'static str {
    match channel {
        "stable" => "https://github.com/Kyusetzu/Karasu/releases/latest/download/latest.json",
        _ => "https://github.com/Kyusetzu/Karasu/releases/download/latest/latest.json",
    }
}

const UPDATE_CHECK_THROTTLE_MS: i64 = 24 * 60 * 60 * 1000;

/// Compares the running version against the latest release on the selected
/// channel. Background/automatic callers should pass `force: false` (respects
/// a 24h throttle so startup checks don't hit the API every launch); the
/// manual "Check for Updates" button always passes `force: true`.
#[tauri::command]
pub async fn check_for_updates(db: State<'_, Db>, force: bool) -> Result<UpdateInfo, String> {
    // Compare the full four-part version so a release tagged with the commit
    // number lines up with what's running.
    let current = app_version_string();
    let channel = db
        .kv_get("update_channel")
        .unwrap_or_else(|| "prerelease".to_string());

    if !force {
        let last_check = db
            .kv_get("last_update_check_ms")
            .and_then(|s| s.parse::<i64>().ok());
        if let Some(last) = last_check {
            if now_ms() - last < UPDATE_CHECK_THROTTLE_MS {
                return Ok(UpdateInfo { current, latest: None, url: None, is_newer: false });
            }
        }
    }
    let _ = db.kv_set("last_update_check_ms", &now_ms().to_string());

    let resp = reqwest::Client::new()
        .get(update_channel_api_url(&channel))
        .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    // No releases published yet on this channel — treat as "up to date".
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo { current, latest: None, url: None, is_newer: false });
    }
    if !resp.status().is_success() {
        return Err(format!("Update check failed: HTTP {}", resp.status()));
    }

    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let tag = body.get("tag_name").and_then(|v| v.as_str()).unwrap_or("");
    let url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let latest = tag.trim_start_matches('v').to_string();
    let is_newer = version_gt(&latest, &current);
    Ok(UpdateInfo { current, latest: Some(latest), url, is_newer })
}

/// True if dotted-numeric version `a` is strictly greater than `b`.
fn version_gt(a: &str, b: &str) -> bool {
    let parse = |s: &str| {
        s.split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let (va, vb) = (parse(a), parse(b));
    for i in 0..va.len().max(vb.len()) {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::version_gt;

    #[test]
    fn version_comparison() {
        assert!(version_gt("0.2.0", "0.1.0"));
        assert!(version_gt("1.0.0", "0.9.9"));
        assert!(version_gt("0.1.1", "0.1.0"));
        assert!(!version_gt("0.1.0", "0.1.0"));
        assert!(!version_gt("0.1.0", "0.2.0"));
        // Shorter vs longer: 0.1 == 0.1.0
        assert!(!version_gt("0.1", "0.1.0"));
        assert!(version_gt("0.1.0.1", "0.1.0"));
    }
}

// --- In-app updater ------------------------------------------------------------

/// Downloaded-but-not-yet-installed update, held between
/// `download_pending_update` and `install_pending_update` so applying it is a
/// separate, explicit user action (installing closes and restarts the app).
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

#[derive(serde::Serialize)]
pub struct DownloadedUpdate {
    pub version: String,
    pub notes: Option<String>,
}

/// Checks the selected channel's manifest and, if a newer version is
/// available, downloads it and stashes it for `install_pending_update`.
/// Notifies the user (kind: "update") once the download finishes.
#[tauri::command]
pub async fn download_pending_update(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<DownloadedUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;

    let channel = db
        .kv_get("update_channel")
        .unwrap_or_else(|| "prerelease".to_string());
    let endpoint = reqwest::Url::parse(update_channel_manifest_url(&channel))
        .map_err(|e| e.to_string())?;

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    let version = update.version.clone();
    let notes = update.body.clone();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    *pending.0.lock().unwrap() = Some((update, bytes));
    crate::notify::notify(
        &app,
        "update",
        "Update ready",
        &format!("Karasu {version} has been downloaded. Restart to install it."),
    );

    Ok(Some(DownloadedUpdate { version, notes }))
}

/// Installs the update stashed by `download_pending_update` and restarts the
/// app. On Windows the NSIS installer requires the running process to exit,
/// so this call does not return on success.
#[tauri::command]
pub fn install_pending_update(
    app: tauri::AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let Some((update, bytes)) = pending.0.lock().unwrap().take() else {
        return Err("No update has been downloaded yet".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

/// Confirms the pending auto-update immediately (also from Blocked).
#[tauri::command]
pub async fn scrobble_now(app: tauri::AppHandle) -> Result<(), String> {
    crate::scrobbler::confirm_pending(app, true).await
}

/// Discards the pending auto-update for this episode.
#[tauri::command]
pub async fn scrobble_cancel(app: tauri::AppHandle) -> Result<(), String> {
    crate::scrobbler::confirm_pending(app, false).await
}
