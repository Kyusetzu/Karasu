//! Player and streaming profiles: which processes are interesting and how
//! the media title is extracted from the window title.

/// Known video players: (process names, suffixes stripped from the window
/// title). The title must look like a video file.
const PLAYERS: &[(&[&str], &[&str])] = &[
    (&["mpv.exe", "mpvnet.exe"], &[" - mpv", " - mpv.net"]),
    (&["vlc.exe"], &[" - VLC media player", " - VLC Media Player"]),
    (
        &["mpc-hc.exe", "mpc-hc64.exe", "mpc-hc64_nvo.exe", "mpc-be.exe", "mpc-be64.exe"],
        &[" - MPC-HC", " - MPC-BE"],
    ),
    (
        &["potplayermini64.exe", "potplayermini.exe", "potplayer64.exe", "potplayer.exe"],
        &[" - PotPlayer"],
    ),
    (&["smplayer.exe"], &[" - SMPlayer"]),
];

const VIDEO_EXTENSIONS: &[&str] = &[
    ".mkv", ".mp4", ".avi", ".m4v", ".webm", ".ts", ".m2ts", ".ogm", ".wmv", ".flv",
];

const BROWSERS: &[&str] = &[
    "chrome.exe",
    "firefox.exe",
    "msedge.exe",
    "brave.exe",
    "opera.exe",
    "opera_gx.exe",
    "vivaldi.exe",
    "zen.exe",
    "librewolf.exe",
];

/// Browser window titles end with the browser name — strip it.
const BROWSER_SUFFIXES: &[&str] = &[
    " - Google Chrome",
    " — Mozilla Firefox",
    " - Mozilla Firefox",
    " - Microsoft\u{200b} Edge",
    " - Microsoft Edge",
    " - Brave",
    " - Opera",
    " - Vivaldi",
    " — Zen Browser",
    " - LibreWolf",
];

/// Streaming sites: (marker in the title, suffixes removed to obtain the
/// series title + episode).
/// Crunchyroll tab: "Frieren: Beyond Journey's End Season 1 Ep 28 Watch on Crunchyroll"
/// or "Watching Frieren Episode 28 - Crunchyroll".
const STREAMING_MARKERS: &[(&str, &[&str])] = &[
    ("Crunchyroll", &[" Watch on Crunchyroll", " - Watch on Crunchyroll", " - Crunchyroll"]),
    ("ADN", &[" - ADN", " en streaming - ADN"]),
    ("Netflix", &[" - Netflix", " | Netflix"]),
];

/// Manga reading sites: same mechanics as streaming, but the title carries
/// a chapter number ("Ch. 45", "Chapter 45").
const MANGA_MARKERS: &[(&str, &[&str])] = &[
    ("MangaDex", &[" - MangaDex", " – MangaDex"]),
    ("MANGA Plus", &[" - MANGA Plus by SHUEISHA", " | MANGA Plus", " - MANGA Plus"]),
    ("Comick", &[" - Comick", " | Comick"]),
    ("Bato.To", &[" - Bato.To"]),
    ("Bato.to", &[" - Bato.to"]),
    ("MangaFire", &[" - MangaFire"]),
    ("Asura Scans", &[" - Asura Scans"]),
];

/// Extracts the file name from a player window if the process is a known
/// player and the title looks like a video file.
pub fn match_player(process: &str, title: &str) -> Option<String> {
    let (_, suffixes) = PLAYERS
        .iter()
        .find(|(procs, _)| procs.contains(&process))?;

    let mut media = title.to_string();
    for suffix in *suffixes {
        if let Some(stripped) = media.strip_suffix(suffix) {
            media = stripped.to_string();
            break;
        }
    }
    let media = media.trim();
    if media.is_empty() {
        return None;
    }

    // Players often show menu/idle titles ("VLC media player") — only
    // accept what looks like a video file.
    let lower = media.to_lowercase();
    if VIDEO_EXTENSIONS.iter().any(|ext| lower.ends_with(ext)) {
        return Some(media.to_string());
    }
    // MPC/mpv may hide the file extension: accept heuristically when an
    // episode number is recognizable.
    if crate::playback::recognition::parser::parse(media).episode.is_some() {
        return Some(media.to_string());
    }
    None
}

