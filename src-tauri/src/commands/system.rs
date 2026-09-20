use crate::db::Db;
use crate::sync::LockExt;
use tauri::{AppHandle, Manager, State};

// Siblings in the same module tree; `mod.rs` re-exports all of it, so every command keeps its old path.
#[allow(unused_imports)]
use super::*;

/// Where the last Wrapped poster was saved, so the next one opens there.
const EXPORT_DIR_KEY: &str = "export_dir";

/// Writes what a save dialog answered with, a path or Android's `content://` URI, through the fs plugin.
fn write_picked(
    app: &tauri::AppHandle,
    picked: tauri_plugin_fs::FilePath,
    bytes: &[u8],
) -> Result<Option<std::path::PathBuf>, String> {
    use std::io::Write;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    let dir = parent_of(&picked);
    let mut opts = OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    let mut file = app.fs().open(picked, opts).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// `write_picked`'s opposite, bounded so a mistaken pick of something huge fails rather than OOMs.
fn read_picked(
    app: &tauri::AppHandle,
    picked: tauri_plugin_fs::FilePath,
    max_bytes: u64,
) -> Result<(String, Option<std::path::PathBuf>), String> {
    use std::io::Read;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    const TOO_LARGE: &str = "That file is too large to be a list export";
    let dir = parent_of(&picked);
    let mut opts = OpenOptions::new();
    opts.read(true);
    let file = app
        .fs()
        .open(picked, opts)
        .map_err(|e| format!("Could not read the file: {e}"))?;
    if file.metadata().map(|m| m.len()).unwrap_or(0) > max_bytes {
        return Err(TOO_LARGE.into());
    }
    // A content URI's metadata can be silent about the size, so the read is capped too, as bytes before UTF-8.
    let mut bytes = Vec::new();
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Could not read the file: {e}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(TOO_LARGE.into());
    }
    let contents =
        String::from_utf8(bytes).map_err(|e| format!("Could not read the file: {e}"))?;
    Ok((contents, dir))
}

fn parent_of(picked: &tauri_plugin_fs::FilePath) -> Option<std::path::PathBuf> {
    match picked {
        tauri_plugin_fs::FilePath::Path(p) => p.parent().map(|d| d.to_path_buf()),
        tauri_plugin_fs::FilePath::Url(_) => None,
    }
}

/// The folder the next dialog opens in — only a real folder qualifies.
fn remember_dir(db: &Db, dir: Option<std::path::PathBuf>) {
    if let Some(dir) = dir {
        let _ = db.kv_set(EXPORT_DIR_KEY, &dir.to_string_lossy());
    }
}
/// Verbose logging, off by default; the errors that matter are recorded either way.
pub(crate) const LOG_DEBUG_KEY: &str = "log_debug";

/// Reports the page the user is on, so the idle Discord presence can show "Looking at <page>".
#[tauri::command]
pub fn set_ui_page(app: tauri::AppHandle, page: String) {
    *app.state::<crate::discord::UiPage>().0.guard() = page;
    crate::discord::sync_current(&app);
}

// --- Display scaling ---------------------------------------------------------

/// Windows' Accessibility text-size multiplier; WebView2 ignores it, so the frontend sets the root font size.
#[tauri::command]
pub fn get_text_scale() -> f64 {
    #[cfg(windows)]
    {
        use windows::UI::ViewManagement::UISettings;
        if let Ok(settings) = UISettings::new() {
            if let Ok(scale) = settings.TextScaleFactor() {
                // Clamped so a bogus value cannot render the app unusable.
                return scale.clamp(1.0, 2.25);
            }
        }
    }
    1.0
}

// --- System accent -----------------------------------------------------------

/// The desktop's or the phone's accent colour as `#rrggbb`, or nothing where the platform does not publish one.
#[tauri::command]
pub fn system_accent() -> Option<String> {
    read_system_accent()
}

#[cfg(windows)]
fn read_system_accent() -> Option<String> {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    let c = UISettings::new().ok()?.GetColorValue(UIColorType::Accent).ok()?;
    Some(hex_from_rgb(c.R, c.G, c.B))
}

