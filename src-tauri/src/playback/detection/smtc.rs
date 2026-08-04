//! Windows System Media Transport Controls as a detection source.
//!
//! Window-title parsing only works for players that put the file name in
//! their title bar. Plenty don't — Jellyfin Media Player is the motivating
//! case: its title never changes, so it was invisible to detection. But it
//! does publish to the Windows media controls (the overlay you get with the
//! volume keys), and so do browsers playing video, Plex, and anything using
//! the Media Session API.
//!
//! That gives us *structured* metadata — a separate title, artist and album —
//! instead of one string to reverse-engineer, which is strictly better input
//! than a release name.
//!
//! Two caveats this module has to live with:
//!   - Not every app fills the fields the same way. Which field carries the
//!     series and which carries the episode varies, and jellyfin-web is known
//!     to swap artist and title outright. `compose_title` is therefore
//!     deliberately forgiving, and `sessions()` exists so the Settings
//!     diagnostic can show exactly what a given player reports.
//!   - Music players publish here too. `PlaybackType` is how we tell them
//!     apart.

use super::Playback;

/// One media session as Windows sees it. Serialized straight into the
/// Settings diagnostic — this is the only way to find out what a player
/// actually publishes, short of guessing.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SmtcSession {
    /// Source app, e.g. a package family name or an executable path.
    #[serde(rename = "appId")]
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// "music" | "video" | "image" | "unknown"
    #[serde(rename = "playbackType")]
    pub playback_type: String,
    /// "playing" | "paused" | "stopped" | "changing" | "opened" | "closed"
    pub status: String,
}

impl SmtcSession {
    fn is_playing(&self) -> bool {
        self.status == "playing"
    }

    /// Music is excluded outright; anything else is allowed through, because
    /// a player that leaves `PlaybackType` unset would otherwise never be
    /// detected. Getting a false positive from an unset video player is
    /// recoverable — the title simply won't match anything on the list.
    fn is_watchable(&self) -> bool {
        self.playback_type != "music"
    }
}

/// Builds the string handed to the release-name parser.
///
/// The convention across players is artist = show, title = episode, so they
/// are joined in that order and the parser picks the episode number out of
/// whatever numbering the title carries. The pieces are only joined when they
/// are actually distinct: several players repeat the show name in both
/// fields, and duplicating it would push the parser off the real title.
pub fn compose_title(artist: &str, title: &str, album: &str) -> String {
    let title = title.trim();
    let artist = artist.trim();
    let album = album.trim();

    // Some players leave `artist` empty and put the show in `album` instead.
    let show = if artist.is_empty() { album } else { artist };

    if show.is_empty() {
        return title.to_string();
    }
    if title.is_empty() {
        return show.to_string();
    }
    // Already self-describing ("Frieren - Episode 5"): don't prefix it again.
    if title.to_lowercase().contains(&show.to_lowercase()) {
        return title.to_string();
    }
    format!("{show} - {title}")
}

/// Trims an app id down to something that reads like the other sources'
/// `process` field ("mpv.exe", "chrome.exe"). SMTC reports either an
/// executable path or a package family name, so both shapes are handled.
pub fn short_app_name(app_id: &str) -> String {
    let id = app_id.trim();
    if id.is_empty() {
        return String::new();
    }
    if id.contains('\\') || id.contains('/') {
        // A path: the file name is already the right shape.
        let tail = id.rsplit(['\\', '/']).next().unwrap_or(id);
        return tail.to_lowercase();
    }
    // A package family name, "Publisher.App_8wekyb3d8bbwe".
    let without_hash = id.split('_').next().unwrap_or(id);
    without_hash
        .rsplit('.')
        .next()
        .unwrap_or(without_hash)
        .to_lowercase()
}

/// Picks the session to report: the first one that is playing and isn't music.
pub fn pick(sessions: &[SmtcSession]) -> Option<&SmtcSession> {
    sessions
        .iter()
        .find(|s| s.is_playing() && s.is_watchable() && s.playback_type == "video")
        .or_else(|| {
            sessions
                .iter()
                .find(|s| s.is_playing() && s.is_watchable())
        })
}

pub fn detect() -> Option<Playback> {
    let sessions = sessions();
    let session = pick(&sessions)?;
    let media_title = compose_title(&session.artist, &session.title, &session.album);
    if media_title.trim().is_empty() {
        return None;
    }
    Some(Playback {
        process: short_app_name(&session.app_id),
        media_title,
        // Not a local file, and the UI's "streaming" icon is the honest one
        // for something we only know about through the OS.
        streaming: true,
        manga: false,
        parsed: None,
    })
}

#[cfg(windows)]
pub fn sessions() -> Vec<SmtcSession> {
    read_sessions().unwrap_or_default()
}

/// Non-Windows groundwork: there is no SMTC equivalent wired up yet.
#[cfg(not(windows))]
pub fn sessions() -> Vec<SmtcSession> {
    Vec::new()
}

