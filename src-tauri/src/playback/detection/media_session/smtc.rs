//! Reading the Windows System Media Transport Controls, via WinRT.
//!
//! Nothing here decides anything — it turns what SMTC reports into
//! `MediaSession`s and hands them back. See the parent module for what is then
//! done with them.

use super::MediaSession;

// Waiting for the WinRT operations below is `IAsyncOperation::join()`, which
// windows-future 0.3 exposes publicly. This used to hand-roll a 500 ms poll of
// `Status()` in 2 ms slices, on the premise that `join()` was private — true of
// 0.2, which had no `join.rs` at all, and carried across the version bump
// without being rechecked.
//
// The poll was not merely redundant. These are cross-process calls — into the
// app that owns the session, and through the system broker for the manager —
// not the in-process reads that comment assumed, so a browser mid-page-load or
// a player cold-starting after resume from sleep overran the deadline. It then
// returned `Error::empty()`, a fabricated `S_EMPTY_ERROR` unrelated to whatever
// actually happened, which for `RequestAsync` propagates out of `read_sessions`
// and is flattened to an empty Vec by the caller: the whole media-session pass
// reported nothing for that tick, and the Settings diagnostic — whose entire
// job is explaining why a player was not detected — showed an empty list with
// no error to explain it.
//
// `join()` parks on a completion event instead of burning CPU, and returns the
// operation's real `HRESULT`. It has no deadline; the deadline was guarding
// against a wedged session manager, which would now stall the detection loop
// instead. That is the better failure: it stops at one blocked thread rather
// than silently reporting "nothing is playing" every five seconds forever.

/// WinRT needs a COM apartment, and the detection sweep runs on a tokio
/// blocking thread that has none. `CoIncrementMTAUsage` keeps a process-wide
/// MTA alive, which those threads then join implicitly — once, not per call.
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

pub fn read_sessions() -> windows::core::Result<Vec<MediaSession>> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Media::MediaPlaybackType;

    ensure_mta();
    let manager = Manager::RequestAsync()?.join()?;
    let mut out = Vec::new();

    for session in manager.GetSessions()? {
        // A session can vanish between listing and reading it, so a failure
        // on any one of these is a skip, not an error for the whole sweep.
        let Ok(props) = session
            .TryGetMediaPropertiesAsync()
            .and_then(|op| op.join())
        else {
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

        out.push(MediaSession {
            app_id: s(session.SourceAppUserModelId()),
            title: s(props.Title()),
            artist: s(props.Artist()),
            album: s(props.AlbumTitle()),
            playback_type: playback_type.to_string(),
            status: status.to_string(),
            // SMTC has no equivalent of MPRIS's `xesam:url`.
            url: String::new(),
        });
    }
    Ok(out)
}
