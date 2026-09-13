//! The single entry point for notifications: the bell row, the desktop toast and the frontend refresh, together.

use crate::db::Db;
use crate::i18n::Msg;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub(crate) fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Who a bell row belongs to: only the app-update notice is unowned, so it stays readable while signed out.
fn owner_for(kind: &str, db: &Db) -> Option<i64> {
    if kind == "update" {
        None
    } else {
        crate::commands::list::viewer_id(db)
    }
}

/// Record, toast and refresh the bell; every step reports its own failure and none of them is fatal.
pub fn notify(app: &AppHandle, kind: &str, title: Msg<'_>, body: Msg<'_>, media_id: Option<i64>) {
    let db = app.state::<Db>();
    let (title, body) = render(app, title, body);

    if let Err(e) = db.notif_insert(kind, &title, &body, now_ms(), media_id, owner_for(kind, &db)) {
        crate::logging::error("notify", format!("cannot record the {kind} notification: {e}"));
    }
    toast(app, kind, &title, &body, true);
    if let Err(e) = app.emit("notifications-changed", ()) {
        crate::logging::warn("notify", format!("cannot refresh the bell: {e}"));
    }
}

/// The toast without the bell row, for news whose row AniList already renders better than a duplicate would.
pub fn notify_toast(app: &AppHandle, kind: &str, title: Msg<'_>, body: Msg<'_>) {
    let (title, body) = render(app, title, body);
    toast(app, kind, &title, &body, false);
}

/// Compose once in the user's language, so the toast, the bell row and the log cannot disagree.
fn render(app: &AppHandle, title: Msg<'_>, body: Msg<'_>) -> (String, String) {
    let lang = crate::i18n::lang(&app.state::<Db>());
    (
        crate::i18n::text(lang, title),
        crate::i18n::text(lang, body),
    )
}

/// The desktop half; not fatal, but a refused toast leaves a line saying whether the news survived in the bell.
fn toast(app: &AppHandle, kind: &str, title: &str, body: &str, in_bell: bool) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        let fallback = if in_bell {
            "It is still in the bell."
        } else {
            "AniList's own notification carries it instead."
        };
        crate::logging::warn(
            "notify",
            format!("the desktop refused a {kind} notification: {e}. {fallback}"),
        );
    }
}

/// The one toast with a button, kept out of the bell because a stale "confirm?" row would bury real news.
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

/// The one button's label, read per toast because the language can change between two scrobbles.
#[cfg(any(windows, target_os = "linux"))]
fn action_label(app: &AppHandle) -> String {
    crate::i18n::text(
        crate::i18n::lang(&app.state::<Db>()),
        crate::i18n::Msg::ConfirmAction,
    )
}

/// Mobile: the notification plugin's toasts carry no button, so the plain fallback is simply the path.
#[cfg(mobile)]
fn toast_with_action(
    _app: &AppHandle,
    _title: &str,
    _body: &str,
    _media_id: i64,
    _episode: u32,
) -> Result<(), String> {
    Err("action toasts are desktop-only".into())
}

/// Windows: `tauri-winrt-notification` directly, since the plugin wrapping it drops buttons.
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
        .add_button(&action_label(app), "confirm")
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

/// Linux: `notify-rust` directly; `wait_for_action` parks a spawned thread, never the async runtime's.
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
        .action("confirm", &action_label(app))
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

/// Asks for notification permission once at startup, on its own thread, and never nags after a `Denied`.
pub fn ensure_permission(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        use tauri_plugin_notification::PermissionState;
        match app.notification().permission_state() {
            Ok(PermissionState::Granted) | Ok(PermissionState::Denied) => {}
            Ok(_) => {
                if let Err(e) = app.notification().request_permission() {
                    crate::logging::warn(
                        "notify",
                        format!("notification permission request failed: {e}"),
                    );
                }
            }
            Err(e) => crate::logging::warn(
                "notify",
                format!("notification permission state unreadable: {e}"),
            ),
        }
    });
}
