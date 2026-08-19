use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use arboard::Clipboard;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::repo;
use crate::db::Database;
use crate::detect;

const POLL_INTERVAL: Duration = Duration::from_millis(400);
const SELF_WRITE_WINDOW_MS: u64 = 2_000;

pub struct MonitorState {
    paused: AtomicBool,
    self_write_until_ms: AtomicU64,
}

impl MonitorState {
    pub fn new() -> Self {
        Self {
            paused: AtomicBool::new(false),
            self_write_until_ms: AtomicU64::new(0),
        }
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
    }

    pub fn mark_self_write(&self) {
        let until = now_millis() + SELF_WRITE_WINDOW_MS;
        self.self_write_until_ms.store(until, Ordering::Relaxed);
    }

    pub fn is_self_write(&self) -> bool {
        now_millis() < self.self_write_until_ms.load(Ordering::Relaxed)
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

struct Captured {
    sha256: String,
    text: Option<String>,
    html: Option<String>,
    image_png: Option<Vec<u8>>,
    image_preview: Option<Vec<u8>>,
    kind: crate::db::models::ItemKind,
}

/// Downscaled preview of a PNG (max `max_dim` on the longest side) so the
/// history list payload stays small; the full image is only loaded on demand.
pub fn make_preview(png: &[u8], max_dim: u32) -> Option<Vec<u8>> {
    let img = image::load_from_memory(png).ok()?;
    let thumb = img.thumbnail(max_dim, max_dim);
    let mut out: Vec<u8> = Vec::new();
    thumb
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .ok()?;
    Some(out)
}

pub fn start_monitor(app: AppHandle) {
    std::thread::Builder::new()
        .name("clipboard-monitor".into())
        .spawn(move || {
            let monitor_state = app.state::<MonitorState>();
            let mut clipboard = match Clipboard::new() {
                Ok(c) => c,
                Err(e) => {
                    tauri_plugin_log::log::error!("failed to init clipboard: {e}");
                    return;
                }
            };
            let mut last_hash: Option<String> = None;

            loop {
                std::thread::sleep(POLL_INTERVAL);

                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    monitor_iteration(&app, &monitor_state, &mut clipboard, &mut last_hash);
                }));
                if let Err(panic) = result {
                    let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                        *s
                    } else if let Some(s) = panic.downcast_ref::<String>() {
                        s.as_str()
                    } else {
                        "unknown panic"
                    };
                    tauri_plugin_log::log::error!("clipboard monitor iteration panicked: {msg}");
                    std::thread::sleep(std::time::Duration::from_secs(5));
                }
            }
        })
        .expect("failed to spawn clipboard monitor");
}

fn monitor_iteration(
    app: &AppHandle,
    monitor_state: &MonitorState,
    clipboard: &mut Clipboard,
    last_hash: &mut Option<String>,
) {
    if monitor_state.is_paused() {
        *last_hash = None;
        return;
    }
    if monitor_state.is_self_write() {
        return;
    }

    let db = app.state::<Database>();
    let settings = {
        let conn = db.conn();
        repo::get_settings(&conn).unwrap_or_default()
    };

    let captured = match read_clipboard(clipboard, settings.capture_images) {
        Some(c) => c,
        None => return,
    };

    if last_hash.as_deref() == Some(captured.sha256.as_str()) {
        return;
    }

    let conn = db.conn();
    // dedupe against any recent item with same hash (covers rapid recopy / stale buffers)
    if repo::item_exists(&conn, &captured.sha256, 30).unwrap_or(false) {
        *last_hash = Some(captured.sha256.clone());
        return;
    }
    // FR-04: also skip if same as the very latest item
    if let Ok(Some(latest)) = repo::latest_item_sha(&conn) {
        if latest == captured.sha256 {
            *last_hash = Some(captured.sha256.clone());
            return;
        }
    }
    drop(conn);

    let is_sensitive = if settings.secret_detection {
        captured
            .text
            .as_deref()
            .map(detect::is_sensitive)
            .unwrap_or(false)
    } else {
        false
    };
    let item_type = match captured.text.as_deref() {
        Some(t) => detect::detect_type(captured.kind, t),
        None => detect::detect_type(captured.kind, ""),
    };

    let conn = db.conn();
    let inserted = repo::insert_item(
        &conn,
        captured.kind,
        captured.text,
        captured.html,
        captured.image_png,
        captured.image_preview,
        captured.sha256.clone(),
        item_type,
        is_sensitive,
        settings.retention_hours,
    );

    match inserted {
        Ok(Some(item)) => {
            *last_hash = Some(captured.sha256);
            tauri_plugin_log::log::debug!(
                "captured item #{} type={} kind={}",
                item.id,
                item.item_type.as_str(),
                item.kind.as_str()
            );
            let _ = app.emit("clipy://item-created", item);
        }
        Ok(None) => {
            *last_hash = Some(captured.sha256);
        }
        Err(e) => {
            tauri_plugin_log::log::error!("failed to insert item: {e}");
        }
    }
}

