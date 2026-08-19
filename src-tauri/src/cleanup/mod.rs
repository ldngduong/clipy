use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::db::repo;
use crate::db::Database;

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60);

pub fn start_cleanup_worker(app: AppHandle) {
    std::thread::Builder::new()
        .name("cleanup-worker".into())
        .spawn(move || loop {
            std::thread::sleep(CLEANUP_INTERVAL);
            let db = app.state::<Database>();
            let conn = db.conn();
            let deleted = repo::delete_expired(&conn).unwrap_or(0);
            if deleted > 0 {
                let _ = app.emit("clipy://items-deleted", deleted);
            }
            let settings = repo::get_settings(&conn).unwrap_or_default();
            let trimmed = repo::trim_history(&conn, settings.max_history).unwrap_or(0);
            if trimmed > 0 {
                let _ = app.emit("clipy://items-deleted", trimmed);
            }
        })
        .expect("failed to spawn cleanup worker");
}
