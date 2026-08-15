use crate::db::Db;
use crate::sync::LockExt;
use tauri::{Manager, State};

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

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
        .state::<crate::playback::scrobbler::PlaybackState>()
        .0
        .lock()
        .unwrap()
        .clone();
    crate::discord::sync(&app, now.as_ref());
    Ok(())
}

/// Mirrors the interface language into the kv store.
///
/// The setting itself lives in the WebView's localStorage, which Rust has no
/// way to read — and Rust is what composes every desktop notification, every
/// bell row and the tray menu. Without this mirror all of them are English
/// whatever the app says around them, which is what they were.
///
/// Called on start and on every change, so it is a copy rather than a source of
/// truth: an unset or unrecognised value simply means English.
#[tauri::command]
pub fn set_ui_language(app: tauri::AppHandle, db: State<'_, Db>, language: String) -> Result<(), String> {
    db.kv_set(crate::i18n::LANGUAGE_KEY, &language)?;
    // The tray's labels are set once at launch, so it needs telling; every
    // other Rust-composed string reads the mirror at the moment it composes.
    //
    // The title is cloned out before the call, not read through a held guard:
    // `tray_set_now_playing` is somebody else's lock order and this path is not
    // worth finding that out on.
    let title = app
        .state::<crate::playback::scrobbler::PlaybackState>()
        .0
        .guard()
        .as_ref()
        .map(|n| n.matched_title.clone().unwrap_or_else(|| n.parsed_title.clone()));
    crate::tray_set_now_playing(&app, title.as_deref());
    Ok(())
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
        months: crate::alerts::stale::stale_months(&db),
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