fn read_clipboard(clip: &mut Clipboard, capture_images: bool) -> Option<Captured> {
    let t0 = std::time::Instant::now();
    let text = match clip.get_text() {
        Ok(t) if !t.trim().is_empty() => Some(t),
        _ => None,
    };
    let t_text = t0.elapsed();

    let html = None; // arboard 3.x cannot read HTML payloads; reserved for future

    if let Some(text) = text {
        return Some(Captured {
            sha256: hash(text.as_bytes()),
            text: Some(text),
            html,
            image_png: None,
            image_preview: None,
            kind: crate::db::models::ItemKind::Text,
        });
    }

    if let Some(html) = html {
        return Some(Captured {
            sha256: hash(html.as_bytes()),
            text: None,
            html: Some(html),
            image_png: None,
            image_preview: None,
            kind: crate::db::models::ItemKind::Html,
        });
    }

    if capture_images {
        if let Ok(img) = clip.get_image() {
            let t_img = t0.elapsed();
            let png = encode_png(&img);
            let t_enc = t0.elapsed();
            if let Ok(png) = png {
                if !png.is_empty() {
                    let image_preview = make_preview(&png, 320);
                    let t_prev = t0.elapsed();
                    tauri_plugin_log::log::info!(
                        "[timing] read_clipboard image text={t_text:?} img={t_img:?} enc={t_enc:?} prev={t_prev:?}"
                    );
                    return Some(Captured {
                        sha256: hash(&png),
                        text: None,
                        html: None,
                        image_png: Some(png),
                        image_preview,
                        kind: crate::db::models::ItemKind::Image,
                    });
                }
            }
        }
    }

    None
}

fn hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn encode_png(img: &arboard::ImageData<'_>) -> Result<Vec<u8>, String> {
    let rgba = image::RgbaImage::from_raw(
        img.width as u32,
        img.height as u32,
        img.bytes.to_vec(),
    )
    .ok_or_else(|| "invalid image dimensions".to_string())?;
    let mut out: Vec<u8> = Vec::new();
    rgba.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| format!("png encode failed: {e}"))?;
    Ok(out)
}

pub fn set_clipboard_text(app: &AppHandle, text: &str) -> Result<(), String> {
    app.state::<MonitorState>().mark_self_write();
    let mut clip = Clipboard::new().map_err(|e| format!("clipboard init failed: {e}"))?;
    clip.set_text(text.to_string())
        .map_err(|e| format!("set clipboard failed: {e}"))
}

pub fn set_clipboard_image(app: &AppHandle, png: &[u8]) -> Result<(), String> {
    app.state::<MonitorState>().mark_self_write();
    let img = image::load_from_memory(png)
        .map_err(|e| format!("decode image failed: {e}"))?
        .to_rgba8();
    let (w, h) = (img.width() as usize, img.height() as usize);
    let mut clip = Clipboard::new().map_err(|e| format!("clipboard init failed: {e}"))?;
    clip.set_image(arboard::ImageData {
        width: w,
        height: h,
        bytes: std::borrow::Cow::Owned(img.into_raw()),
    })
    .map_err(|e| format!("set image failed: {e}"))
}
