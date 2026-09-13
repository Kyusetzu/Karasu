//! The facts a bug report needs, composed from the commands that already know them; never a token, a URL or a path.

use crate::db::Db;
use tauri::Manager;

/// The Linux-only half; `None` on Windows, so the shape says which platform produced it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxInfo {
    /// `PRETTY_NAME` from `/etc/os-release`.
    pub distro: Option<String>,
    /// `XDG_CURRENT_DESKTOP`; GNOME needs an extension before a tray icon appears at all.
    pub desktop: Option<String>,
    /// `XDG_SESSION_TYPE`; under Wayland one application cannot read another's window titles at all.
    pub session: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    /// The four-part `MAJOR.MINOR.PATCH.COMMIT#`; the commit counter is the only precise build identifier.
    pub version: String,
    pub os: String,
    pub app_image: bool,
    pub portable: bool,
    /// Where the database lives; redacted by `render`, not here, so the viewer can show the owner the real path.
    pub data_dir: String,
    pub tray: bool,
    pub schema: u32,
    /// Which manifest the updater polls; the same four-part version can run on either channel.
    pub update_channel: String,
    pub queued: usize,
    /// Whether a token exists. Never the token.
    pub signed_in: bool,
    pub profile_mode: String,
    pub library_configured: bool,
    pub library_files: usize,
    pub library_matched: usize,
    pub media_sessions: bool,
    pub jellyfin: bool,
    /// Which Jellyfin address the last successful request went to, `local` or `external`; it names no host.
    pub jellyfin_base: Option<String>,
    /// The mpv IPC pipe; it outranks every other source, so a report has to say whether it was on.
    pub mpv: bool,
    pub log_debug: bool,
    /// AniList requests per source since the app started; the budget is shared, so a report has to say who spent it.
    pub anilist_requests: Vec<(String, u32)>,
    /// HTTP 429 answers since the app started.
    pub anilist_throttled: u32,
    /// The limiter's last measured headroom, `remaining/limit`, or none before the first header.
    pub anilist_budget: Option<(u32, u32)>,
    pub linux: Option<LinuxInfo>,
}

// --- Pure parsing ------------------------------------------------------------

/// `PRETTY_NAME` out of an `/etc/os-release`.
// Outside the `#[cfg]` so it is tested on both platforms, which a Windows release build reads as unused.
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

/// Replaces the user's own name in a path with a placeholder; the rest of the path is the diagnostic part.
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

/// A cfg'd pair rather than a cfg'd statement, which is stripped on Windows and never compiled here.
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
    // From the command the library screen already uses, rather than reaching into `LibraryIndex` a second way.
    let library = crate::library::get_library_status(
        app.state::<Db>(),
        app.state::<crate::library::LibraryIndex>(),
    );
    let portable = crate::portable::is_portable();
    let traffic = app.state::<crate::anilist::client::AniList>().traffic_snapshot();
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
        update_channel: crate::commands::stored_channel(&db),
        // This account's, matching the pending badge; another account's rows are neither drained nor counted.
        queued: crate::commands::pending(&db),
        // A boolean. The token itself must never leave the backend.
        signed_in: crate::anilist::auth::load_token().is_some(),
        profile_mode: db
            .kv_get("profile_mode")
            .unwrap_or_else(|| "none".to_string()),
        // The path itself names a person and says what they watch; whether one is set and the counts are enough.
        library_configured: library.path.is_some(),
        library_files: library.files_seen,
        library_matched: library.matched,
        media_sessions: crate::commands::read_media_detection(&db),
        jellyfin: crate::commands::jellyfin_config(&db).is_some(),
        jellyfin_base: crate::commands::jellyfin_config(&db).map(|_| {
            use crate::playback::detection::jellyfin::{active_base, Base};
            match active_base() {
                Base::Local => "local".to_string(),
                Base::External => "external".to_string(),
            }
        }),
        mpv: crate::commands::mpv_ipc_config(&db).is_some(),
        log_debug: crate::logging::debug_enabled(),
        anilist_requests: traffic.sources.iter().map(|s| (s.source.clone(), s.total)).collect(),
        anilist_throttled: traffic.throttled,
        anilist_budget: traffic.remaining.zip(traffic.limit),
        linux: linux_info(),
    }
}

/// The block a reporter pastes into an issue, as Markdown, since it is going into a GitHub comment.
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
    if let Some(base) = &d.jellyfin_base {
        row("Jellyfin address in use", base.clone());
    }
    row(
        "Library",
        if d.library_configured {
            format!("{} files, {} matched", d.library_files, d.library_matched)
        } else {
            "not configured".to_string()
        },
    );
    row("Schema", format!("v{}", d.schema));
    row("Update channel", d.update_channel.clone());
    row("Queued edits", d.queued.to_string());
    row("Debug logging", yn(d.log_debug).into());
    row(
        "AniList requests this run",
        if d.anilist_requests.is_empty() {
            "none".to_string()
        } else {
            d.anilist_requests
                .iter()
                .map(|(s, n)| format!("{s} {n}"))
                .collect::<Vec<_>>()
                .join(", ")
        },
    );
    row("Rate limited (429)", d.anilist_throttled.to_string());
    row(
        "AniList budget",
        d.anilist_budget
            .map_or("not measured yet".to_string(), |(r, l)| format!("{r}/{l} left")),
    );
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

    /// The report is pasted in public, so the one thing in it that names a person has to go.
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
            update_channel: "stable".into(),
            queued: 2,
            anilist_requests: vec![("list".into(), 2)],
            anilist_throttled: 0,
            anilist_budget: Some((27, 30)),
            signed_in: true,
            profile_mode: "anilist".into(),
            library_configured: true,
            library_files: 1200,
            library_matched: 980,
            media_sessions: true,
            jellyfin: false,
            jellyfin_base: None,
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
