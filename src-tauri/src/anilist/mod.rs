pub mod auth;
pub mod client;
pub mod login;

use std::time::Duration;
use tauri::Manager;

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