/// Waits for a WinRT async operation on the current thread.
///
/// `windows-future` only exposes `IntoFuture`, and the resulting future holds
/// a raw COM pointer so it isn't `Send` — it can't be awaited inside the
/// scrobbler's spawned task. Its blocking `join()` is private. Polling the
/// public `Status()` is the remaining option, and these particular operations
/// resolve against in-process state, so in practice the first check already
/// succeeds. The deadline exists so a wedged session manager can never stall
/// detection.
#[cfg(windows)]
fn wait_for<T>(
    op: windows_future::IAsyncOperation<T>,
) -> windows::core::Result<T>
where
    T: windows::core::RuntimeType + 'static,
{
    use std::time::{Duration, Instant};
    use windows_future::AsyncStatus;

    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match op.Status()? {
            AsyncStatus::Completed => return op.GetResults(),
            AsyncStatus::Started if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(2));
            }
            _ => return Err(windows::core::Error::empty()),
        }
    }
}

/// WinRT needs a COM apartment, and the detection sweep runs on a tokio
/// blocking thread that has none. `CoIncrementMTAUsage` keeps a process-wide
/// MTA alive, which those threads then join implicitly — once, not per call.
#[cfg(windows)]
fn ensure_mta() {
    use std::sync::OnceLock;
    static MTA: OnceLock<()> = OnceLock::new();
    MTA.get_or_init(|| {
        // Intentionally never released: the cookie would end the MTA on drop,
        // and we want it for the lifetime of the process.
        unsafe {
            let _ = windows::Win32::System::Com::CoIncrementMTAUsage();
        }
    });
}

#[cfg(windows)]
fn read_sessions() -> windows::core::Result<Vec<SmtcSession>> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Media::MediaPlaybackType;

    ensure_mta();
    let manager = wait_for(Manager::RequestAsync()?)?;
    let mut out = Vec::new();

    for session in manager.GetSessions()? {
        // A session can vanish between listing and reading it, so a failure
        // on any one of these is a skip, not an error for the whole sweep.
        let Ok(props) = session.TryGetMediaPropertiesAsync().and_then(wait_for) else {
            continue;
        };
        let status = session
            .GetPlaybackInfo()
            .and_then(|i| i.PlaybackStatus())
            .map(|s| match s {
                Status::Playing => "playing",
                Status::Paused => "paused",
                Status::Stopped => "stopped",
                Status::Changing => "changing",
                Status::Opened => "opened",
                Status::Closed => "closed",
                _ => "unknown",
            })
            .unwrap_or("unknown");

        let playback_type = props
            .PlaybackType()
            .and_then(|r| r.Value())
            .map(|t| match t {
                MediaPlaybackType::Music => "music",
                MediaPlaybackType::Video => "video",
                MediaPlaybackType::Image => "image",
                _ => "unknown",
            })
            .unwrap_or("unknown");

        let s = |v: windows::core::Result<windows::core::HSTRING>| {
            v.map(|h| h.to_string_lossy()).unwrap_or_default()
        };

        out.push(SmtcSession {
            app_id: s(session.SourceAppUserModelId()),
            title: s(props.Title()),
            artist: s(props.Artist()),
            album: s(props.AlbumTitle()),
            playback_type: playback_type.to_string(),
            status: status.to_string(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(artist: &str, title: &str, kind: &str, status: &str) -> SmtcSession {
        SmtcSession {
            app_id: "C:\\Program Files\\Jellyfin Media Player\\jellyfinmediaplayer.exe".into(),
            title: title.into(),
            artist: artist.into(),
            album: String::new(),
            playback_type: kind.into(),
            status: status.into(),
        }
    }

    #[test]
    fn joins_show_and_episode() {
        assert_eq!(
            compose_title("Frieren", "Episode 5", ""),
            "Frieren - Episode 5"
        );
    }

    #[test]
    fn does_not_repeat_a_show_already_in_the_title() {
        assert_eq!(
            compose_title("Frieren", "Frieren - Episode 5", ""),
            "Frieren - Episode 5"
        );
    }

    #[test]
    fn falls_back_to_album_when_artist_is_empty() {
        assert_eq!(compose_title("", "Episode 5", "Frieren"), "Frieren - Episode 5");
    }

    #[test]
    fn tolerates_missing_pieces() {
        assert_eq!(compose_title("", "Episode 5", ""), "Episode 5");
        assert_eq!(compose_title("Frieren", "", ""), "Frieren");
        assert_eq!(compose_title("  ", "  ", "  "), "");
    }

    #[test]
    fn music_is_never_picked() {
        let sessions = vec![session("Some Band", "Some Song", "music", "playing")];
        assert!(pick(&sessions).is_none());
    }

    #[test]
    fn video_wins_over_an_untyped_session() {
        let sessions = vec![
            session("A", "1", "unknown", "playing"),
            session("B", "2", "video", "playing"),
        ];
        assert_eq!(pick(&sessions).unwrap().artist, "B");
    }

    #[test]
    fn untyped_still_counts_when_nothing_declares_video() {
        // A player that never sets PlaybackType must not be invisible.
        let sessions = vec![session("A", "1", "unknown", "playing")];
        assert_eq!(pick(&sessions).unwrap().artist, "A");
    }

    #[test]
    fn paused_is_not_playback() {
        let sessions = vec![session("A", "1", "video", "paused")];
        assert!(pick(&sessions).is_none());
    }

    #[test]
    fn app_id_shortens_to_a_process_like_name() {
        assert_eq!(
            short_app_name("C:\\Program Files\\Jellyfin Media Player\\jellyfinmediaplayer.exe"),
            "jellyfinmediaplayer.exe"
        );
        assert_eq!(
            short_app_name("Microsoft.ZuneMusic_8wekyb3d8bbwe"),
            "zunemusic"
        );
        assert_eq!(short_app_name(""), "");
    }
}
