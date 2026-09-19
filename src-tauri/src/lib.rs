mod alerts;
mod anilist;
mod apk_update;
mod backups;
mod commands;
mod db;
mod diagnostics;
mod discord;
mod identify;
mod background;
mod keystore;
mod widgets;
mod library;
mod logging;
mod net;
mod playback;
mod i18n;
mod portable;
mod sync;

use tauri::{AppHandle, Manager, Wry};
// Used only from the desktop half of this file, so they gate with it, or Android warns of an unused import.
#[cfg(desktop)]
use crate::sync::LockExt;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::Emitter;
// `cfg(desktop)` / `cfg(mobile)` are tauri-build's own flags; a hand-rolled `not(android)` would silently miss iOS.
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

/// The global hotkey's action; focus decides, not visibility, so a buried window comes forward rather than vanishing.
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

/// (Re)binds the summon hotkey, the only global shortcut Karasu registers, so `unregister_all` is exact.
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

/// No global shortcuts on mobile, as an error rather than a quiet Ok, or Settings would store a hotkey that never fires.
#[cfg(mobile)]
pub(crate) fn apply_global_hotkey(_app: &AppHandle, _accel: Option<&str>) -> Result<(), String> {
    Err("Global shortcuts are not available on this platform".into())
}

/// The tray menu items that change at runtime; `None` when the tray failed to build, and every writer tolerates that.
#[cfg(desktop)]
pub struct TrayHandles(pub Mutex<Option<TrayItems>>);

#[cfg(desktop)]
pub struct TrayItems {
    pub now_playing: MenuItem<Wry>,
    pub detection: CheckMenuItem<Wry>,
    /// Held so their labels can be re-set when the language changes; rebuilding the menu would tear it down under a click.
    pub scrobble: MenuItem<Wry>,
    pub sync: MenuItem<Wry>,
    pub show: MenuItem<Wry>,
    pub quit: MenuItem<Wry>,
}

/// Reflects the current detection into the tray; the labels are re-read here too, so a language change lands within a tick.
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

/// No tray on a phone; the pair keeps the scrobbler's and the prefs command's call sites compiling everywhere.
#[cfg(mobile)]
pub fn tray_set_now_playing(_app: &AppHandle, _title: Option<&str>) {}

/// Whether a tray icon exists; nothing may hide the window without asking, since there is nothing else to click.
pub struct TrayPresent(pub bool);

/// A debug build starts in the tray so a rebuild does not steal focus; gated on the tray, or there is no way back.
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

/// Set by `RunEvent::ExitRequested`, read by `RunEvent::Exit`: the one way to tell a requested exit from an imposed one.
static EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);

/// An `Exit` with no `ExitRequested` before it is the OS destroying the loop; leave before tao 0.35 pumps another message.
#[cfg(desktop)]
fn exit_now_if_unrequested(app: &AppHandle) {
    if EXIT_REQUESTED.load(Ordering::SeqCst) {
        return;
    }
    logging::info(
        "shutdown",
        "the session is ending; exiting before the event loop takes another message",
    );
    app.cleanup_before_exit();
    std::process::exit(0);
}

/// Android emits the same event on the activity's destroy and the process must survive it; the notification job runs there.
#[cfg(mobile)]
fn exit_now_if_unrequested(_app: &AppHandle) {}

/// Builds the tray, or reports why it could not; split out so `setup_platform` can wrap the whole thing in `catch_unwind`.
#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let db = app.state::<db::Db>();
    let detection_on = commands::read_media_detection(&db);
    let lang = i18n::lang(&db);
    let label = |m| i18n::text(lang, m);

    // The first row states what detection sees; disabled because it is a fact, not an action.
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

    // A window with no icon is a launch worth continuing, not one worth aborting; the tray simply goes without.
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
            // Same path as the in-app confirm button; errors land in the log rather than a toast nobody can see.
            "scrobble" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = playback::scrobbler::confirm_pending(handle, true).await {
                        logging::info("tray", format!("scrobble now: {e}"));
                    }
                });
            }
            // The frontend owns the sync, since it drives the query cache, so the tray only rings the bell.
            "sync" => {
                let _ = app.emit("manual-sync", ());
            }
            // The check item toggles itself and the kv follows it; the poll reads the key per tick, so it lands within one.
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

/// WebKitGTK's DMA-BUF renderer paints a blank window on many driver combinations; set only when the user has not chosen.
#[cfg(target_os = "linux")]
fn avoid_blank_webkit_window() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// Nothing to do: WebView2 and WebKit-on-macOS have no DMA-BUF renderer.
#[cfg(not(target_os = "linux"))]
fn avoid_blank_webkit_window() {}

