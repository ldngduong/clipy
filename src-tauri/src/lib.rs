pub mod cleanup;
pub mod clipboard;
pub mod commands;
pub mod db;
pub mod detect;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Listener, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub static FORCE_QUIT: AtomicBool = AtomicBool::new(false);

pub struct ShortcutHolder {
    pub current: Mutex<String>,
}

pub fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            if let Err(e) = win.center() {
                tauri_plugin_log::log::warn!("failed to center window: {e}");
            }
            let _ = win.set_focus();
        }
    }
}

fn close_splash(app: &tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        if let Err(e) = win.center() {
            tauri_plugin_log::log::warn!("failed to center window: {e}");
        }
        let _ = win.set_focus();
    }
}

pub fn register_global_shortcut(app: &tauri::AppHandle, shortcut_str: String) -> Result<(), String> {
    let shortcut: Shortcut = shortcut_str
        .parse()
        .map_err(|e| format!("{e}"))?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_main_window(app);
            }
        })
        .map_err(|e| e.to_string())
}

fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_hide = MenuItem::with_id(app, "toggle", "Show / Hide", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause Capture", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &pause,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let pause_item = pause.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "toggle" => toggle_main_window(app),
            "pause" => {
                let paused = !app.state::<clipboard::MonitorState>().is_paused();
                app.state::<clipboard::MonitorState>().set_paused(paused);
                let _ = pause_item.set_text(if paused {
                    "Resume Capture"
                } else {
                    "Pause Capture"
                });
                let _ = app.emit("clipy://capture-paused", paused);
            }
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("clipy://open-settings", ());
            }
            "quit" => {
                FORCE_QUIT.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(clipboard::MonitorState::new())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("clipy.log".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_oauth::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "splash" {
                    return;
                }
                if !FORCE_QUIT.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let splash_handle = handle.clone();
            handle.listen("clipy://app-ready", move |_| {
                close_splash(&splash_handle);
            });
            db::init_db(&handle)?;

            let settings = db::repo::get_settings(&app.state::<db::Database>().conn())
                .map_err(|e| e.to_string())?;
            app.manage(ShortcutHolder {
                current: Mutex::new(settings.global_shortcut.clone()),
            });
            if let Err(e) = register_global_shortcut(app.handle(), settings.global_shortcut.clone())
            {
                tauri_plugin_log::log::warn!(
                    "failed to register global shortcut {}: {e}",
                    settings.global_shortcut
                );
            }

            setup_tray(app.handle())?;
            clipboard::start_monitor(app.handle().clone());
            cleanup::start_cleanup_worker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_items,
            commands::search_items,
            commands::get_item,
            commands::set_item_status,
            commands::delete_item,
            commands::clear_history,
            commands::copy_item,
            commands::get_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::set_collection_pinned,
            commands::set_item_collection,
            commands::get_settings,
            commands::set_settings,
            commands::set_capture_paused,
            commands::get_stats,
            commands::get_db_path,
            commands::export_backup,
            commands::import_backup,
            commands::debug_timing,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}