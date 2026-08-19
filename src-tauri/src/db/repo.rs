use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};

use super::models::{
    ClipboardItem, Collection, ItemFilters, ItemKind, ItemStatus, ItemType, Settings, Stats,
};

const SETTINGS_KEY: &str = "app";

fn row_to_item(row: &Row) -> rusqlite::Result<ClipboardItem> {
    let kind: String = row.get("kind")?;
    let item_type: String = row.get("item_type")?;
    let status: String = row.get("status")?;
    let is_sensitive: i64 = row.get("is_sensitive")?;
    let image_data: Option<Vec<u8>> = row.get("image_data")?;
    let image_preview: Option<Vec<u8>> = row.get("image_preview")?;

    Ok(ClipboardItem {
        id: row.get("id")?,
        kind: ItemKind::from(kind.as_str()),
        content: row.get("content")?,
        html: row.get("html")?,
        image_base64: image_data.map(|b| B64.encode(b)),
        preview_base64: image_preview.map(|b| B64.encode(b)),
        sha256: row.get("sha256")?,
        item_type: ItemType::from(item_type.as_str()),
        status: ItemStatus::from(status.as_str()),
        is_sensitive: is_sensitive != 0,
        expires_at: row.get("expires_at")?,
        created_at: row.get("created_at")?,
        collections: Vec::new(),
    })
}

/// List/search variant: only the downscaled preview is shipped so the
/// history payload stays small even with many large images.
fn row_to_list_item(row: &Row) -> rusqlite::Result<ClipboardItem> {
    let kind: String = row.get("kind")?;
    let item_type: String = row.get("item_type")?;
    let status: String = row.get("status")?;
    let is_sensitive: i64 = row.get("is_sensitive")?;
    let image_preview: Option<Vec<u8>> = row.get("image_preview")?;

    Ok(ClipboardItem {
        id: row.get("id")?,
        kind: ItemKind::from(kind.as_str()),
        content: row.get("content")?,
        html: row.get("html")?,
        image_base64: None,
        preview_base64: image_preview.map(|b| B64.encode(b)),
        sha256: row.get("sha256")?,
        item_type: ItemType::from(item_type.as_str()),
        status: ItemStatus::from(status.as_str()),
        is_sensitive: is_sensitive != 0,
        expires_at: row.get("expires_at")?,
        created_at: row.get("created_at")?,
        collections: Vec::new(),
    })
}