/// The settings portal's `accent-color`, which GNOME 47+ and KDE publish; an older portal answers with an error.
#[cfg(target_os = "linux")]
fn read_system_accent() -> Option<String> {
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{OwnedValue, Value};
    let conn = Connection::session().ok()?;
    let proxy = Proxy::new(
        &conn,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Settings",
    )
    .ok()?;
    let value: OwnedValue = proxy
        .call("ReadOne", &("org.freedesktop.appearance", "accent-color"))
        .ok()?;
    let Value::Structure(rgb) = &*value else {
        return None;
    };
    let channel = |i: usize| rgb.fields().get(i).and_then(|v| f64::try_from(v.clone()).ok());
    hex_from_unit(channel(0)?, channel(1)?, channel(2)?)
}

#[cfg(target_os = "android")]
fn read_system_accent() -> Option<String> {
    crate::background::system_accent().ok().filter(|s| !s.is_empty())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
fn read_system_accent() -> Option<String> {
    None
}

/// Bytes to the `#rrggbb` the theme store and `lib/contrast.ts` read.
#[cfg_attr(not(any(windows, target_os = "android", test)), allow(dead_code))]
pub fn hex_from_rgb(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// The portal's unit floats, where a negative channel is its way of saying "no accent set".
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
pub fn hex_from_unit(r: f64, g: f64, b: f64) -> Option<String> {
    if [r, g, b].iter().any(|c| !c.is_finite() || *c < 0.0 || *c > 1.0) {
        return None;
    }
    let byte = |c: f64| (c * 255.0).round() as u8;
    Some(hex_from_rgb(byte(r), byte(g), byte(b)))
}

// --- Platform ----------------------------------------------------------------

/// What the screen needs to know about where it runs; tray presence stays with `get_close_to_tray`, one source.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// "windows" | "linux" | "android", whatever `std::env::consts::OS` says.
    pub os: String,
    /// Running from an AppImage, the only Linux layout the updater can replace and portable mode can write beside.
    pub app_image: bool,
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.to_string(),
        // The same gate portable mode applies, so the UI and the data folder never disagree about it.
        app_image: crate::portable::running_from_appimage(),
    }
}

// --- Close to tray -----------------------------------------------------------

/// A constant rather than a literal because `lib.rs`'s window handler reads the same key.
pub const CLOSE_TO_TRAY_KEY: &str = "close_to_tray";

/// Whether closing the window hides it; unset follows the tray, since a hidden window with no tray is unreachable.
pub(crate) fn close_hides_window(setting: Option<&str>, tray_present: bool) -> bool {
    match setting {
        Some("1") => true,
        Some("0") => false,
        _ => tray_present,
    }
}

#[derive(serde::Serialize)]
pub struct CloseToTray {
    /// What closing the window does right now.
    pub enabled: bool,
    /// Whether a tray icon was created at startup, so the screen can say why the setting reads as it does.
    pub tray: bool,
}

#[tauri::command]
pub fn get_close_to_tray(app: tauri::AppHandle, db: State<'_, Db>) -> CloseToTray {
    let tray = app.state::<crate::TrayPresent>().0;
    CloseToTray {
        enabled: close_hides_window(db.kv_get(CLOSE_TO_TRAY_KEY).as_deref(), tray),
        tray,
    }
}

#[tauri::command]
pub fn set_close_to_tray(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    db.kv_set(CLOSE_TO_TRAY_KEY, if enabled { "1" } else { "0" })
}

// --- Interface size ---------------------------------------------------------

/// The WebView's own zoom as a percentage; the built-in zoom hotkeys stay off so nothing drifts from the stored value.
pub const UI_ZOOM_KEY: &str = "ui_zoom";
pub const UI_ZOOM_DEFAULT: u32 = 100;
pub const UI_ZOOM_MIN: u32 = 50;
pub const UI_ZOOM_MAX: u32 = 200;

/// The stored value made safe to apply: the default when absent or unparsable, clamped otherwise.
pub fn normalize_ui_zoom(raw: Option<&str>) -> u32 {
    raw.and_then(|s| s.trim().parse::<u32>().ok())
        .map(|n| n.clamp(UI_ZOOM_MIN, UI_ZOOM_MAX))
        .unwrap_or(UI_ZOOM_DEFAULT)
}

pub fn read_ui_zoom(db: &Db) -> u32 {
    normalize_ui_zoom(db.kv_get(UI_ZOOM_KEY).as_deref())
}

/// Zooms the main window; a failure is logged and ignored, since the window still works at 100 %.
#[cfg(desktop)]
pub fn apply_ui_zoom(app: &tauri::AppHandle, percent: u32) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(e) = window.set_zoom(f64::from(percent) / 100.0) {
        crate::logging::warn("ui", format!("could not zoom the window to {percent} %: {e}"));
    }
}

