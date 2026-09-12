//! Portable mode: a `karasu.portable` marker beside the exe keeps the database and token in a `data` folder there.

use std::path::{Path, PathBuf};

const MARKER: &str = "karasu.portable";
const DATA_DIR: &str = "data";
#[cfg(any(windows, target_os = "linux"))]
const TOKEN_FILE: &str = "token.dat";

/// Whether `$APPIMAGE` is worth believing: every child of an AppImage'd process inherits it, so it must exist.
// Ungated so its tests run on both platforms, which is why Windows needs telling it is unused.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn plausible_appimage(path: &Path) -> bool {
    path.is_absolute() && path.exists()
}

/// The folder portable mode works out of; `$APPIMAGE` wins because inside an AppImage `current_exe()` is a throwaway mount.
fn base_dir(appimage: Option<&Path>, current_exe: Option<&Path>) -> Option<PathBuf> {
    appimage
        .or(current_exe)
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
}

/// `$APPIMAGE` when it is worth believing; the gate sits where the environment is read so `base_dir` stays pure.
fn appimage_path() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|p| plausible_appimage(p))
    }
    #[cfg(not(target_os = "linux"))]
    None
}

/// Directory portable mode reads and writes.
pub fn exe_dir() -> Option<PathBuf> {
    let appimage = appimage_path();
    let current = std::env::current_exe().ok();
    base_dir(appimage.as_deref(), current.as_deref())
}

/// Whether this process runs from an AppImage, where autostart cannot work and the updater can only replace the bundle.
pub fn running_from_appimage() -> bool {
    appimage_path().is_some()
}

fn marker_path() -> Option<PathBuf> {
    Some(exe_dir()?.join(MARKER))
}

/// True when the portable marker is present next to the exe.
pub fn is_portable() -> bool {
    marker_path().map(|p| p.exists()).unwrap_or(false)
}

/// The exe-relative data directory (used in portable mode).
pub fn portable_data_dir() -> Option<PathBuf> {
    Some(exe_dir()?.join(DATA_DIR))
}

/// Path to the encrypted token file in portable mode, gated with its only callers in the desktop token store.
#[cfg(any(windows, target_os = "linux"))]
pub fn token_file() -> Option<PathBuf> {
    Some(portable_data_dir()?.join(TOKEN_FILE))
}

/// The data directory setup resolved for the database, because on mobile nothing exe-relative exists to derive it from.
#[cfg(mobile)]
static RESOLVED_DATA_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

#[cfg(mobile)]
pub fn remember_data_dir(dir: &std::path::Path) {
    let _ = RESOLVED_DATA_DIR.set(dir.to_path_buf());
}

/// The desktop half of the cfg'd pair, so the call site in setup compiles everywhere; it has nothing to remember.
#[cfg(desktop)]
pub fn remember_data_dir(_dir: &std::path::Path) {}

/// Where a secret lives on mobile: a file in the app-private data dir, so the token never reaches the WebView.
#[cfg(mobile)]
pub fn mobile_secret_file(name: &str) -> Option<PathBuf> {
    Some(RESOLVED_DATA_DIR.get()?.join(name))
}

/// Where the DB and settings live: exe-relative in portable mode, else the provided AppData fallback.
pub fn data_dir(app_data_fallback: PathBuf) -> PathBuf {
    if is_portable() {
        if let Some(dir) = portable_data_dir() {
            return dir;
        }
    }
    app_data_fallback
}

/// Creates the marker file, enabling portable mode on the next start.
pub fn create_marker() -> Result<(), String> {
    let path = marker_path().ok_or("Cannot resolve executable directory")?;
    if let Some(dir) = portable_data_dir() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, b"Karasu portable mode. Delete this file to go back to AppData.\n")
        .map_err(|e| e.to_string())
}

/// Removes the marker file, reverting to AppData on the next start.
pub fn remove_marker() -> Result<(), String> {
    let path = marker_path().ok_or("Cannot resolve executable directory")?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_uses_fallback_when_not_portable() {
        // In the test binary there is no marker, so the fallback is used.
        let fallback = PathBuf::from("karasu-test-appdata");
        assert_eq!(data_dir(fallback.clone()), fallback);
    }

    /// Proves `$APPIMAGE` beats `current_exe()`, which inside an AppImage points into a mount gone when the process ends.
    #[test]
    fn an_appimage_path_beats_the_mounted_executable() {
        let appimage = PathBuf::from("/home/kyu/Apps/Karasu.AppImage");
        let mounted = PathBuf::from("/tmp/.mount_KarasuAbc123/usr/bin/karasu");
        assert_eq!(
            base_dir(Some(&appimage), Some(&mounted)),
            Some(PathBuf::from("/home/kyu/Apps")),
        );
    }

    #[test]
    fn without_an_appimage_the_executable_decides() {
        let exe = PathBuf::from("/usr/local/bin/karasu");
        assert_eq!(base_dir(None, Some(&exe)), Some(PathBuf::from("/usr/local/bin")));
        assert_eq!(base_dir(None, None), None);
    }

    /// Proves an inherited `$APPIMAGE` from an unrelated bundle is refused unless it is absolute and exists.
    #[test]
    fn only_an_absolute_existing_appimage_is_believed() {
        // A bare name is the dangerous one: its parent is "", which makes the data folder relative to the cwd.
        assert!(!plausible_appimage(Path::new("Karasu.AppImage")));
        assert!(!plausible_appimage(Path::new(
            "/home/kyu/Apps/DoesNotExist.AppImage"
        )));

        // Any absolute path that exists passes; the running test binary will do.
        let real = std::env::current_exe().unwrap();
        assert!(plausible_appimage(&real));
    }

    #[test]
    fn paths_resolve_under_exe_dir() {
        if let Some(exe) = exe_dir() {
            assert!(portable_data_dir().unwrap().starts_with(&exe));
            assert!(token_file().unwrap().starts_with(&exe));
        }
    }
}
