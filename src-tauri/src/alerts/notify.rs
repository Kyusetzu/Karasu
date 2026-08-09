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
///
/// All three steps used to discard their result, which made "Karasu never tells
/// me anything" undiagnosable: a desktop that refuses toasts (Focus Assist on
/// Windows, no notification daemon on a bare Linux WM) looked exactly like a
/// watcher that had found nothing to say. The failures are still not fatal —
/// the bell entry is worth keeping even when the toast will not show — but each
/// one now leaves a line.
pub fn notify(app: &AppHandle, kind: &str, title: &str, body: &str) {
    if let Err(e) = app.state::<Db>().notif_insert(kind, title, body, now_ms()) {
        crate::logging::error("notify", format!("cannot record the {kind} notification: {e}"));
    }
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        crate::logging::warn(
            "notify",
            format!(
                "the desktop refused a {kind} notification: {e}. It is still in the bell."
            ),
        );
    }
    if let Err(e) = app.emit("notifications-changed", ()) {
        crate::logging::warn("notify", format!("cannot refresh the bell: {e}"));
    }
}
