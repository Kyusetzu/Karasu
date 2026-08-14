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

/// The scrobble-confirm toast — the one notification with a button, because
/// its whole purpose *is* an action and the window it would otherwise be
/// confirmed in may be hidden in the tray.
///
/// Deliberately not recorded in the bell, unlike everything else in this file:
/// it is a transient prompt about a session that resolves within minutes, not
/// news, and a bell holding last week's stale "confirm?" rows would bury the
/// notices that are. The header's "nothing shown without being logged" rule is
/// served by the scrobble log lines instead.
///
/// The button's click can arrive minutes late, so it carries the session it
/// was raised for and the confirm path re-checks `applies_to` — a toast for
/// episode 5 must never confirm episode 6. When the platform path fails, the
/// plain plugin toast is the fallback: the news still lands, just buttonless.
pub fn notify_scrobble_confirm(
    app: &AppHandle,
    title: &str,
    body: &str,
    media_id: i64,
    episode: u32,
) {
    if let Err(e) = toast_with_action(app, title, body, media_id, episode) {
        crate::logging::warn(
            "notify",
            format!("action toast failed ({e}); showing a plain one"),
        );
        if let Err(e) = app.notification().builder().title(title).body(body).show() {
            crate::logging::warn(
                "notify",
                format!("the desktop refused the scrobble toast too: {e}"),
            );
        }
    }
}

/// Windows: `tauri-winrt-notification` directly, since the plugin wrapping it
/// drops buttons. Toasts are attributed by AppUserModelID; installed builds
/// registered the bundle identifier through NSIS, while a dev build has no
/// registration at all — the PowerShell id is the same stand-in the plugin
/// uses there.
#[cfg(windows)]
fn toast_with_action(
    app: &AppHandle,
    title: &str,
    body: &str,
    media_id: i64,
    episode: u32,
) -> Result<(), String> {
    use tauri_winrt_notification::Toast;

    let app_id = if cfg!(debug_assertions) {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    let handle = app.clone();
    Toast::new(&app_id)
        .title(title)
        .text1(body)
        .add_button("Update now", "confirm")
        .on_activated(move |action| {
            if action.as_deref() == Some("confirm") {
                let app = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) =
                        crate::playback::scrobbler::confirm_pending_for(app, media_id, episode)
                            .await
                    {
                        crate::logging::warn("notify", format!("toast confirm failed: {e}"));
                    }
                });
            }
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

/// Linux: `notify-rust` directly, same reasoning as the Windows half. The
/// daemon reports clicks through `wait_for_action`, which parks its thread
/// until the toast is acted on or dismissed — a spawned thread's, never the
/// async runtime's. A daemon without action support simply reports a close,
/// which the exact-match guard ignores.
#[cfg(target_os = "linux")]
fn toast_with_action(
    app: &AppHandle,
    title: &str,
    body: &str,
    media_id: i64,
    episode: u32,
) -> Result<(), String> {
    use notify_rust::Notification;

    let handle = Notification::new()
        .summary(title)
        .body(body)
        .appname("Karasu")
        .action("confirm", "Update now")
        .show()
        .map_err(|e| e.to_string())?;
    let app = app.clone();
    std::thread::spawn(move || {
        handle.wait_for_action(|action| {
            if action == "confirm" {
                tauri::async_runtime::spawn(async move {
                    if let Err(e) =
                        crate::playback::scrobbler::confirm_pending_for(app, media_id, episode)
                            .await
                    {
                        crate::logging::warn("notify", format!("toast confirm failed: {e}"));
                    }
                });
            }
        });
    });
    Ok(())
}
