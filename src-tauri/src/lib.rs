use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt,
};

#[cfg(target_os = "macos")]
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

#[cfg(target_os = "macos")]
use core_foundation::{
    base::TCFType, boolean::CFBoolean, dictionary::CFDictionary, string::CFStringRef,
};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(QuickPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef) -> u8;
}

const QUICK_PANEL_WIDTH: f64 = 360.0;
const MANAGEMENT_PANEL_WIDTH: f64 = 760.0;
const QUICK_PANEL_FALLBACK_HEIGHT: f64 = 640.0;
const QUICK_PANEL_HEIGHT_RATIO: f64 = 0.8;
const QUICK_PANEL_MARGIN: f64 = 12.0;
const FOCUS_PREFETCH_INTERVAL_MS: u64 = 250;
static LAST_NATIVE_POSITION_FAILURE_MS: AtomicI64 = AtomicI64::new(0);

#[derive(Default, Clone)]
struct CachedFocusBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    source: String,
    valid: bool,
    updated_at: i64,
}

static FOCUS_BOUNDS_CACHE: std::sync::OnceLock<Arc<Mutex<CachedFocusBounds>>> =
    std::sync::OnceLock::new();

fn focus_bounds_cache() -> Arc<Mutex<CachedFocusBounds>> {
    FOCUS_BOUNDS_CACHE
        .get_or_init(|| Arc::new(Mutex::new(CachedFocusBounds::default())))
        .clone()
}

#[derive(Serialize)]
struct ClipboardPayload {
    text: Option<String>,
}

