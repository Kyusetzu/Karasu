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
          coverImage { large }
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
          isAdult
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

/// The last cached list for this user and type, with no network access at all.
///
/// `fetch_media_list` always awaits AniList, so a cold start stares at a
/// loading state even though a complete list is sitting on disk. This lets the
/// frontend paint that immediately and let the real fetch land underneath it.
///
/// `from_cache` is deliberately `false` here. That flag means "you are offline
/// and this is all we have" — it drives the amber banner in MediaList — and
/// this path is a head start on a refresh that is already in flight, not an
/// offline fallback. Returns `None` when nothing has been cached yet, so the
/// caller simply falls back to the normal loading state.
#[tauri::command]
pub fn cached_media_list(
    db: State<'_, Db>,
    user_id: i64,
    media_type: String,
) -> Option<ListResult> {
    let media_type = validate_media_type(&media_type).ok()?;
    let cached = db.cached_list(user_id, media_type)?;
    Some(ListResult {
        from_cache: false,
        pending: db.queue_len(),
        lists: serde_json::from_str(&cached).ok()?,
    })
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

/// Whether the Windows media-session detection pass runs. Default on, same
/// opt-out idiom as the other detection settings.
pub(crate) fn read_smtc_enabled(db: &Db) -> bool {
    db.kv_get("smtc_enabled").as_deref() != Some("0")
}

#[tauri::command]
pub fn get_smtc_enabled(db: State<'_, Db>) -> bool {
    read_smtc_enabled(&db)
}

#[tauri::command]
pub fn set_smtc_enabled(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("smtc_enabled", if enabled { "1" } else { "0" })
}

/// Everything the Jellyfin source needs, or `None` when it isn't fully
/// configured. A missing user id is treated as "not configured" on purpose,
/// so the source fails closed rather than falling back to something broader.
pub(crate) fn jellyfin_config(
    db: &Db,
) -> Option<crate::detection::jellyfin::JellyfinConfig> {
    let url = db.kv_get("jellyfin_url").filter(|u| !u.trim().is_empty())?;
    let token = crate::detection::jellyfin::load_token()?;
    let user_id = db
        .kv_get("jellyfin_user_id")
        .filter(|u| !u.trim().is_empty())?;
    Some(crate::detection::jellyfin::JellyfinConfig {
        url,
        token,
        user_id,
        device: db.kv_get("jellyfin_device").unwrap_or_default(),
        device_name: local_device_name(),
        device_id: jellyfin_device_id(db),
    })
}

/// A stable per-install id for the `DeviceId` Jellyfin wants on every request.
///
/// Generated once and kept: a fresh one per launch would register a new entry
/// in the server's device list every time Karasu started. There's no `uuid`
/// crate here and no need for one — this only has to be stable and unlikely to
/// collide, not unguessable.
fn jellyfin_device_id(db: &Db) -> String {
    if let Some(existing) = db.kv_get("jellyfin_device_id").filter(|s| !s.is_empty()) {
        return existing;
    }
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    local_device_name().hash(&mut hasher);
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
        .hash(&mut hasher);
    let id = format!("karasu-{:016x}", hasher.finish());
    let _ = db.kv_set("jellyfin_device_id", &id);
    id
}

/// This machine's name, used to prefill the device filter. Jellyfin Media
/// Player reports the Windows computer name by default, so this is usually
/// the right answer — but it is configurable in JMP, and a browser session
/// reports the browser instead, which is why the field stays editable and the
/// Test button lists what the server actually sees.
pub fn local_device_name() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMPUTERNAME").unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        std::fs::read_to_string("/etc/hostname")
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JellyfinSettings {
    pub url: String,
    /// Whether an access token is stored. The token itself is never returned —
    /// it stays in the credential store, like the AniList token.
    pub connected: bool,
    /// The signed-in account, so Settings can show who that is.
    pub user_name: String,
    pub device: String,
    /// This machine's name, so the UI can offer it as the default.
    pub local_device: String,
}

#[tauri::command]
pub fn get_jellyfin_settings(db: State<'_, Db>) -> JellyfinSettings {
    JellyfinSettings {
        url: db.kv_get("jellyfin_url").unwrap_or_default(),
        connected: crate::detection::jellyfin::load_token().is_some()
            && db
                .kv_get("jellyfin_user_id")
                .is_some_and(|u| !u.trim().is_empty()),
        user_name: db.kv_get("jellyfin_user_name").unwrap_or_default(),
        device: db
            .kv_get("jellyfin_device")
            .unwrap_or_else(local_device_name),
        local_device: local_device_name(),
    }
}

/// Saves the settings that aren't part of signing in.
#[tauri::command]
pub fn set_jellyfin_settings(
    db: State<'_, Db>,
    url: String,
    device: String,
) -> Result<(), String> {
    db.kv_set(
        "jellyfin_url",
        &crate::detection::jellyfin::normalize_base_url(&url),
    )?;
    db.kv_set("jellyfin_device", device.trim())?;
    Ok(())
}

/// Exchanges a username and password for an access token.
///
/// The password is used for this one request and then dropped — only the token
/// and the account's own id are stored. Signing in as a user rather than with
/// an admin API key is what makes the server scope `/Sessions` to this account
/// (see the module docs in `detection::jellyfin`).
#[tauri::command]
pub async fn jellyfin_sign_in(
    db: State<'_, Db>,
    url: String,
    username: String,
    password: String,
) -> Result<JellyfinSettings, String> {
    let base = crate::detection::jellyfin::normalize_base_url(&url);
    let (device_name, device_id) = {
        (local_device_name(), jellyfin_device_id(&db))
    };

    let session = crate::detection::jellyfin::authenticate(
        &base,
        &username,
        &password,
        &device_name,
        &device_id,
    )
    .await?;

    db.kv_set("jellyfin_url", &base)?;
    db.kv_set("jellyfin_user_id", &session.user_id)?;
    db.kv_set("jellyfin_user_name", &session.user_name)?;
    crate::detection::jellyfin::save_token(&session.token)?;
    // The old admin API key is useless now and grants far more on the server
    // than Karasu needs; don't leave it sitting in the credential store.
    crate::detection::jellyfin::delete_legacy_api_key();

    Ok(get_jellyfin_settings(db))
}

#[tauri::command]
pub fn jellyfin_sign_out(db: State<'_, Db>) -> Result<JellyfinSettings, String> {
    crate::detection::jellyfin::delete_token()?;
    crate::detection::jellyfin::delete_legacy_api_key();
    db.kv_delete("jellyfin_user_id");
    db.kv_delete("jellyfin_user_name");
    Ok(get_jellyfin_settings(db))
}

/// Lists the sessions the server reports, flagging which ones the device
/// filter accepts.
///
/// The server now returns only the signed-in account's own sessions, so this
/// no longer shows anyone else's playback. It still shows *non-matching* ones,
/// because the device filter is otherwise undiagnosable: a device name one
/// character off looks identical to "nothing is playing", and this is the only
/// way to discover what Jellyfin calls a machine.
#[tauri::command]
pub async fn test_jellyfin(
    db: State<'_, Db>,
) -> Result<Vec<crate::detection::jellyfin::SessionSummary>, String> {
    let cfg = jellyfin_config(&db).ok_or("Sign in to your Jellyfin server first")?;
    crate::detection::jellyfin::list_sessions(&cfg).await
}

/// Every media session Windows currently knows about, for the Settings
/// diagnostic. Players fill these fields inconsistently, so this is the only
/// honest way to see why something was or wasn't detected.
#[tauri::command]
pub async fn smtc_sessions() -> Vec<crate::detection::smtc::SmtcSession> {
    // Blocking WinRT work: off the main thread, like the detection loop.
    tokio::task::spawn_blocking(crate::detection::smtc::sessions)
        .await
        .unwrap_or_default()
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

// --- Display scaling ---------------------------------------------------------

/// Windows' Accessibility → Text size setting, as a multiplier (1.0 = 100%).
///
/// Display scaling needs nothing from us — WebView2 already applies it, so a
/// CSS pixel is a scaled pixel. The text-size slider is separate and the
/// WebView does *not* honour it, so the frontend reads this once at startup
/// and sets the root font size. Anything unexpected returns 1.0: an
/// accessibility preference is not worth failing a launch over.
#[tauri::command]
pub fn get_text_scale() -> f64 {
    #[cfg(windows)]
    {
        use windows::UI::ViewManagement::UISettings;
        if let Ok(settings) = UISettings::new() {
            if let Ok(scale) = settings.TextScaleFactor() {
                // The slider tops out at 225%; clamp anyway so a bogus value
                // can't render the app unusable.
                return scale.clamp(1.0, 2.25);
            }
        }
    }
    1.0
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
pub const COMMIT_NUMBER: u32 = 130;

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

/// Content filter level: `"off"`, `"moderate"` (hide adult) or `"strict"`
/// (also hide suggestive/Ecchi). Defaults to `"strict"`, so a missing key —
/// a fresh install or an existing one upgrading — starts filtered.
pub fn read_content_filter(db: &Db) -> String {
    match db.kv_get("content_filter").as_deref() {
        Some("off") => "off".to_string(),
        Some("moderate") => "moderate".to_string(),
        _ => "strict".to_string(),
    }
}

/// Mirror of the frontend's `isBlocked` for the background passes (airing /
/// sequel notifications, Discord presence), which never touch React. Takes a
/// media JSON node so every caller can hand over whatever it already parsed.
pub fn media_blocked(media: &serde_json::Value, level: &str) -> bool {
    if level == "off" {
        return false;
    }
    if media["isAdult"].as_bool() == Some(true) {
        return true;
    }
    if level != "strict" {
        return false;
    }
    media["genres"]
        .as_array()
        .map(|gs| {
            gs.iter()
                .filter_map(|g| g.as_str())
                .any(|g| g.eq_ignore_ascii_case("ecchi"))
        })
        .unwrap_or(false)
}

/// Whether a media id on the user's cached list is filtered. Used by the
/// Discord presence, which only knows the id of what is playing.
pub fn media_id_blocked(db: &Db, media_id: i64, level: &str) -> bool {
    if level == "off" {
        return false;
    }
    let Some(user_id) = db
        .kv_get("anilist_viewer")
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["id"].as_i64())
    else {
        return false;
    };
    for media_type in ["ANIME", "MANGA"] {
        let Some(payload) = db.cached_list(user_id, media_type) else {
            continue;
        };
        let Ok(lists) = serde_json::from_str::<serde_json::Value>(&payload) else {
            continue;
        };
        for group in lists.as_array().into_iter().flatten() {
            for entry in group["entries"].as_array().into_iter().flatten() {
                if entry["media"]["id"].as_i64() == Some(media_id) {
                    return media_blocked(&entry["media"], level);
                }
            }
        }
    }
    false
}

#[tauri::command]
pub fn get_content_filter(db: State<'_, Db>) -> String {
    read_content_filter(&db)
}

#[tauri::command]
pub fn set_content_filter(db: State<'_, Db>, level: String) -> Result<(), String> {
    if level != "off" && level != "moderate" && level != "strict" {
        return Err("Unknown content filter level".into());
    }
    db.kv_set("content_filter", &level)
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

/// Human-facing release page for `channel`, linked from the About card.
fn update_channel_release_url(channel: &str) -> &'static str {
    match channel {
        "stable" => "https://github.com/Kyusetzu/Karasu/releases/latest",
        _ => "https://github.com/Kyusetzu/Karasu/releases/tag/latest",
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

    // Read the version from `latest.json`, not from the release's tag name.
    // The prerelease channel publishes to a rolling tag literally called
    // "latest", which `version_gt` parses as 0 — so a tag-based comparison can
    // never report an update. The manifest carries the real four-part version
    // (see scripts/generate-update-manifest.ps1) and is what the updater
    // downloads from anyway.
    let resp = reqwest::Client::new()
        .get(update_channel_manifest_url(&channel))
        .header("User-Agent", concat!("Karasu/", env!("CARGO_PKG_VERSION")))
        .send()
        .await
        .map_err(|e| format!("Update check failed: {e}"))?;

    // No release published yet on this channel — treat as "up to date".
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo { current, latest: None, url: None, is_newer: false });
    }
    if !resp.status().is_success() {
        return Err(format!("Update check failed: HTTP {}", resp.status()));
    }

    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let latest = body
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("Update manifest has no version")?
        .trim_start_matches('v')
        .to_string();
    let is_newer = version_gt(&latest, &current);
    Ok(UpdateInfo {
        current,
        latest: Some(display_version(&latest)),
        url: Some(update_channel_release_url(&channel).to_string()),
        is_newer,
    })
}

/// Splits a version into numeric segments, treating `+` exactly like `.`.
///
/// `latest.json` carries the commit number as semver build metadata
/// (`0.23.2+90`) rather than a fourth dotted segment, because the updater
/// plugin parses that field as strict semver. Both spellings have to compare
/// identically here, so the running `0.23.2.90` lines up with the manifest.
fn version_parts(s: &str) -> Vec<u32> {
    s.split(['.', '+'])
        .map(|p| p.parse::<u32>().unwrap_or(0))
        .collect()
}

/// The four-part version in its display form, whatever separator it arrived
/// with — the UI has always shown `MAJOR.MINOR.PATCH.COMMIT#`.
fn display_version(s: &str) -> String {
    s.replace('+', ".")
}

/// True if dotted-numeric version `a` is strictly greater than `b`.
fn version_gt(a: &str, b: &str) -> bool {
    let (va, vb) = (version_parts(a), version_parts(b));
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
    use super::{display_version, version_gt};

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

    /// Why `check_for_updates` reads the manifest instead of the release tag.
    /// The prerelease channel publishes to a rolling tag literally named
    /// "latest", which parses to 0 here — so a tag-based comparison silently
    /// reported "up to date" forever. Feeding a version string in still has to
    /// work, so both halves are pinned.
    #[test]
    fn non_numeric_tag_never_reports_an_update() {
        assert!(!version_gt("latest", "0.19.2.82"));
        assert!(version_gt("0.19.3.83", "0.19.2.82"));
    }

    /// `latest.json` spells the commit number as semver build metadata
    /// (`0.23.2+90`) because tauri-plugin-updater parses that field as strict
    /// semver and a fourth dotted segment makes it fail to deserialize —
    /// which is what broke installing with "unexpected character '.' after
    /// patch version number". The two spellings must compare identically.
    #[test]
    fn build_metadata_reads_as_the_fourth_segment() {
        assert!(version_gt("0.23.2+90", "0.23.1.89"));
        assert!(version_gt("0.23.1+90", "0.23.1.89"));
        assert!(!version_gt("0.23.1+89", "0.23.1.89"));
        assert!(!version_gt("0.23.1+88", "0.23.1.89"));
        // A commit-only bump is still an update.
        assert!(version_gt("0.23.1+90", "0.23.1+89"));
    }

    /// The comparator handed to tauri-plugin-updater. The case that matters
    /// most is the *equal* one: the plugin's own `current_version` comes from
    /// Cargo.toml and has no commit number, so without this the manifest for
    /// the running build would sort above it and the app would reinstall
    /// itself on a loop.
    #[test]
    fn remote_is_newer_uses_the_running_commit_number() {
        use super::{remote_is_newer, COMMIT_NUMBER};
        let running = (0u64, 23u64, 2u64);
        let n = COMMIT_NUMBER as u64;

        assert!(!remote_is_newer((0, 23, 2, n), running), "same build");
        assert!(!remote_is_newer((0, 23, 2, n - 1), running), "older commit");
        assert!(!remote_is_newer((0, 23, 2, 0), running), "no build metadata");
        assert!(remote_is_newer((0, 23, 2, n + 1), running), "newer commit");
        assert!(remote_is_newer((0, 24, 0, 0), running), "newer minor");
        assert!(!remote_is_newer((0, 22, 9, n + 5), running), "older minor");
    }

    /// The About page has always shown MAJOR.MINOR.PATCH.COMMIT#; the manifest
    /// separator is an implementation detail and must not leak into the UI.
    #[test]
    fn versions_display_with_dots() {
        assert_eq!(display_version("0.23.2+90"), "0.23.2.90");
        assert_eq!(display_version("0.23.2.90"), "0.23.2.90");
    }

    /// Must stay in lockstep with `isBlocked` in src/lib/contentFilter.ts —
    /// the background passes would otherwise notify about titles the UI hides.
    #[test]
    fn content_filter_levels() {
        use super::media_blocked;
        use serde_json::json;

        let adult = json!({ "isAdult": true, "genres": ["Hentai"] });
        let ecchi = json!({ "isAdult": false, "genres": ["Comedy", "Ecchi"] });
        let plain = json!({ "isAdult": false, "genres": ["Action"] });

        for m in [&adult, &ecchi, &plain] {
            assert!(!media_blocked(m, "off"));
        }

        assert!(media_blocked(&adult, "moderate"));
        assert!(!media_blocked(&ecchi, "moderate"));
        assert!(!media_blocked(&plain, "moderate"));

        assert!(media_blocked(&adult, "strict"));
        assert!(media_blocked(&ecchi, "strict"));
        assert!(!media_blocked(&plain, "strict"));

        // Case-insensitive, and missing fields must not block.
        assert!(media_blocked(&json!({ "genres": ["ECCHI"] }), "strict"));
        assert!(!media_blocked(&json!({}), "strict"));
    }
}

// --- In-app updater ------------------------------------------------------------

/// Whether a manifest's `(major, minor, patch, commit)` is newer than the
/// running build, whose commit number is `COMMIT_NUMBER` rather than anything
/// the plugin can see (see the comparator in `download_pending_update`).
///
/// Split out from the closure so the comparison is testable without
/// constructing a `semver::Version`.
fn remote_is_newer(remote: (u64, u64, u64, u64), current_core: (u64, u64, u64)) -> bool {
    let (major, minor, patch) = current_core;
    remote > (major, minor, patch, COMMIT_NUMBER as u64)
}

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
        // Without this the app would re-offer the build it is already running,
        // forever. The plugin's default is `remote > current` using semver's
        // *derived* Ord, which does compare build metadata — but its
        // `current_version` comes from `package_info()`, i.e. Cargo.toml, which
        // carries only `MAJOR.MINOR.PATCH` and no commit number at all. So the
        // running 0.23.2.90 arrives here as a bare `0.23.2`, and any manifest
        // with build metadata (`0.23.2+90` — the very same build) sorts above
        // it: download, restart, repeat.
        //
        // COMMIT_NUMBER is a compile-time const in this file, so supplying the
        // running commit number here is exact rather than reconstructed.
        .version_comparator(|current, release| {
            remote_is_newer(
                (
                    release.version.major,
                    release.version.minor,
                    release.version.patch,
                    release.version.build.as_str().parse::<u64>().unwrap_or(0),
                ),
                (current.major, current.minor, current.patch),
            )
        })
        .build()
        .map_err(|e| e.to_string())?;

    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    let version = display_version(&update.version);
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
