mod anilist;
mod commands;
mod db;
mod detection;
mod recognition;
mod scrobbler;

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
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(db::Db::open(data_dir).map_err(std::io::Error::other)?);
            app.manage(anilist::client::AniList::new());
            app.manage(scrobbler::PlaybackState(std::sync::Mutex::new(None)));
            scrobbler::spawn(app.handle().clone());

            let show = MenuItem::with_id(app, "show", "Karasu öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
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
            // Schließen minimiert in den Tray statt zu beenden (Beenden über Tray-Menü)
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_client_id,
            commands::set_client_id,
            commands::anilist_login_url,
            commands::anilist_connect,
            commands::anilist_session,
            commands::anilist_logout,
            commands::anilist_query,
            commands::fetch_anime_list,
            commands::save_list_entry,
            commands::delete_list_entry,
            commands::flush_queue,
            commands::get_now_playing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
