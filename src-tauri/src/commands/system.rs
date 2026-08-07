use crate::db::Db;
use tauri::{Manager, State};

// Siblings in the same module tree; `mod.rs` re-exports all of it, so
// every command keeps the path it had when they shared one file.
#[allow(unused_imports)]
use super::*;

/// Where the last Wrapped poster was saved, so the next one opens there.
const EXPORT_DIR_KEY: &str = "export_dir";

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
        app_image: std::env::var_os("APPIMAGE").is_some(),
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

/// Opens a native save dialog and writes PNG bytes (e.g. the yearly wrap-up
/// card). Returns false if the user cancelled.
#[tauri::command]
pub fn save_image(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    data: Vec<u8>,
    default_name: String,
    format: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

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
