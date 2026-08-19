use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ItemKind {
    Text,
    Html,
    Image,
}

impl ItemKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemKind::Text => "TEXT",
            ItemKind::Html => "HTML",
            ItemKind::Image => "IMAGE",
        }
    }
}

impl From<&str> for ItemKind {
    fn from(s: &str) -> Self {
        match s {
            "HTML" => ItemKind::Html,
            "IMAGE" => ItemKind::Image,
            _ => ItemKind::Text,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ItemType {
    Text,
    Url,
    Code,
    Json,
    Command,
    Email,
    Image,
    File,
}

impl ItemType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemType::Text => "TEXT",
            ItemType::Url => "URL",
            ItemType::Code => "CODE",
            ItemType::Json => "JSON",
            ItemType::Command => "COMMAND",
            ItemType::Email => "EMAIL",
            ItemType::Image => "IMAGE",
            ItemType::File => "FILE",
        }
    }
}

impl From<&str> for ItemType {
    fn from(s: &str) -> Self {
        match s {
            "URL" => ItemType::Url,
            "CODE" => ItemType::Code,
            "JSON" => ItemType::Json,
            "COMMAND" => ItemType::Command,
            "EMAIL" => ItemType::Email,
            "IMAGE" => ItemType::Image,
            "FILE" => ItemType::File,
            _ => ItemType::Text,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ItemStatus {
    Temporary,
    Saved,
    Pinned,
}

impl ItemStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ItemStatus::Temporary => "TEMPORARY",
            ItemStatus::Saved => "SAVED",
            ItemStatus::Pinned => "PINNED",
        }
    }
}

impl From<&str> for ItemStatus {
    fn from(s: &str) -> Self {
        match s {
            "SAVED" => ItemStatus::Saved,
            "PINNED" => ItemStatus::Pinned,
            _ => ItemStatus::Temporary,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipboardItem {
    pub id: i64,
    pub kind: ItemKind,
    pub content: Option<String>,
    pub html: Option<String>,
    pub image_base64: Option<String>,
    pub preview_base64: Option<String>,
    pub sha256: String,
    pub item_type: ItemType,
    pub status: ItemStatus,
    pub is_sensitive: bool,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub collections: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub item_count: i64,
    pub pinned: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ItemFilters {
    pub kind: Option<String>,
    pub item_type: Option<String>,
    pub status: Option<String>,
    pub collection_id: Option<i64>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub total: i64,
    pub temporary: i64,
    pub saved: i64,
    pub pinned: i64,
    pub images: i64,
    pub sensitive: i64,
    pub storage_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub retention_hours: i64,
    #[serde(default)]
    pub max_history: i64,
    #[serde(default)]
    pub capture_images: bool,
    #[serde(default)]
    pub secret_detection: bool,
    #[serde(default)]
    pub global_shortcut: String,
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub launch_on_startup: bool,
    #[serde(default)]
    pub start_minimized: bool,
    #[serde(default)]
    pub click_to_copy: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            retention_hours: 24 * 7,
            max_history: 5000,
            capture_images: true,
            secret_detection: true,
            global_shortcut: "CommandOrControl+Shift+V".to_string(),
            theme: "system".to_string(),
            language: "vi".to_string(),
            launch_on_startup: false,
            start_minimized: false,
            click_to_copy: true,
        }
    }
}
