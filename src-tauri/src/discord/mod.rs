//! Discord Rich Presence. Stays active the whole time Karasu runs: when
//! nothing is playing it shows the page the user is looking at, and when
//! detection fires it switches to the title with an episode progress bar.
//! Every state carries a "Get Karasu here" button.
//! Uses the built-in application ID or a user override from the settings.

use crate::db::Db;
use crate::scrobbler::{NowPlaying, PlaybackState, ScrobbleSession};
use discord_rich_presence::{
    activity::{Activity, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Built-in Discord application ID (public, not a secret) — one shared
/// app for all users, as in Taiga. Empty = the feature requires a custom
/// ID in the settings. Set once by the maintainer.
pub const BUILTIN_DISCORD_APP_ID: &str = "1527934275356332133";

const REPO_URL: &str = "https://github.com/Kyusetzu/Karasu";

pub struct Discord(pub Mutex<Option<DiscordIpcClient>>);

/// The page the user is currently looking at, shown as the idle presence.
pub struct UiPage(pub Mutex<String>);

impl Default for UiPage {
    fn default() -> Self {
        UiPage(Mutex::new("Overview".to_string()))
    }
}

/// Effective app ID: user override from the settings or the built-in one.
pub fn effective_app_id(custom: &str) -> String {
    let custom = custom.trim();
    if custom.is_empty() {
        BUILTIN_DISCORD_APP_ID.to_string()
    } else {
        custom.to_string()
    }
}

fn disconnect(guard: &mut Option<DiscordIpcClient>) {
    if let Some(mut client) = guard.take() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Start of the running session (epoch seconds) if it matches the playback,
/// else now — so the elapsed timer starts fresh.
fn session_start(app: &AppHandle, np: &NowPlaying) -> i64 {
    let state = app.state::<ScrobbleSession>();
    let guard = state.0.lock().unwrap();
    match guard.as_ref() {
        Some(s) if Some(s.media_id) == np.media_id => s.started_ms / 1000,
        _ => now_secs(),
    }
}

/// Episode length in minutes for the matched entry, if known.
fn episode_duration(app: &AppHandle, np: &NowPlaying) -> Option<u32> {
    let media_id = np.media_id?;
    let db = app.state::<Db>();
    crate::scrobbler::candidates_from_cache(&db, &np.media_type)
        .iter()
        .find(|c| c.media_id == media_id)
        .and_then(|c| c.duration_min)
}

/// Re-syncs the presence using the current playback state (used after a UI
/// page change, where the caller has no NowPlaying at hand).
pub fn sync_current(app: &AppHandle) {
    let now = app.state::<PlaybackState>().0.lock().unwrap().clone();
    sync(app, now.as_ref());
}

/// Syncs the presence with the current playback (or the idle page). Called
/// on every detection change, page change and settings change.
pub fn sync(app: &AppHandle, now: Option<&NowPlaying>) {
    let db = app.state::<Db>();
    let enabled = db.kv_get("discord_enabled").as_deref() == Some("1");
    let app_id = effective_app_id(&db.kv_get("discord_app_id").unwrap_or_default());

    let state = app.state::<Discord>();
    let mut guard = state.0.lock().unwrap();

    if !enabled || app_id.is_empty() {
        disconnect(&mut guard);
        return;
    }

    // Connect lazily; if Discord is not running, stay quiet and retry later.
    if guard.is_none() {
        // discord-rich-presence 1.x returns the client directly (no Result).
        let mut client = DiscordIpcClient::new(&app_id);
        if client.connect().is_ok() {
            *guard = Some(client);
        } else {
            return;
        }
    }

    // Never broadcast a title the user's content filter hides — the presence
    // is the one surface other people see, so it matters most here. Falls back
    // to the idle presence rather than going silent.
    let level = crate::commands::read_content_filter(&db);
    let now = now.filter(|np| {
        np.media_id
            .map(|id| !crate::commands::media_id_blocked(&db, id, &level))
            .unwrap_or(true)
    });

    // Build the two presence strings and the timestamps.
    let (details, state_text, timestamps) = match now {
        Some(np) => {
            let title = np
                .matched_title
                .clone()
                .unwrap_or_else(|| np.parsed_title.clone());
            let is_manga = np.media_type == "MANGA";
            let state_text = match np.episode {
                Some(e) if is_manga => format!("Chapter {e}"),
                Some(e) => match np.total_episodes {
                    Some(total) => format!("Episode {e} / {total}"),
                    None => format!("Episode {e}"),
                },
                None if is_manga => "Reading".to_string(),
                None => "Watching".to_string(),
            };
            // Elapsed timer, plus a progress bar when the episode length is
            // known (approximates how far into the episode you are).
            let start = session_start(app, np);
            let timestamps = match (is_manga, episode_duration(app, np)) {
                (false, Some(min)) => Timestamps::new()
                    .start(start)
                    .end(start + i64::from(min) * 60),
                _ => Timestamps::new().start(start),
            };
            (title, state_text, timestamps)
        }
        None => {
            let page = app.state::<UiPage>().0.lock().unwrap().clone();
            (format!("Looking at {page}"), "Idle".to_string(), Timestamps::new())
        }
    };

    // A large image asset makes the presence card look complete in every
    // state. The "logo" key must be uploaded as an art asset in the Discord
    // developer portal for the built-in application id.
    let activity = Activity::new()
        .details(&details)
        .state(&state_text)
        .assets(Assets::new().large_image("logo").large_text("Karasu"))
        .timestamps(timestamps)
        .buttons(vec![Button::new("Get Karasu here", REPO_URL)]);

    if let Some(client) = guard.as_mut() {
        if client.set_activity(activity).is_err() {
            disconnect(&mut guard);
        }
    }
}
