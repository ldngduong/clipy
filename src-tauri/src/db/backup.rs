use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::repo::now_utc;

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Serialize)]
pub struct ExportResult {
    pub data: String,
    pub items: u64,
    pub collections: u64,
    pub images_skipped: u64,
    pub images: Vec<ExportImage>,
}

#[derive(Serialize)]
pub struct ExportImage {
    pub sha256: String,
    pub base64: String,
}

#[derive(Serialize)]
pub struct RestoreResult {
    pub items: u64,
    pub collections: u64,
    pub collections_removed: u64,
    pub items_removed: u64,
}

#[derive(Serialize, Deserialize)]
struct BackupCollection {
    name: String,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
struct BackupItem {
    kind: String,
    content: Option<String>,
    html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_key: Option<String>,
    sha256: String,
    item_type: String,
    status: String,
    is_sensitive: bool,
    expires_at: Option<String>,
    created_at: String,
    updated_at: String,
    collections: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct BackupData {
    app: String,
    version: u32,
    exported_at: String,
    collections: Vec<BackupCollection>,
    items: Vec<BackupItem>,
}

pub fn export_backup(conn: &Connection, include_images: bool) -> rusqlite::Result<ExportResult> {
    let mut stmt = conn.prepare("SELECT name, created_at FROM collections ORDER BY id")?;
    let collections = stmt
        .query_map([], |r| {
            Ok(BackupCollection {
                name: r.get(0)?,
                created_at: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut stmt = conn.prepare(
        "SELECT ci.id, ci.kind, ci.content, ci.html, ci.image_data, ci.sha256, ci.item_type,
                ci.status, ci.is_sensitive, ci.expires_at, ci.created_at, ci.updated_at
         FROM clipboard_items ci
         WHERE ci.kind != 'IMAGE'
           AND (ci.status = 'PINNED'
                OR EXISTS (SELECT 1 FROM collection_items cii WHERE cii.item_id = ci.id))
         ORDER BY ci.id",
    )?;
    let mut image_stmt = if include_images {
        Some(conn.prepare(
            "SELECT ci.id, ci.kind, ci.content, ci.html, ci.image_data, ci.sha256, ci.item_type,
                    ci.status, ci.is_sensitive, ci.expires_at, ci.created_at, ci.updated_at
             FROM clipboard_items ci
             WHERE ci.kind = 'IMAGE'
               AND (ci.status = 'PINNED'
                    OR EXISTS (SELECT 1 FROM collection_items cii WHERE cii.item_id = ci.id))
             ORDER BY ci.id",
        )?)
    } else {
        None
    };

    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<(i64, BackupItem)> {
        let kind: String = r.get("kind")?;
        let sha256: String = r.get("sha256")?;
        Ok((
            r.get("id")?,
            BackupItem {
                image_key: if kind == "IMAGE" { Some(sha256.clone()) } else { None },
                image_base64: None,
                kind,
                content: r.get("content")?,
                html: r.get("html")?,
                sha256,
                item_type: r.get("item_type")?,
                status: r.get("status")?,
                is_sensitive: r.get::<_, i64>("is_sensitive")? != 0,
                expires_at: r.get("expires_at")?,
                created_at: r.get("created_at")?,
                updated_at: r.get("updated_at")?,
                collections: Vec::new(),
            },
        ))
    };

    let mut items = Vec::new();
    let mut export_images = Vec::new();
    {
        let mut cs = conn.prepare(
            "SELECT c.name FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
             WHERE ci.item_id = ?1 ORDER BY c.id",
        )?;
        let mut collect = |rows: Vec<(i64, BackupItem)>| -> rusqlite::Result<()> {
            for (id, mut item) in rows {
                item.collections = cs
                    .query_map([id], |r| r.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                items.push(item);
            }
            Ok(())
        };
        let text_rows = stmt
            .query_map([], map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        collect(text_rows)?;
        if let Some(image_stmt) = &mut image_stmt {
            let image_rows = image_stmt
                .query_map([], |r| -> rusqlite::Result<(i64, BackupItem, Option<Vec<u8>>)> {
                    let (id, item) = map_row(r)?;
                    Ok((id, item, r.get("image_data")?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for (_id, item, image_data) in &image_rows {
                if let (Some(sha), Some(data)) = (&item.image_key, image_data) {
                    export_images.push(ExportImage {
                        sha256: sha.clone(),
                        base64: B64.encode(data),
                    });
                }
            }
            collect(
                image_rows
                    .into_iter()
                    .map(|(id, item, _)| (id, item))
                    .collect(),
            )?;
        }
    }

    let images: i64 = conn.query_row(
        "SELECT COUNT(*) FROM clipboard_items WHERE kind = 'IMAGE'",
        [],
        |r| r.get(0),
    )?;

    let data = BackupData {
        app: "clipy".to_string(),
        version: 1,
        exported_at: now_utc(),
        collections,
        items,
    };
    let json = serde_json::to_string(&data)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e))))?;

    Ok(ExportResult {
        data: json,
        items: data.items.len() as u64,
        collections: data.collections.len() as u64,
        images_skipped: if include_images {
            0
        } else {
            images as u64
        },
        images: export_images,
    })
}

pub fn import_backup(conn: &Connection, json: &str) -> rusqlite::Result<RestoreResult> {
    let data: BackupData = serde_json::from_str(json).map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!(
            "invalid backup data: {e}"
        ))))
    })?;
    if data.app != "clipy" || data.version != 1 {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::other("unsupported backup data"),
        )));
    }

