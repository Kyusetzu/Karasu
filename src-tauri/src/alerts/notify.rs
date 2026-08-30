//! Single entry point for user notifications: records the item in the in-app
//! notification centre (SQLite), shows the native desktop toast, and tells the
//! frontend to refresh its bell. The background watchers (airing, stale,
//! sequel) all go through here so nothing is shown without also being logged.
//!
//! Two functions here skip the bell row on purpose, and each says why beside
//! itself: `notify_scrobble_confirm`, and `notify_toast` for news that gets its
//! row somewhere else. In both cases the log lines are what serve the rule
//! above.

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

/// Record + toast + notify the UI. `kind` groups notifications
/// ("airing" | "stale" | "sequel").
///
/// Every step reports its own failure without any of them being fatal — the
/// bell entry is worth keeping even when the toast will not show, and vice
/// versa. Takes messages rather than sentences, rendered in `render` so the
/// toast, the bell row and the log cannot disagree about what was said.
///
/// What this does *not* do is re-render a bell row when the language changes
/// later: the row is stored as text, so yesterday's news stays in yesterday's
/// language. Storing the key and its parameters instead would fix that and
/// costs a migration, a payload format and a second renderer on the frontend —
/// for rows that expire at 500 and are read the day they arrive. The toast has
/// to be composed in Rust either way, since the OS shows it and no WebView is
/// involved.
///
/// `media_id` is what the bell row opens, and `None` is a real answer rather
/// than a gap: the app-update notice and an aggregated queue report are not
/// about a title. A row without one still marks itself read on click and does
/// nothing else, which is what every row did before schema v15.
pub fn notify(app: &AppHandle, kind: &str, title: Msg<'_>, body: Msg<'_>, media_id: Option<i64>) {
    let db = app.state::<Db>();
    let (title, body) = render(app, title, body);

    if let Err(e) = db.notif_insert(kind, &title, &body, now_ms(), media_id) {
        crate::logging::error("notify", format!("cannot record the {kind} notification: {e}"));
    }
    toast(app, kind, &title, &body, true);
    if let Err(e) = app.emit("notifications-changed", ()) {
        crate::logging::warn("notify", format!("cannot refresh the bell: {e}"));
    }
}

/// The toast without the bell row — for news that gets its row somewhere else.
///
/// The second function in this file to skip the bell on purpose, and for a
/// cousin of the reason `notify_scrobble_confirm` does: a row is worth writing
/// only when it is *the* record of the news. The one caller is the airing
/// watcher, on an account whose own AniList airing notifications are on.
/// AniList's row is strictly the better of the two there — it links to the
/// entry, it names the episode, and it is one segment away in the same panel —
/// so two rows are one row and a duplicate. What AniList cannot do is put a
/// toast on the desktop while Karasu sits in the tray, which is the entire
/// reason that watcher exists, so that half is untouched.
///
/// A separate function rather than a `record: bool` on `notify`: the flag would
/// have to sit beside the `media_id` of a row it is not writing, which is both
/// expressible and meaningless. And "does this belong in the bell" is a
/// property of the kind of news, settled once per call site, not a runtime
/// choice.
pub fn notify_toast(app: &AppHandle, kind: &str, title: Msg<'_>, body: Msg<'_>) {
    let (title, body) = render(app, title, body);
    toast(app, kind, &title, &body, false);
}

/// Compose once, in the user's language — the toast, the bell row and the log
/// cannot then disagree about what was said.
fn render(app: &AppHandle, title: Msg<'_>, body: Msg<'_>) -> (String, String) {
    let lang = crate::i18n::lang(&app.state::<Db>());
    (
        crate::i18n::text(lang, title),
        crate::i18n::text(lang, body),
    )
}

/// The desktop half.
///
/// All three steps used to discard their result, which made "Karasu never tells
/// me anything" undiagnosable: a desktop that refuses toasts (Focus Assist on
/// Windows, no notification daemon on a bare Linux WM) looked exactly like a
/// watcher that had found nothing to say. Still not fatal — but it leaves a
/// line, and `in_bell` decides whether that line can honestly promise the news
/// survived the refusal.
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

/// The one button on the one toast that has one.
///
/// Read per toast rather than cached: the language can change between two
/// scrobbles, and this costs a kv lookup on a path that already talks to the
/// OS notification service.
#[cfg(any(windows, target_os = "linux"))]
fn action_label(app: &AppHandle) -> String {
    crate::i18n::text(
        crate::i18n::lang(&app.state::<Db>()),
        crate::i18n::Msg::ConfirmAction,
    )
}

/// Windows: `tauri-winrt-notification` directly, since the plugin wrapping it
/// drops buttons. Toasts are attributed by AppUserModelID; installed builds
/// registered the bundle identifier through NSIS, while a dev build has no
/// registration at all — the PowerShell id is the same stand-in the plugin
/// uses there.
/// Mobile: the notification plugin shows plain toasts and nothing here can
/// carry a button, so the fallback path below is simply the path.
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

/// Asks the OS for notification permission, once, at startup.
///
/// Not a cfg'd pair, deliberately: the desktop backends answer `Granted`
/// unconditionally, so this is a no-op everywhere the question does not
/// exist. On Android 13+ the first launch shows the system dialog — the
/// honest moment, because the airing alert defaults *on* and a fresh
/// install would otherwise `show()` into the void with nothing ever asking.
/// Its own thread because the mobile request blocks until the user answers,
/// and `Denied` is respected: asked once by us, again only by the OS's own
/// rules, never nagged.
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