fn strip_browser_suffix(title: &str) -> Option<String> {
    let mut media = title.to_string();
    for suffix in BROWSER_SUFFIXES {
        if let Some(stripped) = media.strip_suffix(suffix) {
            media = stripped.to_string();
            break;
        }
    }
    Some(media)
}

/// Detects streaming playback in browser tabs from the window title.
pub fn match_streaming(process: &str, title: &str) -> Option<String> {
    if !BROWSERS.contains(&process) {
        return None;
    }
    let mut media = strip_browser_suffix(title)?;

    let (_, site_suffixes) = STREAMING_MARKERS
        .iter()
        .find(|(marker, _)| media.contains(marker))?;

    for suffix in *site_suffixes {
        if let Some(stripped) = media.strip_suffix(suffix) {
            media = stripped.to_string();
            break;
        }
    }
    // Strip the "Watching " prefix (Crunchyroll)
    let media = media.strip_prefix("Watching ").unwrap_or(&media).trim();

    // Only accept when an episode number is recognizable — otherwise it is
    // just an overview page.
    if crate::playback::recognition::parser::parse(media).episode.is_some() {
        Some(media.to_string())
    } else {
        None
    }
}

/// Detects manga reading in browser tabs (MangaDex and friends).
pub fn match_manga(process: &str, title: &str) -> Option<String> {
    if !BROWSERS.contains(&process) {
        return None;
    }
    let mut media = strip_browser_suffix(title)?;

    let (_, site_suffixes) = MANGA_MARKERS
        .iter()
        .find(|(marker, _)| media.contains(marker))?;

    for suffix in *site_suffixes {
        if let Some(stripped) = media.strip_suffix(suffix) {
            media = stripped.to_string();
            break;
        }
    }
    let media = media.trim();

    // Only accept when a chapter number is recognizable
    if crate::playback::recognition::parser::parse_manga(media).episode.is_some() {
        Some(media.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_mpv_with_suffix() {
        assert_eq!(
            match_player("mpv.exe", "[SubsPlease] Sousou no Frieren - 28 (1080p).mkv - mpv"),
            Some("[SubsPlease] Sousou no Frieren - 28 (1080p).mkv".to_string())
        );
    }

    #[test]
    fn player_vlc_idle_ignored() {
        assert_eq!(match_player("vlc.exe", "VLC media player"), None);
    }

    #[test]
    fn player_unknown_process_ignored() {
        assert_eq!(match_player("notepad.exe", "file.mkv"), None);
    }

    #[test]
    fn streaming_crunchyroll_watch_page() {
        assert_eq!(
            match_streaming(
                "chrome.exe",
                "Watching Sousou no Frieren Episode 28 - Crunchyroll - Google Chrome"
            ),
            Some("Sousou no Frieren Episode 28".to_string())
        );
    }

    #[test]
    fn streaming_crunchyroll_ep_format() {
        assert_eq!(
            match_streaming(
                "firefox.exe",
                "Frieren: Beyond Journey's End Season 1 Ep 28 Watch on Crunchyroll — Mozilla Firefox"
            ),
            Some("Frieren: Beyond Journey's End Season 1 Ep 28".to_string())
        );
    }

    #[test]
    fn streaming_overview_page_ignored() {
        assert_eq!(
            match_streaming("chrome.exe", "Crunchyroll - Watch Anime - Google Chrome"),
            None
        );
    }

    #[test]
    fn manga_mangadex_chapter() {
        assert_eq!(
            match_manga(
                "firefox.exe",
                "Kusuriya no Hitorigoto - Ch. 45 - MangaDex — Mozilla Firefox"
            ),
            Some("Kusuriya no Hitorigoto - Ch. 45".to_string())
        );
    }

    #[test]
    fn manga_overview_page_ignored() {
        assert_eq!(
            match_manga("chrome.exe", "MangaDex - Google Chrome"),
            None
        );
    }

    #[test]
    fn manga_non_browser_ignored() {
        assert_eq!(match_manga("mpv.exe", "Something Ch. 4 - MangaDex"), None);
    }
}