#[derive(Serialize)]
struct UserSettingsPayload {
    path: String,
    settings: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DbInitPayload {
    path: String,
    schema_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipAnalysisPayload {
    source_name: String,
    badge: String,
    title: String,
    summary: String,
    url: Option<String>,
    host: Option<String>,
    is_markdown: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipItemPayload {
    id: String,
    content: String,
    created_at: i64,
    updated_at: i64,
    last_seen_at: i64,
    last_copied_at: Option<i64>,
    source: String,
    kind: String,
    bucket: String,
    favorite: bool,
    tags: Vec<String>,
    copy_count: i64,
    analysis: ClipAnalysisPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureClipPayload {
    status: String,
    item: ClipItemPayload,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryClipPayload {
    items: Vec<ClipItemPayload>,
    next_cursor: Option<String>,
    limit: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FocusedInputBoundsPayload {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    source: String,
}

#[derive(Clone)]
struct NativeBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    source: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessibilityPermissionPayload {
    status: String,
    can_read_focused_input: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteClipPayload {
    deleted_ids: Vec<String>,
    deleted_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupClipPayload {
    hard_deleted: i64,
    ran_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppLogEntryPayload {
    ts_ms: i64,
    level: String,
    message: String,
    context: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryAppLogPayload {
    path: String,
    items: Vec<AppLogEntryPayload>,
    limit: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardChangePayload {
    change_count: i64,
    has_change: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview_len: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateClipInput {
    id: String,
    bucket: Option<String>,
    favorite: Option<bool>,
    copied: Option<bool>,
}

#[tauri::command]
fn read_clipboard_text() -> Result<ClipboardPayload, String> {
    let text = read_platform_clipboard()?;
    if text.is_empty() {
        Ok(ClipboardPayload { text: None })
    } else {
        Ok(ClipboardPayload { text: Some(text) })
    }
}

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<(), String> {
    write_platform_clipboard(&text)
}

#[tauri::command]
fn paste_clipboard_text<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    text: String,
) -> Result<(), String> {
    write_platform_clipboard(&text)?;
    hide_panel_before_paste(&app);
    thread::sleep(Duration::from_millis(60));
    simulate_platform_paste()
}

#[tauri::command]
fn init_clip_database() -> Result<DbInitPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    Ok(DbInitPayload {
        path: database_path()?.to_string_lossy().to_string(),
        schema_version: version,
    })
}

#[tauri::command]
fn capture_clip_record(
    content: String,
    source_label: Option<String>,
    observed_at: i64,
) -> Result<CaptureClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("content is empty".to_string());
    }
    let hash = content_hash(&content);
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM clips WHERE content_hash = ?1 AND deleted_at IS NULL LIMIT 1",
            params![hash],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some(id) = existing_id {
        conn.execute(
            "UPDATE clips SET last_seen_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![observed_at, id],
        )
        .map_err(|error| error.to_string())?;
        let item = load_clip(&conn, &id)?;
        return Ok(CaptureClipPayload {
            status: "promoted".to_string(),
            item,
        });
    }

    let id = format!("clip_{hash:x}_{observed_at}");
    let analysis = analyze_clip(&content, source_label.as_deref().unwrap_or("Clipboard"));
    let tags = default_tags(&analysis, &content).join(",");
    conn.execute(
        "INSERT INTO clips (
            id, content, content_hash, kind, bucket, source, source_label, favorite, tags,
            copy_count, created_at, updated_at, last_seen_at, title, summary, url, host
        ) VALUES (?1, ?2, ?3, ?4, 'history', 'clipboard', ?5, 0, ?6, 0, ?7, ?7, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            content,
            hash.to_string(),
            analysis_kind(&analysis),
            source_label.unwrap_or_else(|| "Clipboard".to_string()),
            tags,
            observed_at,
            analysis.title,
            analysis.summary,
            analysis.url,
            analysis.host
        ],
    )
    .map_err(|error| error.to_string())?;
    upsert_fts(&conn, &id)?;
    let item = load_clip(&conn, &id)?;
    Ok(CaptureClipPayload {
        status: "created".to_string(),
        item,
    })
}

#[tauri::command]
fn query_clip_records(
    text: Option<String>,
    bucket: Option<String>,
    limit: Option<i64>,
    cursor: Option<String>,
) -> Result<QueryClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let cursor_seen_at = cursor
        .as_deref()
        .and_then(|value| value.split(':').next())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(i64::MAX);
    let text = text.unwrap_or_default();
    let bucket = bucket.unwrap_or_else(|| "all".to_string());

    let mut items = Vec::new();
    let bucket_filter = bucket.as_str();
    let is_trash = bucket_filter == "trash";
    if text.trim().is_empty() {
        if bucket_filter == "all" {
            let mut stmt = conn
                .prepare("SELECT id FROM clips WHERE deleted_at IS NULL AND last_seen_at < ?1 ORDER BY last_seen_at DESC LIMIT ?2")
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![cursor_seen_at, limit], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                items.push(load_clip(&conn, &row.map_err(|error| error.to_string())?)?);
            }
        } else if is_trash {
            let mut stmt = conn
                .prepare("SELECT id FROM clips WHERE deleted_at IS NOT NULL AND last_seen_at < ?1 ORDER BY last_seen_at DESC LIMIT ?2")
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![cursor_seen_at, limit], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                items.push(load_clip(&conn, &row.map_err(|error| error.to_string())?)?);
            }
        } else {
            let mut stmt = conn
                .prepare("SELECT id FROM clips WHERE deleted_at IS NULL AND bucket = ?3 AND last_seen_at < ?1 ORDER BY last_seen_at DESC LIMIT ?2")
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![cursor_seen_at, limit, bucket], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                items.push(load_clip(&conn, &row.map_err(|error| error.to_string())?)?);
            }
        }
    } else {
        let escaped = fts_query(&text);
        if bucket_filter == "all" {
            let mut stmt = conn
                .prepare(
                    "SELECT clips.id FROM clip_fts JOIN clips ON clips.id = clip_fts.id
                     WHERE clip_fts MATCH ?1 AND clips.deleted_at IS NULL AND clips.last_seen_at < ?2
                     ORDER BY clips.last_seen_at DESC LIMIT ?3",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![escaped, cursor_seen_at, limit], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                items.push(load_clip(&conn, &row.map_err(|error| error.to_string())?)?);
            }
        } else if is_trash {
            let mut stmt = conn
                .prepare(
                    "SELECT clips.id FROM clip_fts JOIN clips ON clips.id = clip_fts.id
                     WHERE clip_fts MATCH ?1 AND clips.deleted_at IS NOT NULL AND clips.last_seen_at < ?2
                     ORDER BY clips.last_seen_at DESC LIMIT ?3",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![escaped, cursor_seen_at, limit], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                items.push(load_clip(&conn, &row.map_err(|error| error.to_string())?)?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT clips.id FROM clip_fts JOIN clips ON clips.id = clip_fts.id
                     WHERE clip_fts MATCH ?1 AND clips.deleted_at IS NULL AND clips.bucket = ?4 AND clips.last_seen_at < ?2
                     ORDER BY clips.last_seen_at DESC LIMIT ?3",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![escaped, cursor_seen_at, limit, bucket], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|error| error.to_string())?;
            for row in rows {
                items.push(load_clip(&conn, &row.map_err(|error| error.to_string())?)?);
            }
        }
    }

    let next_cursor = if items.len() as i64 == limit {
        items
            .last()
            .map(|item| format!("{}:{}", item.last_seen_at, item.id))
    } else {
        None
    };
    Ok(QueryClipPayload {
        items,
        next_cursor,
        limit,
    })
}

#[tauri::command]
fn soft_delete_clip_records(ids: Vec<String>) -> Result<DeleteClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let deleted_at = now_millis()?;
    for id in &ids {
        conn.execute(
            "UPDATE clips SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![deleted_at, id],
        )
        .map_err(|error| error.to_string())?;
        conn.execute("DELETE FROM clip_fts WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
    }
    Ok(DeleteClipPayload {
        deleted_ids: ids,
        deleted_at,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreClipPayload {
    restored_ids: Vec<String>,
}

#[tauri::command]
fn restore_clip_records(ids: Vec<String>) -> Result<RestoreClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let now = now_millis()?;
    for id in &ids {
        conn.execute(
            "UPDATE clips SET deleted_at = NULL, updated_at = ?1, bucket = 'history' WHERE id = ?2",
            params![now, id],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(RestoreClipPayload { restored_ids: ids })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HardDeleteClipPayload {
    hard_deleted_ids: Vec<String>,
}

#[tauri::command]
fn hard_delete_clip_records(ids: Vec<String>) -> Result<HardDeleteClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    for id in &ids {
        conn.execute("DELETE FROM clip_fts WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        conn.execute("DELETE FROM clips WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
    }
    Ok(HardDeleteClipPayload { hard_deleted_ids: ids })
}

#[tauri::command]
fn update_clip_record(input: UpdateClipInput) -> Result<ClipItemPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let now = now_millis()?;
    if let Some(bucket) = input.bucket {
        conn.execute(
            "UPDATE clips SET bucket = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![bucket, now, input.id],
        )
        .map_err(|error| error.to_string())?;
    }
    if let Some(favorite) = input.favorite {
        conn.execute(
            "UPDATE clips SET favorite = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![if favorite { 1 } else { 0 }, now, input.id],
        )
        .map_err(|error| error.to_string())?;
    }
    if input.copied.unwrap_or(false) {
        conn.execute(
            "UPDATE clips SET copy_count = copy_count + 1, last_copied_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, input.id],
        )
        .map_err(|error| error.to_string())?;
    }
    load_clip(&conn, &input.id)
}

#[tauri::command]
fn set_panel_mode<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    mode: String,
) -> Result<(), String> {
    let width = if mode == "management" {
        MANAGEMENT_PANEL_WIDTH
    } else {
        QUICK_PANEL_WIDTH
    };
    configure_panel_window(&window, width);
    Ok(())
}

#[tauri::command]
fn open_settings_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        &app,
        "settings",
        WebviewUrl::App("settings.html".into()),
    )
    .title("ClipForge 设置")
    .inner_size(720.0, 600.0)
    .min_inner_size(640.0, 480.0)
    .resizable(true)
    .decorations(true)
    .transparent(false)
    .always_on_top(false)
    .visible_on_all_workspaces(false)
    .build()
    .map_err(|error| error.to_string())?;

    let _ = window.set_size(LogicalSize::new(720.0, 600.0));
    let _ = window.set_always_on_top(false);
    let _ = window.set_visible_on_all_workspaces(false);
    let _ = window.center();
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn cleanup_clip_records(retention_days: i64) -> Result<CleanupClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let ran_at = now_millis()?;
    let retention_ms = retention_days.max(1) * 24 * 60 * 60 * 1000;
    let cutoff = ran_at - retention_ms;
    let hard_deleted = conn
        .execute(
            "DELETE FROM clips WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
            params![cutoff],
        )
        .map_err(|error| error.to_string())? as i64;
    conn.execute(
        "DELETE FROM clip_fts WHERE id NOT IN (SELECT id FROM clips WHERE deleted_at IS NULL)",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(CleanupClipPayload {
        hard_deleted,
        ran_at,
    })
}

#[tauri::command]
fn read_user_settings() -> Result<UserSettingsPayload, String> {
    let path = settings_path()?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, "{}\n").map_err(|error| error.to_string())?;
    }

    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let settings = parse_json5_like(&raw).unwrap_or(Value::Object(Default::default()));
    Ok(UserSettingsPayload {
        path: path.to_string_lossy().to_string(),
        settings,
    })
}

#[tauri::command]
fn write_user_settings(settings: Value) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = format!(
        "// ClipForge user settings. JSON5-style comments are allowed.\n{}\n",
        serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?
    );
    fs::write(path, body).map_err(|error| error.to_string())
}

#[tauri::command]
fn append_app_log(
    level: String,
    message: String,
    context: Option<String>,
) -> Result<String, String> {
    let path = log_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let entry = json!({
        "tsMs": timestamp_ms,
        "level": normalize_log_level(&level),
        "message": message,
        "context": context.unwrap_or_default(),
    });
    let line = format!(
        "{}\n",
        serde_json::to_string(&entry).map_err(|error| error.to_string())?
    );
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_app_log_path() -> Result<String, String> {
    Ok(log_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn query_app_logs(
    text: Option<String>,
    level: Option<String>,
    limit: Option<i64>,
) -> Result<QueryAppLogPayload, String> {
    let path = log_path()?;
    let limit = limit.unwrap_or(120).clamp(20, 500);
    let normalized_text = text.unwrap_or_default().trim().to_lowercase();
    let normalized_level = level.unwrap_or_default().trim().to_lowercase();
    let mut items = Vec::new();

    if path.exists() {
        let file = fs::File::open(&path).map_err(|error| error.to_string())?;
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let Some(entry) = parse_log_line(&line) else {
                continue;
            };
            if !normalized_level.is_empty() && entry.level != normalized_level {
                continue;
            }
            if !normalized_text.is_empty() {
                let haystack =
                    format!("{} {} {}", entry.level, entry.message, entry.context).to_lowercase();
                if !haystack.contains(&normalized_text) {
                    continue;
                }
            }
            items.push(entry);
        }
    }

    items.sort_by(|a, b| b.ts_ms.cmp(&a.ts_ms));
    items.truncate(limit as usize);
    Ok(QueryAppLogPayload {
        path: path.to_string_lossy().to_string(),
        items,
        limit,
    })
}

#[tauri::command]
fn focused_input_bounds() -> Result<FocusedInputBoundsPayload, String> {
    focused_input_bounds_platform().or_else(|_| {
        Ok(FocusedInputBoundsPayload {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            source: "fallback".to_string(),
        })
    })
}

#[tauri::command]
fn check_accessibility_permission() -> Result<AccessibilityPermissionPayload, String> {
    check_accessibility_permission_platform()
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    open_accessibility_settings_platform()
}

#[tauri::command]
fn request_accessibility_permission() -> Result<AccessibilityPermissionPayload, String> {
    request_accessibility_permission_platform()
}

#[cfg(target_os = "macos")]
fn focused_input_bounds_platform() -> Result<FocusedInputBoundsPayload, String> {
    if let Ok(cache) = focus_bounds_cache().lock() {
        if cache.valid {
            if let Ok(now) = now_millis() {
                if now - cache.updated_at < FOCUS_PREFETCH_INTERVAL_MS as i64 * 4 {
                    return Ok(FocusedInputBoundsPayload {
                        x: cache.x,
                        y: cache.y,
                        width: cache.width,
                        height: cache.height,
                        source: cache.source.clone(),
                    });
                }
            }
        }
    }
    let payload = native_focused_input_bounds().map(|bounds| FocusedInputBoundsPayload {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        source: bounds.source.to_string(),
    });
    if let Ok(b) = &payload {
        if let Ok(mut cache) = focus_bounds_cache().lock() {
            cache.x = b.x;
            cache.y = b.y;
            cache.width = b.width;
            cache.height = b.height;
            cache.source = b.source.clone();
            cache.valid = b.width > 0.0 && b.height > 0.0;
            if let Ok(now) = now_millis() {
                cache.updated_at = now;
            }
        }
    }
    payload
}

#[cfg(not(target_os = "macos"))]
fn focused_input_bounds_platform() -> Result<FocusedInputBoundsPayload, String> {
    Err("focused input bounds unavailable on this platform".to_string())
}

/// 启动后台预热线程：定期查询焦点输入框位置并写入全局缓存。
/// 这样面板触发时可以立即读取最新焦点位置，避免 AppleScript 同步阻塞。
fn start_focus_prefetch_thread() {
    #[cfg(target_os = "macos")]
    {
        thread::spawn(|| loop {
            thread::sleep(Duration::from_millis(FOCUS_PREFETCH_INTERVAL_MS));
            let _ = focused_input_bounds_platform();
        });
    }
}

#[cfg(target_os = "macos")]
fn native_focused_input_bounds() -> Result<NativeBounds, String> {
    let script = r#"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  try
    set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
    set elementPosition to value of attribute "AXPosition" of focusedElement
    set elementSize to value of attribute "AXSize" of focusedElement
    return (item 1 of elementPosition as text) & "," & (item 2 of elementPosition as text) & "," & (item 1 of elementSize as text) & "," & (item 2 of elementSize as text)
  on error
    return ""
  end try
end tell
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    parse_native_bounds(&raw, "focused-input")
        .ok_or_else(|| "focused input bounds unavailable".to_string())
}

#[cfg(target_os = "macos")]
fn native_front_window_bounds() -> Result<NativeBounds, String> {
    let script = r#"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  try
    set frontWindow to first window of frontApp
    set windowPosition to value of attribute "AXPosition" of frontWindow
    set windowSize to value of attribute "AXSize" of frontWindow
    return (item 1 of windowPosition as text) & "," & (item 2 of windowPosition as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text)
  on error
    return ""
  end try
end tell
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    parse_native_bounds(&raw, "front-window")
        .ok_or_else(|| "front window bounds unavailable".to_string())
}

#[cfg(not(target_os = "macos"))]
fn native_front_window_bounds() -> Result<NativeBounds, String> {
    Err("front window bounds unavailable on this platform".to_string())
}

fn parse_native_bounds(raw: &str, source: &'static str) -> Option<NativeBounds> {
    let parts = raw
        .trim()
        .split(',')
        .filter_map(|part| part.trim().parse::<f64>().ok())
        .collect::<Vec<_>>();
    if parts.len() != 4 || parts[2] <= 0.0 || parts[3] <= 0.0 {
        return None;
    }
    Some(NativeBounds {
        x: parts[0],
        y: parts[1],
        width: parts[2],
        height: parts[3],
        source,
    })
}

#[cfg(target_os = "macos")]
fn check_accessibility_permission_platform() -> Result<AccessibilityPermissionPayload, String> {
    let trusted = unsafe { AXIsProcessTrusted() != 0 };
    if trusted {
        Ok(AccessibilityPermissionPayload {
            status: "granted".to_string(),
            can_read_focused_input: true,
            message: "已获得辅助功能权限，可读取当前输入控件位置。".to_string(),
        })
    } else {
        mark_native_position_failure();
        Ok(AccessibilityPermissionPayload {
            status: "missing".to_string(),
            can_read_focused_input: false,
            message: "未获得辅助功能权限。主面板会快速显示在当前屏幕右侧，不再等待输入位置探测。".to_string(),
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn check_accessibility_permission_platform() -> Result<AccessibilityPermissionPayload, String> {
    Ok(AccessibilityPermissionPayload {
        status: "unsupported".to_string(),
        can_read_focused_input: false,
        message: "当前平台暂不支持读取外部应用输入控件位置。".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn open_accessibility_settings_platform() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .status()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_accessibility_settings_platform() -> Result<(), String> {
    Err("accessibility settings are only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn request_accessibility_permission_platform() -> Result<AccessibilityPermissionPayload, String> {
    let prompt_key = unsafe { core_foundation::string::CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let prompt_value = CFBoolean::true_value();
    let options = CFDictionary::from_CFType_pairs(&[(prompt_key.as_CFType(), prompt_value.as_CFType())]);
    let trusted = unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) != 0 };
    if trusted {
        Ok(AccessibilityPermissionPayload {
            status: "granted".to_string(),
            can_read_focused_input: true,
            message: "已获得辅助功能权限，可读取当前输入控件位置。".to_string(),
        })
    } else {
        mark_native_position_failure();
        Ok(AccessibilityPermissionPayload {
            status: "missing".to_string(),
            can_read_focused_input: false,
            message: "已请求 macOS 辅助功能授权。请在系统设置中勾选 ClipForge 或当前 dev 进程。".to_string(),
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn request_accessibility_permission_platform() -> Result<AccessibilityPermissionPayload, String> {
    check_accessibility_permission_platform()
}

fn normalize_log_level(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "debug" => "debug".to_string(),
        "info" => "info".to_string(),
        "warn" | "warning" => "warn".to_string(),
        "error" => "error".to_string(),
        _ => "info".to_string(),
    }
}

fn parse_log_line(line: &str) -> Option<AppLogEntryPayload> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    let level = value
        .get("level")
        .and_then(Value::as_str)
        .map(normalize_log_level)
        .unwrap_or_else(|| "info".to_string());
    let message = value
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let context = value
        .get("context")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let ts_ms = value
        .get("tsMs")
        .and_then(Value::as_i64)
        .or_else(|| value.get("ts").and_then(Value::as_i64).map(|ts| ts * 1000))
        .unwrap_or_default();
    Some(AppLogEntryPayload {
        ts_ms,
        level,
        message,
        context,
    })
}

fn settings_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not available".to_string())?;
    #[cfg(target_os = "macos")]
    {
        return Ok(home
            .join("Library")
            .join("Application Support")
            .join("ClipForge")
            .join("settings.json5"));
    }
    #[cfg(target_os = "windows")]
    {
        return Ok(home
            .join("AppData")
            .join("Roaming")
            .join("ClipForge")
            .join("settings.json5"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Ok(home
            .join(".config")
            .join("clipforge")
            .join("settings.json5"))
    }
}

fn log_path() -> Result<PathBuf, String> {
    Ok(settings_path()?
        .parent()
        .ok_or_else(|| "settings parent is not available".to_string())?
        .join("clipforge.jsonl"))
}

fn parse_json5_like(raw: &str) -> Result<Value, String> {
    match json5::from_str(raw) {
        Ok(value) => Ok(value),
        Err(json5_error) => {
            serde_json::from_str(raw).map_err(|json_error| format!("{json5_error}; {json_error}"))
        }
    }
}

fn database_path() -> Result<PathBuf, String> {
    Ok(settings_path()?
        .parent()
        .ok_or_else(|| "settings parent is not available".to_string())?
        .join("clipforge.sqlite"))
}

fn open_clip_db() -> Result<Connection, String> {
    let path = database_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let conn = Connection::open(path).map_err(|error| error.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| error.to_string())?;
    conn.pragma_update(None, "busy_timeout", 1000)
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS clips (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            kind TEXT NOT NULL,
            bucket TEXT NOT NULL,
            source TEXT NOT NULL,
            source_label TEXT NOT NULL,
            favorite INTEGER NOT NULL DEFAULT 0,
            tags TEXT NOT NULL DEFAULT '',
            copy_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            last_copied_at INTEGER,
            deleted_at INTEGER,
            title TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            url TEXT,
            host TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_content_hash ON clips(content_hash);
        CREATE INDEX IF NOT EXISTS idx_clips_recent ON clips(deleted_at, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clips_bucket_recent ON clips(bucket, deleted_at, last_seen_at DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS clip_fts USING fts5(id UNINDEXED, content, title, summary, tags);
        PRAGMA user_version = 1;
        ",
    )
    .map_err(|error| error.to_string())
}

fn content_hash(content: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

fn now_millis() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64)
}

fn analyze_clip(content: &str, source_label: &str) -> ClipAnalysisPayload {
    let trimmed = content.trim();
    let first_url = trimmed
        .split_whitespace()
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(|value| value.trim_matches(|c| matches!(c, ')' | ']' | '"' | '\'')));
    let title = if let Some(url) = first_url {
        url.replace("https://", "").replace("http://", "")
    } else {
        trimmed.replace('\n', " ")
    };
    ClipAnalysisPayload {
        source_name: source_label.to_string(),
        badge: if first_url.is_some() { "URL" } else { "T" }.to_string(),
        title: title.chars().take(80).collect(),
        summary: trimmed.replace('\n', " ").chars().take(180).collect(),
        url: first_url.map(ToString::to_string),
        host: first_url
            .and_then(|value| value.split('/').nth(2))
            .map(ToString::to_string),
        is_markdown: trimmed.starts_with('#')
            || trimmed.contains("\n- ")
            || trimmed.contains("```"),
    }
}

fn analysis_kind(analysis: &ClipAnalysisPayload) -> String {
    if analysis.url.is_some() {
        "link"
    } else if analysis.is_markdown {
        "markdown"
    } else {
        "text"
    }
    .to_string()
}

fn default_tags(analysis: &ClipAnalysisPayload, content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    if analysis.url.is_some() {
        tags.push("链接".to_string());
    }
    if analysis.is_markdown {
        tags.push("Markdown".to_string());
    }
    if content.contains('\n') {
        tags.push("多行".to_string());
    }
    tags
}

fn fts_query(text: &str) -> String {
    text.split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn upsert_fts(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM clip_fts WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO clip_fts(id, content, title, summary, tags)
         SELECT id, content, title, summary, tags FROM clips WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_clip(conn: &Connection, id: &str) -> Result<ClipItemPayload, String> {
    conn.query_row(
        "SELECT id, content, kind, bucket, source_label, favorite, tags, copy_count,
                created_at, updated_at, last_seen_at, last_copied_at, title, summary, url, host
         FROM clips WHERE id = ?1",
        params![id],
        |row| {
            let tags_raw: String = row.get(6)?;
            let title: String = row.get(12)?;
            let summary: String = row.get(13)?;
            let url: Option<String> = row.get(14)?;
            let host: Option<String> = row.get(15)?;
            let source: String = row.get(4)?;
            Ok(ClipItemPayload {
                id: row.get(0)?,
                content: row.get(1)?,
                kind: row.get(2)?,
                bucket: row.get(3)?,
                source: source.clone(),
                favorite: row.get::<_, i64>(5)? == 1,
                tags: tags_raw
                    .split(',')
                    .filter(|tag| !tag.is_empty())
                    .map(ToString::to_string)
                    .collect(),
                copy_count: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                last_seen_at: row.get(10)?,
                last_copied_at: row.get(11)?,
                analysis: ClipAnalysisPayload {
                    source_name: source,
                    badge: if url.is_some() { "URL" } else { "T" }.to_string(),
                    title,
                    summary,
                    url,
                    host,
                    is_markdown: false,
                },
            })
        },
    )
    .map_err(|error| error.to_string())
}

fn read_platform_clipboard() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // pbpaste 比 osascript 快 5-10 倍；优先用 pbpaste，失败再回退
        if let Ok(text) = read_command("pbpaste", &[]) {
            return Ok(text);
        }
        return read_command(
            "osascript",
            &["-e", "the clipboard as «class utf8»"],
        );
    }

    #[cfg(target_os = "windows")]
    {
        return read_command(
            "powershell",
            &["-NoProfile", "-Command", "Get-Clipboard -Raw"],
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (program, args) in [
            ("wl-paste", vec!["--no-newline"]),
            ("xclip", vec!["-selection", "clipboard", "-out"]),
            ("xsel", vec!["--clipboard", "--output"]),
        ] {
            if let Ok(text) = read_command(program, &args) {
                return Ok(text);
            }
        }
        Err("No supported clipboard reader found. Install wl-clipboard, xclip, or xsel.".into())
    }
}

#[tauri::command]
fn poll_clipboard_change(last_change_count: i64) -> Result<ClipboardChangePayload, String> {
    #[cfg(target_os = "macos")]
    {
        // 用 AppleScript 取 change count，比每次 pbpaste 节省 30-50ms
        // NSPasteboard changeCount 在复制/粘贴时严格递增
        let raw = read_command(
            "osascript",
            &[
                "-e",
                "use framework \"AppKit\"\nuse scripting additions\nset pb to current application's NSPasteboard's generalPasteboard()\nset theCount to pb's changeCount() as integer\nreturn theCount as string",
            ],
        );
        if let Ok(text) = raw {
            if let Ok(current) = text.trim().parse::<i64>() {
                return Ok(ClipboardChangePayload {
                    change_count: current,
                    has_change: current != last_change_count,
                    preview: None,
                    preview_len: None,
                });
            }
        }
        // 失败时回退到直接读剪贴板文本（兼容旧路径）
        let text = read_platform_clipboard().unwrap_or_default();
        let len = text.chars().count() as i64;
        Ok(ClipboardChangePayload {
            change_count: last_change_count + 1,
            has_change: true,
            preview: Some(text.chars().take(40).collect()),
            preview_len: Some(len),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = last_change_count;
        Ok(ClipboardChangePayload {
            change_count: 0,
            has_change: true,
            preview: None,
            preview_len: None,
        })
    }
}

fn write_platform_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return write_command("pbcopy", &[], text);
    }

    #[cfg(target_os = "windows")]
    {
        return write_command(
            "powershell",
            &[
                "-NoProfile",
                "-Command",
                "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
            ],
            text,
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (program, args) in [
            ("wl-copy", vec![]),
            ("xclip", vec!["-selection", "clipboard", "-in"]),
            ("xsel", vec!["--clipboard", "--input"]),
        ] {
            if write_command(program, &args, text).is_ok() {
                return Ok(());
            }
        }
        Err("No supported clipboard writer found. Install wl-clipboard, xclip, or xsel.".into())
    }
}

fn read_command(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program}: {error}"))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|error| error.to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn write_command(program: &str, args: &[&str], text: &str) -> Result<(), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("{program}: {error}"))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| format!("{program}: stdin unavailable"))?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|error| error.to_string())?;

    let status = child.wait().map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{program}: exited with {status}"))
    }
}

#[cfg(target_os = "macos")]
fn hide_panel_before_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(panel) = app.get_webview_panel("main") {
        panel.resign_key_window();
        panel.hide();
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_panel_before_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[cfg(target_os = "macos")]
fn simulate_platform_paste() -> Result<(), String> {
    const KEY_V: u16 = 0x09;
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "create CGEventSource failed".to_string())?;
    let key_down = CGEvent::new_keyboard_event(source.clone(), KEY_V, true)
        .map_err(|_| "create paste key-down event failed".to_string())?;
    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_down.post(CGEventTapLocation::HID);

    let key_up = CGEvent::new_keyboard_event(source, KEY_V, false)
        .map_err(|_| "create paste key-up event failed".to_string())?;
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(target_os = "windows")]
fn simulate_platform_paste() -> Result<(), String> {
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
        ])
        .status()
        .map_err(|error| error.to_string())
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(format!("powershell paste exited with {status}"))
            }
        })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn simulate_platform_paste() -> Result<(), String> {
    for (program, args) in [
        ("wtype", vec!["-M", "ctrl", "v", "-m", "ctrl"]),
        ("xdotool", vec!["key", "ctrl+v"]),
    ] {
        if let Ok(status) = Command::new(program).args(args).status() {
            if status.success() {
                return Ok(());
            }
        }
    }
    Err("No supported paste simulator found. Install wtype or xdotool.".to_string())
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        configure_quick_panel_window(&window);
    }
    let open_quick = MenuItemBuilder::with_id("open_quick", "打开快捷面板")
        .accelerator("Ctrl+V")
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 ClipForge").build(app)?;
    let menu = Menu::with_items(app, &[&open_quick, &quit])?;
    let quick_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyV);
    if let Err(error) = app.global_shortcut().register(quick_shortcut) {
        let _ = append_app_log(
            "warn".to_string(),
            "Register global shortcut failed".to_string(),
            Some(error.to_string()),
        );
    }
    let mut tray_builder = TrayIconBuilder::new()
        .tooltip("ClipForge")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_quick" => show_quick_panel(app, "tray"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_quick_panel(tray.app_handle(), "tray");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    tray_builder.build(app)?;

    // 启动后台剪贴板监听线程：脱离 WebView，隐藏时也能工作
    let app_handle = app.handle().clone();
    std::thread::spawn(move || {
        let mut last_text = String::new();
        println!("[CLIPBOARD] background monitor started");
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            match read_platform_clipboard() {
                Ok(text) => {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() && trimmed != last_text {
                        println!("[CLIPBOARD] detected change: {} chars", trimmed.chars().count());
                        last_text = trimmed.to_string();
                        if let Err(e) = app_handle.emit_to("main", "clipboard-changed", serde_json::json!({
                            "text": trimmed
                        })) {
                            println!("[CLIPBOARD] emit error: {}", e);
                        }
                    }
                }
                Err(e) => {
                    println!("[CLIPBOARD] read error: {}", e);
                }
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let quick_shortcut = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyV);
    start_focus_prefetch_thread();
    let mut builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            setup_app(app)
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.setup(setup_app);
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &quick_shortcut && event.state() == ShortcutState::Pressed {
                        show_quick_panel(app, "shortcut");
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            read_clipboard_text,
            write_clipboard_text,
            paste_clipboard_text,
            init_clip_database,
            capture_clip_record,
            query_clip_records,
            soft_delete_clip_records,
            restore_clip_records,
            hard_delete_clip_records,
            update_clip_record,
            cleanup_clip_records,
            read_user_settings,
            write_user_settings,
            append_app_log,
            get_app_log_path,
            query_app_logs,
            set_panel_mode,
            open_settings_window,
            focused_input_bounds,
            check_accessibility_permission,
            open_accessibility_settings,
            request_accessibility_permission,
            poll_clipboard_change
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipForge");
}

fn show_quick_panel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, reason: &str) {
    if let Some(window) = app.get_webview_window("main") {
        if reason == "shortcut" && window.is_visible().unwrap_or(false) {
            let _ = window.emit("clipforge://hide-quick-panel", reason);
            return;
        }
        let cached = focus_bounds_cache();
        let (used_cache, cache_data) = {
            if let Ok(c) = cached.lock() {
                if c.valid && c.width > 0.0 && c.height > 0.0 {
                    (true, c.clone())
                } else {
                    (false, c.clone())
                }
            } else {
                (false, CachedFocusBounds::default())
            }
        };
        if used_cache {
            if let Some((x, y, height)) =
                compute_panel_position(&window, QUICK_PANEL_WIDTH, &cache_data)
            {
                let _ = window.set_size(LogicalSize::new(QUICK_PANEL_WIDTH, height));
                set_panel_position(&window, x, y);
            }
        } else {
            position_panel_window_fast(&window, QUICK_PANEL_WIDTH, QUICK_PANEL_FALLBACK_HEIGHT);
        }
        show_panel_window(app, &window);
        let _ = window.emit("clipforge://show-quick-panel", reason);

        let window_label = window.label().to_string();
        let app_handle = app.clone();
        thread::spawn(move || {
            let payload = focused_input_bounds_platform().ok();
            if let Some(w) = app_handle.get_webview_window(&window_label) {
                if let Some(bounds) = payload {
                    let cache = CachedFocusBounds {
                        x: bounds.x,
                        y: bounds.y,
                        width: bounds.width,
                        height: bounds.height,
                        source: bounds.source.clone(),
                        valid: bounds.width > 0.0 && bounds.height > 0.0,
                        updated_at: now_millis().unwrap_or(0),
                    };
                    if let Some((x, y, height)) =
                        compute_panel_position(&w, QUICK_PANEL_WIDTH, &cache)
                    {
                        let _ = w.set_size(LogicalSize::new(QUICK_PANEL_WIDTH, height));
                        set_panel_position(&w, x, y);
                    }
                }
            }
        });
    }
}

fn position_panel_window_fast<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) {
    if let Some((x, y, _)) = panel_position(window, panel_width, panel_height) {
        set_panel_position(window, x, y);
    }
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
}

fn position_panel_window_with_focus<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) {
    if let Some((x, y, _)) = panel_position_with_focus(window, panel_width, panel_height) {
        set_panel_position(window, x, y);
    }
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
}

#[cfg(target_os = "macos")]
fn set_panel_position<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, x: f64, y: f64) {
    let _ = window.set_position(LogicalPosition::new(x, y));
}

#[cfg(not(target_os = "macos"))]
fn set_panel_position<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, x: f64, y: f64) {
    let _ = window.set_position(LogicalPosition::new(x, y));
}

fn compute_panel_position<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    focus: &CachedFocusBounds,
) -> Option<(f64, f64, f64)> {
    let monitors = window.available_monitors().ok()?;
    let focus_phys_x = focus.x;
    let focus_phys_y = focus.y;
    let focus_phys_width = focus.width;
    let focus_phys_height = focus.height;

    let target_monitor = monitors
        .into_iter()
        .find(|monitor| {
            let scale = monitor.scale_factor();
            let work_area = monitor.work_area();
            let pos_logical = work_area.position.to_logical::<f64>(scale);
            let size_logical = work_area.size.to_logical::<f64>(scale);
            let phys_x = pos_logical.x * scale;
            let phys_y = pos_logical.y * scale;
            let phys_width = size_logical.width * scale;
            let phys_height = size_logical.height * scale;
            focus_phys_x >= phys_x &&
                focus_phys_x < phys_x + phys_width &&
                focus_phys_y >= phys_y &&
                focus_phys_y < phys_y + phys_height
        })
        .or_else(|| window.current_monitor().ok().flatten())?;

    let target_scale = target_monitor.scale_factor();
    let focus_x = focus_phys_x / target_scale;
    let focus_y = focus_phys_y / target_scale;
    let focus_width = focus_phys_width / target_scale;
    let focus_height = focus_phys_height / target_scale;

    let work_area = target_monitor.work_area();
    let position = work_area.position.to_logical::<f64>(target_scale);
    let size = work_area.size.to_logical::<f64>(target_scale);
    let max_height = (size.height - QUICK_PANEL_MARGIN * 2.0).max(360.0);
    let panel_height = (size.height * QUICK_PANEL_HEIGHT_RATIO)
        .round()
        .min(max_height);

    let center_x = focus_x + focus_width / 2.0;
    let input_bottom_y = focus_y + focus_height;
    let panel_x = (center_x - panel_width / 2.0).max(position.x + QUICK_PANEL_MARGIN);
    let panel_y = (input_bottom_y + QUICK_PANEL_MARGIN)
        .min(position.y + size.height - panel_height - QUICK_PANEL_MARGIN);

    let min_x = position.x + QUICK_PANEL_MARGIN;
    let max_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
    let min_y = position.y + QUICK_PANEL_MARGIN;
    let max_y = position.y + size.height - panel_height - QUICK_PANEL_MARGIN;
    Some((
        panel_x.clamp(min_x, max_x.max(min_x)),
        panel_y.clamp(min_y, max_y.max(min_y)),
        panel_height,
    ))
}

fn panel_position_with_focus<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    _fallback_height: f64,
) -> Option<(f64, f64, f64)> {
    let focus_bounds = focused_input_bounds_platform().ok();

    let monitor = if let Some(ref bounds) = focus_bounds {
        let center_x = bounds.x + bounds.width / 2.0;
        let center_y = bounds.y + bounds.height / 2.0;
        window.monitor_from_point(center_x, center_y).ok().flatten()
    } else {
        None
    }
    .or_else(|| window.current_monitor().ok().flatten());

    monitor.map(|monitor| {
        let scale = monitor.scale_factor();
        let work_area = monitor.work_area();
        let position = work_area.position.to_logical::<f64>(scale);
        let size = work_area.size.to_logical::<f64>(scale);
        let max_height = (size.height - QUICK_PANEL_MARGIN * 2.0).max(360.0);
        let panel_height = (size.height * QUICK_PANEL_HEIGHT_RATIO)
            .round()
            .min(max_height);

        let (x, y) = if let Some(bounds) = focus_bounds {
            if bounds.width > 0.0 && bounds.height > 0.0 && bounds.source != "fallback" {
                let input_center_x = bounds.x + bounds.width / 2.0;
                let input_bottom_y = bounds.y + bounds.height;
                let panel_x = (input_center_x - panel_width / 2.0).max(position.x + QUICK_PANEL_MARGIN);
                let panel_y = input_bottom_y + QUICK_PANEL_MARGIN;
                (panel_x, panel_y)
            } else {
                let fallback_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
                let fallback_y = position.y + ((size.height - panel_height) / 2.0).max(QUICK_PANEL_MARGIN);
                (fallback_x, fallback_y)
            }
        } else {
            let fallback_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
            let fallback_y = position.y + ((size.height - panel_height) / 2.0).max(QUICK_PANEL_MARGIN);
            (fallback_x, fallback_y)
        };

        let min_x = position.x + QUICK_PANEL_MARGIN;
        let max_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
        let min_y = position.y + QUICK_PANEL_MARGIN;
        let max_y = position.y + size.height - panel_height - QUICK_PANEL_MARGIN;
        (
            x.clamp(min_x, max_x.max(min_x)),
            y.clamp(min_y, max_y.max(min_y)),
            panel_height,
        )
    })
}

fn configure_quick_panel_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    configure_panel_window(window, QUICK_PANEL_WIDTH);
    configure_platform_quick_panel(window);
}

fn configure_panel_window<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, panel_width: f64) {
    let mut panel_height = QUICK_PANEL_FALLBACK_HEIGHT;
    if let Some((x, y, height)) = panel_position(window, panel_width, panel_height) {
        panel_height = height;
        let _ = window.set_size(LogicalSize::new(panel_width, panel_height));
        set_panel_position(window, x, y);
    } else {
        let _ = window.set_size(LogicalSize::new(panel_width, panel_height));
    }
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
}

#[cfg(target_os = "macos")]
fn configure_platform_quick_panel<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    match window.to_panel::<QuickPanel<R>>() {
        Ok(panel) => {
            panel.set_level(quick_panel_level());
            panel.set_style_mask(StyleMask::empty().nonactivating_panel().resizable().into());
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .full_screen_auxiliary()
                    .can_join_all_spaces()
                    .into(),
            );
            panel.set_hides_on_deactivate(false);
            panel.set_works_when_modal(true);
        }
        Err(error) => {
            let _ = append_app_log(
                "warn".to_string(),
                "Configure macOS NSPanel failed".to_string(),
                Some(error.to_string()),
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn configure_platform_quick_panel<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

#[cfg(target_os = "macos")]
fn show_panel_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    if let Ok(panel) = app.get_webview_panel("main") {
        panel.set_level(quick_panel_level());
        panel.order_front_regardless();
        panel.show_and_make_key();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn quick_panel_level() -> i64 {
    PanelLevel::Status.value()
}

#[cfg(not(target_os = "macos"))]
fn show_panel_window<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn position_panel_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) {
    if let Some((x, y, _)) = panel_position(window, panel_width, panel_height) {
        set_panel_position(window, x, y);
    }
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
}

fn panel_position<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    fallback_height: f64,
) -> Option<(f64, f64, f64)> {
    let mut panel_height = fallback_height;
    let monitor = window
        .cursor_position()
        .ok()
        .and_then(|position| window.monitor_from_point(position.x, position.y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());

    monitor.map(|monitor| {
        let scale = monitor.scale_factor();
        let work_area = monitor.work_area();
        let position = work_area.position.to_logical::<f64>(scale);
        let size = work_area.size.to_logical::<f64>(scale);
        let max_height = (size.height - QUICK_PANEL_MARGIN * 2.0).max(360.0);
        panel_height = (size.height * QUICK_PANEL_HEIGHT_RATIO)
            .round()
            .min(max_height);
        let fallback_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
        let fallback_y = position.y + ((size.height - panel_height) / 2.0).max(QUICK_PANEL_MARGIN);
        let (x, y) = (fallback_x, fallback_y);
        let min_x = position.x + QUICK_PANEL_MARGIN;
        let max_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
        let min_y = position.y + QUICK_PANEL_MARGIN;
        let max_y = position.y + size.height - panel_height - QUICK_PANEL_MARGIN;
        (
            x.clamp(min_x, max_x.max(min_x)),
            y.clamp(min_y, max_y.max(min_y)),
            panel_height,
        )
    })
}

fn mark_native_position_failure() {
    if let Ok(now) = now_millis() {
        LAST_NATIVE_POSITION_FAILURE_MS.store(now, Ordering::Relaxed);
    }
}
