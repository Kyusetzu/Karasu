use crate::db::Db;
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

/// Currently detected playback (poll loop state).
#[tauri::command]
pub fn get_now_playing(
    state: State<'_, crate::playback::scrobbler::PlaybackState>,
) -> Option<crate::playback::scrobbler::NowPlaying> {
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

/// Still spelled `smtc_enabled`, deliberately. The setting is no longer
/// Windows-only, but renaming the key would silently reset every existing
/// user's opt-out back to on — a migration is more code than the wart is
/// worth.
const MEDIA_DETECTION_KEY: &str = "smtc_enabled";

/// Whether the system media-session pass runs (SMTC on Windows, MPRIS on
/// Linux). Default on, same opt-out idiom as the other detection settings.
pub(crate) fn read_media_detection(db: &Db) -> bool {
    db.kv_get(MEDIA_DETECTION_KEY).as_deref() != Some("0")
}

#[tauri::command]
pub fn get_media_detection(db: State<'_, Db>) -> bool {
    read_media_detection(&db)
}

/// The raw setter, for callers without a `State` handle — the tray toggle.
pub(crate) fn write_media_detection(db: &Db, enabled: bool) -> Result<(), String> {
    db.kv_set(MEDIA_DETECTION_KEY, if enabled { "1" } else { "0" })
}

#[tauri::command]
pub fn set_media_detection(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    write_media_detection(&db, enabled)
}

/// Everything the Jellyfin source needs, or `None` when it isn't fully
/// configured. A missing user id is treated as "not configured" on purpose,
/// so the source fails closed rather than falling back to something broader.
pub(crate) fn jellyfin_config(
    db: &Db,
) -> Option<crate::playback::detection::jellyfin::JellyfinConfig> {
    let url = db.kv_get("jellyfin_url").filter(|u| !u.trim().is_empty())?;
    let token = crate::playback::detection::jellyfin::load_token()?;
    let user_id = db
        .kv_get("jellyfin_user_id")
        .filter(|u| !u.trim().is_empty())?;
    Some(crate::playback::detection::jellyfin::JellyfinConfig {
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
        connected: crate::playback::detection::jellyfin::load_token().is_some()
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
        &crate::playback::detection::jellyfin::normalize_base_url(&url),
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
    let base = crate::playback::detection::jellyfin::normalize_base_url(&url);
    let (device_name, device_id) = {
        (local_device_name(), jellyfin_device_id(&db))
    };

    let session = crate::playback::detection::jellyfin::authenticate(
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
    crate::playback::detection::jellyfin::save_token(&session.token)?;
    // The old admin API key is useless now and grants far more on the server
    // than Karasu needs; don't leave it sitting in the credential store.
    crate::playback::detection::jellyfin::delete_legacy_api_key();

    Ok(get_jellyfin_settings(db))
}

#[tauri::command]
pub fn jellyfin_sign_out(db: State<'_, Db>) -> Result<JellyfinSettings, String> {
    crate::playback::detection::jellyfin::delete_token()?;
    crate::playback::detection::jellyfin::delete_legacy_api_key();
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
) -> Result<Vec<crate::playback::detection::jellyfin::SessionSummary>, String> {
    let cfg = jellyfin_config(&db).ok_or("Sign in to your Jellyfin server first")?;
    crate::playback::detection::jellyfin::list_sessions(&cfg).await
}

/// Every media session the desktop currently knows about, for the Settings
/// diagnostic. Players fill these fields inconsistently, so this is the only
/// honest way to see why something was or wasn't detected.
#[tauri::command]
pub async fn media_sessions() -> Vec<crate::playback::detection::media_session::MediaSession> {
    // Blocking WinRT / D-Bus work: off the main thread, like the detection loop.
    tokio::task::spawn_blocking(crate::playback::detection::media_session::sessions)
        .await
        .unwrap_or_default()
}

/// Confirms the pending auto-update immediately (also from Blocked).
#[tauri::command]
pub async fn scrobble_now(app: tauri::AppHandle) -> Result<(), String> {
    crate::playback::scrobbler::confirm_pending(app, true).await
}

/// Discards the pending auto-update for this episode.
#[tauri::command]
pub async fn scrobble_cancel(app: tauri::AppHandle) -> Result<(), String> {
    crate::playback::scrobbler::confirm_pending(app, false).await
}
