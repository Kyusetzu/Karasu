//! Discord Rich Presence, showing the viewed page while idle and the playing title once detection fires.

use crate::db::Db;
use crate::sync::LockExt;
use crate::playback::scrobbler::{NowPlaying, PlaybackState, ScrobbleSession};
use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Built-in Discord application ID (public, not a secret); empty would make the feature require a custom ID.
pub const BUILTIN_DISCORD_APP_ID: &str = "1527934275356332133";

const REPO_URL: &str = "https://github.com/Kyusetzu/Karasu";

pub struct Discord(pub Mutex<Option<DiscordIpcClient>>);

/// Last sent fingerprint and time: identical payloads are skipped, then re-sent so a dead pipe is still noticed.
pub struct LastPresence(pub Mutex<(String, std::time::Instant)>);

/// How long an identical presence may coast before it is re-sent anyway.
const RESEND_SECS: u64 = 60;

impl Default for LastPresence {
    fn default() -> Self {
        LastPresence(Mutex::new((String::new(), std::time::Instant::now())))
    }
}

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

fn disconnect(app: &AppHandle, guard: &mut Option<DiscordIpcClient>) {
    if let Some(mut client) = guard.take() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
    // Whatever was showing is gone with the connection.
    app.state::<LastPresence>().0.guard().0.clear();
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Start of the running session in epoch seconds if it matches the playback, else now so the timer starts fresh.
fn session_start(app: &AppHandle, np: &NowPlaying) -> i64 {
    let state = app.state::<ScrobbleSession>();
    let guard = state.0.guard();
    match guard.as_ref() {
        Some(s) if Some(s.media_id) == np.media_id => s.started_ms / 1000,
        _ => now_secs(),
    }
}

/// Re-syncs the presence from the current playback state, for callers with no NowPlaying at hand.
pub fn sync_current(app: &AppHandle) {
    let now = app.state::<PlaybackState>().0.guard().clone();
    sync(app, now.as_ref());
}

/// Syncs the presence with the current playback or the idle page, on every detection, page and settings change.
pub fn sync(app: &AppHandle, now: Option<&NowPlaying>) {
    let db = app.state::<Db>();
    let enabled = db.kv_get("discord_enabled").as_deref() == Some("1");
    let app_id = effective_app_id(&db.kv_get("discord_app_id").unwrap_or_default());

    let state = app.state::<Discord>();
    let mut guard = state.0.guard();

    if !enabled || app_id.is_empty() {
        disconnect(app, &mut guard);
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

    // Never broadcast a title the content filter hides; the presence is the one surface other people see.
    let level = crate::commands::read_content_filter(&db);
    let now = now.filter(|np| {
        match np.media_id {
            Some(id) => !crate::commands::media_id_blocked(&db, id, &level),
            // With the filter on, an unmatched detection is not broadcast: that is where adult content lands.
            None => level == "off",
        }
    });

    // The start second rides along for the fingerprint: it pins the elapsed timer, so it is part of the identity.
    let (details, state_text, timestamps, kind, fingerprint_start) = match now {
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
            // Elapsed timer, plus a progress bar when the episode length is known.
            let start = session_start(app, np);
            let timestamps = match (is_manga, np.duration_min) {
                (false, Some(min)) => Timestamps::new()
                    .start(start)
                    .end(start + i64::from(min) * 60),
                _ => Timestamps::new().start(start),
            };
            // "Watching X" reads better than "Playing Karasu" for video; Discord has no Reading type, so manga keeps Playing.
            let kind = if is_manga {
                ActivityType::Playing
            } else {
                ActivityType::Watching
            };
            (title, state_text, timestamps, kind, start)
        }
        None => {
            let page = app.state::<UiPage>().0.guard().clone();
            (
                format!("Looking at {page}"),
                "Idle".to_string(),
                Timestamps::new(),
                ActivityType::Playing,
                0,
            )
        }
    };

    // Up to two buttons; the AniList one only appears when detection matched a real entry.
    let anilist_url = now.and_then(|np| {
        np.media_id.map(|id| {
            let kind = if np.media_type == "MANGA" { "manga" } else { "anime" };
            format!("https://anilist.co/{kind}/{id}")
        })
    });
    let mut buttons = vec![Button::new("Get Karasu here", REPO_URL)];
    if let Some(url) = anilist_url.as_deref() {
        buttons.push(Button::new("View on AniList", url));
    }

    // The cover goes in `large_image` as a plain URL; unmatched states keep "logo", which must stay uploaded in the portal.
    let cover = now.and_then(|np| np.cover_url.as_deref());
    let assets = match cover {
        Some(url) => Assets::new()
            .large_image(url)
            .large_text(&details)
            .small_image("logo")
            .small_text("Karasu"),
        None => Assets::new().large_image("logo").large_text("Karasu"),
    };

    // Skip a payload identical to the one showing; `duration` is included because the end timestamp derives from it.
    let fingerprint = format!(
        "{details}|{state_text}|{cover}|{buttons}|{start}|{duration:?}",
        cover = cover.unwrap_or(""),
        buttons = anilist_url.as_deref().unwrap_or(""),
        start = fingerprint_start,
        duration = now.and_then(|np| np.duration_min),
    );
    {
        let last = app.state::<LastPresence>();
        let mut last = last.0.guard();
        if last.0 == fingerprint && last.1.elapsed().as_secs() < RESEND_SECS {
            return;
        }
        *last = (fingerprint, std::time::Instant::now());
    }

    let activity = Activity::new()
        .activity_type(kind)
        .details(&details)
        .state(&state_text)
        .assets(assets)
        .timestamps(timestamps)
        .buttons(buttons);

    if let Some(client) = guard.as_mut() {
        if client.set_activity(activity).is_err() {
            disconnect(app, &mut guard);
        }
    }
}
