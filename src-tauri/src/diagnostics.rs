//! The facts a bug report needs, gathered in one place.
//!
//! Every one of these was already knowable — through `app_version`,
//! `platform_info`, `get_portable_status`, `get_close_to_tray` and
//! `get_library_status` — but only by asking five commands and knowing to ask.
//! A reporter should not have to know the shape of the app to describe it, so
//! this composes the existing sources rather than re-deriving any of them; two
//! sources for one fact is how they drift.
//!
//! What is deliberately **not** here: the AniList token (a boolean says whether
//! one exists and nothing more), the Jellyfin URL and username, and the library
//! folder. The destination for this text is a public issue, so the library path
//! is reduced to "configured or not" and the data directory is redacted unless
//! the user explicitly asks for the unredacted export. The log file is where
//! full detail lives; that one stays local until the user attaches it.

use crate::db::Db;
use tauri::Manager;

/// The Linux-only half. `None` on Windows, so the shape says which platform
/// produced it without a second field to keep in step.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxInfo {
    /// `PRETTY_NAME` from `/etc/os-release`.
    pub distro: Option<String>,
    /// `XDG_CURRENT_DESKTOP` — GNOME needs an extension before a tray icon
    /// appears at all, which is the most common "the tray is broken" report.
    pub desktop: Option<String>,
    /// `XDG_SESSION_TYPE`: `wayland` or `x11`. The single most useful Linux
    /// fact here — under Wayland one application cannot read another's window
    /// titles at all, so half of "detection does not work" is answered by it.
    pub session: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    /// The four-part `MAJOR.MINOR.PATCH.COMMIT#`. The commit counter is the
    /// only precise build identifier; the semver core repeats across builds.
    pub version: String,
    pub os: String,
    pub app_image: bool,
    pub portable: bool,
    /// Where the database lives. Redacted by `render`, not here, so the viewer
    /// can still show the real path to the person who owns it.
    pub data_dir: String,
    pub tray: bool,
    pub schema: u32,
    pub queued: usize,
    /// Whether a token exists. Never the token.
    pub signed_in: bool,
    pub profile_mode: String,
    pub library_configured: bool,
    pub library_files: usize,
    pub library_matched: usize,
    pub media_sessions: bool,
    pub jellyfin: bool,
    /// The mpv IPC pipe. It outranks every other source, so a bug report that
    /// could not say whether it was on was missing the first thing to check.
    pub mpv: bool,
    pub log_debug: bool,
    pub linux: Option<LinuxInfo>,
}

// --- Pure parsing ------------------------------------------------------------

