mod airing;
mod anilist;
mod commands;
mod db;
mod detection;
mod discord;
mod notify;
mod library;
mod portable;
mod recognition;
mod relations;
mod scrobbler;
mod sequel;
mod stale;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            app.manage(scrobbler::PlaybackState(std::sync::Mutex::new(None)));
            app.manage(scrobbler::ScrobbleSession(std::sync::Mutex::new(None)));
            app.manage(relations::Relations(std::sync::RwLock::new(Vec::new())));
            app.manage(discord::Discord(std::sync::Mutex::new(None)));
            app.manage(discord::UiPage::default());
            app.manage(library::LibraryIndex::default());
            app.manage(commands::PendingUpdate::default());
            library::hydrate(app.handle());
            relations::spawn_loader(app.handle().clone());
            scrobbler::spawn(app.handle().clone());
            airing::spawn(app.handle().clone());
            stale::spawn(app.handle().clone());
            sequel::spawn(app.handle().clone());
            // Show the idle presence right away (if Discord is enabled).
            discord::sync_current(app.handle());

            let show = MenuItem::with_id(app, "show", "Open Karasu", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
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
        })
        .on_window_event(|window, event| {
            // Closing minimizes to the tray instead of quitting (quit via tray menu)
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
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
            commands::save_list_entry,
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
            commands::save_png,
            commands::app_version,
            commands::check_for_updates,
            commands::get_update_channel,
            commands::set_update_channel,
            commands::get_update_check_auto,
            commands::set_update_check_auto,
            commands::get_content_filter,
            commands::set_content_filter,
            commands::download_pending_update,
            commands::install_pending_update,
            commands::get_text_scale,
            commands::get_smtc_enabled,
            commands::set_smtc_enabled,
            commands::smtc_sessions,
            commands::get_jellyfin_settings,
            commands::set_jellyfin_settings,
            commands::jellyfin_users,
            commands::test_jellyfin,
            commands::get_portable_status,
            commands::enable_portable,
            commands::disable_portable,
            library::get_library_path,
            library::set_library_path,
            library::pick_library_folder,
            library::get_library_index,
            library::scan_library,
            library::play_next,
            library::play_episode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
