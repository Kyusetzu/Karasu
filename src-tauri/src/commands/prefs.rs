use crate::db::Db;
use crate::sync::LockExt;
use tauri::{Manager, State};

// Siblings in the same module tree; `mod.rs` re-exports all of it, so every command keeps its old path.
#[allow(unused_imports)]
use super::*;

#[derive(serde::Serialize, specta::Type)]
pub struct DiscordSettings {
    pub enabled: bool,
    #[serde(rename = "appId")]
    pub app_id: String,
    /// true if an application ID is compiled in
    #[serde(rename = "hasBuiltinAppId")]
    pub has_builtin_app_id: bool,
}

#[tauri::command]
#[specta::specta]
pub fn get_discord_settings(db: State<'_, Db>) -> DiscordSettings {
    DiscordSettings {
        enabled: db.kv_get("discord_enabled").as_deref() == Some("1"),
        app_id: db.kv_get("discord_app_id").unwrap_or_default(),
        has_builtin_app_id: !crate::discord::BUILTIN_DISCORD_APP_ID.is_empty(),
    }
}

#[tauri::command]
#[specta::specta]
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
        .guard()
        .clone();
    crate::discord::sync(&app, now.as_ref());
    Ok(())
}

/// Mirrors the interface language into kv, because Rust composes notifications, bell rows and the tray menu.
#[tauri::command]
#[specta::specta]
pub fn set_ui_language(app: tauri::AppHandle, db: State<'_, Db>, language: String) -> Result<(), String> {
    db.kv_set(crate::i18n::LANGUAGE_KEY, &language)?;
    // The widget projection carries pre-rendered labels in this language.
    crate::widgets::refresh(&app);
    // The tray's labels are set once at launch; the title is cloned out first so no guard is held into the call.
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
#[specta::specta]
pub fn get_airing_notify(db: State<'_, Db>) -> bool {
    db.kv_get("airing_notify").as_deref() != Some("0")
}

#[tauri::command]
#[specta::specta]
pub fn set_airing_notify(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("airing_notify", if enabled { "1" } else { "0" })
}

#[derive(serde::Serialize, specta::Type)]
pub struct StaleSettings {
    enabled: bool,
    #[specta(type = crate::commands::Num)]
    months: i64,
}

/// On-hold reminder settings (disabled by default).
#[tauri::command]
#[specta::specta]
pub fn get_stale_settings(db: State<'_, Db>) -> StaleSettings {
    StaleSettings {
        enabled: db.kv_get("stale_notify").as_deref() == Some("1"),
        months: crate::alerts::stale::stale_months(&db),
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_stale_settings(
    db: State<'_, Db>,
    enabled: bool,
    months: crate::commands::Num,
) -> Result<(), String> {
    let months = months.0;
    db.kv_set("stale_notify", if enabled { "1" } else { "0" })?;
    db.kv_set("stale_months", &months.clamp(1, 24).to_string())
}

/// The background-notification interval in minutes, 0 meaning off; one kv key both platforms read.
#[tauri::command]
#[specta::specta]
pub fn get_notif_schedule(db: State<'_, Db>) -> crate::commands::Num {
    crate::commands::Num(crate::alerts::site::interval_min(&db))
}

#[tauri::command]
#[specta::specta]
pub fn set_notif_schedule(db: State<'_, Db>, minutes: crate::commands::Num) -> Result<(), String> {
    let minutes = minutes.0;
    // Clamped on write as well as on read, the stale_months discipline.
    let clamped = if minutes <= 0 {
        0
    } else {
        minutes.clamp(
            crate::alerts::site::INTERVAL_MIN,
            crate::alerts::site::INTERVAL_MAX,
        )
    };
    // Stored first and unconditionally: `spawn_schedule_assert` retries a failed schedule at every start.
    db.kv_set(crate::alerts::site::INTERVAL_KEY, &clamped.to_string())?;
    // The failure is still reported, or a refused job leaves the pane claiming a schedule nobody registered.
    reassert_notif_job(clamped)
}

/// The stable code a failed reschedule is reported under; `src/lib/notifSchedule.ts` turns it into the toast.
#[cfg(target_os = "android")]
const NOTIF_JOB_REFUSED: &str = "settings.notifJobRefused";

/// Cfg'd pair: Android mirrors the setting into its JobScheduler; elsewhere the in-app pass reads kv itself.
#[cfg(target_os = "android")]
fn reassert_notif_job(minutes: i64) -> Result<(), String> {
    crate::background::assert_schedule(minutes).map_err(|e| {
        crate::logging::warn("prefs", format!("job reschedule failed: {e}"));
        format!("{NOTIF_JOB_REFUSED}: {e}")
    })
}

#[cfg(not(target_os = "android"))]
fn reassert_notif_job(_minutes: i64) -> Result<(), String> {
    Ok(())
}

/// Whether sequel-announcement notifications are enabled (default off).
#[tauri::command]
#[specta::specta]
pub fn get_sequel_notify(db: State<'_, Db>) -> bool {
    db.kv_get("sequel_notify").as_deref() == Some("1")
}

#[tauri::command]
#[specta::specta]
pub fn set_sequel_notify(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("sequel_notify", if enabled { "1" } else { "0" })
}

/// Content filter level, `off`, `moderate` (hide adult) or `strict` (also Ecchi); a missing key means strict.
pub fn read_content_filter(db: &Db) -> String {
    match db.kv_get("content_filter").as_deref() {
        Some("off") => "off".to_string(),
        Some("moderate") => "moderate".to_string(),
        _ => "strict".to_string(),
    }
}

/// Mirror of the frontend's `isBlocked` for the background passes, over whatever media JSON the caller has.
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

/// Whether a media id on the cached list is filtered, for the Discord presence that only knows the id.
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
#[specta::specta]
pub fn get_content_filter(db: State<'_, Db>) -> String {
    read_content_filter(&db)
}

/// Whether explicit artwork the level let through is blurred until clicked; defaults on, since a blur costs one click.
const BLUR_ADULT_KEY: &str = "blur_adult";

#[tauri::command]
#[specta::specta]
pub fn get_blur_adult(db: State<'_, Db>) -> bool {
    db.kv_get(BLUR_ADULT_KEY).as_deref() != Some("0")
}

#[tauri::command]
#[specta::specta]
pub fn set_blur_adult(app: tauri::AppHandle, db: State<'_, Db>, blur: bool) -> Result<(), String> {
    db.kv_set(BLUR_ADULT_KEY, if blur { "1" } else { "0" })?;
    // The widgets hide what this blurs — a home screen cannot blur.
    crate::widgets::refresh(&app);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_content_filter(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    level: String,
) -> Result<(), String> {
    if level != "off" && level != "moderate" && level != "strict" {
        return Err("Unknown content filter level".into());
    }
    db.kv_set("content_filter", &level)?;
    // Otherwise a blocked title lingers on the home screen until the next list fetch rewrites the projection.
    crate::widgets::refresh(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The same three answers `lib/contentFilter`'s `isBlocked` gives, so a background pass hides what the screens hide.
    #[test]
    fn media_blocked_mirrors_the_frontend_rule() {
        let adult = json!({ "isAdult": true, "genres": ["Action"] });
        let ecchi = json!({ "isAdult": false, "genres": ["Comedy", "Ecchi"] });
        let plain = json!({ "isAdult": false, "genres": ["Drama"] });
        for level in ["off", "moderate", "strict"] {
            assert!(!media_blocked(&plain, level), "plain at {level}");
        }
        assert!(!media_blocked(&adult, "off"));
        assert!(media_blocked(&adult, "moderate"));
        assert!(media_blocked(&adult, "strict"));
        assert!(!media_blocked(&ecchi, "moderate"));
        assert!(media_blocked(&ecchi, "strict"));
    }

    #[test]
    fn media_blocked_reads_the_genre_case_insensitively_and_survives_missing_fields() {
        assert!(media_blocked(&json!({ "genres": ["ECCHI"] }), "strict"));
        assert!(!media_blocked(&json!({}), "strict"));
        assert!(!media_blocked(&json!({ "genres": "Ecchi" }), "strict"));
    }

    /// A missing or unknown value is strict, so a corrupted key can only hide more, never less.
    #[test]
    fn the_stored_level_defaults_to_strict() {
        let db = crate::db::tests::mem_db();
        assert_eq!(read_content_filter(&db), "strict");
        db.kv_set("content_filter", "off").unwrap();
        assert_eq!(read_content_filter(&db), "off");
        db.kv_set("content_filter", "moderate").unwrap();
        assert_eq!(read_content_filter(&db), "moderate");
        db.kv_set("content_filter", "lenient").unwrap();
        assert_eq!(read_content_filter(&db), "strict");
    }

    #[test]
    fn an_unknown_id_or_a_signed_out_database_is_never_blocked() {
        let db = crate::db::tests::mem_db();
        assert!(!media_id_blocked(&db, 1, "strict"));
        db.kv_set("anilist_viewer", r#"{"id": 7}"#).unwrap();
        assert!(!media_id_blocked(&db, 1, "strict"));
        assert!(!media_id_blocked(&db, 1, "off"));
    }
}