#[cfg(not(desktop))]
pub fn apply_ui_zoom(_app: &tauri::AppHandle, _percent: u32) {}

#[tauri::command]
pub fn get_ui_zoom(db: State<'_, Db>) -> u32 {
    read_ui_zoom(&db)
}

/// Stores and applies the zoom, answering with the clamped value so the pane shows what was applied.
#[tauri::command]
pub fn set_ui_zoom(app: tauri::AppHandle, db: State<'_, Db>, percent: u32) -> Result<u32, String> {
    let percent = percent.clamp(UI_ZOOM_MIN, UI_ZOOM_MAX);
    db.kv_set(UI_ZOOM_KEY, &percent.to_string())?;
    apply_ui_zoom(&app, percent);
    Ok(percent)
}

// --- Global hotkey -----------------------------------------------------------

/// The accelerator that summons or hides the window from anywhere; off by default, nobody chose it.
const GLOBAL_HOTKEY_KEY: &str = "global_hotkey";

pub(crate) fn read_global_hotkey(db: &Db) -> Option<String> {
    db.kv_get(GLOBAL_HOTKEY_KEY).filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn get_global_hotkey(db: State<'_, Db>) -> Option<String> {
    read_global_hotkey(&db)
}

/// Registers first, stores second, so an accelerator the OS rejects never comes back silently at every startup.
#[tauri::command]
pub fn set_global_hotkey(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    accelerator: Option<String>,
) -> Result<(), String> {
    let accel = accelerator
        .map(|a| a.trim().to_string())
        .filter(|a| !a.is_empty());
    crate::apply_global_hotkey(&app, accel.as_deref())?;
    db.kv_set(GLOBAL_HOTKEY_KEY, accel.as_deref().unwrap_or(""))
}

// --- Portable mode -----------------------------------------------------------

#[derive(serde::Serialize)]
pub struct PortableStatus {
    pub portable: bool,
    /// Absolute path where the database currently lives.
    pub dir: String,
    /// A database in the folder this switch would move away from; `None` when that folder holds nothing.
    pub other: Option<DatabaseInfo>,
}

/// Enough about a database file to say how old it is and whether it looks used.
#[derive(serde::Serialize)]
pub struct DatabaseInfo {
    pub path: String,
    pub bytes: u64,
    /// Last modified in milliseconds since the epoch, or 0 when the filesystem will not say.
    #[serde(rename = "modifiedMs")]
    pub modified_ms: i64,
}

/// Describes the database at `path`, or `None` if there is none; the whole basis of the portable warning.
pub(crate) fn describe_database(path: &std::path::Path) -> Option<DatabaseInfo> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Some(DatabaseInfo {
        path: path.to_string_lossy().to_string(),
        bytes: meta.len(),
        modified_ms,
    })
}

#[tauri::command]
pub fn get_portable_status(app: tauri::AppHandle) -> PortableStatus {
    let portable = crate::portable::is_portable();
    let here = crate::portable::portable_data_dir();
    let there = app.path().app_data_dir().ok();
    let (active, inactive) = if portable {
        (here, there)
    } else {
        (there, here)
    };
    PortableStatus {
        portable,
        dir: active
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        other: inactive.and_then(|d| describe_database(&d.join("karasu.db"))),
    }
}

/// Enables portable mode: the database and token are copied first and the marker written last, because it is live.
#[tauri::command]
pub fn enable_portable(
    app: AppHandle,
    db: State<'_, Db>,
    replace: Option<bool>,
) -> Result<(), String> {
    let dest_dir = crate::portable::portable_data_dir().ok_or("No portable path")?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let dest = dest_dir.join("karasu.db");
    match (dest.exists(), replace) {
        (false, _) => db.snapshot_to(&dest)?,
        // `snapshot_over`, because `VACUUM INTO` refuses a destination that exists.
        (true, Some(true)) => db.snapshot_over(&dest)?,
        (true, Some(false)) => {
            crate::logging::info(
                "portable",
                "keeping the database already beside the executable",
            );
        }
        (true, None) => {
            return Err(format!(
                "A database already exists at {}. Say whether to keep it or replace it with the current one.",
                dest.to_string_lossy()
            ))
        }
    }
    // Copy before the marker, clear after it, so a failed marker write cannot leave the install signed out.
    crate::anilist::auth::copy_token_to_portable_file()?;
    crate::portable::create_marker()?;
    crate::anilist::auth::clear_credential_store_token();

    // `Db` is never reopened while `is_portable()` is live, so restarting now makes the snapshot the last word.
    crate::logging::info("portable", "portable mode on — restarting onto it");
    app.restart();
}

