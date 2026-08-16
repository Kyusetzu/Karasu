//! mpv's JSON IPC as a detection source — the one that knows the most.
//!
//! A user who adds `input-ipc-server=\\.\pipe\karasu-mpv` (or a socket path
//! on Linux) to `mpv.conf` gets exact playback facts instead of a window
//! title: the real file path for the release parser, and a live position the
//! scrobble deadline can trust. Opt-in by construction — probing a pipe name
//! nobody configured, every five seconds, would be waste dressed as a
//! feature.
//!
//! The transport is the platform half (named pipe / unix socket, the cfg'd
//! pair convention); everything with a decision in it — the request lines,
//! reply parsing, and what counts as a usable candidate — is pure and
//! tested on both platforms.
//!
//! The timeout covers the write and the reads, so a pipe that exists and
//! never answers costs half a second. It does **not** cover the Windows
//! connect: `ClientOptions::open` is a synchronous `CreateFileW` that runs
//! inside the future's first poll, before the timer can arm. For a local
//! `\\.\pipe\…` name that returns immediately, which is why the path is
//! shape-checked before it ever gets here (`commands::mpv_ipc_config`) —
//! a UNC or network path could otherwise stall a runtime thread past the
//! advertised bound. Linux is genuinely async and has no such caveat.

use super::Playback;

/// Everything the probe needs to know. Read from settings by
/// `commands::mpv_ipc_config`, `None` while the feature is off.
pub struct MpvConfig {
    pub path: String,
}

/// The name the settings hint suggests for `mpv.conf`.
///
/// A named pipe on Windows lives in a per-session namespace, so a constant is
/// right there. A unix socket is a path, and `/tmp/karasu-mpv` is one path
/// shared by every account on the machine: on a multi-user box the first user
/// to run mpv owns the name, and the next either collides with it or connects
/// to a socket somebody else is holding. `$XDG_RUNTIME_DIR` exists precisely
/// for this — per-user, mode 0700, cleared at logout — with `/tmp` kept as the
/// fallback for a session that has none, which is what shipped before.
///
/// A function rather than a `const`, because the answer is only known at
/// runtime. The settings hint reads the same one, so the path the pane tells
/// the user to put in `mpv.conf` is always the path Karasu will connect to.
#[cfg(windows)]
pub fn default_pipe() -> String {
    r"\\.\pipe\karasu-mpv".to_string()
}

#[cfg(not(windows))]
pub fn default_pipe() -> String {
    match std::env::var_os("XDG_RUNTIME_DIR") {
        Some(dir) if !dir.is_empty() => std::path::Path::new(&dir)
            .join("karasu-mpv")
            .to_string_lossy()
            .into_owned(),
        _ => "/tmp/karasu-mpv".to_string(),
    }
}

/// One property per request id, ids being 1-based indexes into this list.
const PROPS: [&str; 5] = ["media-title", "path", "playback-time", "duration", "pause"];

#[derive(Debug, Default, PartialEq)]
pub(crate) struct MpvState {
    pub media_title: Option<String>,
    pub path: Option<String>,
    pub position_sec: Option<u32>,
    pub duration_sec: Option<u32>,
    pub paused: bool,
}

/// All five requests in one write; mpv answers each on its own line.
pub(crate) fn request_lines() -> String {
    PROPS
        .iter()
        .enumerate()
        .map(|(i, prop)| {
            serde_json::json!({ "command": ["get_property", prop], "request_id": i + 1 })
                .to_string()
                + "\n"
        })
        .collect()
}

/// Feeds one reply line into the state. Returns whether it answered one of
/// ours — events and unknown ids interleave freely on the same stream and
/// simply do not count. An errored property ("property unavailable" during
/// startup) still counts as answered: its slot stays `None`, which the
/// candidate rules below treat honestly.
pub(crate) fn apply_reply(state: &mut MpvState, line: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    let Some(id) = v.get("request_id").and_then(|i| i.as_u64()) else {
        return false;
    };
    let data = v.get("data");
    match id {
        1 => state.media_title = data.and_then(|d| d.as_str()).map(str::to_string),
        2 => state.path = data.and_then(|d| d.as_str()).map(str::to_string),
        3 => state.position_sec = data.and_then(|d| d.as_f64()).map(|s| s.max(0.0) as u32),
        4 => state.duration_sec = data.and_then(|d| d.as_f64()).map(|s| s.max(0.0) as u32),
        5 => state.paused = data.and_then(|d| d.as_bool()).unwrap_or(false),
        _ => return false,
    }
    true
}

