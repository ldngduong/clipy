use std::sync::atomic::{AtomicU64, Ordering};

use clipy_lib::db::models::{ItemFilters, ItemKind, ItemType};
use clipy_lib::db::repo;
use clipy_lib::db::Database;

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_db() -> Database {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("clipy-test-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    Database::open(&dir.join("test.db")).unwrap()
}

fn insert_text(
    conn: &rusqlite::Connection,
    content: &str,
    sha: &str,
    item_type: ItemType,
    is_sensitive: bool,
    retention_hours: i64,
) -> Option<clipy_lib::db::models::ClipboardItem> {
    repo::insert_item(
        conn,
        ItemKind::Text,
        Some(content.to_string()),
        None,
        None,
        None,
        sha.to_string(),
        item_type,
        is_sensitive,
        retention_hours,
    )
    .unwrap()
}

#[test]
fn insert_and_retrieve_item() {
    let db = temp_db();
    let conn = db.conn();
    let item = insert_text(&conn, "docker compose up -d", "abc123", ItemType::Command, false, 24 * 7)
        .expect("item inserted");

    assert_eq!(item.item_type, ItemType::Command);
    assert!(item.expires_at.is_some());

    let fetched = repo::get_item(&conn, item.id).unwrap();
    assert_eq!(fetched.content.as_deref(), Some("docker compose up -d"));
}

#[test]
fn duplicate_sha_ignored() {
    let db = temp_db();
    let conn = db.conn();
    let a = insert_text(&conn, "same text", "dup-sha", ItemType::Text, false, 24 * 7);
    assert!(a.is_some());

    let b = insert_text(&conn, "same text", "dup-sha", ItemType::Text, false, 24 * 7);
    assert!(b.is_none());
}

#[test]
fn fts5_search_works() {
    let db = temp_db();
    let conn = db.conn();
    for (i, content) in [
        "docker compose up -d",
        "docker-compose.prod.yml",
        "Docker deployment command",
        "npm install @nestjs/common",
        "const user = await prisma.user.findUnique({ id })",
    ]
    .iter()
    .enumerate()
    {
        insert_text(
            &conn,
            content,
            &format!("sha-{i}"),
            if content.starts_with("docker compose") || content.starts_with("npm") {
                ItemType::Command
            } else {
                ItemType::Text
            },
            false,
            24 * 7,
        );
    }

    let results = repo::search_items(&conn, "docker", &ItemFilters::default()).unwrap();
    assert_eq!(results.len(), 3, "docker matches 3 items");

    let results = repo::search_items(&conn, "compose", &ItemFilters::default()).unwrap();
    assert_eq!(results.len(), 2);

    let results = repo::search_items(&conn, "docker compose", &ItemFilters::default()).unwrap();
    assert!(results.len() >= 1);
    assert!(
        results.iter().any(|i| i.content.as_deref() == Some("docker compose up -d")),
        "expected 'docker compose up -d' in results: {:?}",
        results.iter().map(|i| i.content.as_deref()).collect::<Vec<_>>()
    );

    // filters combine with search
    let f = ItemFilters {
        item_type: Some("COMMAND".into()),
        ..Default::default()
    };
    let results = repo::search_items(&conn, "docker", &f).unwrap();
    assert_eq!(results.len(), 1);
}

#[test]
fn expiration_and_trim() {
    let db = temp_db();
    let conn = db.conn();
    insert_text(&conn, "temp one", "e1", ItemType::Text, false, 0); // no expiry
    insert_text(&conn, "saved one", "e2", ItemType::Text, false, 24);
    drop(conn);

    // manually expire the second item
    let conn = db.conn();
    conn.execute(
        "UPDATE clipboard_items SET expires_at = datetime('now', '-1 hour') WHERE sha256 = 'e2'",
        [],
    )
    .unwrap();
    let deleted = repo::delete_expired(&conn).unwrap();
    assert_eq!(deleted, 1);
    drop(conn);

    let conn = db.conn();
    let remaining = repo::list_items(&conn, &ItemFilters::default()).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].sha256, "e1");

    // trim keeps only latest 1 temporary
    insert_text(&conn, "temp two", "e3", ItemType::Text, false, 24);
    let trimmed = repo::trim_history(&conn, 1).unwrap();
    assert_eq!(trimmed, 1);
    let remaining = repo::list_items(&conn, &ItemFilters::default()).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].sha256, "e3");
}

