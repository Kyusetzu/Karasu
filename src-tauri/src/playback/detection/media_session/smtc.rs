//! Reads the Windows System Media Transport Controls via WinRT into `MediaSession`s; the parent module decides.

use super::MediaSession;

// windows-future's blocking `join()` is public; do not bring back the poll loop that fabricated an HRESULT on overrun.

/// WinRT needs a COM apartment, and `CoIncrementMTAUsage` keeps one process-wide MTA the blocking threads join.
fn ensure_mta() {
    use std::sync::OnceLock;
    static MTA: OnceLock<()> = OnceLock::new();
    MTA.get_or_init(|| {
        // Never released: the cookie would end the MTA on drop, and it is wanted for the life of the process.
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
        // A session can vanish between listing and reading it, so a failure on one is a skip, not an error for the sweep.
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