/// The filename inside a local path — parser input of the same quality the
/// MPRIS `file://` branch gets. A URL (streaming through mpv) has no useful
/// filename, so the composed `media-title` speaks instead.
fn file_name(path: &str) -> Option<String> {
    if path.contains("://") {
        return None;
    }
    let name = path.rsplit(['/', '\\']).next()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// What the probe found, as a detection candidate.
///
/// Paused playback stays a *candidate*, unlike the media-session pass which
/// drops it outright — with a live position a pause simply stops the number
/// the scrobble deadline reads, so nothing is lost by keeping it. What a
/// paused player must not do is *outrank* a live source: `detect_playback`
/// takes the pausedness this returns and demotes it to a last resort, which
/// is the difference between "you paused mpv for a minute" and "an mpv window
/// left paused an hour ago hides the episode you are streaming right now".
pub(crate) fn playback_from_state(state: &MpvState) -> Option<Playback> {
    let title = state
        .path
        .as_deref()
        .and_then(file_name)
        .or_else(|| {
            state
                .media_title
                .clone()
                .filter(|t| !t.trim().is_empty())
        })?;
    Some(Playback {
        process: "mpv (ipc)".into(),
        media_title: title,
        streaming: false,
        manga: false,
        parsed: None,
        position_sec: state.position_sec,
        duration_sec: state.duration_sec,
    })
}

#[cfg(windows)]
async fn connect(
    path: &str,
) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeClient> {
    tokio::net::windows::named_pipe::ClientOptions::new().open(path)
}

#[cfg(target_os = "linux")]
async fn connect(path: &str) -> std::io::Result<tokio::net::UnixStream> {
    tokio::net::UnixStream::connect(path).await
}

async fn probe(path: &str) -> Option<MpvState> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let attempt = async {
        let stream = connect(path).await.ok()?;
        let (read, mut write) = tokio::io::split(stream);
        write.write_all(request_lines().as_bytes()).await.ok()?;
        let mut lines = BufReader::new(read).lines();
        let mut state = MpvState::default();
        let mut answered = 0usize;
        // Events interleave; 32 lines is far beyond anything a healthy mpv
        // sends between five answers, and the bound is what keeps a chatty
        // stream from owning the loop.
        for _ in 0..32 {
            let line = lines.next_line().await.ok()??;
            if apply_reply(&mut state, &line) {
                answered += 1;
                if answered == PROPS.len() {
                    return Some(state);
                }
            }
        }
        None
    };
    // One clock over connect, write and reads together: a pipe that exists
    // but never answers (a wedged or foreign server) costs half a second,
    // not a hung detection pass.
    tokio::time::timeout(std::time::Duration::from_millis(500), attempt)
        .await
        .ok()
        .flatten()
}

/// The candidate and whether mpv is paused — the caller needs the second half
/// to rank it. See `playback_from_state`.
pub async fn detect(cfg: &MpvConfig) -> Option<(Playback, bool)> {
    let state = probe(&cfg.path).await?;
    playback_from_state(&state).map(|p| (p, state.paused))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answered(state: &mut MpvState, lines: &[&str]) -> usize {
        lines.iter().filter(|l| apply_reply(state, l)).count()
    }

    #[test]
    fn the_requests_ask_for_each_property_on_its_own_line() {
        let out = request_lines();
        assert_eq!(out.lines().count(), 5);
        assert!(out.contains(r#""get_property","media-title""#));
        assert!(out.contains(r#""request_id":5"#));
    }

    #[test]
    fn replies_fill_the_state_and_events_do_not_count() {
        let mut state = MpvState::default();
        let n = answered(
            &mut state,
            &[
                r#"{"event":"property-change"}"#,
                r#"{"data":"Frieren - 05","request_id":1,"error":"success"}"#,
                r#"{"data":"D:\\anime\\[SubsPlease] Frieren - 05.mkv","request_id":2,"error":"success"}"#,
                "not json at all",
                r#"{"data":774.3,"request_id":3,"error":"success"}"#,
                r#"{"data":1420.0,"request_id":4,"error":"success"}"#,
                r#"{"data":false,"request_id":5,"error":"success"}"#,
            ],
        );
        assert_eq!(n, 5);
        assert_eq!(state.position_sec, Some(774));
        assert_eq!(state.duration_sec, Some(1420));
        assert!(!state.paused);
    }

    #[test]
    fn an_unavailable_property_counts_as_answered_but_stays_empty() {
        let mut state = MpvState::default();
        assert!(apply_reply(
            &mut state,
            r#"{"error":"property unavailable","request_id":2}"#
        ));
        assert_eq!(state.path, None);
    }

    #[test]
    fn the_file_name_beats_the_composed_title_and_a_url_does_not() {
        let local = MpvState {
            media_title: Some("Frieren – episode five".into()),
            path: Some(r"D:\anime\[SubsPlease] Frieren - 05.mkv".into()),
            position_sec: Some(10),
            duration_sec: Some(1420),
            paused: false,
        };
        let p = playback_from_state(&local).unwrap();
        assert_eq!(p.media_title, "[SubsPlease] Frieren - 05.mkv");
        assert_eq!(p.position_sec, Some(10));

        let streamed = MpvState {
            media_title: Some("Frieren - 05".into()),
            path: Some("https://example.com/stream.m3u8".into()),
            ..MpvState::default()
        };
        assert_eq!(
            playback_from_state(&streamed).unwrap().media_title,
            "Frieren - 05"
        );
    }

    #[test]
    fn paused_stays_a_candidate_and_nothing_usable_is_none() {
        let paused = MpvState {
            path: Some("/anime/ep1.mkv".into()),
            paused: true,
            ..MpvState::default()
        };
        // Still a candidate — the *ranking* is where pausedness is spent, and
        // `detect` reports the flag so `detect_playback` can demote it.
        assert!(playback_from_state(&paused).is_some());
        assert!(paused.paused);

        let idle = MpvState::default();
        assert!(playback_from_state(&idle).is_none());
        let blank = MpvState {
            media_title: Some("   ".into()),
            ..MpvState::default()
        };
        assert!(playback_from_state(&blank).is_none());
    }
}
