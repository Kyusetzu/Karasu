use crate::db::Db;
use crate::sync::LockExt;
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
    state.0.guard().clone()
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
    /// Whether an episode-gap block lifts itself after the grace period —
    /// off by default: writing past a gap is a choice, and the default
    /// choice is asking.
    #[serde(rename = "gapAuto")]
    pub gap_auto: bool,
}

pub(crate) fn read_scrobble_settings(db: &Db) -> ScrobbleSettings {
    ScrobbleSettings {
        enabled: db.kv_get("scrobble_enabled").as_deref() != Some("0"),
        confirm: db.kv_get("scrobble_confirm").as_deref() == Some("1"),
        delay_min: db
            .kv_get("scrobble_delay_min")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        gap_auto: db.kv_get("scrobble_gap_auto").as_deref() == Some("1"),
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
    gap_auto: bool,
) -> Result<(), String> {
    db.kv_set("scrobble_enabled", if enabled { "1" } else { "0" })?;
    db.kv_set("scrobble_confirm", if confirm { "1" } else { "0" })?;
    db.kv_set("scrobble_delay_min", &delay_min.to_string())?;
    db.kv_set("scrobble_gap_auto", if gap_auto { "1" } else { "0" })
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

// --- mpv IPC ----------------------------------------------------------------

/// Opt-in, unlike the media-session pass: probing a pipe name the user never
/// configured, every five seconds, would be waste dressed as a feature.
const MPV_IPC_ENABLED_KEY: &str = "mpv_ipc_enabled";
const MPV_IPC_PATH_KEY: &str = "mpv_ipc_path";

/// Whether a stored path can be a pipe at all.
///
/// On Windows the check earns its keep twice: `ClientOptions::open` is an
/// `OPEN_EXISTING` `CreateFileW` that will happily open an ordinary *file* of
/// that name and then hand it to `NamedPipeClient::from_raw_handle`, whose
/// `unsafe` precondition is that the handle really is a pipe client; and a
/// UNC or network path is the one shape whose synchronous connect can stall
/// the detection loop past the probe's timeout (see the `mpv_ipc` header).
/// Pure, so it is tested on both platforms.
pub(crate) fn is_pipe_path(path: &str) -> bool {
    let path = path.trim();
    if path.is_empty() {
        return false;
    }
    if cfg!(windows) {
        // `\\.\pipe\name` — the local named-pipe namespace, and only it.
        let lower = path.to_lowercase().replace('/', "\\");
        lower.starts_with(r"\\.\pipe\") && lower.len() > r"\\.\pipe\".len()
    } else {
        // A unix socket is an ordinary filesystem path; absolute only, so a
        // relative name cannot resolve against whatever the cwd happens to be.
        path.starts_with('/')
    }
}

pub(crate) fn mpv_ipc_config(
    db: &Db,
) -> Option<crate::playback::detection::mpv_ipc::MpvConfig> {
    if db.kv_get(MPV_IPC_ENABLED_KEY).as_deref() != Some("1") {
        return None;
    }
    let path = db
        .kv_get(MPV_IPC_PATH_KEY)
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| crate::playback::detection::mpv_ipc::default_pipe());
    if !is_pipe_path(&path) {
        crate::logging::debug_changed(
            "mpv",
            "path",
            format!("{path:?} cannot be an IPC pipe; the source stays off"),
        );
        return None;
    }
    Some(crate::playback::detection::mpv_ipc::MpvConfig { path })
}

/// The player binary the library launches with the IPC pipe. Empty keeps the
/// default-player contract — that fork is deliberate and the setting is its
/// only door.
const MPV_LAUNCH_KEY: &str = "mpv_launch_path";

/// `(player binary, pipe path)` for a library launch, or `None` to open with
/// the default player. The pipe comes back with the binary because launching
/// mpv *with* `--input-ipc-server` is the whole point: Karasu knowing the
/// name up front beats discovering a running instance.
pub(crate) fn mpv_launch_config(db: &Db) -> Option<(String, String)> {
    let player = db.kv_get(MPV_LAUNCH_KEY).filter(|p| !p.trim().is_empty())?;
    let pipe = db
        .kv_get(MPV_IPC_PATH_KEY)
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(|| crate::playback::detection::mpv_ipc::default_pipe());
    Some((player, pipe))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvIpcSettings {
    pub enabled: bool,
    /// The effective path — the stored one, or the platform default.
    pub path: String,
    /// What the settings hint tells the user to put in `mpv.conf`.
    pub default_path: String,
    /// The player binary for library launches, empty for the default player.
    pub launch_path: String,
}

#[tauri::command]
pub fn get_mpv_ipc(db: State<'_, Db>) -> MpvIpcSettings {
    let default_path = crate::playback::detection::mpv_ipc::default_pipe();
    MpvIpcSettings {
        enabled: db.kv_get(MPV_IPC_ENABLED_KEY).as_deref() == Some("1"),
        path: db
            .kv_get(MPV_IPC_PATH_KEY)
            .filter(|p| !p.trim().is_empty())
            .unwrap_or_else(|| default_path.clone()),
        default_path,
        launch_path: db.kv_get(MPV_LAUNCH_KEY).unwrap_or_default(),
    }
}

#[tauri::command]
pub fn set_mpv_ipc(
    db: State<'_, Db>,
    enabled: bool,
    path: String,
    launch_path: String,
) -> Result<(), String> {
    db.kv_set(MPV_IPC_ENABLED_KEY, if enabled { "1" } else { "0" })?;
    db.kv_set(MPV_IPC_PATH_KEY, path.trim())?;
    db.kv_set(MPV_LAUNCH_KEY, launch_path.trim())
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

/// This machine's name, used to prefill the device filter and as the
/// `Device` field of the Jellyfin auth header. Jellyfin Media Player reports
/// the Windows computer name by default, so this is usually the right
/// answer — but it is configurable in JMP, and a browser session reports the
/// browser instead, which is why the field stays editable and the Test
/// button lists what the server actually sees. The cfg'd trio below is the
/// house pattern (`protect`/`unprotect`): Android has no `/etc/hostname`,
/// and the empty string that read produced there became `Device=""` — which
/// Jellyfin answers with HTTP 400 before looking at the credentials.
pub fn local_device_name() -> String {
    raw_device_name()
}

#[cfg(windows)]
fn raw_device_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

#[cfg(all(not(windows), not(target_os = "android")))]
fn raw_device_name() -> String {
    std::fs::read_to_string("/etc/hostname")
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// `android.os.Build.MODEL` — "Pixel 8", not a hostname the platform does
/// not have. The constant fallback keeps the name non-empty even before the
/// tao context is ready; `auth_header` floors the empty case once more on
/// its own, so this is quality, not the guarantee.
#[cfg(target_os = "android")]
fn raw_device_name() -> String {
    android_device_model().unwrap_or_else(|| "Android".to_string())
}

/// `None` when the JNI context is not ready or the value is not clean
/// ASCII — the name goes into an HTTP header, where reqwest rejects
/// non-visible bytes at send time.
#[cfg(target_os = "android")]
fn android_device_model() -> Option<String> {
    let ctx = tao::platform::android::prelude::main_android_context()?;
    let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    // `Build` is a boot-classpath class, so plain `find_class` works even
    // from an attached native thread — the app-classloader dance the
    // keystore needs is only for `dev.kyu.karasu.*`.
    let got = (|| -> jni::errors::Result<String> {
        let class = env.find_class("android/os/Build")?;
        let value = env
            .get_static_field(class, "MODEL", "Ljava/lang/String;")?
            .l()?;
        Ok(env
            .get_string(&jni::objects::JString::from(value))?
            .into())
    })();
    let s = match got {
        Ok(s) => s,
        Err(_) => {
            if env.exception_check().unwrap_or(false) {
                let _ = env.exception_clear();
            }
            return None;
        }
    };
    let s = s.trim().to_string();
    (!s.is_empty() && s.chars().all(|c| c.is_ascii_graphic() || c == ' ')).then_some(s)
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
        // The *stored* value, empty included. This used to prefill the
        // machine name, which the screen puts in the field's `value` and
        // writes back on any Save or sign-in — so opening the card and
        // pressing Save silently converted "any device" into "only this PC",
        // and a browser session (DeviceName "Chrome") stopped being detected
        // with nothing on screen having been typed. `local_device` is still
        // reported and belongs in the field's *placeholder*, where a
        // suggestion cannot become a setting by itself.
        device: db.kv_get("jellyfin_device").unwrap_or_default(),
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
/// `Result`, not a bare `Vec`: an empty list and a session service that could
/// not be reached are different diagnoses, and the whole point of this command
/// is telling someone which one they have. Returning `Vec` made the frontend's
/// own `.catch` unreachable — the command could not fail — so both rendered as
/// "no media session is reporting anything".
#[tauri::command]
pub async fn media_sessions(
) -> Result<Vec<crate::playback::detection::media_session::MediaSession>, String> {
    // Blocking WinRT / D-Bus work: off the main thread, like the detection loop.
    tokio::task::spawn_blocking(crate::playback::detection::media_session::sessions_result)
        .await
        .map_err(|e| format!("Could not read the media sessions: {e}"))?
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

// --- Detection corrections ---------------------------------------------------

#[tauri::command]
pub fn list_detection_overrides(db: State<'_, Db>) -> Vec<crate::db::DetectionOverride> {
    let mut rows = db.detection_overrides();
    rows.sort_by(|a, b| a.display_title.cmp(&b.display_title));
    rows
}

/// "This is actually <media_id>." Stored against the parse, so every later
/// detection of the same title skips the guessing — and applied immediately,
/// because the poll loop only rebuilds a match when the title changes.
#[tauri::command]
pub fn set_detection_override(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    title: String,
    season: Option<u32>,
    media_type: String,
    media_id: i64,
    display_title: String,
    episode_offset: Option<i32>,
) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Nothing is playing to correct".into());
    }
    db.detection_override_set(
        title,
        crate::playback::scrobbler::season_key(season),
        &media_type,
        media_id,
        display_title.trim(),
        episode_offset.unwrap_or(0),
    )?;
    crate::playback::scrobbler::requeue_match(&app);
    Ok(())
}

/// Forgets one, giving the matcher its guess back.
#[tauri::command]
pub fn clear_detection_override(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    title: String,
    season: Option<u32>,
    media_type: String,
) -> Result<(), String> {
    let removed = db.detection_override_clear(
        title.trim(),
        crate::playback::scrobbler::season_key(season),
        &media_type,
    )?;
    if removed == 0 {
        return Err("There was no correction for that title".into());
    }
    crate::playback::scrobbler::requeue_match(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_pipe_path;

    #[test]
    fn only_a_real_pipe_shape_reaches_the_probe() {
        if cfg!(windows) {
            assert!(is_pipe_path(r"\\.\pipe\karasu-mpv"));
            // Case and slash direction are both how people really type it.
            assert!(is_pipe_path(r"\\.\PIPE\Karasu-Mpv"));
            // The bare namespace names no pipe.
            assert!(!is_pipe_path(r"\\.\pipe\"));
            // An ordinary file `OPEN_EXISTING` would gladly open, and the UNC
            // path whose connect can stall the loop.
            assert!(!is_pipe_path(r"C:\Users\Kyu\notes.txt"));
            assert!(!is_pipe_path(r"\\server\share\pipe\karasu-mpv"));
        } else {
            assert!(is_pipe_path("/tmp/karasu-mpv"));
            assert!(!is_pipe_path("karasu-mpv"));
        }
        assert!(!is_pipe_path(""));
        assert!(!is_pipe_path("   "));
    }
}
