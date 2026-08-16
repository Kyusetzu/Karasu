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

#[cfg(target_os = "linux")]
mod mpris;
#[cfg(windows)]
mod smtc;

// The three items below are only *called* from the MPRIS backend, so a
// Windows build sees them as dead. They live here rather than in `mpris.rs`
// deliberately: they are pure decisions about a session, and keeping them
// platform-neutral is what lets their tests run on both platforms instead of
// only in the Linux CI job.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
/// Audio-only extensions, for telling a music player from a video one.
const AUDIO_EXTENSIONS: &[&str] = &[
    ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".wma", ".aiff",
    ".m4b", ".ape", ".wv",
];

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
/// Players that only ever play music. Matched on the shortened app name, so
/// this is the MPRIS bus suffix in practice.
const MUSIC_PLAYERS: &[&str] = &[
    "spotify", "spotifyd", "ncspot", "rhythmbox", "clementine", "strawberry",
    "audacious", "elisa", "lollypop", "amberol", "mpd", "cmus", "moc", "quodlibet",
    "deadbeef", "tauon", "gnome-music", "sayonara",
];

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

/// Every session worth reporting, best first: those declaring video, then the
/// rest. Playing and non-music throughout.
fn watchable<'a>(sessions: &'a [MediaSession]) -> impl Iterator<Item = &'a MediaSession> + 'a {
    let eligible = |s: &&MediaSession| s.is_playing() && s.is_watchable();
    sessions
        .iter()
        .filter(move |s| eligible(s) && s.playback_type == "video")
        .chain(
            sessions
                .iter()
                .filter(move |s| eligible(s) && s.playback_type != "video"),
        )
}

/// The session to report: the best one that is playing and isn't music.
///
/// Only the tests take it a candidate at a time; `detect` needs the whole
/// ordering so it can fall through past one it cannot use.
#[cfg(test)]
fn pick(sessions: &[MediaSession]) -> Option<&MediaSession> {
    watchable(sessions).next()
}

/// The file name behind a `file://` URL, percent-decoded.
///
/// `None` for anything else — an http stream, or a URL with no last segment.
/// Lossy decoding rather than strict: a file name that is not valid UTF-8 is
/// still worth a guess at, and the matcher will simply fail to place it.
pub fn local_file_name(url: &str) -> Option<String> {
    let path = url.strip_prefix("file://")?;
    // Strip the (usually empty) authority: file://host/path.
    let path = match path.find('/') {
        Some(i) => &path[i..],
        None => return None,
    };
    let last = path.rsplit('/').find(|s| !s.is_empty())?;
    let decoded = percent_encoding::percent_decode_str(last)
        .decode_utf8_lossy()
        .to_string();
    let decoded = decoded.trim();
    (!decoded.is_empty()).then(|| decoded.to_string())
}

/// What kind of media this is, for sources that do not say.
///
/// MPRIS publishes no equivalent of SMTC's `PlaybackType`, so it is inferred.
/// The URL is evidence about the file itself and beats any guess made from the
/// player's name, so it is checked first. "unknown" is deliberately the
/// fallback rather than "video": `pick` treats unknown as eligible, and a
/// player that says nothing must not be invisible.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn infer_playback_type(url: &str, app_id: &str) -> &'static str {
    // The path only — a query string must not defeat the extension check.
    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    if super::profiles::VIDEO_EXTENSIONS.iter().any(|e| path.ends_with(e)) {
        return "video";
    }
    if AUDIO_EXTENSIONS.iter().any(|e| path.ends_with(e)) {
        return "music";
    }
    let name = short_app_name(app_id);
    if MUSIC_PLAYERS.contains(&name.as_str()) {
        return "music";
    }
    "unknown"
}

