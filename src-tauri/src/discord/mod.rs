//! Discord Rich Presence: zeigt den aktuell geschauten Anime an.
//! Braucht eine eigene Discord-Application-ID (Settings), da Karasu keine
//! zentral registrierte App ist.

use crate::db::Db;
use crate::scrobbler::NowPlaying;
use discord_rich_presence::{
    activity::{Activity, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Eingebaute Discord-Application-ID (öffentlich, kein Secret) — eine
/// geteilte App für alle Nutzer, wie bei Taiga. Leer = Feature erfordert
/// eine eigene ID in den Settings. Wird vom Maintainer einmalig eingetragen.
pub const BUILTIN_DISCORD_APP_ID: &str = "";

pub struct Discord(pub Mutex<Option<DiscordIpcClient>>);

/// Effektive App-ID: Nutzer-Override aus den Settings oder die eingebaute.
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

/// Gleicht die Presence mit der aktuellen Wiedergabe ab. Wird bei jeder
/// Änderung der Erkennung und nach Settings-Änderungen aufgerufen.
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

    let Some(np) = now else {
        if let Some(client) = guard.as_mut() {
            if client.clear_activity().is_err() {
                disconnect(&mut guard);
            }
        }
        return;
    };

    if guard.is_none() {
        let Ok(mut client) = DiscordIpcClient::new(&app_id) else {
            return;
        };
        if client.connect().is_ok() {
            *guard = Some(client);
        } else {
            return; // Discord läuft nicht — still bleiben
        }
    }

    let title = np
        .matched_title
        .clone()
        .unwrap_or_else(|| np.parsed_title.clone());
    let episode = np
        .episode
        .map(|e| format!("Episode {e}"))
        .unwrap_or_else(|| "Watching anime".to_string());
    let start = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let activity = Activity::new()
        .details(&title)
        .state(&episode)
        .timestamps(Timestamps::new().start(start));

    if let Some(client) = guard.as_mut() {
        if client.set_activity(activity).is_err() {
            disconnect(&mut guard);
        }
    }
}
