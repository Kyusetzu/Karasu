//! mpv's JSON IPC as an opt-in detection source: the real file path and a live position instead of a window title.

use super::Playback;

/// Everything the probe needs, read from settings by `commands::mpv_ipc_config`; `None` while the feature is off.
pub struct MpvConfig {
    pub path: String,
}

/// The path the settings hint shows for `mpv.conf`; `$XDG_RUNTIME_DIR` is per-user, so accounts cannot collide on `/tmp`.
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

/// Feeds one reply line into the state and says whether it answered one of ours; an errored property still counts.
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

/// The filename inside a local path; a URL has no useful filename, so the composed `media-title` speaks instead.
fn file_name(path: &str) -> Option<String> {
    if path.contains("://") {
        return None;
    }
    let name = path.rsplit(['/', '\\']).next()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

/// The probe's findings as a candidate; paused stays a candidate, and `detect_playback` demotes it rather than dropping it.
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

/// No mpv on mobile: the probe's `.ok()?` turns this into "nothing playing", as a desktop with mpv closed does.
#[cfg(mobile)]
async fn connect(_path: &str) -> std::io::Result<tokio::net::UnixStream> {
    Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
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
        // Events interleave, and the bound is what keeps a chatty stream from owning the loop.
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
    // One clock over write and reads; the Windows connect is synchronous, so `commands::mpv_ipc_config` shape-checks the path.
    tokio::time::timeout(std::time::Duration::from_millis(500), attempt)
        .await
        .ok()
        .flatten()
}

/// The candidate and whether mpv is paused, since the caller needs the second half to rank it.
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
        // Still a candidate; pausedness is spent in the ranking, where `detect_playback` demotes it.
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