fn attach_metadata(conn: &Connection, mut item: ClipboardItem) -> rusqlite::Result<ClipboardItem> {
    let mut stmt =
        conn.prepare("SELECT c.name FROM collections c JOIN collection_items ci ON ci.collection_id = c.id WHERE ci.item_id = ?1")?;
    item.collections = stmt
        .query_map([item.id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(item)
}

pub fn now_utc() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn from_utc(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

// ---------------------------------------------------------------- items

pub fn insert_item(
    conn: &Connection,
    kind: ItemKind,
    content: Option<String>,
    html: Option<String>,
    image_data: Option<Vec<u8>>,
    image_preview: Option<Vec<u8>>,
    sha256: String,
    item_type: ItemType,
    is_sensitive: bool,
    retention_hours: i64,
) -> rusqlite::Result<Option<ClipboardItem>> {
    let expires_at = if retention_hours > 0 {
        let exp = Utc::now() + chrono::Duration::hours(retention_hours);
        Some(exp.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
    } else {
        None
    };
    conn.execute(
        "INSERT OR IGNORE INTO clipboard_items
           (kind, content, html, image_data, image_preview, sha256, item_type, is_sensitive, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            kind.as_str(),
            content,
            html,
            image_data,
            image_preview,
            sha256,
            item_type.as_str(),
            is_sensitive as i64,
            expires_at
        ],
    )?;
    if conn.changes() == 0 {
        return Ok(None);
    }
    let id = conn.last_insert_rowid();
    let item = get_item(conn, id)?;
    Ok(Some(item))
}

pub fn item_exists(conn: &Connection, sha256: &str, recent_seconds: i64) -> rusqlite::Result<bool> {
    let created_after =
        Utc::now() - chrono::Duration::seconds(recent_seconds);
    let after = created_after.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let exists = conn.query_row(
        "SELECT 1 FROM clipboard_items WHERE sha256 = ?1 AND created_at >= ?2 LIMIT 1",
        params![sha256, after],
        |_| Ok(1),
    )?;
    Ok(exists == 1)
}

pub fn get_item(conn: &Connection, id: i64) -> rusqlite::Result<ClipboardItem> {
    let item = conn
        .query_row(
            "SELECT id, kind, content, html, image_data, image_preview, sha256, item_type, status,
                    is_sensitive, expires_at, created_at
             FROM clipboard_items WHERE id = ?1",
            [id],
            row_to_item,
        )
        .optional()?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    attach_metadata(conn, item)
}

pub fn latest_item_sha(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT sha256 FROM clipboard_items ORDER BY id DESC LIMIT 1",
        [],
        |r| r.get(0),
    )
    .optional()
}

pub fn list_items(
    conn: &Connection,
    filters: &ItemFilters,
) -> rusqlite::Result<Vec<ClipboardItem>> {
    let mut sql = String::from(
        "SELECT ci.id, ci.kind, ci.content, ci.html, ci.image_preview, ci.sha256, ci.item_type, ci.status,
                ci.is_sensitive, ci.expires_at, ci.created_at
         FROM clipboard_items ci",
    );
    let mut conds: Vec<String> = Vec::new();
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(kind) = &filters.kind {
        conds.push("ci.kind = ?".to_string());
        args.push(Box::new(kind.clone()));
    }
    if let Some(t) = &filters.item_type {
        conds.push("ci.item_type = ?".to_string());
        args.push(Box::new(t.clone()));
    }
    if let Some(s) = &filters.status {
        conds.push("ci.status = ?".to_string());
        args.push(Box::new(s.clone()));
    }
    if let Some(cid) = filters.collection_id {
        conds.push("ci.id IN (SELECT item_id FROM collection_items WHERE collection_id = ?)".to_string());
        args.push(Box::new(cid));
    }

    if !conds.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conds.join(" AND "));
    }
    sql.push_str(" ORDER BY CASE ci.status WHEN 'PINNED' THEN 0 ELSE 1 END, ci.id DESC");
    if let Some(limit) = filters.limit {
        sql.push_str(" LIMIT ?");
        args.push(Box::new(limit));
    }
    if let Some(offset) = filters.offset {
        sql.push_str(" OFFSET ?");
        args.push(Box::new(offset));
    }

    let mut stmt = conn.prepare(&sql)?;
    let params = rusqlite::params_from_iter(args.iter().map(|a| a.as_ref()));
    let rows = stmt.query_map(params, row_to_list_item)?;
    let mut items = Vec::new();
    for row in rows {
        let item = row?;
        items.push(attach_metadata(conn, item)?);
    }
    Ok(items)
}

pub fn search_items(
    conn: &Connection,
    raw_query: &str,
    filters: &ItemFilters,
) -> rusqlite::Result<Vec<ClipboardItem>> {
    let terms: Vec<String> = raw_query
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let match_query = terms.join(" AND ");

    let mut sql = String::from(
        "SELECT ci.id, ci.kind, ci.content, ci.html, ci.image_preview, ci.sha256, ci.item_type, ci.status,
                ci.is_sensitive, ci.expires_at, ci.created_at
         FROM items_fts f
         JOIN clipboard_items ci ON ci.id = f.rowid",
    );
    let mut conds = vec!["items_fts MATCH ?1".to_string()];
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(match_query)];

    if let Some(kind) = &filters.kind {
        conds.push("ci.kind = ?".to_string());
        args.push(Box::new(kind.clone()));
    }
    if let Some(t) = &filters.item_type {
        conds.push("ci.item_type = ?".to_string());
        args.push(Box::new(t.clone()));
    }
    if let Some(s) = &filters.status {
        conds.push("ci.status = ?".to_string());
        args.push(Box::new(s.clone()));
    }

    sql.push_str(" WHERE ");
    sql.push_str(&conds.join(" AND "));
    sql.push_str(" ORDER BY CASE ci.status WHEN 'PINNED' THEN 0 ELSE 1 END, ci.id DESC");
    if let Some(limit) = filters.limit {
        sql.push_str(" LIMIT ?");
        args.push(Box::new(limit));
    }
    if let Some(offset) = filters.offset {
        sql.push_str(" OFFSET ?");
        args.push(Box::new(offset));
    }

    let mut stmt = conn.prepare(&sql)?;
    let params = rusqlite::params_from_iter(args.iter().map(|a| a.as_ref()));
    let rows = stmt.query_map(params, row_to_list_item)?;
    let mut items = Vec::new();
    for row in rows {
        let item = row?;
        items.push(attach_metadata(conn, item)?);
    }
    Ok(items)
}

pub fn set_item_status(conn: &Connection, id: i64, status: ItemStatus) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE clipboard_items SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![status.as_str(), now_utc(), id],
    )?;
    Ok(())
}

