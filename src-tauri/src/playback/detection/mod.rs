//! Detection of running media playback via visible windows
//! (Karasu's counterpart to Taiga's Anisthesia).

pub mod audio;
pub mod jellyfin;
pub mod media_session;
pub mod mpv_ipc;
pub mod profiles;

#[cfg(windows)]
use windows::core::BOOL;
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
#[cfg(windows)]
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible,
};

#[derive(Debug, Clone, PartialEq)]
pub struct WindowInfo {
    /// Lower-case process name, e.g. "mpv.exe"
    pub process: String,
    pub title: String,
}

/// Candidate from a player or browser window.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Playback {
    pub process: String,
    /// Cleaned media title (file name or streaming/reading title)
    pub media_title: String,
    /// true if detected from a browser/streaming window
    pub streaming: bool,
    /// true if this is manga reading (chapters instead of episodes)
    pub manga: bool,
    /// Set when the source already knows the series and episode exactly, so
    /// the release-name parser is skipped. Only the Jellyfin API can do this;
    /// every window-title source leaves it `None`.
    pub parsed: Option<crate::playback::recognition::parser::Parsed>,
    /// Playback position in seconds, when the source reports one (Jellyfin's
    /// `PlayState` today). A window title never knows it, so those sources
    /// leave it `None` and the scrobbler falls back to the wall clock.
    pub position_sec: Option<u32>,
    /// The *file's* duration in seconds from the same source. More exact than
    /// the entry's rounded minutes when present.
    pub duration_sec: Option<u32>,
}

/// Lists all visible top-level windows with title and process name.
#[cfg(windows)]
pub fn enumerate_windows() -> Vec<WindowInfo> {
    let mut result: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(enum_callback),
            LPARAM(&mut result as *mut Vec<WindowInfo> as isize),
        );
    }
    result
}

/// Windows-only by design, not groundwork: Wayland forbids reading another
/// application's windows and an X11-only backend was declined, so on Linux
/// the media-session pass and Jellyfin are the whole of detection.
#[cfg(not(windows))]
pub fn enumerate_windows() -> Vec<WindowInfo> {
    Vec::new()
}

#[cfg(windows)]
unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let result = unsafe { &mut *(lparam.0 as *mut Vec<WindowInfo>) };

    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return BOOL(1);
    }
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return BOOL(1);
    }
    let mut buf = vec![0u16; (len + 1) as usize];
    let read = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if read <= 0 {
        return BOOL(1);
    }
    let title = String::from_utf16_lossy(&buf[..read as usize]);

    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return BOOL(1);
    }

    if let Some(process) = process_name(pid) {
        result.push(WindowInfo { process, title });
    }
    BOOL(1)
}

#[cfg(windows)]
pub(super) fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        ok.ok()?;
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        Some(path.rsplit('\\').next()?.to_lowercase())
    }
}

/// Manual live test: `cargo test live_detect -- --ignored --nocapture`
/// with a player running prints all windows and the detection result.
#[cfg(test)]
mod live_tests {
    #[test]
    #[ignore]
    fn live_detect() {
        for w in super::enumerate_windows() {
            println!("FENSTER: {} | {}", w.process, w.title);
        }
        println!("ERKANNT: {:?}", super::detect_windows());
    }
}

/// Scans visible windows for running anime playback or manga reading.
///
/// The SMTC pass is deliberately *not* here: it is async, and it must run
/// after this one. See `detect_playback` in the scrobbler loop.
pub fn detect_windows() -> Option<Playback> {
    let windows = enumerate_windows();
    // What the audio stack says about each of those processes. Read once for
    // the whole sweep rather than per candidate: it is a COM round trip, this
    // runs every 5 s, and every rung below asks the same question.
    //
    // An empty map is the normal answer everywhere except Windows, and it
    // suppresses nothing — see `audio`.
    let playing = audio::play_states();
    // Local players take precedence over browser detection
    for w in &windows {
        if audio::is_paused(&playing, &w.process) {
            continue;
        }
        if let Some(media) = profiles::match_player(&w.process, &w.title) {
            return Some(Playback {
                process: w.process.clone(),
                media_title: media,
                streaming: false,
                manga: false,
                parsed: None,
                position_sec: None,
                duration_sec: None,
            });
        }
    }
    for w in &windows {
        if audio::is_paused(&playing, &w.process) {
            continue;
        }
        if let Some(media) = profiles::match_streaming(&w.process, &w.title) {
            return Some(Playback {
                process: w.process.clone(),
                media_title: media,
                streaming: true,
                manga: false,
                parsed: None,
                position_sec: None,
                duration_sec: None,
            });
        }
    }
    // No pause check on the manga rung, and it would be wrong to add one: a
    // reader is a browser tab that makes no sound, so its process reads as
    // Inactive whenever no *other* tab is playing. Reading is not audible, and
    // the wall clock is the only progress signal it ever had.
    for w in &windows {
        if let Some(media) = profiles::match_manga(&w.process, &w.title) {
            return Some(Playback {
                process: w.process.clone(),
                media_title: media,
                streaming: true,
                manga: true,
                parsed: None,
                position_sec: None,
                duration_sec: None,
            });
        }
    }
    None
}

