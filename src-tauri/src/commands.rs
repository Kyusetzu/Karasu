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
mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float, $repeat: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score, repeat: $repeat) {
    id mediaId status progress repeat updatedAt
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

/// Local playback history since `from_ms` (epoch ms), newest first — the
/// data behind the Activity analytics.
#[tauri::command]
pub fn get_history(db: State<'_, Db>, from_ms: i64) -> Vec<crate::db::HistoryRow> {
    db.history_since(from_ms)
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

/// Whether new-episode desktop notifications are enabled (default on).
#[tauri::command]
pub fn get_airing_notify(db: State<'_, Db>) -> bool {
    db.kv_get("airing_notify").as_deref() != Some("0")
}

#[tauri::command]
pub fn set_airing_notify(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("airing_notify", if enabled { "1" } else { "0" })
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

/// Compares the running version against the latest GitHub release.
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let resp = reqwest::Client::new()
        .get("https://api.github.com/repos/Kyusetzu/Karasu/releases/latest")
        .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    // No releases published yet — treat as "up to date".
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