// The mobile entry point belongs on `run`; on any other item the attribute emits no entry symbol on Android.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First, before anything can panic; a packaged build has no stderr for the default hook to print to.
    logging::install_panic_hook();

    avoid_blank_webkit_window();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Android's anilist.co intent-filter is generated from the tauri.conf `deep-link` block, safe across regeneration.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        // Not exposed to the WebView: the fs plugin lets `commands::system` write into a save dialog's content:// URI.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    attach_desktop(builder)
        .setup(|app| {
            let data_dir = portable::data_dir(app.path().app_data_dir()?);
            portable::remember_data_dir(&data_dir);
            // Before the database, so a failure to open that is the first thing the log records.
            logging::init(data_dir.clone());
            // A database that will not open gets one attempt at restoring the newest backup before the launch ends.
            let db = match db::Db::open(data_dir.clone()) {
                Ok(db) => db,
                Err(first) => {
                    logging::error("db", format!("cannot open the database: {first}"));
                    match backups::restore_newest(&data_dir) {
                        Some(_) => db::Db::open(data_dir.clone()).map_err(|e| {
                            logging::error(
                                "db",
                                format!("the restored database will not open either: {e}"),
                            );
                            std::io::Error::other(e)
                        })?,
                        None => {
                            logging::error("db", "no usable backup to restore from");
                            return Err(std::io::Error::other(first).into());
                        }
                    }
                }
            };
            app.manage(db);
            // The window exists and the page has not painted, so the stored zoom lands before anything is drawn.
            commands::apply_ui_zoom(
                app.handle(),
                commands::read_ui_zoom(&app.state::<db::Db>()),
            );
            // The verbose switch survives a restart, so "turn it on and reproduce it" need not be re-armed each launch.
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
            // The "new release" bell row dies with the install it announced, before the frontend reads the bell.
            commands::clear_stale_update_notice(&app.state::<db::Db>());
            app.manage(anilist::client::AniList::new(Some(anilist::rate_store(app.handle().clone()))));
            anilist::spawn_traffic_reporter(app.handle().clone());
            // Drop passthrough answers older than a week, so an abandoned screen's row cannot linger.
            let prune_cutoff = commands::unix_now() - anilist::query_cache::PRUNE_AFTER_SECS;
            app.state::<db::Db>().query_cache_prune(prune_cutoff);
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
        alerts::site::spawn(app.handle().clone());
        assert_notif_schedule(app.handle());
        sweep_apk_updates(app.handle());
        {
            // Project the widgets from the cache once at startup, delayed a beat so the JNI poke finds tao's context ready.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                widgets::refresh(&handle);
            });
        }
            // Before the first toast can land: on Android this is the system permission dialog, elsewhere a no-op.
            alerts::notify::ensure_permission(app.handle());
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
            commands::discard_queued_edit,
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
            commands::get_notif_schedule,
            commands::set_notif_schedule,
            commands::get_stale_settings,
            commands::set_stale_settings,
            commands::get_sequel_notify,
            commands::set_sequel_notify,
            commands::get_notifications,
            commands::diagnostics,
            commands::diagnostics_report,
            commands::get_logs,
            commands::get_ui_zoom,
            commands::set_ui_zoom,
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
            apk_update::apk_updater_available,
            apk_update::apk_update_state,
            apk_update::apk_download,
            apk_update::apk_install,
            apk_update::apk_open_install_permission,
            apk_update::apk_discard,
            apk_update::apk_prompt_if_ready,
            apk_update::get_apk_download_metered,
            apk_update::set_apk_download_metered,
            commands::get_text_scale,
            commands::get_media_detection,
            commands::set_media_detection,
            commands::media_sessions,
            commands::get_jellyfin_settings,
            commands::set_jellyfin_settings,
            commands::jellyfin_sign_in,
            commands::jellyfin_sign_out,
            commands::test_jellyfin,
            commands::get_jellyfin_background,
            commands::set_jellyfin_background,
            commands::request_battery_exemption,
            commands::discover_jellyfin_servers,
            commands::probe_jellyfin_server,
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
            library::list_library_redirects,
            library::play_next,
            library::play_episode,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { .. } => EXIT_REQUESTED.store(true, Ordering::SeqCst),
            tauri::RunEvent::Exit => exit_now_if_unrequested(app),
            _ => {}
        });
}

/// The desktop-only plugins and the close-to-tray handler; a cfg'd pair, since those crates do not exist on mobile.
#[cfg(desktop)]
fn attach_desktop(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Size, position and maximised state come back on the next start; `center: true` only places a first run.
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| {
            // Closing hides to the tray instead of quitting, but only where there is a tray to hide into.
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
    // `catch_unwind`, not `?`: libappindicator panics when it cannot dlopen its library, and never `panic = "abort"`.
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

    // A stored hotkey that no longer registers must not fail the launch; it goes to the log and the setting stays.
    if let Some(accel) = commands::read_global_hotkey(&app.state::<db::Db>()) {
        if let Err(e) = apply_global_hotkey(app.handle(), Some(&accel)) {
            logging::warn(
                "hotkey",
                format!("global hotkey '{accel}' failed to register: {e}"),
            );
        }
    }

}

/// Mobile has no tray, so the one bit of platform state everything reads unconditionally is managed at its honest value.
#[cfg(mobile)]
fn setup_platform(app: &tauri::App) {
    app.manage(TrayPresent(false));
}

/// A cfg'd pair, so the setup call site compiles everywhere while only Android re-asserts its JobScheduler registration.
#[cfg(target_os = "android")]
fn assert_notif_schedule(app: &tauri::AppHandle) {
    background::spawn_schedule_assert(app.clone());
}

#[cfg(not(target_os = "android"))]
fn assert_notif_schedule(_app: &tauri::AppHandle) {}

/// The same pair for the APK sweep, retried like the schedule because it needs the android context too.
#[cfg(target_os = "android")]
fn sweep_apk_updates(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..20 {
            if tao::platform::android::prelude::main_android_context().is_some() {
                apk_update::sweep(&app.state::<db::Db>());
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    });
}

#[cfg(not(target_os = "android"))]
fn sweep_apk_updates(_app: &tauri::AppHandle) {}
