//! Single entry point for user notifications: records the item in the in-app
//! notification centre (SQLite), shows the native desktop toast, and tells the
//! frontend to refresh its bell. The background watchers (airing, stale,
//! sequel) all go through here so nothing is shown without also being logged.

use crate::db::Db;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Record + toast + notify the UI. `kind` groups notifications
/// ("airing" | "stale" | "sequel").
pub fn notify(app: &AppHandle, kind: &str, title: &str, body: &str) {
    let _ = app.state::<Db>().notif_insert(kind, title, body, now_ms());
    let _ = app.notification().builder().title(title).body(body).show();
    let _ = app.emit("notifications-changed", ());
}
