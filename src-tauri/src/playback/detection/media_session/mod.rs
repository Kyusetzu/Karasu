//! The desktop's own media session as a detection source.
//!
//! Window-title parsing only works for players that put the file name in
//! their title bar. Plenty don't — Jellyfin Media Player is the motivating
//! case: its title never changes, so it was invisible to detection. But it
//! does publish to the system's media controls (the overlay you get with the
//! volume keys), and so do browsers playing video, Plex, and anything using
//! the Media Session API.
//!
//! That gives us *structured* metadata — a separate title, artist and album —
//! instead of one string to reverse-engineer, which is strictly better input
//! than a release name.
//!
//! Every desktop has its own name for this. Windows calls it SMTC and exposes
//! it through WinRT; Linux calls it MPRIS and exposes it over D-Bus. They
//! agree closely enough on *what* a media session is that only the reading of
//! it differs, so the shape and every decision made about it live here and the
//! two backends supply nothing but a `Vec<MediaSession>`.
//!
//! Two caveats this module has to live with:
//!   - Not every app fills the fields the same way. Which field carries the
//!     series and which carries the episode varies, and jellyfin-web is known
//!     to swap artist and title outright. `compose_title` is therefore
//!     deliberately forgiving, and `sessions()` exists so the Settings
//!     diagnostic can show exactly what a given player reports.
//!   - Music players publish here too. `playback_type` is how we tell them
//!     apart.

use super::Playback;

#[cfg(windows)]
mod smtc;

/// One media session as the desktop sees it. Serialized straight into the
/// Settings diagnostic — this is the only way to find out what a player
/// actually publishes, short of guessing.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct MediaSession {
    /// Source app: an executable path or package family name on Windows, a
    /// D-Bus bus name on Linux.
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
    /// What is being played, when the source says. MPRIS publishes a
    /// `xesam:url`; SMTC has no equivalent and leaves this empty.
    pub url: String,
}

impl MediaSession {
    fn is_playing(&self) -> bool {
        self.status == "playing"
    }

    /// Music is excluded outright; anything else is allowed through, because
    /// a player that leaves the type unset would otherwise never be
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
/// `process` field ("mpv.exe", "chrome.exe"). The three shapes are an
/// executable path, a Windows package family name, and an MPRIS bus name.
pub fn short_app_name(app_id: &str) -> String {
    let id = app_id.trim();
    if id.is_empty() {
        return String::new();
    }
    // An MPRIS bus name, "org.mpris.MediaPlayer2.mpv.instance1234". Checked
    // before the package-family branch because it has no underscore to split
    // on and would otherwise reduce to its instance suffix.
    if let Some(rest) = id.strip_prefix("org.mpris.MediaPlayer2.") {
        return rest.split('.').next().unwrap_or(rest).to_lowercase();
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
pub fn pick(sessions: &[MediaSession]) -> Option<&MediaSession> {
    sessions
        .iter()
        .find(|s| s.is_playing() && s.is_watchable() && s.playback_type == "video")
        .or_else(|| sessions.iter().find(|s| s.is_playing() && s.is_watchable()))
}

/// Turns one session into a playback candidate.
///
/// Split out of `detect` so the mapping can be tested without a live session
/// manager on either platform.
pub fn playback_from(session: &MediaSession) -> Option<Playback> {
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

pub fn detect() -> Option<Playback> {
    playback_from(pick(&sessions())?)
}

#[cfg(windows)]
pub fn sessions() -> Vec<MediaSession> {
    smtc::read_sessions().unwrap_or_default()
}

/// No media-session API on this platform.
#[cfg(not(windows))]
pub fn sessions() -> Vec<MediaSession> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(artist: &str, title: &str, kind: &str, status: &str) -> MediaSession {
        MediaSession {
            app_id: "C:\\Program Files\\Jellyfin Media Player\\jellyfinmediaplayer.exe".into(),
            title: title.into(),
            artist: artist.into(),
            album: String::new(),
            playback_type: kind.into(),
            status: status.into(),
            url: String::new(),
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
        // A player that never sets a playback type must not be invisible.
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

    /// An MPRIS bus name carries an instance suffix and no underscore, so the
    /// package-family branch would have reduced it to "instance1234".
    #[test]
    fn an_mpris_bus_name_shortens_to_the_player() {
        assert_eq!(short_app_name("org.mpris.MediaPlayer2.mpv.instance1234"), "mpv");
        assert_eq!(short_app_name("org.mpris.MediaPlayer2.firefox.instance_1_25"), "firefox");
        assert_eq!(short_app_name("org.mpris.MediaPlayer2.VLC"), "vlc");
        assert_eq!(
            short_app_name("org.mpris.MediaPlayer2.plasma-browser-integration"),
            "plasma-browser-integration"
        );
    }

    #[test]
    fn a_session_with_no_usable_title_is_not_playback() {
        assert!(playback_from(&session("  ", "  ", "video", "playing")).is_none());
    }

    #[test]
    fn a_playing_session_becomes_a_streaming_candidate() {
        let p = playback_from(&session("Frieren", "Episode 5", "video", "playing")).unwrap();
        assert_eq!(p.media_title, "Frieren - Episode 5");
        assert_eq!(p.process, "jellyfinmediaplayer.exe");
        assert!(p.streaming);
        assert!(!p.manga);
    }
}
