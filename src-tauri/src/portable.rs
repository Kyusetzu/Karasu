//! Portable mode: when a `karasu.portable` marker file sits next to the
//! executable, Karasu keeps its database and token in a `data` folder
//! beside the exe instead of in the user's AppData, so the whole folder
//! can be carried on a USB drive. The token is DPAPI-encrypted (see auth).

use std::path::PathBuf;

const MARKER: &str = "karasu.portable";
const DATA_DIR: &str = "data";
const TOKEN_FILE: &str = "token.dat";

/// Directory containing the running executable.
pub fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(|p| p.to_path_buf())
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
        let fallback = PathBuf::from("C:/some/appdata");
        assert_eq!(data_dir(fallback.clone()), fallback);
    }

    #[test]
    fn paths_resolve_under_exe_dir() {
        if let Some(exe) = exe_dir() {
            assert!(portable_data_dir().unwrap().starts_with(&exe));
            assert!(token_file().unwrap().starts_with(&exe));
        }
    }
}