/// `PRETTY_NAME` out of an `/etc/os-release`.
///
/// Outside the `#[cfg]` so it is tested on both platforms rather than only in
/// the Linux CI job — the shared-module half of the convention that keeps
/// platform code honest, which is why Windows needs telling it is unused.
///
/// Worth knowing why `npm run verify` never caught this: the only other caller
/// is in `#[cfg(test)]`, so `cargo test` keeps the function alive and a release
/// build does not. The warning appears in `tauri build` alone.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_os_release(text: &str) -> Option<String> {
    for line in text.lines() {
        let Some(value) = line.strip_prefix("PRETTY_NAME=") else {
            continue;
        };
        let value = value.trim().trim_matches('"');
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// Replaces the user's own name in a path with a placeholder.
///
/// `C:\Users\Kyu\AppData\…` and `/home/kyu/.local/share/…` both carry a real
/// name into whatever the report is pasted into. The rest of the path is the
/// diagnostic part and survives.
pub fn redact_home(path: &str) -> String {
    for marker in ["\\Users\\", "/Users/", "/home/"] {
        let Some(start) = path.find(marker) else {
            continue;
        };
        let after = start + marker.len();
        let sep = if marker.contains('\\') { '\\' } else { '/' };
        let end = path[after..]
            .find(sep)
            .map(|i| after + i)
            .unwrap_or(path.len());
        if end > after {
            return format!("{}<user>{}", &path[..after], &path[end..]);
        }
    }
    path.to_string()
}

// --- Platform probes ---------------------------------------------------------

/// A cfg'd *pair* rather than a cfg'd statement: a `#[cfg]` on a statement is
/// stripped on Windows, so nothing inside it is ever compiled here and the
/// first anyone hears of a mistake is the Linux CI job.
#[cfg(target_os = "linux")]
fn linux_info() -> Option<LinuxInfo> {
    let env = |key: &str| {
        std::env::var(key)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    Some(LinuxInfo {
        distro: std::fs::read_to_string("/etc/os-release")
            .ok()
            .as_deref()
            .and_then(parse_os_release),
        desktop: env("XDG_CURRENT_DESKTOP"),
        session: env("XDG_SESSION_TYPE"),
    })
}

#[cfg(not(target_os = "linux"))]
fn linux_info() -> Option<LinuxInfo> {
    None
}

// --- Gathering ---------------------------------------------------------------

pub fn collect(app: &tauri::AppHandle) -> Diagnostics {
    let db = app.state::<Db>();
    // The library facts come from the command the library screen already uses,
    // rather than reaching into `LibraryIndex` a second way — the same reason
    // tray presence is read from `TrayPresent` instead of probed again.
    let library = crate::library::get_library_status(
        app.state::<Db>(),
        app.state::<crate::library::LibraryIndex>(),
    );
    let portable = crate::portable::is_portable();
    let data_dir = if portable {
        crate::portable::portable_data_dir()
    } else {
        app.path().app_data_dir().ok()
    }
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or_default();

    Diagnostics {
        version: crate::commands::app_version_string(),
        os: std::env::consts::OS.to_string(),
        app_image: crate::portable::running_from_appimage(),
        portable,
        data_dir,
        tray: app.state::<crate::TrayPresent>().0,
        schema: db.schema_version(),
        queued: db.queue_len(),
        // A boolean. The token itself must never leave the backend.
        signed_in: crate::anilist::auth::load_token().is_some(),
        profile_mode: db
            .kv_get("profile_mode")
            .unwrap_or_else(|| "none".to_string()),
        // The path itself is deliberately not carried — it names a person and
        // says what they watch. Whether one is set, and the two counts, are the
        // parts that discriminate a scanner bug.
        library_configured: library.path.is_some(),
        library_files: library.files_seen,
        library_matched: library.matched,
        media_sessions: crate::commands::read_media_detection(&db),
        jellyfin: crate::commands::jellyfin_config(&db).is_some(),
        mpv: crate::commands::mpv_ipc_config(&db).is_some(),
        log_debug: crate::logging::debug_enabled(),
        linux: linux_info(),
    }
}

/// The block a reporter pastes into an issue.
///
/// Markdown rather than JSON: it is going into a GitHub comment, and a table
/// nobody has to unfold is worth more than a shape a machine could parse.
pub fn render(d: &Diagnostics, redact: bool) -> String {
    let yn = |b: bool| if b { "yes" } else { "no" };
    let dir = if redact {
        redact_home(&d.data_dir)
    } else {
        d.data_dir.clone()
    };

    let mut out = String::new();
    out.push_str("| | |\n|---|---|\n");
    let mut row = |k: &str, v: String| {
        out.push_str(&format!("| {k} | {v} |\n"));
    };
    row("Karasu", d.version.clone());
    row("OS", d.os.clone());
    if let Some(linux) = &d.linux {
        row("Distro", linux.distro.clone().unwrap_or_else(|| "?".into()));
        row("Desktop", linux.desktop.clone().unwrap_or_else(|| "?".into()));
        row(
            "Session",
            linux.session.clone().unwrap_or_else(|| "?".into()),
        );
        row("AppImage", yn(d.app_image).into());
    }
    row("Tray", yn(d.tray).into());
    row("Portable", yn(d.portable).into());
    row("Data folder", format!("`{dir}`"));
    row("Signed in", format!("{} ({})", yn(d.signed_in), d.profile_mode));
    row("Detection", {
        let mut sources: Vec<&str> = Vec::new();
        // Listed first because that is where it sits in `detect_playback`.
        if d.mpv {
            sources.push("mpv IPC");
        }
        if d.os == "windows" {
            sources.push("window titles");
        }
        if d.media_sessions {
            sources.push(if d.os == "linux" { "MPRIS" } else { "media sessions" });
        }
        if d.jellyfin {
            sources.push("Jellyfin");
        }
        if sources.is_empty() {
            "none enabled".to_string()
        } else {
            sources.join(", ")
        }
    });
    row(
        "Library",
        if d.library_configured {
            format!("{} files, {} matched", d.library_files, d.library_matched)
        } else {
            "not configured".to_string()
        },
    );
    row("Schema", format!("v{}", d.schema));
    row("Queued edits", d.queued.to_string());
    row("Debug logging", yn(d.log_debug).into());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_release_yields_the_pretty_name() {
        let sample = "NAME=\"Ubuntu\"\nVERSION_ID=\"22.04\"\nPRETTY_NAME=\"Ubuntu 22.04.4 LTS\"\nID=ubuntu\n";
        assert_eq!(
            parse_os_release(sample).as_deref(),
            Some("Ubuntu 22.04.4 LTS")
        );
        // Arch ships it unquoted.
        assert_eq!(
            parse_os_release("ID=arch\nPRETTY_NAME=Arch Linux\n").as_deref(),
            Some("Arch Linux")
        );
        assert_eq!(parse_os_release("ID=weird\n"), None);
        assert_eq!(parse_os_release("PRETTY_NAME=\"\"\n"), None);
    }

    /// The report is pasted in public, so the one thing in it that names a
    /// person has to go.
    #[test]
    fn a_home_directory_loses_the_user_name() {
        assert_eq!(
            redact_home(r"C:\Users\Kyu\AppData\Roaming\dev.kyu.karasu"),
            r"C:\Users\<user>\AppData\Roaming\dev.kyu.karasu"
        );
        assert_eq!(
            redact_home("/home/kyu/.local/share/dev.kyu.karasu"),
            "/home/<user>/.local/share/dev.kyu.karasu"
        );
        // Portable beside an AppImage: no home segment, nothing to redact.
        assert_eq!(redact_home("/opt/karasu/data"), "/opt/karasu/data");
        assert_eq!(redact_home(""), "");
    }

    fn sample() -> Diagnostics {
        Diagnostics {
            version: "0.67.2.229".into(),
            os: "linux".into(),
            app_image: true,
            portable: false,
            data_dir: "/home/kyu/.local/share/dev.kyu.karasu".into(),
            tray: false,
            schema: 10,
            queued: 2,
            signed_in: true,
            profile_mode: "anilist".into(),
            library_configured: true,
            library_files: 1200,
            library_matched: 980,
            media_sessions: true,
            jellyfin: false,
            mpv: false,
            log_debug: false,
            linux: Some(LinuxInfo {
                distro: Some("Arch Linux".into()),
                desktop: Some("GNOME".into()),
                session: Some("wayland".into()),
            }),
        }
    }

    #[test]
    fn the_report_names_the_linux_facts_that_decide_a_bug() {
        let out = render(&sample(), true);
        assert!(out.contains("Arch Linux"), "{out}");
        assert!(out.contains("wayland"), "{out}");
        assert!(out.contains("GNOME"), "{out}");
        // Wayland plus no tray is the pair that explains most Linux reports.
        assert!(out.contains("| Tray | no |"), "{out}");
        // MPRIS, not "window titles" — those are Windows-only.
        assert!(out.contains("MPRIS"), "{out}");
        assert!(!out.contains("window titles"), "{out}");
    }

    #[test]
    fn the_report_redacts_the_home_directory_by_default() {
        let d = sample();
        assert!(render(&d, true).contains("/home/<user>/"));
        assert!(!render(&d, true).contains("/home/kyu/"));
        // And hands over the real path when explicitly asked.
        assert!(render(&d, false).contains("/home/kyu/"));
    }

    /// Whatever else changes, no rendering of this may carry a credential.
    #[test]
    fn the_report_says_whether_signed_in_and_never_more() {
        let out = render(&sample(), true);
        assert!(out.contains("| Signed in | yes (anilist) |"), "{out}");
        // The struct has no field that could hold one in the first place.
        let json = serde_json::to_string(&sample()).unwrap();
        for forbidden in ["token", "password", "secret", "Bearer"] {
            assert!(
                !json.to_lowercase().contains(forbidden),
                "diagnostics gained a {forbidden}-shaped field"
            );
        }
    }

    #[test]
    fn a_windows_report_has_no_linux_block() {
        let mut d = sample();
        d.os = "windows".into();
        d.linux = None;
        d.app_image = false;
        let out = render(&d, true);
        assert!(!out.contains("Session"), "{out}");
        assert!(out.contains("window titles"), "{out}");
    }
}
