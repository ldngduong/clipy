pub const SCHEMA: &str = r#"
-- Settings (key-value, JSON values)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Collections
CREATE TABLE IF NOT EXISTS collections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Clipboard items
CREATE TABLE IF NOT EXISTS clipboard_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('TEXT','HTML','IMAGE')),
  content       TEXT,
  html          TEXT,
  image_data    BLOB,
  image_preview BLOB,
  sha256        TEXT NOT NULL UNIQUE,
  item_type     TEXT NOT NULL DEFAULT 'TEXT'
                CHECK (item_type IN ('TEXT','URL','CODE','JSON','COMMAND','EMAIL','IMAGE','FILE')),
  status        TEXT NOT NULL DEFAULT 'TEMPORARY'
                CHECK (status IN ('TEMPORARY','SAVED','PINNED')),
  is_sensitive  INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_items_created_at ON clipboard_items (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_status      ON clipboard_items (status);
CREATE INDEX IF NOT EXISTS idx_items_kind        ON clipboard_items (kind);
CREATE INDEX IF NOT EXISTS idx_items_item_type   ON clipboard_items (item_type);
CREATE INDEX IF NOT EXISTS idx_items_expires     ON clipboard_items (expires_at) WHERE status = 'TEMPORARY';

-- Item <-> Collection (many-to-many)
CREATE TABLE IF NOT EXISTS collection_items (
  item_id       INTEGER NOT NULL REFERENCES clipboard_items(id) ON DELETE CASCADE,
  collection_id INTEGER NOT NULL REFERENCES collections(id)     ON DELETE CASCADE,
  PRIMARY KEY (item_id, collection_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_cid ON collection_items (collection_id);

-- Full-text search (FTS5, external content)
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  content,
  content='clipboard_items',
  content_rowid='id',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON clipboard_items BEGIN
  INSERT INTO items_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON clipboard_items BEGIN
  INSERT INTO items_fts(items_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON clipboard_items BEGIN
  INSERT INTO items_fts(items_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO items_fts(rowid, content) VALUES (new.id, new.content);
END;
"#;