/// Disables portable mode by removing the marker, leaving the portable folder alone: a switch, not a delete.
#[tauri::command]
pub fn disable_portable(app: AppHandle) -> Result<(), String> {
    // The token goes back to the credential store before the marker leaves, because `load_token` follows the marker.
    crate::anilist::auth::copy_token_from_portable_file()?;
    crate::portable::remove_marker()?;
    crate::logging::info("portable", "portable mode off — restarting onto AppData");
    app.restart();
}

/// Saves an image through a native dialog; `data` is base64, since a typed array crosses the bridge as JSON numbers.
#[tauri::command]
pub fn save_image(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    data: String,
    default_name: String,
    format: String,
) -> Result<bool, String> {
    use base64::Engine as _;
    use tauri_plugin_dialog::DialogExt;

    let data = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Could not decode the image: {e}"))?;

    // Only the two the encoder produces; an unchecked string would become the extension and write an unopenable file.
    let (label, ext) = match format.as_str() {
        "png" => ("PNG image", "png"),
        "jpeg" => ("JPEG image", "jpg"),
        _ => return Err(format!("Unsupported image format: {format}")),
    };

    let mut builder = app.dialog().file().set_file_name(&default_name);
    // Reopens in the folder the last poster went to, because a year-in-review is exported in bursts.
    if let Some(dir) = db.kv_get(EXPORT_DIR_KEY) {
        let dir = std::path::PathBuf::from(dir);
        if dir.is_dir() {
            builder = builder.set_directory(dir);
        }
    }

    match builder.add_filter(label, &[ext]).blocking_save_file() {
        Some(picked) => {
            let dir = write_picked(&app, picked, &data)
                .map_err(|e| format!("Could not save image: {e}"))?;
            remember_dir(&db, dir);
            Ok(true)
        }
        None => Ok(false),
    }
}

// --- Diagnostics -------------------------------------------------------------

/// Everything a bug report needs in one round trip, so a reporter cannot end up with half a picture.
#[tauri::command]
pub fn diagnostics(app: tauri::AppHandle) -> crate::diagnostics::Diagnostics {
    crate::diagnostics::collect(&app)
}

/// The same facts as a markdown block for an issue; redacted, because the data folder names a person.
#[tauri::command]
pub fn diagnostics_report(app: tauri::AppHandle, redact: bool) -> String {
    crate::diagnostics::render(&crate::diagnostics::collect(&app), redact)
}

/// The newest log entries, newest first.
#[tauri::command]
pub fn get_logs(limit: Option<usize>) -> Vec<crate::logging::LogEntry> {
    crate::logging::entries(limit.unwrap_or(200).min(crate::logging::RING_CAPACITY))
}

/// A crash or unhandled rejection from the WebView, logged beside the backend's so the two line up in order.
#[tauri::command]
pub fn log_frontend_error(message: String, stack: Option<String>) {
    let detail = stack
        .map(|s| format!("{message}\n{s}"))
        .unwrap_or_else(|| message.clone());
    crate::logging::error("ui", detail);
}

#[tauri::command]
pub fn get_log_debug(db: State<'_, Db>) -> bool {
    db.kv_get(LOG_DEBUG_KEY).as_deref() == Some("1")
}

#[tauri::command]
pub fn set_log_debug(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    crate::logging::set_debug(enabled);
    db.kv_set(LOG_DEBUG_KEY, if enabled { "1" } else { "0" })
}

