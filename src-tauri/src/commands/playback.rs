use crate::db::Db;
use crate::sync::LockExt;
use tauri::State;

// Siblings in the same module tree; `mod.rs` re-exports all of it, so every command keeps its old path.
#[allow(unused_imports)]
use super::*;

/// Currently detected playback (poll loop state).
#[tauri::command]
#[specta::specta]
pub fn get_now_playing(
    state: State<'_, crate::playback::scrobbler::PlaybackState>,
) -> Option<crate::playback::scrobbler::NowPlaying> {
    state.0.guard().clone()
}

// --- Scrobbler settings and control ------------------------------------------

#[derive(serde::Serialize, specta::Type)]
pub struct ScrobbleSettings {
    pub enabled: bool,
    /// true = require confirmation in the UI before updating
    pub confirm: bool,
    /// threshold in minutes; 0 = automatic (2/3 of the episode length)
    #[serde(rename = "delayMin")]
    pub delay_min: u32,
    /// Whether an episode-gap block lifts itself after the grace period; off by default, since the default is asking.
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
#[specta::specta]
pub fn get_scrobble_settings(db: State<'_, Db>) -> ScrobbleSettings {
    read_scrobble_settings(&db)
}

#[tauri::command]
#[specta::specta]
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

/// The kv key is still spelled `smtc_enabled`; renaming it would reset every user's opt-out.
const MEDIA_DETECTION_KEY: &str = "smtc_enabled";

/// Whether the system media-session pass runs (SMTC on Windows, MPRIS on Linux); default on.
pub(crate) fn read_media_detection(db: &Db) -> bool {
    db.kv_get(MEDIA_DETECTION_KEY).as_deref() != Some("0")
}

#[tauri::command]
#[specta::specta]
pub fn get_media_detection(db: State<'_, Db>) -> bool {
    read_media_detection(&db)
}

/// The raw setter, for callers without a `State` handle — the tray toggle.
pub(crate) fn write_media_detection(db: &Db, enabled: bool) -> Result<(), String> {
    db.kv_set(MEDIA_DETECTION_KEY, if enabled { "1" } else { "0" })
}

#[tauri::command]
#[specta::specta]
pub fn set_media_detection(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    write_media_detection(&db, enabled)
}

/// Everything the Jellyfin source needs, or `None` when any part is missing, so the source fails closed.
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
        external_url: db.kv_get("jellyfin_external_url").unwrap_or_default(),
        server_id: db.kv_get("jellyfin_server_id").unwrap_or_default(),
    })
}

// --- mpv IPC ----------------------------------------------------------------

/// Opt-in, unlike the media-session pass: probing a pipe the user never configured would be waste.
const MPV_IPC_ENABLED_KEY: &str = "mpv_ipc_enabled";
const MPV_IPC_PATH_KEY: &str = "mpv_ipc_path";

/// Whether a stored path can be a pipe at all; on Windows an ordinary file or a UNC path would open, and must not.
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
        // A unix socket is an ordinary filesystem path; absolute only, so nothing resolves against the cwd.
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
        .unwrap_or_else(crate::playback::detection::mpv_ipc::default_pipe);
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

/// The player binary the library launches with the IPC pipe; empty keeps the default-player contract.
const MPV_LAUNCH_KEY: &str = "mpv_launch_path";

/// `(player binary, pipe path)` for a library launch, or `None` for the default player; mpv gets the pipe up front.
pub(crate) fn mpv_launch_config(db: &Db) -> Option<(String, String)> {
    let player = db.kv_get(MPV_LAUNCH_KEY).filter(|p| !p.trim().is_empty())?;
    let pipe = db
        .kv_get(MPV_IPC_PATH_KEY)
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(crate::playback::detection::mpv_ipc::default_pipe);
    Some((player, pipe))
}

#[derive(serde::Serialize, specta::Type)]
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
#[specta::specta]
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
#[specta::specta]
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

/// A stable per-install `DeviceId` for Jellyfin, generated once so each launch does not register a new device.
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

