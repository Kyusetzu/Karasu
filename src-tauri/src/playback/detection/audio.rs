//! Whether the process behind a window is actually playing anything.
//!
//! The window-title rung has no play state of its own. A title is a string:
//! mpv, VLC, MPC-HC and PotPlayer all keep showing the file name while paused,
//! and none of the profiled players writes a pause marker into it. So a player
//! left paused mid-episode kept the scrobbler's wall clock running, and the
//! episode was written as watched — the one detection rung where that was
//! still true after the media-session rung learned to read `PlayState`.
//!
//! The signal used instead is the audio session. WASAPI tracks one per
//! process: `AudioSessionStateActive` while the process is submitting samples,
//! `AudioSessionStateInactive` once it stops. Pausing a player stops the
//! submission, so the session goes Inactive within about a second — and this
//! is a documented, per-process, non-privileged API rather than a heuristic
//! over a string.
//!
//! **Only an explicit Inactive suppresses detection.** Every other outcome —
//! no session for that process, an Expired one, a COM failure, a machine with
//! no audio endpoint at all, Linux — means "unknown", and unknown keeps the
//! behaviour this module replaced. That asymmetry is the whole safety
//! argument: a silent video, `mpv --no-audio`, an exclusive-mode device or a
//! headless VM cannot make Karasu stop seeing playback, because none of them
//! produces an Inactive session. The failure mode is "as before", never "blind".
//!
//! Expired is deliberately not Paused. It means the player released the device
//! entirely, which some players do on pause and others only on stop, so it
//! cannot tell the two apart. Unknown is the honest answer.
//!
//! The split follows `media_session/mod.rs`: the backend supplies data, this
//! module decides, and the decision is tested on both platforms rather than
//! only in the Linux CI job.

// `PlayState::Playing` and `record` are constructed only by the Windows
// backend and the tests, so a Linux `cargo check` — which compiles neither the
// backend nor `#[cfg(test)]` — reports them dead. They are not: they are the
// half of this module that only one platform runs, which is the shape the
// media-session split established. Scoped to `not(windows)` on purpose, so the
// Windows build still gets a real dead-code warning if one of them ever
// genuinely stops being called there.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::HashMap;

/// What the audio stack says about one process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayState {
    Playing,
    Paused,
}

/// Lower-case process name (`"mpv.exe"`) to what its audio session reports.
///
/// A process with no entry is not in any state — it is unmeasured, which is
/// what `is_paused` reads as "carry on".
pub type PlayStates = HashMap<String, PlayState>;

/// Whether detection should stand down for this process.
///
/// True *only* on a recorded `Paused`. This is the pure half, and the one the
/// tests exercise; everything above it is a data source.
pub fn is_paused(states: &PlayStates, process: &str) -> bool {
    states.get(process) == Some(&PlayState::Paused)
}

/// Folds one session's reading into the map.
///
/// A process can own several sessions — a browser has one per tab that has
/// ever played, and a player may hold a second for its notification sound.
/// Playing wins: one active stream means the process is playing, however many
/// idle ones sit beside it. Without this rule a browser with six spent tabs
/// and one playing video reported whichever session happened to enumerate
/// last.
pub fn record(states: &mut PlayStates, process: String, state: PlayState) {
    if states.get(&process) == Some(&PlayState::Playing) {
        return;
    }
    states.insert(process, state);
}

#[cfg(windows)]
mod backend {
    use super::{record, PlayState, PlayStates};
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateInactive,
        IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    /// Every render session on the default endpoint, by process name.
    ///
    /// Every step returns the map built so far rather than propagating an
    /// error, because a partial reading is exactly as safe as an empty one:
    /// what is absent is unknown, and unknown does not suppress.
    pub fn play_states() -> PlayStates {
        let mut out = PlayStates::new();
        unsafe {
            // The result is deliberately dropped. Detection runs on a
            // `spawn_blocking` thread that nothing else initialises, so this
            // is usually the call that succeeds; if the thread already has an
            // apartment this answers RPC_E_CHANGED_MODE, which is not a
            // failure — COM is initialised either way and the calls below work
            // in either apartment.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let Ok(enumerator) =
                CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return out;
            };
            // The default endpoint only. A player sent to a second device is
            // then unmeasured rather than wrong, which is the safe direction.
            let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) else {
                return out;
            };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else {
                return out;
            };
            let Ok(sessions) = manager.GetSessionEnumerator() else {
                return out;
            };
            let Ok(count) = sessions.GetCount() else {
                return out;
            };

            for i in 0..count {
                let Ok(ctrl) = sessions.GetSession(i) else {
                    continue;
                };
                let Ok(ctrl2) = ctrl.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(pid) = ctrl2.GetProcessId() else {
                    continue;
                };
                let Ok(state) = ctrl.GetState() else {
                    continue;
                };
                // Expired falls through to `continue`: see the module note.
                let seen = if state == AudioSessionStateActive {
                    PlayState::Playing
                } else if state == AudioSessionStateInactive {
                    PlayState::Paused
                } else {
                    continue;
                };
                let Some(name) = super::super::process_name(pid) else {
                    continue;
                };
                record(&mut out, name, seen);
            }
        }
        out
    }
}

/// No window enumeration on Linux, so nothing here to hang a play state on —
/// and the media-session rung reads MPRIS's own `PlaybackStatus` anyway.
#[cfg(not(windows))]
mod backend {
    pub fn play_states() -> super::PlayStates {
        super::PlayStates::new()
    }
}

pub use backend::play_states;

#[cfg(test)]
mod tests {
    use super::*;

    fn states(pairs: &[(&str, PlayState)]) -> PlayStates {
        pairs.iter().map(|(p, s)| ((*p).to_string(), *s)).collect()
    }

    /// The asymmetry the module is built on: absence never suppresses.
    #[test]
    fn an_unmeasured_process_is_not_paused() {
        let s = states(&[("vlc.exe", PlayState::Paused)]);
        assert!(!is_paused(&s, "mpv.exe"), "no reading for mpv");
        assert!(!is_paused(&PlayStates::new(), "mpv.exe"), "no readings at all");
    }

    #[test]
    fn only_an_explicit_pause_suppresses() {
        let s = states(&[("mpv.exe", PlayState::Paused), ("vlc.exe", PlayState::Playing)]);
        assert!(is_paused(&s, "mpv.exe"));
        assert!(!is_paused(&s, "vlc.exe"));
    }

    /// A browser holds a session per tab that has ever played. Six spent tabs
    /// and one playing video is a playing browser, and before `record` the
    /// answer depended on enumeration order.
    #[test]
    fn one_playing_session_outvotes_any_number_of_idle_ones() {
        let mut s = PlayStates::new();
        for _ in 0..6 {
            record(&mut s, "chrome.exe".into(), PlayState::Paused);
        }
        record(&mut s, "chrome.exe".into(), PlayState::Playing);
        record(&mut s, "chrome.exe".into(), PlayState::Paused);
        assert!(!is_paused(&s, "chrome.exe"));
    }

    #[test]
    fn a_pause_after_nothing_still_registers() {
        let mut s = PlayStates::new();
        record(&mut s, "mpv.exe".into(), PlayState::Paused);
        assert!(is_paused(&s, "mpv.exe"));
    }

    /// The Linux build has no backend, and the pure half must still answer.
    #[cfg(not(windows))]
    #[test]
    fn without_a_backend_nothing_is_ever_paused() {
        assert!(play_states().is_empty());
        assert!(!is_paused(&play_states(), "mpv.exe"));
    }
}
