use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::db::schema::SCHEMA;

pub mod backup;
pub mod models;
pub mod repo;
mod schema;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;

        // lightweight column migrations for existing databases
        let has_pinned = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('collections') WHERE name = 'pinned'",
            [],
            |r| r.get::<_, i64>(0),
        )?;
        if has_pinned == 0 {
            conn.execute_batch(
                "ALTER TABLE collections ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            )?;
        }
        let has_preview = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('clipboard_items') WHERE name = 'image_preview'",
            [],
            |r| r.get::<_, i64>(0),
        )?;
        if has_preview == 0 {
            conn.execute_batch("ALTER TABLE clipboard_items ADD COLUMN image_preview BLOB")?;
            let mut stmt = conn.prepare(
                "SELECT id, image_data FROM clipboard_items WHERE kind = 'IMAGE' AND image_data IS NOT NULL",
            )?;
            let rows: Vec<(i64, Vec<u8>)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?;
            drop(stmt);
            for (id, data) in rows {
                if let Some(prev) = crate::clipboard::make_preview(&data, 320) {
                    conn.execute(
                        "UPDATE clipboard_items SET image_preview = ?1 WHERE id = ?2",
                        rusqlite::params![prev, id],
                    )?;
                }
            }
        }
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("db mutex poisoned")
    }
}

pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create data dir: {e}"))?;
    let db_path = dir.join("clipy.db");
    let db = Database::open(&db_path).map_err(|e| format!("failed to open database: {e}"))?;
    app.manage(db);
    Ok(())
}
