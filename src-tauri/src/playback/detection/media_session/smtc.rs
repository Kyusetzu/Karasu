//! Reading the Windows System Media Transport Controls, via WinRT.
//!
//! Nothing here decides anything — it turns what SMTC reports into
//! `MediaSession`s and hands them back. See the parent module for what is then
//! done with them.

use super::MediaSession;

/// Waits for a WinRT async operation on the current thread.
///
/// `windows-future` only exposes `IntoFuture`, and the resulting future holds
/// a raw COM pointer so it isn't `Send` — it can't be awaited inside the
/// scrobbler's spawned task. Its blocking `join()` is private. Polling the
/// public `Status()` is the remaining option, and these particular operations
/// resolve against in-process state, so in practice the first check already
/// succeeds. The deadline exists so a wedged session manager can never stall
/// detection.
fn wait_for<T>(op: windows_future::IAsyncOperation<T>) -> windows::core::Result<T>
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