/// Turns one session into a playback candidate.
///
/// Split out of `detect` so the mapping can be tested without a live session
/// manager on either platform.
pub fn playback_from(session: &MediaSession) -> Option<Playback> {
    // A local file is the good case: MPRIS hands over the real release name,
    // which is better parser input than any composition of artist and title,
    // and is the same shape the Windows window-title path produces for mpv.
    if let Some(name) = local_file_name(&session.url) {
        crate::logging::debug_changed(
            "session",
            "chosen",
            format!("{}: local file {:?}", session.app_id, name),
        );
        return Some(Playback {
            process: short_app_name(&session.app_id),
            media_title: name,
            streaming: false,
            manga: false,
            parsed: None,
            position_sec: None,
            duration_sec: None,
        });
    }

    let media_title = compose_title(&session.artist, &session.title, &session.album);
    if media_title.trim().is_empty() {
        // A `None` that looks exactly like "nothing is playing" from the outside,
        // which is why it is worth a line: the session existed and was rejected.
        crate::logging::debug_changed(
            "session",
            "skipped",
            format!("{}: no usable title, skipped", session.app_id),
        );
        return None;
    }
    // A composed title whose *parse* is empty is not playback either. Some
    // clients swap artist and title (the warning above), which puts the
    // episode marker first — "Folge 1 - Some Show" parses to an empty title
    // with an episode number, and an empty title matches nothing, blocks
    // nothing useful, and would become the key of a correction that could
    // never fire again.
    if crate::playback::recognition::parser::parse(&media_title)
        .title
        .trim()
        .is_empty()
    {
        crate::logging::debug_changed(
            "session",
            "skipped",
            format!("{}: {media_title:?} has no title once parsed", session.app_id),
        );
        return None;
    }
    crate::logging::debug_changed(
        "session",
        "chosen",
        format!("{}: composed {:?}", session.app_id, media_title),
    );
    Some(Playback {
        process: short_app_name(&session.app_id),
        media_title,
        // Not a local file, and the UI's "streaming" icon is the honest one
        // for something we only know about through the OS.
        streaming: true,
        manga: false,
        parsed: None,
        position_sec: None,
        duration_sec: None,
    })
}

