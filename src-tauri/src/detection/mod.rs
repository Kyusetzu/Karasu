//! Erkennung laufender Medienwiedergabe über sichtbare Fenster
//! (Karasus Gegenstück zu Taigas Anisthesia).

pub mod profiles;

use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsWindowVisible,
};

#[derive(Debug, Clone, PartialEq)]
pub struct WindowInfo {
    /// Prozessname in Kleinbuchstaben, z. B. "mpv.exe"
    pub process: String,
    pub title: String,
}

/// Kandidat aus einem Player- oder Browser-Fenster.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Playback {
    pub process: String,
    /// Bereinigter Medientitel (Dateiname bzw. Streaming-/Lese-Titel)
    pub media_title: String,
    /// true, wenn aus einem Browser-/Streaming-Fenster erkannt
    pub streaming: bool,
    /// true, wenn es sich um Manga-Lesen handelt (Kapitel statt Episoden)
    pub manga: bool,
}

/// Listet alle sichtbaren Top-Level-Fenster mit Titel und Prozessnamen.
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

/// Manueller Live-Test: `cargo test live_detect -- --ignored --nocapture`
/// bei laufendem Player zeigt alle Fenster und das Erkennungsergebnis.
#[cfg(test)]
mod live_tests {
    #[test]
    #[ignore]
    fn live_detect() {
        for w in super::enumerate_windows() {
            println!("FENSTER: {} | {}", w.process, w.title);
        }
        println!("ERKANNT: {:?}", super::detect_playback());
    }
}

/// Sucht in allen Fenstern nach laufender Anime-Wiedergabe oder Manga-Lesen.
pub fn detect_playback() -> Option<Playback> {
    let windows = enumerate_windows();
    // Lokale Player haben Vorrang vor Browser-Erkennung
    for w in &windows {
        if let Some(media) = profiles::match_player(&w.process, &w.title) {
            return Some(Playback {
                process: w.process.clone(),
                media_title: media,
                streaming: false,
                manga: false,
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
            });
        }
    }
    None
}
