//! Play state of a window's process from its WASAPI audio session; only an explicit Inactive ever suppresses.

// Only the Windows backend and the tests call these; scoped so the Windows build keeps its real dead-code warning.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::HashMap;

/// What the audio stack says about one process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayState {
    Playing,
    Paused,
}

/// Lower-case process name to what its audio session reports; an absent entry is unmeasured, not a state.
pub type PlayStates = HashMap<String, PlayState>;

/// Whether detection should stand down for this process: true only on a recorded `Paused`.
pub fn is_paused(states: &PlayStates, process: &str) -> bool {
    states.get(process) == Some(&PlayState::Paused)
}

/// Folds one session into the map; Playing wins, because one active stream beside idle ones is a playing process.
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

    /// Every render session on the default endpoint by process name; a partial map is as safe as an empty one.
    pub fn play_states() -> PlayStates {
        let mut out = PlayStates::new();
        unsafe {
            // Dropped on purpose: RPC_E_CHANGED_MODE from a thread that already has an apartment is fine either way.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let Ok(enumerator) =
                CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return out;
            };
            // The default endpoint only: a player sent to a second device is unmeasured rather than wrong.
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
                // Expired falls through: a player that released the device may be paused or stopped, so it stays unknown.
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

/// No window enumeration on Linux, so nothing to hang a play state on; MPRIS reports its own `PlaybackStatus`.
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

    /// A browser holds a session per tab that has ever played, and one playing tab makes a playing browser.
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