/// The best session that actually yields something to scrobble.
///
/// Not `playback_from(pick(…)?)`: `pick` returns one candidate and
/// `playback_from` can still reject it for having no usable title, so a single
/// unusable session ended the whole sweep. On Linux that is not hypothetical —
/// `read_sessions` lists every `org.mpris.MediaPlayer2.*` bus name, including
/// ones whose Metadata is absent (browsers between tracks, playerctld, a player
/// that registered before setting metadata), and those are inferred "unknown"
/// rather than "video", so they sit in the same tier as the real player and can
/// be listed first. Falling through to the next candidate is the difference
/// between scrobbling the episode and never seeing it.
pub fn detect() -> Option<Playback> {
    let sessions = sessions();
    // What the desktop actually publishes. This is the same data the Settings
    // diagnostic shows, and for the same reason: there is otherwise no way to
    // tell "Karasu ignored it" from "the player never told the system". On
    // disk it also survives the moment, which the live diagnostic does not.
    // `debug_changed`, not `debug`: this runs on every five-second poll.
    crate::logging::debug_changed(
        "session",
        "sessions",
        format!(
            "{} session(s): [{}]",
            sessions.len(),
            sessions
                .iter()
                .map(|s| format!(
                    "{} {}/{}",
                    s.app_id, s.playback_type, s.status
                ))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    );
    let found = watchable(&sessions).find_map(playback_from);
    found
}

/// What the platform reports, or why it could not be asked.
///
/// The detection pass wants a plain list and treats "nothing" as a normal
/// answer — most polls find nothing playing. The *diagnostic* wants the
/// difference: "no session is reporting anything" and "the session service
/// could not be reached" were byte-identical on screen, and on Linux this pass
/// is the whole of local detection, so the second one means the feature is
/// down. Telling someone their player is at fault when the session bus is
/// missing sends them to debug the wrong thing.
#[cfg(windows)]
pub fn sessions_result() -> Result<Vec<MediaSession>, String> {
    smtc::read_sessions().map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
pub fn sessions_result() -> Result<Vec<MediaSession>, String> {
    mpris::read_sessions().map_err(|e| e.to_string())
}

/// No media-session API on this platform.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn sessions_result() -> Result<Vec<MediaSession>, String> {
    Ok(Vec::new())
}

/// The list alone, for the detection pass.
///
/// A failure is an empty list here on purpose — the poll runs every 5 s and has
/// nothing useful to do with an error — but it does not pass silently: the
/// reason goes through `debug_changed`, which records a line only when it
/// differs from the last one under the same key. A plain `warn` on this path is
/// 17,280 lines a day and rotates the interesting part of the log off disk.
pub fn sessions() -> Vec<MediaSession> {
    match sessions_result() {
        Ok(list) => list,
        Err(e) => {
            crate::logging::debug_changed("detect", "sessions_error", &e);
            Vec::new()
        }
    }
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

    /// A playing session with no metadata used to end the sweep, because
    /// `pick` chose it and `playback_from` then rejected it. On Linux an empty
    /// MPRIS player sitting on the bus ahead of the real one would have hidden
    /// the episode for as long as it stayed there.
    #[test]
    fn an_empty_session_falls_through_to_the_next_one() {
        let sessions = vec![
            session("  ", "  ", "unknown", "playing"),
            session("Frieren", "Episode 5", "unknown", "playing"),
        ];
        assert_eq!(
            watchable(&sessions).find_map(playback_from).map(|p| p.media_title),
            Some("Frieren - Episode 5".to_string())
        );
    }

    /// The preference order `pick` documents still holds when iterating: video
    /// is considered before anything untyped, whatever the bus order.
    #[test]
    fn video_is_still_considered_before_untyped() {
        let sessions = vec![
            session("A", "Untyped", "unknown", "playing"),
            session("B", "Video", "video", "playing"),
        ];
        let order: Vec<_> = watchable(&sessions).map(|s| s.title.clone()).collect();
        assert_eq!(order, vec!["Video", "Untyped"]);
    }

    /// The URL is evidence about the file; the player's name is only a guess
    /// about the player. So the extension wins, including for a browser, and
    /// a query string must not defeat it.
    #[test]
    fn the_media_kind_is_inferred_from_the_url_before_the_player() {
        assert_eq!(infer_playback_type("file:///a/Frieren%20-%2005.mkv", ""), "video");
        assert_eq!(infer_playback_type("file:///a/song.flac", ""), "music");
        assert_eq!(
            infer_playback_type("https://x/v.mp4?token=1", "org.mpris.MediaPlayer2.firefox"),
            "video"
        );
        // Spotify streams, so there is no extension to read — the bus name is
        // all there is to go on.
        assert_eq!(
            infer_playback_type("https://open.spotify.com/track/1", "org.mpris.MediaPlayer2.spotify"),
            "music"
        );
    }

    /// Anything unrecognised stays eligible. `pick` lets "unknown" through on
    /// purpose, so guessing "video" here would gain nothing and guessing
    /// "music" would make a whole player invisible.
    #[test]
    fn an_unrecognised_source_stays_unknown() {
        assert_eq!(infer_playback_type("", ""), "unknown");
        assert_eq!(
            infer_playback_type("https://x/watch", "org.mpris.MediaPlayer2.chromium"),
            "unknown"
        );
    }

    #[test]
    fn a_file_url_yields_the_release_name() {
        assert_eq!(
            local_file_name("file:///srv/anime/%5BSubsPlease%5D%20Frieren%20-%2005.mkv").unwrap(),
            "[SubsPlease] Frieren - 05.mkv"
        );
        // Multi-byte UTF-8 survives the decode.
        assert_eq!(
            local_file_name("file:///a/%E8%91%AC%E9%80%81%E3%81%AE.mkv").unwrap(),
            "葬送の.mkv"
        );
        // A trailing slash has no file to name.
        assert_eq!(local_file_name("file:///a/b/"), Some("b".to_string()));
    }

    #[test]
    fn a_url_that_is_not_a_local_file_has_no_name() {
        assert!(local_file_name("https://example.com/x.mkv").is_none());
        assert!(local_file_name("").is_none());
        assert!(local_file_name("file://").is_none());
    }

    /// The whole point of reading `xesam:url`: a local file goes to the parser
    /// as the name on disk, and is not called streaming.
    #[test]
    fn a_local_file_beats_the_composed_title() {
        let mut s = session("Some Artist", "Track 5", "video", "playing");
        s.url = "file:///srv/[Group]%20Frieren%20-%2005.mkv".into();
        let p = playback_from(&s).unwrap();
        assert_eq!(p.media_title, "[Group] Frieren - 05.mkv");
        assert!(!p.streaming);
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
