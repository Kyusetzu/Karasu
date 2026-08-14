use crate::db::Db;
use tauri::{Manager, State};

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

/// Where the last Wrapped poster was saved, so the next one opens there.
const EXPORT_DIR_KEY: &str = "export_dir";
/// Verbose logging. Off by default — the errors that matter are recorded either
/// way, and this is the switch for reproducing something on request.
pub(crate) const LOG_DEBUG_KEY: &str = "log_debug";

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

// --- Platform ----------------------------------------------------------------

/// What the screen needs to know about where it is running.
///
/// Capabilities rather than an OS string alone, because every consumer's real
/// question is a capability — "can this self-update", "is there a folder
/// portable mode can write to". `@tauri-apps/plugin-os` would be a new npm
/// dependency, a new Rust dependency and a new capability grant to answer less
/// than this does. Tray presence is deliberately *not* here: `get_close_to_tray`
/// already reports it, and two sources for one fact is how they drift.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// "windows" | "linux" | "macos"
    pub os: String,
    /// Running from an AppImage. The updater can only replace one of those on
    /// Linux, and it is the only Linux layout portable mode can write beside.
    pub app_image: bool,
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    PlatformInfo {
        os: std::env::consts::OS.to_string(),
        // Same gate portable mode applies, so the UI and the data folder can
        // never disagree about whether this is an AppImage.
        app_image: crate::portable::running_from_appimage(),
    }
}

// --- Close to tray -----------------------------------------------------------

/// A constant rather than a literal because `lib.rs`'s window handler reads
/// the same key, and the two disagreeing would be invisible.
pub const CLOSE_TO_TRAY_KEY: &str = "close_to_tray";

/// Whether closing the window hides it instead of quitting.
///
/// Unset means "whatever this desktop can support": hiding is only safe when
/// something can bring the window back. On Windows that is always the tray; on
/// Linux the tray may not exist at all, and a hidden window with no tray icon
/// is an app the user cannot reach.
///
/// An explicit choice always wins, including "hide anyway" with no tray —
/// re-launching Karasu re-shows the window through the single-instance hook,
/// so that is a recoverable preference rather than a trap.
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
    /// Whether a tray icon was actually created at startup. The screen needs
    /// this to explain *why* the setting reads the way it does — without it a
    /// Linux user sees "closing quits" with no reason given.
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

// --- Global hotkey -----------------------------------------------------------

/// The accelerator that summons (or hides) the window from anywhere, or unset
/// for off — off by default, because a hotkey the user never chose that
/// swallows a system-wide key combination is a bug report, not a feature.
const GLOBAL_HOTKEY_KEY: &str = "global_hotkey";