/// Writes the report and the log to a file the user picks, through a Rust-driven dialog like `save_image`.
#[tauri::command]
pub fn export_diagnostics(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    redact: bool,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let d = crate::diagnostics::collect(&app);
    let mut out = String::from("# Karasu diagnostics\n\n");
    out.push_str(&crate::diagnostics::render(&d, redact));
    out.push_str("\n## Log\n\n```\n");
    // Oldest first here: a log is read forwards when it is the story of what happened.
    for entry in crate::logging::entries(crate::logging::RING_CAPACITY)
        .iter()
        .rev()
    {
        let line = format!(
            "{} {:<5} {}: {}\n",
            crate::logging::format_utc(entry.ms),
            entry.level.label(),
            entry.target,
            entry.message
        );
        out.push_str(&if redact {
            crate::diagnostics::redact_home(&line)
        } else {
            line
        });
    }
    out.push_str("```\n");

    let mut builder = app
        .dialog()
        .file()
        .set_file_name(format!("karasu-diagnostics-{}.md", d.version));
    if let Some(dir) = db.kv_get(EXPORT_DIR_KEY) {
        let dir = std::path::PathBuf::from(dir);
        if dir.is_dir() {
            builder = builder.set_directory(dir);
        }
    }
    match builder.add_filter("Markdown", &["md"]).blocking_save_file() {
        Some(picked) => {
            let dir = write_picked(&app, picked, out.as_bytes())
                .map_err(|e| format!("Could not save the report: {e}"))?;
            remember_dir(&db, dir);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Saves caller-supplied text through the same dialog as `export_diagnostics`; the WebView gets no filesystem door.
#[tauri::command]
pub fn save_text(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    contents: String,
    default_name: String,
    filter_label: String,
    extension: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file().set_file_name(default_name);
    if let Some(dir) = db.kv_get(EXPORT_DIR_KEY) {
        let dir = std::path::PathBuf::from(dir);
        if dir.is_dir() {
            builder = builder.set_directory(dir);
        }
    }
    match builder
        .add_filter(filter_label, &[extension.as_str()])
        .blocking_save_file()
    {
        Some(picked) => {
            let dir = write_picked(&app, picked, contents.as_bytes())
                .map_err(|e| format!("Could not save the file: {e}"))?;
            remember_dir(&db, dir);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// `save_text`'s opposite: the WebView asks for a kind of file and receives bounded text, never a path.
#[tauri::command]
pub fn open_text(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    filter_label: String,
    extension: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let mut builder = app.dialog().file();
    if let Some(dir) = db.kv_get(EXPORT_DIR_KEY) {
        let dir = std::path::PathBuf::from(dir);
        if dir.is_dir() {
            builder = builder.set_directory(dir);
        }
    }
    match builder
        .add_filter(filter_label, &[extension.as_str()])
        .blocking_pick_file()
    {
        Some(picked) => {
            const MAX_BYTES: u64 = 16 * 1024 * 1024;
            let (contents, dir) = read_picked(&app, picked, MAX_BYTES)?;
            remember_dir(&db, dir);
            Ok(Some(contents))
        }
        None => Ok(None),
    }
}

// --- Backups -----------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct BackupSettings {
    pub enabled: bool,
    pub keep: usize,
    /// Where the files land, shown in the settings hint so nobody has to ask.
    pub dir: String,
}

#[tauri::command]
pub fn get_backup_settings(app: tauri::AppHandle, db: State<'_, Db>) -> BackupSettings {
    let dir = app
        .path()
        .app_data_dir()
        .map(crate::portable::data_dir)
        .map(|p| p.join("backups").to_string_lossy().to_string())
        .unwrap_or_default();
    BackupSettings {
        enabled: crate::backups::read_enabled(&db),
        keep: crate::backups::read_keep(&db),
        dir,
    }
}

/// Opens the backup folder in the file manager, creating it first so the button is never a dead end.
#[tauri::command]
pub fn open_backup_dir(app: tauri::AppHandle, db: State<'_, Db>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = get_backup_settings(app.clone(), db).dir;
    if dir.is_empty() {
        return Err("No backup folder".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {dir}: {e}"))?;
    app.opener()
        .open_path(&dir, None::<&str>)
        .map_err(|e| format!("Could not open {dir}: {e}"))
}

#[tauri::command]
pub async fn set_backup_settings(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    enabled: bool,
    keep: u32,
) -> Result<(), String> {
    crate::backups::write_settings(&db, enabled, keep as usize)?;
    if enabled {
        // A backup now, on a blocking thread since it is a whole-database `VACUUM INTO`, awaited so the toast is honest.
        tokio::task::spawn_blocking(move || crate::backups::run_once(&app))
            .await
            .map_err(|e| format!("Could not write the backup: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_autostart(app: tauri::AppHandle) -> bool {
    autostart_enabled(&app)
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    autostart_apply(&app, enabled)
}

// The autostart plugin does not exist on mobile, so the shared handler list keeps the commands and this pair splits.
#[cfg(desktop)]
fn autostart_enabled(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[cfg(mobile)]
fn autostart_enabled(_app: &tauri::AppHandle) -> bool {
    false
}

#[cfg(desktop)]
fn autostart_apply(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|e| e.to_string())
}

#[cfg(mobile)]
fn autostart_apply(_app: &tauri::AppHandle, _enabled: bool) -> Result<(), String> {
    Err("Autostart is not available on this platform".into())
}

// --- Notification centre -----------------------------------------------------

/// Recent notifications, newest first (for the bell dropdown).
#[tauri::command]
pub fn get_notifications(db: State<'_, Db>) -> Vec<crate::db::NotificationRow> {
    db.notif_all(100, crate::commands::list::viewer_id(&db))
}

#[tauri::command]
pub fn unread_notification_count(db: State<'_, Db>) -> i64 {
    db.notif_unread_count(crate::commands::list::viewer_id(&db))
}

#[tauri::command]
pub fn mark_notification_read(app: AppHandle, db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.notif_mark_read(id)?;
    crate::alerts::notify::refresh_bell(&app);
    Ok(())
}

#[tauri::command]
pub fn mark_all_notifications_read(app: AppHandle, db: State<'_, Db>) -> Result<(), String> {
    db.notif_mark_all_read()?;
    crate::alerts::notify::refresh_bell(&app);
    Ok(())
}

// --- Version -----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{
        close_hides_window, describe_database, hex_from_rgb, hex_from_unit, normalize_ui_zoom,
        UI_ZOOM_DEFAULT, UI_ZOOM_MAX, UI_ZOOM_MIN,
    };

    /// A stored zoom is clamped and a missing one is the default, since it is applied before the first paint.
    #[test]
    fn a_stored_zoom_is_clamped_and_a_missing_one_is_the_default() {
        assert_eq!(normalize_ui_zoom(None), UI_ZOOM_DEFAULT);
        assert_eq!(normalize_ui_zoom(Some("125")), 125);
        assert_eq!(normalize_ui_zoom(Some(" 150 ")), 150);
        assert_eq!(normalize_ui_zoom(Some("5")), UI_ZOOM_MIN);
        assert_eq!(normalize_ui_zoom(Some("999")), UI_ZOOM_MAX);
        assert_eq!(normalize_ui_zoom(Some("large")), UI_ZOOM_DEFAULT);
        assert_eq!(normalize_ui_zoom(Some("")), UI_ZOOM_DEFAULT);
    }

    /// Only a real file is described, so a folder that merely exists is never mistaken for a database.
    #[test]
    fn only_a_real_file_is_described() {
        let dir = std::env::temp_dir().join("karasu-portable-probe");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let db = dir.join("karasu.db");
        assert!(describe_database(&db).is_none(), "nothing there yet");

        std::fs::write(&db, b"SQLite format 3\0").unwrap();
        let info = describe_database(&db).expect("the file is there now");
        assert_eq!(info.bytes, 16);
        assert!(info.path.ends_with("karasu.db"));

        // A directory of that name is not a database; `is_file` is what keeps `metadata` from reporting one.
        let as_dir = dir.join("folder.db");
        std::fs::create_dir_all(&as_dir).unwrap();
        assert!(describe_database(&as_dir).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// An unset preference follows the tray, because hiding with no tray loses the window.
    #[test]
    fn an_unset_preference_follows_whether_a_tray_exists() {
        assert!(close_hides_window(None, true));
        assert!(!close_hides_window(None, false));
    }

    /// An explicit choice wins both ways, including "hide anyway" with no tray.
    #[test]
    fn an_explicit_preference_beats_the_tray() {
        assert!(close_hides_window(Some("1"), false));
        assert!(!close_hides_window(Some("0"), true));
    }

    /// Anything else is an unset preference, not a third state.
    #[test]
    fn an_unrecognised_value_reads_as_unset() {
        assert!(close_hides_window(Some(""), true));
        assert!(!close_hides_window(Some("yes"), false));
    }

    #[test]
    fn an_accent_is_spelled_as_the_theme_store_reads_it() {
        assert_eq!(hex_from_rgb(75, 63, 199), "#4b3fc7");
        assert_eq!(hex_from_rgb(0, 0, 0), "#000000");
        assert_eq!(hex_from_unit(1.0, 1.0, 1.0).as_deref(), Some("#ffffff"));
        assert_eq!(hex_from_unit(0.2941, 0.2471, 0.7804).as_deref(), Some("#4b3fc7"));
        // The portal answers `(-1, -1, -1)` for "no accent", and a NaN is nobody's colour.
        assert_eq!(hex_from_unit(-1.0, -1.0, -1.0), None);
        assert_eq!(hex_from_unit(f64::NAN, 0.0, 0.0), None);
        assert_eq!(hex_from_unit(1.5, 0.0, 0.0), None);
    }
}
