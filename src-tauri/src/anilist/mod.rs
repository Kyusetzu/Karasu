pub mod auth;
pub mod client;
pub mod login;
pub mod query_cache;

use std::time::Duration;
use tauri::Manager;

/// The kv row the limiter's last measurement lives in; the Android job writes it too, in its own process.
pub const RATE_STATE_KEY: &str = "rate_state";

/// The limiter's persistence over the database, so a new process starts from the last measurement, not from a guess.
pub fn rate_store(app: tauri::AppHandle) -> client::RateStore {
    let load_app = app.clone();
    client::RateStore {
        load: Box::new(move || {
            let raw = load_app.state::<crate::db::Db>().kv_get(RATE_STATE_KEY)?;
            serde_json::from_str(&raw).ok()
        }),
        save: Box::new(move |p| {
            if let Ok(json) = serde_json::to_string(p) {
                let _ = app.state::<crate::db::Db>().kv_set(RATE_STATE_KEY, &json);
            }
        }),
    }
}

/// Every five minutes, whatever happened; a zero line is what proves a quiet night was quiet.
const REPORT_EVERY: Duration = Duration::from_secs(5 * 60);

/// Writes the per-source request tally to the log on a fixed cadence, like the scrobbler's poll line.
pub fn spawn_traffic_reporter(app: tauri::AppHandle) {
    crate::logging::supervise("anilist-report", move || {
        let app = app.clone();
        async move {
            loop {
                tokio::time::sleep(REPORT_EVERY).await;
                let line = app.state::<client::AniList>().report_window();
                crate::logging::debug("anilist", line);
            }
        }
    });
}