/// This machine's name, the device-filter placeholder and the `Device` field of the Jellyfin auth header.
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

/// `android.os.Build.MODEL`, with a constant fallback so the name is never empty before the tao context is ready.
#[cfg(target_os = "android")]
fn raw_device_name() -> String {
    android_device_model().unwrap_or_else(|| "Android".to_string())
}

/// `None` when the JNI context is not ready or the value is not clean ASCII, since it goes into an HTTP header.
#[cfg(target_os = "android")]
fn android_device_model() -> Option<String> {
    let ctx = tao::platform::android::prelude::main_android_context()?;
    let vm = unsafe { jni::JavaVM::from_raw(ctx.java_vm.cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    // `Build` is a boot-classpath class, so plain `find_class` works from an attached native thread.
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

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JellyfinSettings {
    pub url: String,
    /// Whether an access token is stored; the token itself never leaves the credential store.
    pub connected: bool,
    /// The signed-in account, so Settings can show who that is.
    pub user_name: String,
    /// The server's own name from `/System/Info/Public` at sign-in; empty for a sign-in older than that probe.
    pub server_name: String,
    pub device: String,
    /// This machine's name, so the UI can offer it as the default.
    pub local_device: String,
    /// The optional second address; empty for none.
    pub external_url: String,
    /// Whether the external address has answered as the same server from here; `None` when there is none.
    pub external_verified: Option<bool>,
    /// Whether the external address would carry the token over plain http, which the pane warns about.
    pub external_plain_http: bool,
}

#[tauri::command]
#[specta::specta]
pub fn get_jellyfin_settings(db: State<'_, Db>) -> JellyfinSettings {
    let external = db.kv_get("jellyfin_external_url").unwrap_or_default();
    JellyfinSettings {
        url: db.kv_get("jellyfin_url").unwrap_or_default(),
        connected: crate::playback::detection::jellyfin::load_token().is_some()
            && db
                .kv_get("jellyfin_user_id")
                .is_some_and(|u| !u.trim().is_empty()),
        user_name: db.kv_get("jellyfin_user_name").unwrap_or_default(),
        server_name: db.kv_get("jellyfin_server_name").unwrap_or_default(),
        // The stored value, empty included; prefilling the machine name here turned "any device" into "only this PC" on Save.
        device: db.kv_get("jellyfin_device").unwrap_or_default(),
        local_device: local_device_name(),
        external_url: external.clone(),
        external_verified: if external.is_empty() {
            None
        } else {
            Some(crate::playback::detection::jellyfin::external_verified(&external))
        },
        external_plain_http: crate::playback::detection::jellyfin::external_is_plain_http(&external),
    }
}

/// Whether the phone keeps a foreground service up for Jellyfin tracking; off by default, it is a persistent notification.
pub(crate) fn read_jellyfin_background(db: &Db) -> bool {
    db.kv_get("jellyfin_background").as_deref() == Some("1")
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JellyfinBackground {
    pub enabled: bool,
    /// Whether this platform has the service at all (Android only), so the pane can leave the rows out elsewhere.
    pub supported: bool,
    /// Whether Android has exempted Karasu from battery optimisation; `None` where it does not apply or could not be asked.
    pub battery_exempt: Option<bool>,
}

#[tauri::command]
#[specta::specta]
pub fn get_jellyfin_background(db: State<'_, Db>) -> JellyfinBackground {
    JellyfinBackground {
        enabled: read_jellyfin_background(&db),
        supported: background_supported(),
        battery_exempt: battery_exempt_state(),
    }
}

/// Stores the choice; the scrobbler's next tick starts or stops the service.
#[tauri::command]
#[specta::specta]
pub fn set_jellyfin_background(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set("jellyfin_background", if enabled { "1" } else { "0" })
}

/// Opens Android's exemption dialog; the desktop arm refuses, and the pane never shows the button there.
#[tauri::command]
#[specta::specta]
pub fn request_battery_exemption() -> Result<(), String> {
    request_battery_exemption_impl()
}

#[cfg(target_os = "android")]
fn background_supported() -> bool {
    true
}

#[cfg(not(target_os = "android"))]
fn background_supported() -> bool {
    false
}

#[cfg(target_os = "android")]
fn battery_exempt_state() -> Option<bool> {
    crate::background::battery_exempt().ok()
}

#[cfg(not(target_os = "android"))]
fn battery_exempt_state() -> Option<bool> {
    None
}

#[cfg(target_os = "android")]
fn request_battery_exemption_impl() -> Result<(), String> {
    crate::background::request_battery_exemption()
}

#[cfg(not(target_os = "android"))]
fn request_battery_exemption_impl() -> Result<(), String> {
    Err("Battery settings are not a thing on this platform".into())
}

/// Saves the settings outside sign-in; an external address answering as another server is refused, an unreachable one kept.
#[tauri::command]
#[specta::specta]
pub async fn set_jellyfin_settings(
    db: State<'_, Db>,
    url: String,
    device: String,
    external_url: String,
) -> Result<(), String> {
    use crate::playback::detection::{discovery, jellyfin};
    let base = jellyfin::normalize_base_url(&url);
    // The poll sends the access token to whatever this holds, so a non-HTTP scheme is refused; LAN addresses stay valid.
    if !base.is_empty() && !crate::net::is_usable_base_url(&base) {
        return Err(jellyfin::ERR_BAD_URL.into());
    }
    let external = jellyfin::validate_external_url(&external_url).map_err(String::from)?;
    // Whatever was known about the addresses is stale the moment they change.
    jellyfin::reset_base();
    if !external.is_empty() {
        let server_id = match db.kv_get("jellyfin_server_id").filter(|s| !s.trim().is_empty()) {
            Some(id) => id,
            None => match discovery::probe(&base).await {
                Ok(info) => {
                    db.kv_set("jellyfin_server_id", &info.id)?;
                    db.kv_set("jellyfin_server_name", &info.name)?;
                    info.id
                }
                Err(_) => return Err(jellyfin::ERR_EXTERNAL_UNKNOWN_SERVER.into()),
            },
        };
        match discovery::probe(&external).await {
            Ok(info) if jellyfin::external_accepted(&info, &server_id) => {
                jellyfin::mark_external_verified(&external);
            }
            Ok(_) => return Err(jellyfin::ERR_EXTERNAL_OTHER_SERVER.into()),
            Err(e) => crate::logging::debug(
                "jellyfin",
                format!("external address not reachable from here yet ({e}); verified when needed"),
            ),
        }
    }
    db.kv_set("jellyfin_url", &base)?;
    db.kv_set("jellyfin_device", device.trim())?;
    db.kv_set("jellyfin_external_url", &external)?;
    Ok(())
}

/// Exchanges a username and password for an access token; signing in as a user scopes `/Sessions` to this account.
#[tauri::command]
#[specta::specta]
pub async fn jellyfin_sign_in(
    db: State<'_, Db>,
    url: String,
    username: String,
    password: String,
) -> Result<JellyfinSettings, String> {
    let base = crate::playback::detection::jellyfin::normalize_base_url(&url);
    // Validated and probed before the password goes anywhere; the probe also yields the server's name and id.
    if !crate::net::is_usable_base_url(&base) {
        return Err(crate::playback::detection::jellyfin::ERR_BAD_URL.into());
    }
    let info = crate::playback::detection::discovery::probe(&base).await?;
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
    db.kv_set("jellyfin_server_id", &info.id)?;
    db.kv_set("jellyfin_server_name", &info.name)?;
    crate::playback::detection::jellyfin::save_token(&session.token)?;
    // The old admin API key grants far more than Karasu needs; don't leave it in the credential store.
    crate::playback::detection::jellyfin::delete_legacy_api_key();

    Ok(get_jellyfin_settings(db))
}

#[tauri::command]
#[specta::specta]
pub fn jellyfin_sign_out(db: State<'_, Db>) -> Result<JellyfinSettings, String> {
    crate::playback::detection::jellyfin::delete_token()?;
    crate::playback::detection::jellyfin::delete_legacy_api_key();
    db.kv_delete("jellyfin_user_id");
    db.kv_delete("jellyfin_user_name");
    db.kv_delete("jellyfin_server_id");
    db.kv_delete("jellyfin_server_name");
    Ok(get_jellyfin_settings(db))
}

/// Every Jellyfin server that answers the LAN broadcast and confirms itself; a button press, never a poll.
#[tauri::command]
#[specta::specta]
pub async fn discover_jellyfin_servers(
) -> Result<Vec<crate::playback::detection::discovery::DiscoveredServer>, String> {
    crate::playback::detection::discovery::discover().await
}

/// What the server at `url` says it is — name, version, id — anonymously.
#[tauri::command]
#[specta::specta]
pub async fn probe_jellyfin_server(
    url: String,
) -> Result<crate::playback::detection::discovery::ServerInfo, String> {
    crate::playback::detection::discovery::probe(&url).await
}

/// Lists the account's sessions, non-matching ones included, because the device filter is otherwise undiagnosable.
#[tauri::command]
#[specta::specta]
pub async fn test_jellyfin(db: State<'_, Db>) -> Result<JellyfinTest, String> {
    use crate::playback::detection::jellyfin;
    let cfg = jellyfin_config(&db).ok_or("Sign in to your Jellyfin server first")?;
    let sessions = jellyfin::list_sessions(&cfg).await?;
    let base = jellyfin::active_base();
    let url = match base {
        jellyfin::Base::External => jellyfin::normalize_base_url(&cfg.external_url),
        jellyfin::Base::Local => jellyfin::normalize_base_url(&cfg.url),
    };
    Ok(JellyfinTest { sessions, base, url })
}

/// The Test-connection answer: the sessions, and which address answered.
#[derive(serde::Serialize, specta::Type)]
pub struct JellyfinTest {
    pub sessions: Vec<crate::playback::detection::jellyfin::SessionSummary>,
    pub base: crate::playback::detection::jellyfin::Base,
    pub url: String,
}

/// Every media session for the Settings diagnostic; a `Result`, because an empty list and an unreachable service differ.
#[tauri::command]
#[specta::specta]
pub async fn media_sessions(
) -> Result<Vec<crate::playback::detection::media_session::MediaSession>, String> {
    // Blocking WinRT / D-Bus work: off the main thread, like the detection loop.
    tokio::task::spawn_blocking(crate::playback::detection::media_session::sessions_result)
        .await
        .map_err(|e| format!("Could not read the media sessions: {e}"))?
}

/// Confirms the pending auto-update immediately (also from Blocked).
#[tauri::command]
#[specta::specta]
pub async fn scrobble_now(app: tauri::AppHandle) -> Result<(), String> {
    crate::playback::scrobbler::confirm_pending(app, true).await
}

/// Discards the pending auto-update for this episode.
#[tauri::command]
#[specta::specta]
pub async fn scrobble_cancel(app: tauri::AppHandle) -> Result<(), String> {
    crate::playback::scrobbler::confirm_pending(app, false).await
}

// --- Detection corrections ---------------------------------------------------

#[tauri::command]
#[specta::specta]
pub fn list_detection_overrides(db: State<'_, Db>) -> Vec<crate::db::DetectionOverride> {
    let mut rows = db.detection_overrides();
    rows.sort_by(|a, b| a.display_title.cmp(&b.display_title));
    rows
}

/// Stores a correction against the parse and applies it now, since the poll only rebuilds a match when the title changes.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub fn set_detection_override(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    title: String,
    season: Option<u32>,
    media_type: String,
    media_id: crate::commands::Num,
    display_title: String,
    episode_offset: Option<i32>,
) -> Result<(), String> {
    let media_id = media_id.0;
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
#[specta::specta]
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
            // An ordinary file `OPEN_EXISTING` would gladly open, and the UNC path whose connect can stall the loop.
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
