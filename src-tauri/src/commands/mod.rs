use base64::Engine as _;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::clipboard::{self, MonitorState};
use crate::db::models::{ItemFilters, ItemStatus, Settings};
use crate::db::{repo, Database};

#[tauri::command]
pub async fn get_items(
    db: State<'_, Database>,
    filters: Option<ItemFilters>,
) -> Result<Vec<serde_json::Value>, String> {
    let t0 = std::time::Instant::now();
    let db = db.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<serde_json::Value>, String> {
        let conn = db.conn();
        let items = repo::list_items(&conn, &filters.unwrap_or_default())
            .map_err(|e| format!("query failed: {e}"))?;
        Ok(items
            .into_iter()
            .map(|i| serde_json::to_value(i).unwrap_or_default())
            .collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())??;
    tauri_plugin_log::log::info!("[timing] get_items total={:?}", t0.elapsed());
    Ok(result)
}

#[tauri::command]
pub async fn search_items(
    db: State<'_, Database>,
    query: String,
    filters: Option<ItemFilters>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.conn();
        let items = repo::search_items(&conn, &query, &filters.unwrap_or_default())
            .map_err(|e| format!("search failed: {e}"))?;
        Ok(items
            .into_iter()
            .map(|i| serde_json::to_value(i).unwrap_or_default())
            .collect::<Vec<_>>())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_item(db: State<'_, Database>, id: i64) -> Result<serde_json::Value, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.conn();
        let item = repo::get_item(&conn, id).map_err(|e| format!("not found: {e}"))?;
        serde_json::to_value(item).map_err(|e| format!("serialize failed: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn set_item_status(
    app: AppHandle,
    db: State<'_, Database>,
    id: i64,
    status: String,
) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    let st = ItemStatus::from(status.as_str());
    {
        let conn = db.conn();
        repo::set_item_status(&conn, id, st).map_err(|e| e.to_string())?;
    }
    let t_db = t0.elapsed();
    let _ = app.emit("clipy://item-updated", id);
    tauri_plugin_log::log::info!(
        "[timing] set_item_status id={id} status={status} db={t_db:?} total={:?}",
        t0.elapsed()
    );
    Ok(())
}

#[tauri::command]
pub fn delete_item(app: AppHandle, db: State<'_, Database>, id: i64) -> Result<(), String> {
    {
        let conn = db.conn();
        repo::delete_item(&conn, id).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("clipy://item-deleted", id);
    Ok(())
}

#[tauri::command]
pub fn clear_history(app: AppHandle, db: State<'_, Database>) -> Result<u64, String> {
    let n = {
        let conn = db.conn();
        repo::clear_history(&conn).map_err(|e| e.to_string())?
    };
    let _ = app.emit("clipy://history-cleared", ());
    Ok(n)
}

#[tauri::command]
pub async fn copy_item(app: AppHandle, db: State<'_, Database>, id: i64) -> Result<(), String> {
    let db = db.inner().clone();
    let item = tauri::async_runtime::spawn_blocking(move || {
        let conn = db.conn();
        repo::get_item(&conn, id).map_err(|e| format!("not found: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    set_clipboard_for_item(&app, &item, false)
}

fn set_clipboard_for_item(
    app: &AppHandle,
    item: &crate::db::models::ClipboardItem,
    plain: bool,
) -> Result<(), String> {
    app.state::<MonitorState>().mark_self_write();
    match item.kind.as_str() {
        "IMAGE" => {
            let png = base64::engine::general_purpose::STANDARD
                .decode(item.image_base64.clone().unwrap_or_default())
                .map_err(|e| format!("decode failed: {e}"))?;
            clipboard::set_clipboard_image(app, &png)
        }
        _ => {
            let text = if plain {
                item.content.clone().unwrap_or_default()
            } else {
                item.content.clone().or(item.html.clone()).unwrap_or_default()
            };
            let mut clip = arboard::Clipboard::new().map_err(|e| e.to_string())?;
            clip.set_text(text).map_err(|e| e.to_string())
        }
    }
}

// -------------------------------------------------------- collections

#[tauri::command]
pub fn get_collections(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let conn = db.conn();
    let list = repo::list_collections(&conn).map_err(|e| e.to_string())?;
    serde_json::to_value(list).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(db: State<'_, Database>, name: String) -> Result<i64, String> {
    let conn = db.conn();
    repo::create_collection(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_collection(db: State<'_, Database>, id: i64, name: String) -> Result<(), String> {
    let conn = db.conn();
    repo::rename_collection(&conn, id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_collection(app: AppHandle, db: State<'_, Database>, id: i64) -> Result<(), String> {
    {
        let conn = db.conn();
        repo::delete_collection(&conn, id).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("clipy://collections-changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_collection_pinned(
    app: AppHandle,
    db: State<'_, Database>,
    id: i64,
    pinned: bool,
) -> Result<(), String> {
    {
        let conn = db.conn();
        repo::set_collection_pinned(&conn, id, pinned).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("clipy://collections-changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_item_collection(
    app: AppHandle,
    db: State<'_, Database>,
    item_id: i64,
    collection_id: Option<i64>,
) -> Result<(), String> {
    let t0 = std::time::Instant::now();
    {
        let conn = db.conn();
        repo::set_item_collection(&conn, item_id, collection_id).map_err(|e| e.to_string())?;
    }
    let t_db = t0.elapsed();
    let _ = app.emit("clipy://item-updated", item_id);
    tauri_plugin_log::log::info!(
        "[timing] set_item_collection item={item_id} collection={collection_id:?} db={t_db:?} total={:?}",
        t0.elapsed()
    );
    Ok(())
}

// ----------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(db: State<'_, Database>) -> Result<Settings, String> {
    let conn = db.conn();
    repo::get_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    db: State<'_, Database>,
    settings: Settings,
) -> Result<(), String> {
    let holder = app.state::<crate::ShortcutHolder>();
    let mut current = holder.current.lock().unwrap();
    if *current != settings.global_shortcut {
        if let Ok(old) = current.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            let _ = app.global_shortcut().unregister(old);
        }
        crate::register_global_shortcut(&app, settings.global_shortcut.clone()).map_err(|e| {
            let _ = crate::register_global_shortcut(&app, current.clone());
            format!("invalid shortcut: {e}")
        })?;
        *current = settings.global_shortcut.clone();
    }

    let conn = db.conn();
    repo::set_settings(&conn, &settings).map_err(|e| e.to_string())?;
    let _ = app.emit("clipy://settings-changed", ());
    Ok(())
}

// --------------------------------------------------------- backup

#[tauri::command]
pub async fn export_backup(
    db: State<'_, Database>,
    include_images: bool,
) -> Result<serde_json::Value, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.conn();
        let result = crate::db::backup::export_backup(&conn, include_images)
            .map_err(|e| format!("export failed: {e}"))?;
        serde_json::to_value(result).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_backup(
    app: AppHandle,
    db: State<'_, Database>,
    data: String,
) -> Result<serde_json::Value, String> {
    let db = db.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let conn = db.conn();
        crate::db::backup::import_backup(&conn, &data).map_err(|e| format!("import failed: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("clipy://items-restored", &result);
    let _ = app.emit("clipy://collections-changed", ());
    serde_json::to_value(result).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- misc

#[tauri::command]
pub fn set_capture_paused(app: AppHandle, paused: bool) -> Result<(), String> {
    app.state::<MonitorState>().set_paused(paused);
    let _ = app.emit("clipy://capture-paused", paused);
    Ok(())
}

#[tauri::command]
pub async fn get_stats(db: State<'_, Database>) -> Result<serde_json::Value, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.conn();
        let stats = repo::get_stats(&conn).map_err(|e| e.to_string())?;
        serde_json::to_value(stats).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_db_path(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    Ok(dir.join("clipy.db").to_string_lossy().to_string())
}

#[tauri::command]
pub fn debug_timing(phase: String, ms: f64) -> Result<(), String> {
    tauri_plugin_log::log::info!("[timing] FE {phase} {ms:.1}ms");
    Ok(())
}
