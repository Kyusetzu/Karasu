//! Detection of running media playback via visible windows
//! (Karasu's counterpart to Taiga's Anisthesia).

pub mod jellyfin;
pub mod media_session;
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

/// Non-Windows groundwork: window enumeration isn't wired up yet (it needs an
/// X11/Wayland backend), so detection is a no-op here for now.
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
fn process_name(pid: u32) -> Option<String> {
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
    // Local players take precedence over browser detection
    for w in &windows {
        if let Some(media) = profiles::match_player(&w.process, &w.title) {
            return Some(Playback {
                process: w.process.clone(),
                media_title: media,
                streaming: false,
                manga: false,
                parsed: None,
            });
        }
    }
    for w in &windows {
        if let Some(media) = profiles::match_streaming(&w.process, &w.title) {
            return Some(Playback {
                process: w.process.clone(),
                media_title: media,
                streaming: true,
                manga: false,
                parsed: None,
            });
        }
    }
    for w in &windows {
        if let Some(media) = profiles::match_manga(&w.process, &w.title) {
            return Some(Playback {
                process: w.process.clone(),
                media_title: media,
                streaming: true,
                manga: true,
                parsed: None,
            });
        }
    }
    None
}

/// Full sweep, in order of how much each source actually knows.
///
/// The Jellyfin API comes first when it is configured (server URL, API key
/// *and* a user — see `jellyfin`): it reports the series and episode as
/// separate fields, so it beats anything derived from a string. Window titles
/// come next. The desktop's media sessions come last —
/// a browser playing Crunchyroll appears in both, and the site-marker path
/// produces a cleaner title, so the session pass only gets a look in when
/// nothing recognised a window. That is exactly the Jellyfin Media Player
/// case, where the title bar never changes.
///
/// The order holds on Linux too, but the middle rung is empty there: window
/// enumeration has no X11/Wayland backend, so the media-session pass is the
/// only generic source and effectively runs first.
pub async fn detect_playback(
    media_detection: bool,
    jellyfin: Option<jellyfin::JellyfinConfig>,
) -> Option<Playback> {
    if let Some(cfg) = jellyfin {
        if let Some(p) = jellyfin::detect(&cfg).await {
            return Some(p);
        }
    }
    // Blocking Win32/WinRT and D-Bus work; keep it off the runtime's worker
    // thread.
    tokio::task::spawn_blocking(move || {
        detect_windows().or_else(|| {
            if media_detection {
                media_session::detect()
            } else {
                None
            }
        })
    })
    .await
    .unwrap_or(None)
}