    let tx = conn.unchecked_transaction()?;
    let items_removed = tx.execute("DELETE FROM clipboard_items", [])? as u64;
    let collections_removed = tx.execute("DELETE FROM collections", [])? as u64;

    for c in &data.collections {
        tx.execute(
            "INSERT INTO collections (name, created_at) VALUES (?1, ?2)",
            params![c.name, c.created_at],
        )?;
    }

        let effective_sha = |it: &BackupItem| -> String {
        match it.image_base64.as_deref() {
            Some(b64) if it.kind == "IMAGE" => {
                let data = B64.decode(b64).unwrap_or_default();
                sha256_hex(&data)
            }
            _ => it.sha256.clone(),
        }
    };
    let mut item_ids: Vec<(String, i64)> = Vec::new();
    for it in &data.items {
        let image_data: Option<Vec<u8>> = match it.image_base64.as_deref() {
            Some(b64) => Some(B64.decode(b64).map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(
                    format!("invalid image data: {e}"),
                )))
            })?),
            None => None,
        };
        // The image bytes in a backup may have been re-encoded on the server
        // (e.g. WebP -> PNG on restore), so the original sha256 no longer
        // describes them. Recompute from the actual bytes to keep the row
        // consistent, otherwise later image uploads fail integrity checks.
        let sha = effective_sha(it);
        let image_preview = image_data
            .as_deref()
            .filter(|_d| it.kind == "IMAGE")
            .and_then(|d| crate::clipboard::make_preview(d, 320));
        tx.execute(
            "INSERT INTO clipboard_items
               (kind, content, html, image_data, image_preview, sha256, item_type, status,
                is_sensitive, expires_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                it.kind,
                it.content,
                it.html,
                image_data,
                image_preview,
                sha,
                it.item_type,
                it.status,
                it.is_sensitive as i64,
                it.expires_at,
                it.created_at,
                it.updated_at
            ],
        )?;
        item_ids.push((sha, tx.last_insert_rowid()));
    }

    let find_id = |sha: &str| -> Option<i64> {
        item_ids.iter().find(|(s, _)| s == sha).map(|(_, id)| *id)
    };
    let find_cid = |name: &str| -> Option<i64> {
        tx.query_row(
            "SELECT id FROM collections WHERE name = ?1",
            [name],
            |r| r.get::<_, i64>(0),
        )
        .optional()
        .ok()
        .flatten()
    };

    for it in &data.items {
        let Some(item_id) = find_id(&effective_sha(it)) else { continue };
        for cname in &it.collections {
            if let Some(cid) = find_cid(cname) {
                tx.execute(
                    "INSERT OR IGNORE INTO collection_items (item_id, collection_id) VALUES (?1, ?2)",
                    params![item_id, cid],
                )?;
            }
        }
    }

    tx.commit()?;

    Ok(RestoreResult {
        items: data.items.len() as u64,
        collections: data.collections.len() as u64,
        collections_removed,
        items_removed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::SCHEMA;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    fn seed(conn: &Connection) {
        conn.execute("INSERT INTO collections (name) VALUES ('Work'), ('Personal')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO clipboard_items (kind, content, html, sha256, item_type, status)
             VALUES ('TEXT','in-collection','<b>x</b>','sha1','TEXT','SAVED'),
                    ('TEXT','pinned',NULL,'sha2','CODE','PINNED'),
                    ('TEXT','temporary',NULL,'sha3','TEXT','TEMPORARY'),
                    ('IMAGE',NULL,NULL,'sha4','IMAGE','PINNED'),
                    ('IMAGE',NULL,NULL,'sha5','IMAGE','TEMPORARY')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO collection_items (item_id, collection_id) VALUES (1,1),(1,2)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn export_only_pinned_and_collection_items_skips_images() {
        let conn = db();
        seed(&conn);
        let result = export_backup(&conn, false).unwrap();
        assert_eq!(result.items, 2);
        assert_eq!(result.collections, 2);
        assert_eq!(result.images_skipped, 2);
        let data: BackupData = serde_json::from_str(&result.data).unwrap();
        assert!(!data.items.iter().any(|i| i.content == Some("temporary".into())));
        assert!(!data.items.iter().any(|i| i.kind == "IMAGE"));
        let pinned = data.items.iter().find(|i| i.content == Some("pinned".into())).unwrap();
        assert_eq!(pinned.status, "PINNED");
    }

    #[test]
    fn export_with_images_for_pro() {
        let conn = db();
        seed(&conn);
        conn.execute(
            "UPDATE clipboard_items SET image_data = X'89504E47' WHERE kind = 'IMAGE' AND status = 'PINNED'",
            [],
        )
        .unwrap();
        let result = export_backup(&conn, true).unwrap();
        assert_eq!(result.items, 3);
        assert_eq!(result.images_skipped, 0);
        let data: BackupData = serde_json::from_str(&result.data).unwrap();
        let image = data.items.iter().find(|i| i.kind == "IMAGE").unwrap();
        assert!(image.image_base64.is_none());
        assert_eq!(image.image_key.as_deref(), Some("sha4"));
        assert_eq!(result.images.len(), 1);
        assert_eq!(result.images[0].sha256, "sha4");
        let bytes = B64.decode(&result.images[0].base64).unwrap();
        assert_eq!(bytes, vec![0x89, 0x50, 0x4E, 0x47]);
    }

    #[test]
    fn import_replaces_fully_and_syncs_collections() {
        let src = db();
        seed(&src);
        let export = export_backup(&src, false).unwrap();

        let dst = db();
        dst.execute("INSERT INTO collections (name) VALUES ('Stale')", []).unwrap();
        dst.execute(
            "INSERT INTO clipboard_items (kind, content, sha256, item_type, status)
             VALUES ('TEXT','old', 'sha-old','TEXT','SAVED')",
            [],
        )
        .unwrap();
        let r = import_backup(&dst, &export.data).unwrap();
        assert_eq!(r.items, 2);
        assert_eq!(r.collections, 2);
        assert_eq!(r.collections_removed, 1);
        assert_eq!(r.items_removed, 1);

        let names: Vec<String> = dst
            .prepare("SELECT name FROM collections ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(names, vec!["Personal", "Work"]);

        let rows: Vec<(String, String)> = dst
            .prepare(
                "SELECT ci.content, c.name FROM clipboard_items ci
                 JOIN collection_items cii ON cii.item_id = ci.id
                 JOIN collections c ON c.id = cii.collection_id
                 ORDER BY ci.id, c.name",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![
                ("in-collection".into(), "Personal".into()),
                ("in-collection".into(), "Work".into()),
            ]
        );

        let fts: i64 = dst
            .query_row("SELECT COUNT(*) FROM items_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts, 2);
    }

    #[test]
    fn import_rejects_invalid_data() {
        let conn = db();
        assert!(import_backup(&conn, "not json").is_err());
    }
}