pub fn delete_item(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", [id])?;
    Ok(())
}

pub fn clear_history(conn: &Connection) -> rusqlite::Result<u64> {
    let n = conn.execute("DELETE FROM clipboard_items", [])?;
    Ok(n as u64)
}

pub fn delete_expired(conn: &Connection) -> rusqlite::Result<u64> {
    let now = now_utc();
    let n = conn.execute(
        "DELETE FROM clipboard_items
         WHERE status = 'TEMPORARY'
           AND expires_at IS NOT NULL AND expires_at < ?1
           AND NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = clipboard_items.id)",
        [now],
    )?;
    Ok(n as u64)
}

pub fn trim_history(conn: &Connection, max: i64) -> rusqlite::Result<u64> {
    if max <= 0 {
        return Ok(0);
    }
    let n = conn.execute(
        "DELETE FROM clipboard_items
         WHERE status = 'TEMPORARY'
           AND id NOT IN (
             SELECT id FROM clipboard_items
             WHERE status IN ('SAVED','PINNED')
             UNION ALL
             SELECT item_id FROM collection_items
             UNION ALL
             SELECT id FROM clipboard_items WHERE status = 'TEMPORARY'
             ORDER BY id DESC LIMIT ?1
           )",
        [max],
    )?;
    Ok(n as u64)
}

// ------------------------------------------------------- collections

pub fn list_collections(conn: &Connection) -> rusqlite::Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.created_at,
                (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count,
                c.pinned
         FROM collections c ORDER BY c.pinned DESC, c.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Collection {
            id: r.get(0)?,
            name: r.get(1)?,
            created_at: r.get(2)?,
            item_count: r.get(3)?,
            pinned: r.get::<_, i64>(4)? != 0,
        })
    })?;
    rows.collect()
}

pub fn create_collection(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO collections (name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
        [name],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_collection(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE collections SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

pub fn delete_collection(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    Ok(())
}

pub fn set_collection_pinned(conn: &Connection, id: i64, pinned: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE collections SET pinned = ?1 WHERE id = ?2",
        params![pinned as i64, id],
    )?;
    Ok(())
}

pub fn set_item_collection(
    conn: &Connection,
    item_id: i64,
    collection_id: Option<i64>,
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM collection_items WHERE item_id = ?1", [item_id])?;
    if let Some(cid) = collection_id {
        conn.execute(
            "INSERT OR IGNORE INTO collection_items (item_id, collection_id) VALUES (?1, ?2)",
            params![item_id, cid],
        )?;
    }
    Ok(())
}

// ----------------------------------------------------------- settings

pub fn get_settings(conn: &Connection) -> rusqlite::Result<Settings> {
    let row = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            [SETTINGS_KEY],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    match row {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(Settings::default()),
    }
}

pub fn set_settings(conn: &Connection, settings: &Settings) -> rusqlite::Result<()> {
    let json = serde_json::to_string(settings).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e.to_string())))
    })?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SETTINGS_KEY, json],
    )?;
    Ok(())
}

// -------------------------------------------------------------- stats

pub fn get_stats(conn: &Connection) -> rusqlite::Result<Stats> {
    let count = |sql: &str| -> rusqlite::Result<i64> {
        conn.query_row(sql, [], |r| r.get(0))
    };
    Ok(Stats {
        total: count("SELECT COUNT(*) FROM clipboard_items")?,
        temporary: count("SELECT COUNT(*) FROM clipboard_items WHERE status = 'TEMPORARY'")?,
        saved: count("SELECT COUNT(*) FROM clipboard_items WHERE status = 'SAVED'")?,
        pinned: count("SELECT COUNT(*) FROM clipboard_items WHERE status = 'PINNED'")?,
        images: count("SELECT COUNT(*) FROM clipboard_items WHERE kind = 'IMAGE'")?,
        sensitive: count("SELECT COUNT(*) FROM clipboard_items WHERE is_sensitive = 1")?,
        storage_bytes: conn
            .query_row(
                "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0),
    })
}

pub fn any_item_after(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM clipboard_items WHERE id > ?1",
        [id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

// used to build "since" cursors for frontend polling (future sync)
pub fn last_item_id(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COALESCE(MAX(id), 0) FROM clipboard_items", [], |r| r.get(0))
}

pub fn touch_updated(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE clipboard_items SET updated_at = ?1 WHERE id = ?2",
        params![now_utc(), id],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn expires_in_minutes(item_expires: &str) -> i64 {
    let exp = from_utc(item_expires);
    let mins = (exp - Utc::now()).num_minutes();
    mins.max(0)
}