pub(crate) fn read_global_hotkey(db: &Db) -> Option<String> {
    db.kv_get(GLOBAL_HOTKEY_KEY).filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn get_global_hotkey(db: State<'_, Db>) -> Option<String> {
    read_global_hotkey(&db)
}

/// Registers first, stores second: an accelerator the OS rejects must leave
/// the stored setting untouched, or the same failure comes back silently at
/// every startup. `None` (or blank) unregisters and turns the feature off.
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

/// Enables portable mode: copies the current database next to the exe, moves
/// the token into the encrypted portable file and only then writes the marker.
/// Takes effect after a restart.
///
/// The marker goes **last** on purpose. `is_portable()` is a live check for
/// that file, so the moment it exists the app reads from the portable folder —
/// there is no restart to wait for. Writing it first (as this did) meant any
/// later failure returned an error the UI reported as "it did not work" while
/// the app had in fact already switched, to a folder holding no token and
/// possibly no database. Done in this order, a failure leaves an unused folder
/// and nothing else.
#[tauri::command]
pub fn enable_portable(db: State<'_, Db>) -> Result<(), String> {
    let dest_dir = crate::portable::portable_data_dir().ok_or("No portable path")?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let dest = dest_dir.join("karasu.db");
    if !dest.exists() {
        db.snapshot_to(&dest)?;
    }
    crate::anilist::auth::migrate_to_portable_file()?;
    crate::portable::create_marker()
}

/// Disables portable mode (removes the marker). Takes effect after a restart.
#[tauri::command]
pub fn disable_portable() -> Result<(), String> {
    crate::portable::remove_marker()
}

/// Opens a native save dialog and writes the image (e.g. the yearly wrap-up
/// card). Returns false if the user cancelled.
///
/// `data` is base64, not a byte array. Tauri serializes a command's arguments
/// with `JSON.stringify`, whose replacer expands any typed array into a JSON
/// array of numbers — so a 4 MB poster crossed the bridge as ~16 MB of ASCII
/// digits and was rebuilt one `serde_json` number at a time. Base64 is ~1.37x
/// the bytes and one decode.
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

    // Only the two the encoder actually produces. An unchecked string here
    // would end up as the file extension and the dialog filter, so a typo
    // would silently write an unopenable file.
    let (label, ext) = match format.as_str() {
        "png" => ("PNG image", "png"),
        "jpeg" => ("JPEG image", "jpg"),
        _ => return Err(format!("Unsupported image format: {format}")),
    };

    let mut builder = app.dialog().file().set_file_name(&default_name);
    // Reopening in the same folder the last poster went to. A year-in-review
    // is exported in bursts — five presets, three sizes — and re-navigating
    // from the home directory each time is the whole friction of the feature.
    if let Some(dir) = db.kv_get(EXPORT_DIR_KEY) {
        let dir = std::path::PathBuf::from(dir);
        if dir.is_dir() {
            builder = builder.set_directory(dir);
        }
    }

    let path = builder
        .add_filter(label, &[ext])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok());

    match path {
        Some(p) => {
            std::fs::write(&p, &data)
                .map_err(|e| format!("Could not save image: {e}"))?;
            if let Some(dir) = p.parent() {
                let _ = db.kv_set(EXPORT_DIR_KEY, &dir.to_string_lossy());
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

// --- Diagnostics -------------------------------------------------------------

/// Everything a bug report needs, in one round trip.
///
/// One command rather than the frontend firing six, so a reporter cannot end up
/// with half a picture because one of them failed.
#[tauri::command]
pub fn diagnostics(app: tauri::AppHandle) -> crate::diagnostics::Diagnostics {
    crate::diagnostics::collect(&app)
}

/// The same facts as a markdown block, ready to paste into an issue.
///
/// Redacted by default — the destination is a public comment, and the data
/// folder is the one field that names a person.
#[tauri::command]
pub fn diagnostics_report(app: tauri::AppHandle, redact: bool) -> String {
    crate::diagnostics::render(&crate::diagnostics::collect(&app), redact)
}

/// The newest log entries, newest first.
#[tauri::command]
pub fn get_logs(limit: Option<usize>) -> Vec<crate::logging::LogEntry> {
    crate::logging::entries(limit.unwrap_or(200).min(crate::logging::RING_CAPACITY))
}

/// Where the log file lives, for the "show me the folder" affordance.
#[tauri::command]
pub fn log_file_path() -> Option<String> {
    crate::logging::log_path().map(|p| p.to_string_lossy().to_string())
}

/// A crash or unhandled rejection from the WebView.
///
/// The frontend had no error boundary and no `onerror`, so a render throw blanked
/// the window and left nothing behind. Routing it here puts a UI crash in the
/// same file as a backend one, in order, which is usually how the connection
/// between the two becomes visible.
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

/// Writes the report and the log to a file the user picks.
///
/// Rust-driven dialog like `save_image`, so the WebView needs no new capability.
/// `redact` is passed through rather than assumed: the button offering this is
/// explicit about which one it is asking for.
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
    // Oldest first here: a log is read forwards when it is the story of what
    // happened, even though the viewer shows the newest at the top.
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
    let path = builder
        .add_filter("Markdown", &["md"])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok());

    match path {
        Some(p) => {
            std::fs::write(&p, out.as_bytes())
                .map_err(|e| format!("Could not save the report: {e}"))?;
            if let Some(dir) = p.parent() {
                let _ = db.kv_set(EXPORT_DIR_KEY, &dir.to_string_lossy());
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Saves caller-supplied text through the same dialog + remembered-folder
/// idiom as `export_diagnostics` above. The frontend builds the content (the
/// airing `.ics` today); Rust owns only the dialog and the write, so the
/// WebView still gets no filesystem door.
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
    let path = builder
        .add_filter(filter_label, &[extension.as_str()])
        .blocking_save_file()
        .and_then(|p| p.into_path().ok());

    match path {
        Some(p) => {
            std::fs::write(&p, contents.as_bytes())
                .map_err(|e| format!("Could not save the file: {e}"))?;
            if let Some(dir) = p.parent() {
                let _ = db.kv_set(EXPORT_DIR_KEY, &dir.to_string_lossy());
            }
            Ok(true)
        }
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

#[cfg(test)]
mod tests {
    use super::close_hides_window;

    /// The default has to follow the desktop, because the failure is not
    /// symmetric: hiding with no tray loses the window, while quitting with a
    /// tray merely surprises someone once.
    #[test]
    fn an_unset_preference_follows_whether_a_tray_exists() {
        assert!(close_hides_window(None, true));
        assert!(!close_hides_window(None, false));
    }

    /// An explicit choice wins both ways — including "hide anyway" with no
    /// tray, which re-launching recovers from via the single-instance hook.
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
}