#[test]
fn pinned_and_collection_items_never_expire() {
    let db = temp_db();
    let conn = db.conn();
    // pinned items + items inside a collection are immune to expiration & trim (FR-07)
    let pinned = insert_text(&conn, "pinned forever", "p1", ItemType::Text, false, 24)
        .expect("pinned item");
    let in_collection = insert_text(&conn, "collected forever", "c1", ItemType::Text, false, 24)
        .expect("collected item");
    let temp = insert_text(&conn, "temp", "t1", ItemType::Text, false, 24).expect("temp item");

    repo::set_item_status(&conn, pinned.id, clipy_lib::db::models::ItemStatus::Pinned).unwrap();
    let cid = repo::create_collection(&conn, "Work").unwrap();
    repo::set_item_collection(&conn, in_collection.id, Some(cid)).unwrap();

    // expire everything in the past
    conn.execute(
        "UPDATE clipboard_items SET expires_at = datetime('now', '-1 hour')",
        [],
    )
    .unwrap();
    let deleted = repo::delete_expired(&conn).unwrap();
    assert_eq!(deleted, 1, "only the plain TEMPORARY item expires");

    // trim with max 1: pinned + collected are protected, nothing left to trim
    let trimmed = repo::trim_history(&conn, 1).unwrap();
    assert_eq!(trimmed, 0, "trim must not delete pinned/collected items");

    let remaining = repo::list_items(&conn, &ItemFilters::default()).unwrap();
    assert_eq!(remaining.len(), 2);
    let ids: Vec<i64> = remaining.iter().map(|i| i.id).collect();
    assert!(ids.contains(&pinned.id));
    assert!(ids.contains(&in_collection.id));
}

#[test]
fn collections_filter() {
    let db = temp_db();
    let conn = db.conn();
    let cid = repo::create_collection(&conn, "Work").unwrap();
    repo::create_collection(&conn, "Work").unwrap(); // conflict ignored

    let item = insert_text(&conn, "postgres connection", "ct1", ItemType::Text, false, 24 * 7)
        .expect("item");

    repo::set_item_collection(&conn, item.id, Some(cid)).unwrap();

    let item = repo::get_item(&conn, item.id).unwrap();
    assert_eq!(item.collections, vec!["Work".to_string()]);

    let cols = repo::list_collections(&conn).unwrap();
    assert_eq!(cols.len(), 1);
    assert_eq!(cols[0].item_count, 1);

    let filtered = repo::list_items(
        &conn,
        &ItemFilters {
            collection_id: Some(cid),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(filtered.len(), 1);
}

#[test]
fn settings_roundtrip() {
    let db = temp_db();
    let conn = db.conn();
    let defaults = repo::get_settings(&conn).unwrap();
    assert_eq!(defaults.retention_hours, 24 * 7);

    let mut s = defaults.clone();
    s.retention_hours = 1;
    s.capture_images = false;
    repo::set_settings(&conn, &s).unwrap();

    let loaded = repo::get_settings(&conn).unwrap();
    assert_eq!(loaded.retention_hours, 1);
    assert!(!loaded.capture_images);
}

#[test]
fn stats_and_clear() {
    let db = temp_db();
    let conn = db.conn();
    for i in 0..3 {
        insert_text(&conn, &format!("item {i}"), &format!("st-{i}"), ItemType::Text, true, 24);
    }
    let stats = repo::get_stats(&conn).unwrap();
    assert_eq!(stats.total, 3);
    assert_eq!(stats.sensitive, 3);

    let n = repo::clear_history(&conn).unwrap();
    assert_eq!(n, 3);
    assert_eq!(repo::get_stats(&conn).unwrap().total, 0);
}