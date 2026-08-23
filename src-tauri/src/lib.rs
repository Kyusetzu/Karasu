mod alerts;
mod anilist;
mod backups;
mod commands;
mod db;
mod diagnostics;
mod discord;
mod identify;
mod library;
mod logging;
mod playback;
mod i18n;
mod portable;
mod sync;

use tauri::{AppHandle, Manager, Wry};
// These three are used only from the desktop half of this file (the tray's
// menu handles and its emits), so they gate with it — an unconditional import
// is an unused-import warning on every Android check.
#[cfg(desktop)]
use crate::sync::LockExt;
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::Emitter;
// The menu and tray modules do not exist in a mobile build of tauri, so the
// imports gate with the code that uses them. `cfg(desktop)` / `cfg(mobile)`
// are tauri-build's own flags — the blessed spelling for this split, where a
// hand-rolled `not(target_os = "android")` would silently miss iOS.
#[cfg(desktop)]
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    WindowEvent,
};

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The global hotkey's action: summon the window, or put it away if it is the
/// thing on top right now. Focus decides, not visibility — a window that is
/// technically visible but buried under something else should come forward,
/// not vanish.
#[cfg(desktop)]
fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let focused = window.is_focused().unwrap_or(false);
        let visible = window.is_visible().unwrap_or(false);
        if focused && visible {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

/// (Re)binds the summon hotkey. The hotkey is the only global shortcut Karasu
/// registers, so `unregister_all` is exact rather than approximate; `None`
/// simply leaves everything unbound. Lives here beside the window helpers it
/// drives — `commands::set_global_hotkey` and startup both call through this,
/// so a registration failure looks identical from either path.
#[cfg(desktop)]
pub(crate) fn apply_global_hotkey(app: &AppHandle, accel: Option<&str>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    if let Some(accel) = accel {
        shortcuts
            .on_shortcut(accel, |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    toggle_main_window(app);
                }
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// No global shortcuts on mobile — quietly, not as an error: the setting can
/// never be *stored* there (separate database), so the only caller is the
/// startup path reading an absent key.
#[cfg(mobile)]
pub(crate) fn apply_global_hotkey(_app: &AppHandle, _accel: Option<&str>) -> Result<(), String> {
    Ok(())
}

/// The tray menu items that change at runtime. Held in managed state because
/// the builder's handles are the only way to mutate a menu after `build` —
/// rebuilding the whole menu per update would tear it down under an open
/// click. `None` when the tray itself failed to build (Linux without an
/// AppIndicator host), and every writer tolerates that.
#[cfg(desktop)]
pub struct TrayHandles(pub Mutex<Option<TrayItems>>);

#[cfg(desktop)]
pub struct TrayItems {
    pub now_playing: MenuItem<Wry>,
    pub detection: CheckMenuItem<Wry>,
    /// Held only so their labels can be re-set when the language changes —
    /// rebuilding the menu instead would tear it down under an open click,
    /// which is the same reason `now_playing` is held.
    pub scrobble: MenuItem<Wry>,
    pub sync: MenuItem<Wry>,
    pub show: MenuItem<Wry>,
    pub quit: MenuItem<Wry>,
}

/// Reflects the current detection into the tray: the disabled first row
/// names what is playing, the tooltip mirrors it for hover.
///
/// The language comes from the kv mirror the frontend writes, because the
/// setting itself lives in the WebView's localStorage and Rust cannot read it.
/// The labels are only rebuilt when this runs, which is on every detection
/// tick — so a language change reaches the tray within five seconds rather
/// than at the next launch.
#[cfg(desktop)]
pub fn tray_set_now_playing(app: &AppHandle, title: Option<&str>) {
    let lang = i18n::lang(&app.state::<db::Db>());
    if let Some(handles) = app.try_state::<TrayHandles>() {
        if let Some(items) = handles.0.guard().as_ref() {
            let _ = items.now_playing.set_text(match title {
                Some(t) => format!("▶ {t}"),
                None => i18n::text(lang, i18n::Msg::TrayNothingPlaying),
            });
            let _ = items.scrobble.set_text(i18n::text(lang, i18n::Msg::TrayScrobbleNow));
            let _ = items.sync.set_text(i18n::text(lang, i18n::Msg::TraySyncNow));
            let _ = items.detection.set_text(i18n::text(lang, i18n::Msg::TrayDetection));
            let _ = items.show.set_text(i18n::text(lang, i18n::Msg::TrayOpen));
            let _ = items.quit.set_text(i18n::text(lang, i18n::Msg::TrayQuit));
        }
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(match title {
            Some(t) => format!("Karasu — {t}"),
            None => "Karasu".into(),
        }));
    }
}

/// There is no tray to reflect anything into on a phone; the scrobbler and
/// the prefs command call this on every state change, so the pair keeps those
/// call sites compiling everywhere.
#[cfg(mobile)]
pub fn tray_set_now_playing(_app: &AppHandle, _title: Option<&str>) {}

/// Whether a tray icon exists.
///
/// Nothing may hide the window without asking this first: on a desktop with no
/// StatusNotifier host there is nothing left to click to bring it back.
/// Managed on every platform — always `false` on mobile — because
/// `close_hides_window` and the diagnostics read it unconditionally.
pub struct TrayPresent(pub bool);

/// A debug build starts in the tray instead of in front of you.
///
/// `cargo tauri dev` is usually run while something else is being read or
/// written, and a window that takes focus every time the Rust side rebuilds is
/// the single most disruptive thing about the loop. The app is still fully
/// running — detection, scrobbling, the lot — and one click on the tray icon
/// brings it up.
///
/// Gated on `tray_present` because of the invariant on `TrayPresent` above: with
/// no tray there is nothing left to click, and a hidden window with no way back
/// is worse than a window that stole focus.
///
/// Written as a cfg'd **pair of functions** rather than a `#[cfg]` on the call.
/// A cfg'd statement is stripped before type-checking, so the release build
/// would never compile the debug arm and the first anyone would hear of a
/// mistake in it is a broken dev loop.
#[cfg(all(desktop, debug_assertions))]
fn hide_window_in_dev(app: &tauri::App, tray_present: bool) {
    use tauri::Manager as _;
    if !tray_present {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        logging::info("startup", "debug build: started in the tray");
    }
}

#[cfg(all(desktop, not(debug_assertions)))]
fn hide_window_in_dev(_app: &tauri::App, _tray_present: bool) {}

/// Builds the tray, or reports why it could not be built.
///
/// Split out of `setup` so the whole thing can be wrapped in `catch_unwind` —
/// see the call site for why an ordinary `?` is not enough.
#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let db = app.state::<db::Db>();
    let detection_on = commands::read_media_detection(&db);
    let lang = i18n::lang(&db);
    let label = |m| i18n::text(lang, m);

    // The first row states what detection sees; disabled because it is a
    // fact, not an action — clicking a title with nothing behind it would be
    // a button that does nothing.
    let now_playing =
        MenuItem::with_id(app, "now", label(i18n::Msg::TrayNothingPlaying), false, None::<&str>)?;
    let scrobble =
        MenuItem::with_id(app, "scrobble", label(i18n::Msg::TrayScrobbleNow), true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", label(i18n::Msg::TraySyncNow), true, None::<&str>)?;
    let detection = CheckMenuItem::with_id(
        app,
        "detection",
        label(i18n::Msg::TrayDetection),
        true,
        detection_on,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", label(i18n::Msg::TrayOpen), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", label(i18n::Msg::TrayQuit), true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&now_playing, &sep1, &scrobble, &sync, &detection, &sep2, &show, &quit],
    )?;

    app.manage(TrayHandles(Mutex::new(Some(TrayItems {
        now_playing: now_playing.clone(),
        detection: detection.clone(),
        scrobble: scrobble.clone(),
        sync: sync.clone(),
        show: show.clone(),
        quit: quit.clone(),
    }))));

    // A window with no icon is a launch worth continuing, not one worth
    // aborting — the tray simply goes without.
    let Some(icon) = app.default_window_icon().cloned() else {
        return Err(tauri::Error::UnknownPath);
    };

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Karasu")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            // Same path as the in-app confirm button; errors ("nothing is
            // playing") land in the log rather than a toast nobody can see.
            "scrobble" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = playback::scrobbler::confirm_pending(handle, true).await {
                        logging::info("tray", format!("scrobble now: {e}"));
                    }
                });
            }
            // The frontend owns the sync (it drives the query cache), so the
            // tray only rings the bell — GlobalKeys listens.
            "sync" => {
                let _ = app.emit("manual-sync", ());
            }
            // The check item toggles itself; the kv follows *it*, so the menu
            // is the source of truth for what was just clicked. The 5s poll
            // reads the key per tick, so it takes effect within one cycle.
            "detection" => {
                if let Some(handles) = app.try_state::<TrayHandles>() {
                    if let Some(items) = handles.0.guard().as_ref() {
                        let enabled = items.detection.is_checked().unwrap_or(true);
                        let db = app.state::<db::Db>();
                        let _ = commands::write_media_detection(&db, enabled);
                    }
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// WebKitGTK's DMA-BUF renderer paints a blank window on a long list of
/// driver/compositor combinations — the NVIDIA proprietary driver most often.
/// The app starts, the process runs, and the user sees nothing, which is the
/// single most common way a Tauri app "fails" on Linux. Only set when the user
/// has not chosen for themselves.
///
/// A cfg'd **pair** rather than `#[cfg(target_os = "linux")]` on the `if` this
/// used to be. An attribute on a *statement* is stripped wholesale on every
/// other platform, so nothing inside it is ever compiled here — CLAUDE.md names
/// that trap, and it was sitting in the file whose own doc explains it. The
/// body is still Linux-only by nature; what the pair buys is a call site that
/// is type-checked on Windows too, so this cannot be renamed or given arguments
/// without the local build noticing.
#[cfg(target_os = "linux")]
fn avoid_blank_webkit_window() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// Nothing to do: WebView2 and WebKit-on-macOS have no DMA-BUF renderer.
#[cfg(not(target_os = "linux"))]
fn avoid_blank_webkit_window() {}

pub fn run() {
    // First, before anything can panic. Until this existed every panic in the
    // app went to a stderr no packaged build has — see `logging`.
    logging::install_panic_hook();

    avoid_blank_webkit_window();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    attach_desktop(builder)
        .setup(|app| {
            let data_dir = portable::data_dir(app.path().app_data_dir()?);
            portable::remember_data_dir(&data_dir);
            // Before the database, so a failure to open *that* is the first
            // thing the log records rather than something it misses.
            logging::init(data_dir.clone());
            app.manage(db::Db::open(data_dir).map_err(|e| {
                logging::error("db", format!("cannot open the database: {e}"));
                std::io::Error::other(e)
            })?);
            // The verbose switch survives a restart, so a "turn it on and
            // reproduce it" request does not have to be re-armed each launch.
            logging::set_debug(
                app.state::<db::Db>()
                    .kv_get(commands::LOG_DEBUG_KEY)
                    .as_deref()
                    == Some("1"),
            );
            logging::info(
                "startup",
                format!("Karasu {}", commands::app_version_string()),
            );
            app.manage(anilist::client::AniList::new());
            app.manage(playback::scrobbler::PlaybackState(std::sync::Mutex::new(None)));
            app.manage(playback::scrobbler::ScrobbleSession(std::sync::Mutex::new(None)));
            app.manage(playback::relations::Relations(std::sync::RwLock::new(Vec::new())));
            app.manage(discord::Discord(std::sync::Mutex::new(None)));
            app.manage(discord::UiPage::default());
            app.manage(discord::LastPresence::default());
            app.manage(library::LibraryIndex::default());
            app.manage(commands::PendingUpdate::default());
            library::hydrate(app.handle());
            playback::relations::spawn_loader(app.handle().clone());
            playback::scrobbler::spawn(app.handle().clone());
            alerts::airing::spawn(app.handle().clone());
            alerts::stale::spawn(app.handle().clone());
            alerts::sequel::spawn(app.handle().clone());
            backups::spawn(app.handle().clone());
            // Show the idle presence right away (if Discord is enabled).
            discord::sync_current(app.handle());

            setup_platform(app);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::anilist_auth_info,
            commands::set_client_id,
            commands::anilist_login_url,
            commands::anilist_start_login,
            commands::anilist_connect,
            commands::anilist_session,
            commands::anilist_logout,
            commands::refresh_viewer,
            commands::anilist_query,
            commands::fetch_media_list,
            commands::cached_media_list,
            commands::save_list_entry,
            commands::bulk_save_list_entries,
            commands::delete_list_entry,
            commands::flush_queue,
            commands::sync_status,
            commands::fetch_bio_image,
            commands::get_blur_adult,
            commands::set_blur_adult,
            commands::get_profile_mode,
            commands::enable_local_mode,
            commands::local_fetch_list,
            commands::local_save_entry,
            commands::local_delete_entry,
            commands::local_all_entries,
            commands::get_now_playing,
            commands::get_scrobble_settings,
            commands::set_scrobble_settings,
            commands::scrobble_now,
            commands::scrobble_cancel,
            commands::get_discord_settings,
            commands::set_discord_settings,
            commands::set_ui_page,
            commands::get_autostart,
            commands::set_autostart,
            commands::set_ui_language,
            commands::get_airing_notify,
            commands::set_airing_notify,
            commands::get_stale_settings,
            commands::set_stale_settings,
            commands::get_sequel_notify,
            commands::set_sequel_notify,
            commands::get_notifications,
            commands::diagnostics,
            commands::diagnostics_report,
            commands::get_logs,
            commands::log_file_path,
            commands::log_frontend_error,
            commands::get_log_debug,
            commands::set_log_debug,
            commands::export_diagnostics,
            commands::unread_notification_count,
            commands::mark_notification_read,
            commands::mark_all_notifications_read,
            commands::save_image,
            commands::save_text,
            commands::app_version,
            commands::check_for_updates,
            commands::get_update_channel,
            commands::set_update_channel,
            commands::get_update_check_auto,
            commands::set_update_check_auto,
            commands::get_content_filter,
            commands::set_content_filter,
            commands::download_pending_update,
            commands::pending_update,
            commands::install_pending_update,
            commands::get_text_scale,
            commands::get_media_detection,
            commands::set_media_detection,
            commands::media_sessions,
            commands::get_jellyfin_settings,
            commands::set_jellyfin_settings,
            commands::jellyfin_sign_in,
            commands::jellyfin_sign_out,
            commands::test_jellyfin,
            commands::platform_info,
            commands::get_close_to_tray,
            commands::set_close_to_tray,
            commands::get_global_hotkey,
            commands::set_global_hotkey,
            commands::open_text,
            commands::get_backup_settings,
            commands::set_backup_settings,
            commands::open_backup_dir,
            commands::get_mpv_ipc,
            commands::set_mpv_ipc,
            commands::list_detection_overrides,
            commands::set_detection_override,
            commands::clear_detection_override,
            commands::get_portable_status,
            commands::enable_portable,
            commands::disable_portable,
            library::get_library_path,
            library::set_library_path,
            library::pick_library_folder,
            library::get_library_index,
            library::get_library_episodes,
            library::get_library_status,
            library::scan_library,
            library::get_library_unmatched,
            library::set_library_match,
            library::clear_library_match,
            library::set_library_redirect,
            library::clear_library_redirect,
            library::play_next,
            library::play_episode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The four desktop-only plugins and the close-to-tray window handler.
///
/// Three of the plugin crates are `#![cfg(not(android/ios))]` at the *crate*
/// root, so on mobile every `init()` path here would be unresolved — this is
/// the cfg'd-pair spelling of that fact, per the house rule that a statement
/// is never cfg'd. The updater rides along: its distribution model is the
/// desktop's.
#[cfg(desktop)]
fn attach_desktop(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| {
            // Closing minimizes to the tray instead of quitting (quit via tray
            // menu) — but only where there is a tray to minimize *to*. Hiding
            // into a tray that does not exist leaves no way back to the window.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let tray = app.state::<TrayPresent>().0;
                let setting = app.state::<db::Db>().kv_get(commands::CLOSE_TO_TRAY_KEY);
                if commands::close_hides_window(setting.as_deref(), tray) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
}

#[cfg(mobile)]
fn attach_desktop(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
}

/// The desktop half of setup: the tray, the dev-build hide, the hotkey.
#[cfg(desktop)]
fn setup_platform(app: &tauri::App) {
    // `catch_unwind`, not `?`, because the tray does not fail politely
    // on Linux: `libappindicator-sys` *panics* when it cannot dlopen
    // libayatana-appindicator3.so.1, and a panic walks straight past
    // `?`. That aborted startup on every desktop without the library
    // installed — the app did not merely lose its tray, it never came
    // up. A dlopen probe would not be enough either: `build()` can
    // also return Err and the menu can panic on its own.
    //
    // The outcome goes to the log, not to stderr. This is the single
    // most-asked Linux question ("why does closing quit?") and until
    // there was a log the answer was written to a handle nobody has.
    let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        build_tray(app)
    }));
    let built = match built {
        Ok(Ok(())) => {
            logging::info("tray", "tray icon built");
            true
        }
        Ok(Err(e)) => {
            logging::warn("tray", format!("no tray icon ({e})"));
            false
        }
        Err(_) => {
            logging::warn(
                "tray",
                "no tray icon (the desktop has no AppIndicator library). \
                 Closing the window will quit instead of hiding.",
            );
            false
        }
    };
    app.manage(TrayPresent(built));
    // Debug builds only, and only with a tray to come back from.
    hide_window_in_dev(app, built);

    // A stored hotkey that no longer registers (another app claimed
    // it, a layout changed) must not fail the launch — it goes to the
    // log and the setting stays put for the user to see and change.
    if let Some(accel) = commands::read_global_hotkey(&app.state::<db::Db>()) {
        if let Err(e) = apply_global_hotkey(app.handle(), Some(&accel)) {
            logging::warn(
                "hotkey",
                format!("global hotkey '{accel}' failed to register: {e}"),
            );
        }
    }

}

/// Mobile has no tray, so the single bit of platform state everything else
/// reads unconditionally is managed at its honest value.
#[cfg(mobile)]
fn setup_platform(app: &tauri::App) {
    app.manage(TrayPresent(false));
}

