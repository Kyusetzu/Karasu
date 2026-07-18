use crate::anilist::{
    auth,
    client::{AniList, ApiError},
};
use crate::db::Db;
use serde_json::{json, Value};
use tauri::{Manager, State};

/// Eingebaute AniList-Client-ID (Taiga-Prinzip: eine geteilte App für alle
/// Nutzer; die ID ist öffentlich, kein Secret). Leer = Nutzer brauchen eine
/// eigene Client-ID. Wird vom Maintainer einmalig eingetragen.
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
    /// true, wenn eine Client-ID einkompiliert ist (Login ohne Setup möglich)
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

/// Validiert den eingefügten Token gegen die Viewer-Query und speichert ihn
/// im Windows Credential Manager. Gibt das Viewer-Objekt zurück.
#[tauri::command]
pub async fn anilist_connect(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    token: String,
) -> Result<Value, String> {
    // Akzeptiert rohen Token ebenso wie die komplette Redirect-URL
    let token = auth::extract_token(&token);
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

/// Gibt den gecachten Viewer zurück, wenn ein Token gespeichert ist —
/// ohne API-Call, damit der App-Start offline und ratelimit-schonend ist.
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

/// Generischer GraphQL-Proxy: Das Frontend definiert Query + Variablen,
/// das Backend hängt den Token an und übernimmt das Rate-Limiting.
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

// --- Anime-Liste: Laden mit Cache, Mutations mit Offline-Queue --------------

const LIST_QUERY: &str = "
query ($userId: Int!) {
  MediaListCollection(userId: $userId, type: ANIME) {
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
          title { romaji english native }
          coverImage { large extraLarge }
          bannerImage
          episodes
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
    /// true, wenn die Daten aus dem lokalen Cache stammen (offline)
    #[serde(rename = "fromCache")]
    from_cache: bool,
    /// Anzahl noch nicht synchronisierter Änderungen
    pending: usize,
    lists: Value,
}

/// Lädt die Anime-Liste; offline wird der letzte Stand aus SQLite geliefert.
/// Vor dem Laden wird versucht, die Offline-Queue abzuarbeiten, damit der
/// Server-Stand die eigenen Änderungen enthält.
#[tauri::command]
pub async fn fetch_anime_list(
    db: State<'_, Db>,
    api: State<'_, AniList>,
    user_id: i64,
) -> Result<ListResult, String> {
    let token = auth::load_token();
    let _ = process_queue(&db, &api, token.as_deref()).await;

    match api
        .query(token.as_deref(), LIST_QUERY, json!({ "userId": user_id }))
        .await
    {
        Ok(data) => {
            let lists = data
                .pointer("/MediaListCollection/lists")
                .cloned()
                .unwrap_or_else(|| json!([]));
            let _ = db.cache_list(user_id, &lists.to_string());
            Ok(ListResult {
                from_cache: false,
                pending: db.queue_len(),
                lists,
            })
        }
        Err(ApiError::Network(_)) => {
            let cached = db
                .cached_list(user_id)
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
    /// true, wenn die Änderung offline in die Queue gelegt wurde
    pub(crate) queued: bool,
    pub(crate) entry: Option<Value>,
}

/// Kern des Listen-Speicherns, auch vom Scrobbler genutzt: online direkt,
/// offline in die Queue (Reihenfolge bleibt erhalten).
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

/// Speichert einen Listeneintrag (Status/Fortschritt/Score). Offline wird
/// die Änderung in die Queue gelegt und später synchronisiert.
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

/// Arbeitet die Offline-Queue in Reihenfolge ab. Netzwerkfehler brechen ab
/// (Rest bleibt liegen), API-Fehler verwerfen den Eintrag, damit die Queue
/// nicht dauerhaft blockiert.
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

/// Manuell auslösbarer Sync der Offline-Queue (z. B. Button in der UI).
#[tauri::command]
pub async fn flush_queue(
    db: State<'_, Db>,
    api: State<'_, AniList>,
) -> Result<usize, String> {
    let token = auth::load_token().ok_or("Not connected to AniList")?;
    process_queue(&db, &api, Some(&token)).await
}

/// Aktuell erkannte Wiedergabe (Poll-Loop-Zustand).
#[tauri::command]
pub fn get_now_playing(
    state: State<'_, crate::scrobbler::PlaybackState>,
) -> Option<crate::scrobbler::NowPlaying> {
    state.0.lock().unwrap().clone()
}

// --- Scrobbler-Einstellungen und -Steuerung ---------------------------------

#[derive(serde::Serialize)]
pub struct ScrobbleSettings {
    pub enabled: bool,
    /// true = vor dem Update Bestätigung in der UI verlangen
    pub confirm: bool,
    /// Schwelle in Minuten; 0 = automatisch (2/3 der Episodenlänge)
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
    /// true, wenn eine Application-ID einkompiliert ist
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
    // Presence sofort an den neuen Zustand anpassen
    let now = app
        .state::<crate::scrobbler::PlaybackState>()
        .0
        .lock()
        .unwrap()
        .clone();
    crate::discord::sync(&app, now.as_ref());
    Ok(())
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

/// Bestätigt das anstehende Auto-Update sofort (auch bei Blocked).
#[tauri::command]
pub async fn scrobble_now(app: tauri::AppHandle) -> Result<(), String> {
    crate::scrobbler::confirm_pending(app, true).await
}

/// Verwirft das anstehende Auto-Update für diese Episode.
#[tauri::command]
pub async fn scrobble_cancel(app: tauri::AppHandle) -> Result<(), String> {
    crate::scrobbler::confirm_pending(app, false).await
}
