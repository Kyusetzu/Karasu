mod alerts;
mod anilist;
mod commands;
mod db;
mod discord;
mod identify;
mod library;
mod playback;
mod portable;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Whether a tray icon exists.
///
/// Nothing may hide the window without asking this first: on a desktop with no
/// StatusNotifier host there is nothing left to click to bring it back.
pub struct TrayPresent(pub bool);

/// Builds the tray, or reports why it could not be built.
///
/// Split out of `setup` so the whole thing can be wrapped in `catch_unwind` —
/// see the call site for why an ordinary `?` is not enough.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Karasu", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

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
pub fn run() {
    // WebKitGTK's DMA-BUF renderer paints a blank window on a long list of
    // driver/compositor combinations — the NVIDIA proprietary driver most
    // often. The app starts, the process runs, and the user sees nothing,
    // which is the single most common way a Tauri app "fails" on Linux.
    // Only set when the user has not chosen for themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let data_dir = portable::data_dir(app.path().app_data_dir()?);
            app.manage(db::Db::open(data_dir).map_err(std::io::Error::other)?);
            app.manage(anilist::client::AniList::new());
            app.manage(playback::scrobbler::PlaybackState(std::sync::Mutex::new(None)));
            app.manage(playback::scrobbler::ScrobbleSession(std::sync::Mutex::new(None)));
            app.manage(playback::relations::Relations(std::sync::RwLock::new(Vec::new())));
            app.manage(discord::Discord(std::sync::Mutex::new(None)));
            app.manage(discord::UiPage::default());
            app.manage(library::LibraryIndex::default());
            app.manage(commands::PendingUpdate::default());
            library::hydrate(app.handle());
            playback::relations::spawn_loader(app.handle().clone());
            playback::scrobbler::spawn(app.handle().clone());
            alerts::airing::spawn(app.handle().clone());
            alerts::stale::spawn(app.handle().clone());
            alerts::sequel::spawn(app.handle().clone());
            // Show the idle presence right away (if Discord is enabled).
            discord::sync_current(app.handle());

            // `catch_unwind`, not `?`, because the tray does not fail politely
            // on Linux: `libappindicator-sys` *panics* when it cannot dlopen
            // libayatana-appindicator3.so.1, and a panic walks straight past
            // `?`. That aborted startup on every desktop without the library
            // installed — the app did not merely lose its tray, it never came
            // up. A dlopen probe would not be enough either: `build()` can
            // also return Err and the menu can panic on its own.
            //
            // The default panic hook stays installed on purpose: the backtrace
            // it prints is the only diagnostic a user ever gets for this.
            let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                build_tray(app)
            }));
            let built = match built {
                Ok(Ok(())) => true,
                Ok(Err(e)) => {
                    eprintln!("karasu: no tray icon ({e})");
                    false
                }
                Err(_) => {
                    eprintln!(
                        "karasu: no tray icon (the desktop has no AppIndicator library). \
                         Closing the window will quit instead of hiding.",
                    );
                    false
                }
            };
            app.manage(TrayPresent(built));

            Ok(())
        })
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
        .invoke_handler(tauri::generate_handler![
            commands::anilist_auth_info,
            commands::set_client_id,
            commands::anilist_login_url,
            commands::anilist_start_login,
            commands::anilist_connect,
            commands::anilist_session,
            commands::anilist_logout,
            commands::anilist_query,
            commands::fetch_media_list,
            commands::cached_media_list,
            commands::save_list_entry,
            commands::bulk_save_list_entries,
            commands::delete_list_entry,
            commands::flush_queue,
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
            commands::get_airing_notify,
            commands::set_airing_notify,
            commands::get_stale_settings,
            commands::set_stale_settings,
            commands::get_sequel_notify,
            commands::set_sequel_notify,
            commands::get_notifications,
            commands::unread_notification_count,
            commands::mark_notification_read,
            commands::mark_all_notifications_read,
            commands::save_image,
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
            library::play_next,
            library::play_episode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