/// Full sweep, in order of how much each source actually knows.
///
/// A *playing* mpv IPC pipe comes first when the user has configured one: it
/// reports the real file path **and** a live position, and a pipe the user
/// wrote into `mpv.conf` is the most explicit signal in the whole pipeline.
/// The Jellyfin API is next (server URL, API key *and* a user — see
/// `jellyfin`): series and episode as separate fields plus a position,
/// beating anything derived from a string. Window titles come next. The
/// desktop's media sessions come last — a browser playing Crunchyroll appears
/// in both, and the site-marker path produces a cleaner title, so the session
/// pass only gets a look in when nothing recognised a window. That is exactly
/// the Jellyfin Media Player case, where the title bar never changes.
///
/// A **paused** mpv is the exception to its own rung, and the reason is a real
/// bug this fixed: Karasu now launches mpv itself, so an mpv window left
/// paused an hour ago sat at the top of this order forever and hid a Jellyfin
/// episode that was actually playing. A paused pipe is therefore held aside
/// and used only when every other source came up empty — still the honest
/// answer when it is the only thing on the machine, never an answer that
/// outranks something live.
///
/// The order holds on Linux too, but the window rung is empty there: window
/// enumeration has no X11/Wayland backend, so after mpv and Jellyfin the
/// media-session pass is the only generic source.
pub async fn detect_playback(
    media_detection: bool,
    jellyfin: Option<jellyfin::JellyfinConfig>,
    mpv: Option<mpv_ipc::MpvConfig>,
) -> Option<Playback> {
    let mut paused_mpv: Option<Playback> = None;
    if let Some(cfg) = mpv {
        if let Some((p, paused)) = mpv_ipc::detect(&cfg).await {
            if !paused {
                crate::logging::debug_changed("detect", "source", format!("mpv ipc: {:?}", p.media_title));
                return Some(p);
            }
            paused_mpv = Some(p);
        }
    }
    if let Some(cfg) = jellyfin {
        if let Some(p) = jellyfin::detect(&cfg).await {
            crate::logging::debug_changed("detect", "source", format!("jellyfin: {:?}", p.media_title));
            return Some(p);
        }
    }
    // Blocking Win32/WinRT and D-Bus work; keep it off the runtime's worker
    // thread.
    let found = tokio::task::spawn_blocking(move || {
        // Which rung won, said at each rung rather than once afterwards:
        // `Playback` carries no source field, so a single line after the fact
        // could not tell a window title from a media session — and the
        // precedence documented above is the most confusing part of the
        // pipeline. `or_else` also collapses the branch, so there is no later
        // point that still knows.
        if let Some(p) = detect_windows() {
            crate::logging::debug_changed("detect", "source", format!("window title: {:?}", p.media_title));
            return Some(p);
        }
        if !media_detection {
            return None;
        }
        let found = media_session::detect();
        if let Some(p) = &found {
            crate::logging::debug_changed("detect", "source", format!("media session: {:?}", p.media_title));
        }
        found
    })
    .await
    .unwrap_or(None);

    // Nothing live anywhere: a paused pipe is still what is on this machine.
    if found.is_none() {
        if let Some(p) = &paused_mpv {
            crate::logging::debug_changed(
                "detect",
                "source",
                format!("mpv ipc (paused): {:?}", p.media_title),
            );
        }
    }
    found.or(paused_mpv)
}
