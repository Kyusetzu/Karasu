//! Portable mode: when a `karasu.portable` marker file sits next to the
//! executable, Karasu keeps its database and token in a `data` folder
//! beside the exe instead of in the user's AppData. The token is encrypted
//! either way — DPAPI on Windows, XChaCha20-Poly1305 on Linux (see auth).

use std::path::{Path, PathBuf};

const MARKER: &str = "karasu.portable";
const DATA_DIR: &str = "data";
const TOKEN_FILE: &str = "token.dat";

/// Whether `$APPIMAGE` names something we should believe.
///
/// The AppImage runtime exports `APPIMAGE`, `ARGV0` and `OWD`, and **every
/// child process inherits them** — so a Karasu installed from a package and
/// launched from a terminal that an AppImage'd app spawned would otherwise read
/// a completely unrelated `.AppImage` as its own location, and put its data
/// folder next to that. A bare name is the other trap: `Path::parent()` of
/// `"Karasu.AppImage"` is `Some("")`, which makes the data directory relative
/// to whatever the working directory happens to be.
///
/// Requiring an absolute path that exists rules out both.
///
/// Lives outside the `#[cfg]` so its tests run on both platforms rather than
/// only in the Linux CI job, which is why Windows needs telling it is unused.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn plausible_appimage(path: &Path) -> bool {
    path.is_absolute() && path.exists()
}

/// The folder portable mode works out of, from the two inputs that decide it.
///
/// Split from `exe_dir` so the AppImage case can be tested without one.
/// `$APPIMAGE` wins because inside an AppImage `current_exe()` resolves into
/// the throwaway `/tmp/.mount_XXXX` squashfs: the marker written there would
/// never be found again, and the data folder would cease to exist the moment
/// the process ends. `$APPIMAGE` is the real path of the `.AppImage` file, and
/// its folder is the one the user can actually see.
fn base_dir(appimage: Option<&Path>, current_exe: Option<&Path>) -> Option<PathBuf> {
    appimage
        .or(current_exe)
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
}

/// `$APPIMAGE`, but only when it is worth believing. The gate lives here, at
/// the boundary where the environment is read, so `base_dir` stays pure and
/// testable against paths that need not exist.
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

/// Whether this process is running from an AppImage, as the UI understands it:
/// autostart cannot work and the updater can only replace the bundle.
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

/// Path to the encrypted token file (portable mode only).
pub fn token_file() -> Option<PathBuf> {
    Some(portable_data_dir()?.join(TOKEN_FILE))
}

/// Where the DB/settings live: exe-relative in portable mode, else the
/// provided AppData fallback.
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

    /// Inside an AppImage `current_exe()` points into a temporary mount that
    /// is gone as soon as the process ends, so `$APPIMAGE` has to win — the
    /// whole point of portable mode is a folder that is still there next time.
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

    /// `$APPIMAGE` is inherited by every child of an AppImage'd process, so a
    /// package-installed Karasu launched from an AppImage'd terminal would
    /// otherwise adopt that unrelated bundle's folder as its own.
    #[test]
    fn only_an_absolute_existing_appimage_is_believed() {
        // A bare name is the dangerous one: its parent is "", which would make
        // the data folder relative to the working directory.
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
