fn main() {
    let db_path = format!(
        "{}/.local/share/com.duong.clipy/clipy.db",
        std::env::var("HOME").unwrap()
    );
    let conn = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .expect("open db");
    let mut stmt = conn
        .prepare("SELECT id, item_type, substr(content,1,50) AS c, created_at FROM clipboard_items ORDER BY id DESC LIMIT 5")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .unwrap();
    for row in rows {
        let (id, ty, c, ts) = row.unwrap();
        println!("id={id} type={ty} content={c:?} at={ts}");
    }
}
