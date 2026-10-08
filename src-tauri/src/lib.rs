#![recursion_limit = "256"]

use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, OpenFlags, OptionalExtension,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
#[cfg(debug_assertions)]
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};
#[cfg(desktop)]
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_updater::UpdaterExt;

mod agent;
mod application_context;
mod clipboard;
mod context_collector_runtime;
mod context_collector_system;
mod context_collectors;
mod mcp;
mod settings_service;

pub use mcp::run_mcp_stdio;
use agent::{
    agent_cancel_run, agent_check_provider, agent_detect, agent_get_config, agent_get_run,
    agent_get_transcript, agent_list_provider_models, agent_list_providers, agent_prepare_run,
    agent_restore_session, agent_start_run, cleanup_agent_children,
};
use mcp::{
    get_mcp_status, mcp_tool_names, start_mcp_server, start_mcp_server_with_reason,
    stop_mcp_server,
};

use application_context::{capture as capture_application_snapshot, SourceAppInfo};
use settings_service::{
    current_global_shortcut_value, current_native_locale, desired_launch_at_login,
    get_clipforge_config_path, get_clipforge_settings, read_user_settings, settings_get_public,
    settings_patch_public, settings_replace_public, settings_reset_public,
    settings_service_agent_check, settings_service_agent_models, settings_service_agent_providers,
    settings_service_get, settings_service_patch, settings_service_replace, settings_service_reset,
    sync_global_shortcut_registration, sync_launch_at_login_from_settings,
    update_clipforge_settings, write_user_settings,
};

fn command_error(code: &str, detail: impl AsRef<str>) -> String {
    format!("{}: {}", code, detail.as_ref())
}

fn is_command_error(value: &str) -> bool {
    value.split_once(':').is_some_and(|(code, _)| {
        !code.is_empty()
            && code
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    })
}

fn preserve_command_error(default_code: &str, error: String) -> String {
    if is_command_error(&error) {
        error
    } else {
        command_error(default_code, error)
    }
}

#[cfg(target_os = "macos")]
use tauri_nspanel::objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy, NSResponder,
    NSRunningApplication, NSWindow as AppKitNSWindow,
};
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
    // 粘贴目标快照用的原生 AX API。旧实现走 System Events osascript，本机实测单次 >1s，
    // 使粘贴目标 bundle/bounds 缓存延迟 1s+ 才就绪（用户快速选中时缓存仍为空，粘贴前
    // 无法激活目标 App，内容落不进输入框）。AX API 直连辅助功能权限（已授予），亚毫秒返回。
    fn AXUIElementCreateSystemWide() -> *mut std::os::raw::c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut std::os::raw::c_void,
        attribute: CFStringRef,
        value: *mut *mut std::os::raw::c_void,
    ) -> i32;
    fn AXUIElementCopyParameterizedAttributeValue(
        element: *mut std::os::raw::c_void,
        attribute: CFStringRef,
        parameter: *mut std::os::raw::c_void,
        value: *mut *mut std::os::raw::c_void,
    ) -> i32;
    fn AXUIElementGetPid(element: *mut std::os::raw::c_void, pid: *mut i32) -> i32;
    fn AXValueCreate(the_type: usize, value_ptr: *const std::os::raw::c_void)
    -> *mut std::os::raw::c_void;
    fn AXValueGetValue(
        value: *mut std::os::raw::c_void,
        the_type: usize,
        value_ptr: *mut std::os::raw::c_void,
    ) -> u8;
}

// AXValueCopyAttributeValue 返回的 CFType 引用计数 +1，用完必须释放；CFRelease 在
// CoreFoundation 框架（core-foundation crate 未直接导出该符号）。
#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *mut std::os::raw::c_void);
}

const QUICK_PANEL_WIDTH: f64 = 420.0;
const MANAGEMENT_PANEL_WIDTH: f64 = 760.0;
const QUICK_PANEL_DEFAULT_HEIGHT: f64 = 400.0; // 默认 420×400（约 0-8 九项 + 顶部/底部操作区）
const QUICK_PANEL_FALLBACK_HEIGHT: f64 = 400.0;
const QUICK_PANEL_MIN_HEIGHT: f64 = 320.0;
const QUICK_PANEL_MAX_HEIGHT: f64 = 760.0;
const QUICK_PANEL_MARGIN: f64 = 12.0;
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const APP_BUNDLE_IDENTIFIER: &str = "app.clipforge.desktop";

/// 从用户设置解析面板宽高（默认 420×400；宽 320-600，高 300-1000；0/非法用默认）。
/// 高度 0 或缺失 = 自适应默认（约 0-8 九项）。
fn resolve_panel_dims() -> (f64, f64) {
    let (mut width, mut height) = (QUICK_PANEL_WIDTH, QUICK_PANEL_DEFAULT_HEIGHT);
    if let Ok(settings) = read_user_settings() {
        if let Some(value) = settings.settings.get("panelWidth").and_then(Value::as_f64) {
            if value >= 320.0 {
                width = value.clamp(320.0, 600.0);
            }
        }
        if let Some(value) = settings.settings.get("panelHeight").and_then(Value::as_f64) {
            if value >= 300.0 {
                height = if [430.0, 450.0, 488.0]
                    .iter()
                    .any(|legacy| (value - legacy).abs() < f64::EPSILON)
                {
                    QUICK_PANEL_DEFAULT_HEIGHT
                } else {
                    value.clamp(300.0, 1000.0)
                };
            }
        }
    }
    (width, height)
}
const FOCUS_PREFETCH_INTERVAL_MS: u64 = 250;
const FOCUS_CACHE_MAX_AGE_MS: i64 = 600;
const PASTE_TARGET_CACHE_MAX_AGE_MS: i64 = 12_000;
static LAST_NATIVE_POSITION_FAILURE_MS: AtomicI64 = AtomicI64::new(0);
static WRITEBACK_SUPPRESS: AtomicBool = AtomicBool::new(false);
static ACCESSIBILITY_PROMPTED: AtomicBool = AtomicBool::new(false);
static ACCESSIBILITY_FIRST_USE_PROMPT_CHECKED: AtomicBool = AtomicBool::new(false);
static ACCESSIBILITY_STALE_RESET: AtomicBool = AtomicBool::new(false);

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PanelPositionStrategy {
    #[serde(rename = "trayCenter")]
    TrayCenter,
    #[serde(rename = "followCursor")]
    FollowCursor,
    #[serde(rename = "center")]
    Center,
    #[serde(rename = "windowCenter")]
    WindowCenter,
    #[serde(rename = "lastPosition")]
    LastPosition,
    #[serde(rename = "focusInput")]
    FocusInput,
}

impl Default for PanelPositionStrategy {
    fn default() -> Self {
        PanelPositionStrategy::FollowCursor
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPosition {
    pub x: f64,
    pub y: f64,
    pub monitor_id: Option<String>,
}

static FOCUS_BOUNDS_CACHE: std::sync::OnceLock<Arc<Mutex<CachedFocusBounds>>> =
    std::sync::OnceLock::new();
static PASTE_TARGET_BOUNDS_CACHE: std::sync::OnceLock<Arc<Mutex<CachedFocusBounds>>> =
    std::sync::OnceLock::new();
static PASTE_TARGET_APP_BUNDLE_CACHE: std::sync::OnceLock<Arc<Mutex<String>>> =
    std::sync::OnceLock::new();
static PANEL_LAST_POSITION: std::sync::OnceLock<Arc<Mutex<Option<NormalizedPosition>>>> =
    std::sync::OnceLock::new();
#[cfg(debug_assertions)]
static DEV_QUICK_PROBE_TARGET_READY: AtomicBool = AtomicBool::new(false);
#[cfg(debug_assertions)]
static DEV_QUICK_PROBE_TARGET_BUNDLE_CACHE: std::sync::OnceLock<Arc<Mutex<String>>> =
    std::sync::OnceLock::new();

fn focus_bounds_cache() -> Arc<Mutex<CachedFocusBounds>> {
    FOCUS_BOUNDS_CACHE
        .get_or_init(|| Arc::new(Mutex::new(CachedFocusBounds::default())))
        .clone()
}

fn paste_target_bounds_cache() -> Arc<Mutex<CachedFocusBounds>> {
    PASTE_TARGET_BOUNDS_CACHE
        .get_or_init(|| Arc::new(Mutex::new(CachedFocusBounds::default())))
        .clone()
}

fn paste_target_app_bundle_cache() -> Arc<Mutex<String>> {
    PASTE_TARGET_APP_BUNDLE_CACHE
        .get_or_init(|| Arc::new(Mutex::new(String::new())))
        .clone()
}

#[cfg(debug_assertions)]
fn dev_quick_probe_target_bundle_cache() -> Arc<Mutex<String>> {
    DEV_QUICK_PROBE_TARGET_BUNDLE_CACHE
        .get_or_init(|| Arc::new(Mutex::new(String::new())))
        .clone()
}


fn panel_last_position() -> Arc<Mutex<Option<NormalizedPosition>>> {
    PANEL_LAST_POSITION
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone()
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
struct SourceAppPayload {
    name: String,
    bundle_id: String,
    executable_path: String,
    icon_base64: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClipboardRepresentationPayload {
    format: String,
    storage: String,
    content: Option<String>,
    file_name: Option<String>,
    size: Option<i64>,
    hash: Option<String>,
    preferred: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CaptureContextPayload {
    schema_version: i64,
    surface: String,
    source_label: String,
    source_app: Option<Value>,
    /// 应用级上下文是 best-effort 采集，旧记录缺失时按 None 兼容读取。
    #[serde(default)]
    application_context: Option<Value>,
    /// 外部采集器按 pending/complete/partial/skipped 记录异步补写状态与各层结果。
    #[serde(default)]
    collectors: Value,
    observed_at: i64,
    primary_format: String,
    available_formats: Vec<String>,
    environment: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipItemPayload {
    id: String,
    content: String,
    content_hash: String,
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
    payload_kind: String,
    primary_format: String,
    available_formats: Vec<String>,
    representations: Vec<ClipboardRepresentationPayload>,
    plain_text: String,
    search_text: Option<String>,
    sub_kind: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    size: Option<i64>,
    file_types: Option<String>,
    thumbnail_path: Option<String>,
    image_file: Option<String>,
    is_sensitive: bool,
    capture_context: CaptureContextPayload,
    metadata: Value,
    agent_context: Value,
    source_app: Option<SourceAppPayload>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchClipsRequest {
    text: Option<String>,
    bucket: Option<String>,
    kinds: Option<Vec<String>>,
    types: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    file_extensions: Option<Vec<String>>,
    favorite: Option<bool>,
    limit: Option<i64>,
    cursor: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckState {
    status: String,
    current_version: String,
    available_version: Option<String>,
    channel: String,
    last_checked_at: Option<i64>,
    ignored_version: Option<String>,
    release_notes: Option<String>,
    download_progress: Option<f64>,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfoPayload {
    product_name: String,
    current_version: String,
    bundle_identifier: String,
    target_os: String,
    target_arch: String,
    updater_endpoint: String,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchAtLoginPayload {
    supported: bool,
    enabled: bool,
    desired: bool,
    message: String,
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
struct TccAccessibilityRecordPayload {
    database: String,
    client: String,
    client_type: i64,
    auth_value: i64,
    auth_label: String,
    csreq_summary: String,
    last_modified: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessibilityDiagnosticsPayload {
    trusted: bool,
    expected_bundle_identifier: String,
    executable_path: String,
    app_bundle_path: String,
    code_signature_identifier: String,
    signature_kind: String,
    team_identifier: String,
    cd_hash: String,
    designated_requirement: String,
    tcc_records: Vec<TccAccessibilityRecordPayload>,
    tcc_query_error: Option<String>,
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
    retention_hard_deleted: i64,
    overflow_hard_deleted: i64,
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
struct LogStatsPayload {
    path: String,
    size_bytes: u64,
    line_count: u64,
    oldest_ts_ms: i64,
    max_size_mb: u32,
    keep_ratio: f64,
    retention_days: u32,
    auto_cleanup: bool,
    interval_min: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsExportPayload {
    path: String,
    created_at: i64,
    log_count: usize,
    summary: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClipboardChangePayload {
    change_count: i64,
    has_change: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview_len: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePathStatusPayload {
    path: String,
    exists: bool,
    is_file: bool,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelTriggerPayload {
    visible: bool,
    focused: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    source: String,
    position_source: String,
    focused_input_source: String,
    used_focused_input: bool,
    accessibility_status: String,
    message: String,
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeClipPayload {
    content: String,
    kind: String,
    analysis: ClipAnalysisPayload,
    tags: Vec<String>,
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportClipPayload {
    exported_at: i64,
    count: i64,
    items: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportTextFileInput {
    title: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportTextFilesPayload {
    directory: String,
    count: i64,
    files: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportClipInput {
    id: Option<String>,
    content: String,
    kind: Option<String>,
    bucket: Option<String>,
    source_label: Option<String>,
    favorite: Option<bool>,
    tags: Option<Vec<String>>,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    last_seen_at: Option<i64>,
    note: Option<String>,
    pinned: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportClipPayload {
    imported: i64,
    skipped: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateClipInput {
    id: String,
    content: Option<String>,
    tags: Option<Vec<String>>,
    bucket: Option<String>,
    favorite: Option<bool>,
    pinned: Option<bool>,
    note: Option<String>,
    metadata: Option<Value>,
    agent_context: Option<Value>,
    copied: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveEditorDraftInput {
    id: String,
    session_id: String,
    draft_version: i64,
    content: String,
    tags: Vec<String>,
    metadata: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardItemCommandInput {
    id: String,
    paste_mode: Option<String>,
    source: Option<String>,
}

fn paste_prepared_clipboard<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: Option<String>,
    text_preview: String,
    fingerprint: String,
) -> Result<(), String> {
    let trigger_source = source.unwrap_or_else(|| "unknown".to_string());
    let char_count = text_preview.chars().count();
    let line_count = text_preview.lines().count().max(1);
    // osascript 级诊断（frontmost_app_for_log / focused_ui_for_log）每次都要 fork osascript，
    // 在 IPC 线程上累计 80~230ms/次，是粘贴卡顿的主因之一。默认走轻量日志；仅在
    // CLIPFORGE_VERBOSE_PASTE=1 时才输出完整诊断。
    if paste_verbose_diagnostics() {
        log_to_file(
            "info",
            "paste",
            &format!(
                "start source={} chars={} lines={} hash={} frontmost={} accessibility={}",
                trigger_source,
                char_count,
                line_count,
                &fingerprint[..8],
                frontmost_app_for_log(),
                paste_accessibility_status_for_log()
            ),
        );
    } else {
        log_to_file(
            "info",
            "paste",
            &format!(
                "start source={} chars={} lines={} hash={} accessibility={}",
                trigger_source,
                char_count,
                line_count,
                &fingerprint[..8],
                paste_accessibility_status_for_log()
            ),
        );
    }
    ensure_paste_accessibility_permission()?;
    hide_panel_before_paste(&app);
    // 面板已 hide，焦点释放通常很快；原 420ms 预算过大、经常空等，缩到 140ms。
    let waited_ms = wait_for_panel_release_before_paste(&app, Duration::from_millis(140));
    let restore_details = restore_paste_target_focus();
    // 点击已移除（见 click_paste_target_bounds），activate 后给目标 App 一个短焦点回收窗口即可，
    // 不再硬等 90ms。
    thread::sleep(Duration::from_millis(40));
    let settle_ms = paste_settle_delay_ms(&trigger_source);
    if settle_ms > 0 {
        thread::sleep(Duration::from_millis(settle_ms));
    }
    if paste_verbose_diagnostics() {
        log_to_file(
            "info",
            "paste",
            &format!(
                "before simulated paste source={} waitedMs={} restoreFocus={} settleMs={} frontmost={} focusedUi={} panelState={}",
                trigger_source,
                waited_ms,
                restore_details,
                settle_ms,
                frontmost_app_for_log(),
                focused_ui_for_log(),
                panel_state_for_log(&app)
            ),
        );
    } else {
        log_to_file(
            "debug",
            "paste",
            &format!(
                "before simulated paste source={} waitedMs={} restoreFocus={} settleMs={}",
                trigger_source, waited_ms, restore_details, settle_ms
            ),
        );
    }
    #[cfg(debug_assertions)]
    verify_dev_quick_probe_paste_target()
        .map_err(|error| format!("quick probe paste target verification failed: {error}"))?;
    match simulate_platform_paste() {
        Ok(simulation_details) => {
            log_to_file(
                "info",
                "paste",
                &format!(
                    "simulated Cmd+V posted source={} hash={} {}",
                    trigger_source,
                    &fingerprint[..8],
                    simulation_details
                ),
            );
            Ok(())
        }
        Err(error) => {
            log_to_file(
                "warn",
                "paste",
                &format!("simulated paste failed: {}", error),
            );
            Err(error)
        }
    }
}

#[tauri::command]
fn write_clipboard_item(input: ClipboardItemCommandInput) -> Result<ClipItemPayload, String> {
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIPBOARD_WRITE_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIPBOARD_WRITE_FAILED", error))?;
    let item = load_clip(&conn, &input.id)?;
    suppress_writeback_for(Duration::from_millis(450));
    let write_result = clipboard::write_clipboard_item(&item, input.paste_mode.as_deref())
        .map_err(|error| preserve_command_error("CLIPBOARD_WRITE_FAILED", error))?;
    update_clip_record(UpdateClipInput {
        id: item.id.clone(),
        content: None,
        tags: None,
        bucket: None,
        favorite: None,
        pinned: None,
        note: None,
        metadata: None,
        agent_context: None,
        copied: Some(true),
    })
    .map_err(|error| preserve_command_error("CLIPBOARD_WRITE_FAILED", error))?;
    log_to_file(
        "info",
        "clipboard-write",
        &format!(
            "id={} primaryFormat={} availableFormats={} pasteMode={} writtenFormats={} guardHash={}",
            item.id,
            item.primary_format,
            item.available_formats.join("|"),
            input.paste_mode.unwrap_or_else(|| "rich".to_string()),
            write_result.written_formats.join("|"),
            write_result.guard_hash
        ),
    );
    load_clip(&conn, &item.id)
}

#[tauri::command]
fn paste_clipboard_item<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: ClipboardItemCommandInput,
) -> Result<ClipItemPayload, String> {
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIPBOARD_PASTE_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIPBOARD_PASTE_FAILED", error))?;
    let item = load_clip(&conn, &input.id)?;
    suppress_writeback_for(Duration::from_millis(700));
    let write_result = clipboard::write_clipboard_item(&item, input.paste_mode.as_deref())
        .map_err(|error| preserve_command_error("CLIPBOARD_PASTE_FAILED", error))?;
    paste_prepared_clipboard(
        app,
        input.source.clone(),
        write_result.text_fallback.clone(),
        write_result.guard_hash.clone(),
    )
    .map_err(|error| preserve_command_error("CLIPBOARD_PASTE_FAILED", error))?;
    update_clip_record(UpdateClipInput {
        id: item.id.clone(),
        content: None,
        tags: None,
        bucket: None,
        favorite: None,
        pinned: None,
        note: None,
        metadata: None,
        agent_context: None,
        copied: Some(true),
    })
    .map_err(|error| preserve_command_error("CLIPBOARD_PASTE_FAILED", error))?;
    log_to_file(
        "info",
        "clipboard-paste",
        &format!(
            "id={} primaryFormat={} availableFormats={} pasteMode={} writtenFormats={} source={} guardHash={}",
            item.id,
            item.primary_format,
            item.available_formats.join("|"),
            input.paste_mode.unwrap_or_else(|| "rich".to_string()),
            write_result.written_formats.join("|"),
            input.source.unwrap_or_else(|| "unknown".to_string()),
            write_result.guard_hash
        ),
    );
    load_clip(&conn, &item.id)
}

#[tauri::command]
pub(crate) fn save_editor_draft(input: SaveEditorDraftInput) -> Result<ClipItemPayload, String> {
    let metadata = json!({
        "editor": {
            "sessionId": input.session_id,
            "draftVersion": input.draft_version,
            "savedAt": now_millis()?,
            "source": "detail-compact-editor"
        },
        "extra": input.metadata.unwrap_or_else(|| json!({}))
    });
    update_clip_record(UpdateClipInput {
        id: input.id,
        content: Some(input.content),
        tags: Some(input.tags),
        bucket: None,
        favorite: None,
        pinned: None,
        note: None,
        metadata: Some(metadata),
        agent_context: None,
        copied: None,
    })
    .map_err(|error| preserve_command_error("EDITOR_SAVE_FAILED", error))
}

/// 记录一次设置操作的耗时，超 300ms 写 app log（B6：300ms 性能预算可观测）。
fn log_panel_open_step(reason: &str, step: &str, started: Instant, last: &mut Instant) {
    let now = Instant::now();
    let step_ms = now.duration_since(*last).as_millis();
    let total_ms = now.duration_since(started).as_millis();
    if step_ms > 40 || total_ms > 120 {
        log_to_file(
            "warn",
            "panel-open-perf",
            &format!(
                "reason={} step={} stepMs={} totalMs={}",
                reason, step, step_ms, total_ms
            ),
        );
    } else {
        log_to_file(
            "debug",
            "panel-open-perf",
            &format!(
                "reason={} step={} stepMs={} totalMs={}",
                reason, step, step_ms, total_ms
            ),
        );
    }
    *last = now;
}

#[cfg(desktop)]
fn read_launch_at_login_status<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    desired: bool,
) -> LaunchAtLoginPayload {
    match app.autolaunch().is_enabled() {
        Ok(enabled) => LaunchAtLoginPayload {
            supported: true,
            enabled,
            desired,
            message: if enabled {
                "Launch at login is enabled".to_string()
            } else {
                "Launch at login is disabled".to_string()
            },
        },
        Err(error) => LaunchAtLoginPayload {
            supported: false,
            enabled: false,
            desired,
            message: format!("Launch at login status unavailable: {error}"),
        },
    }
}

#[cfg(not(desktop))]
fn read_launch_at_login_status<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    desired: bool,
) -> LaunchAtLoginPayload {
    LaunchAtLoginPayload {
        supported: false,
        enabled: false,
        desired,
        message: "Launch at login is only available on desktop builds".to_string(),
    }
}

#[cfg(desktop)]
fn set_launch_at_login_native<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LaunchAtLoginPayload, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|error| error.to_string())?;
    } else {
        manager.disable().map_err(|error| error.to_string())?;
    }
    Ok(read_launch_at_login_status(app, enabled))
}

#[cfg(not(desktop))]
fn set_launch_at_login_native<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LaunchAtLoginPayload, String> {
    Ok(read_launch_at_login_status(app, enabled))
}

#[tauri::command]
fn get_launch_at_login<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LaunchAtLoginPayload, String> {
    let desired = read_user_settings()
        .map(|payload| desired_launch_at_login(&payload.settings))
        .unwrap_or(true);
    Ok(read_launch_at_login_status(&app, desired))
}

#[tauri::command]
fn set_launch_at_login<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<LaunchAtLoginPayload, String> {
    set_launch_at_login_native(&app, enabled)
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
async fn check_update(app: tauri::AppHandle) -> Result<UpdateCheckState, String> {
    let now = now_millis()?;
    let mut state = base_update_state(now);

    let updater = app
        .updater()
        .map_err(|e| format!("updater init failed: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            state.status = "available".to_string();
            state.available_version = Some(update.version.clone());
            state.release_notes = update.body.clone();
            state.last_checked_at = Some(now);
            state.error_code = None;
            state.error_message = None;
        }
        Ok(None) => {
            state.status = "latest".to_string();
            state.last_checked_at = Some(now);
            state.error_code = None;
            state.error_message = None;
        }
        Err(e) => {
            state.status = "failed".to_string();
            state.last_checked_at = Some(now);
            state.error_code = Some("UPDATE_CHECK_FAILED".to_string());
            state.error_message = Some(format!("{}", e));
        }
    }

    persist_update_state(&state)?;
    log_to_file(
        "info",
        "update-check",
        &format!(
            "status={} currentVersion={} availableVersion={} errorCode={}",
            state.status,
            state.current_version,
            state.available_version.as_deref().unwrap_or(""),
            state.error_code.as_deref().unwrap_or("")
        ),
    );
    Ok(state)
}

#[tauri::command]
fn get_build_info() -> BuildInfoPayload {
    BuildInfoPayload {
        product_name: "ClipForge".to_string(),
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        bundle_identifier: APP_BUNDLE_IDENTIFIER.to_string(),
        target_os: std::env::consts::OS.to_string(),
        target_arch: std::env::consts::ARCH.to_string(),
        updater_endpoint:
            "https://github.com/embaobao/clipforge/releases/latest/download/latest.json".to_string(),
    }
}

#[tauri::command]
async fn download_update(app: tauri::AppHandle) -> Result<UpdateCheckState, String> {
    let now = now_millis()?;
    let mut state = read_update_state().unwrap_or_else(|_| base_update_state(now));

    if state.status != "available" {
        state.status = "failed".to_string();
        state.error_code = Some("UPDATE_NOT_AVAILABLE".to_string());
        state.error_message = Some("当前没有可下载的更新。".to_string());
        state.last_checked_at = Some(now);
        persist_update_state(&state)?;
        return Ok(state);
    }

    let updater = app
        .updater()
        .map_err(|e| format!("updater init failed: {}", e))?;

    let check_result = updater.check().await;
    match check_result {
        Ok(Some(update)) => {
            state.status = "downloading".to_string();
            state.download_progress = Some(0.0);
            state.last_checked_at = Some(now);
            persist_update_state(&state)?;

            let install_result: Result<(), tauri_plugin_updater::Error> = update
                .download_and_install(|_chunk_length, _content_length| {}, || {})
                .await;

            match install_result {
                Ok(()) => {
                    state.status = "ready".to_string();
                    state.download_progress = Some(1.0);
                    state.error_code = None;
                    state.error_message = None;
                    state.last_checked_at = Some(now_millis().unwrap_or(now));
                }
                Err(e) => {
                    state.status = "failed".to_string();
                    state.error_code = Some("UPDATE_DOWNLOAD_FAILED".to_string());
                    state.error_message = Some(format!("{}", e));
                }
            }
        }
        Ok(None) => {
            state.status = "latest".to_string();
            state.download_progress = None;
            state.error_code = None;
            state.error_message = None;
        }
        Err(e) => {
            state.status = "failed".to_string();
            state.error_code = Some("UPDATE_CHECK_FAILED".to_string());
            state.error_message = Some(format!("{}", e));
        }
    }

    persist_update_state(&state)?;
    log_to_file(
        "info",
        "update-download",
        &format!(
            "status={} version={}",
            state.status,
            state.available_version.as_deref().unwrap_or("")
        ),
    );
    Ok(state)
}

#[tauri::command]
fn install_update() -> Result<UpdateCheckState, String> {
    let now = now_millis()?;
    let mut state = read_update_state().unwrap_or_else(|_| base_update_state(now));

    if state.status != "ready" {
        state.status = "failed".to_string();
        state.error_code = Some("UPDATE_NOT_READY".to_string());
        state.error_message = Some("更新尚未准备好，先下载更新。".to_string());
    } else {
        state.status = "latest".to_string();
        state.error_code = None;
        state.error_message = None;
    }
    state.last_checked_at = Some(now);
    persist_update_state(&state)?;
    Ok(state)
}

#[tauri::command]
fn ignore_update_version(version: String) -> Result<UpdateCheckState, String> {
    let now = now_millis()?;
    let mut state = read_update_state().unwrap_or_else(|_| base_update_state(now));
    state.ignored_version = Some(version);
    state.status = "latest".to_string();
    state.download_progress = None;
    state.error_code = None;
    state.error_message = None;
    state.last_checked_at = Some(now);
    persist_update_state(&state)?;
    Ok(state)
}

fn update_state_path() -> Result<PathBuf, String> {
    Ok(settings_path()?
        .parent()
        .ok_or_else(|| "settings parent is not available".to_string())?
        .join("update-state.json"))
}

fn base_update_state(now: i64) -> UpdateCheckState {
    UpdateCheckState {
        status: "latest".to_string(),
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        available_version: None,
        channel: "stable".to_string(),
        last_checked_at: Some(now),
        ignored_version: read_update_state()
            .ok()
            .and_then(|state| state.ignored_version),
        release_notes: None,
        download_progress: None,
        error_code: None,
        error_message: None,
    }
}

fn read_update_state() -> Result<UpdateCheckState, String> {
    let path = update_state_path()?;
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn persist_update_state(state: &UpdateCheckState) -> Result<(), String> {
    let path = update_state_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(state).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn capture_clip_record(
    content: String,
    source_label: Option<String>,
    observed_at: i64,
) -> Result<CaptureClipPayload, String> {
    capture_clip_payload(
        clipboard::StandardClipboardPayload::Text(clipboard::TextPayload {
            text: content,
            html: None,
            rtf: None,
        }),
        source_label,
        observed_at,
    )
}

#[tauri::command]
pub(crate) fn capture_current_clipboard(
    source_label: Option<String>,
    observed_at: i64,
) -> Result<CaptureClipPayload, String> {
    let raw_payload = clipboard::read_clipboard_payload()
        .map_err(|error| preserve_command_error("CLIPBOARD_READ_FAILED", error))?
        .ok_or_else(|| command_error("CLIPBOARD_EMPTY", "clipboard is empty"))?;
    let raw_fingerprint = clipboard_payload_fingerprint(&raw_payload);
    let payload = apply_capture_settings(raw_payload)?.ok_or_else(|| {
        command_error(
            "CLIPBOARD_CAPTURE_SKIPPED",
            "clipboard capture skipped by settings",
        )
    })?;
    let fingerprint = clipboard_payload_fingerprint(&payload);
    log_to_file(
        "info",
        "clipboard-capture",
        &format!(
            "manual capture, raw_hash={}, hash={}, ts={}",
            &raw_fingerprint[..8],
            &fingerprint[..8],
            observed_at
        ),
    );
    capture_clip_payload(payload, source_label, observed_at)
}

/// 采集当前前台应用的实时上下文；该命令不写入剪贴板历史，外部脚本必须显式开启。
#[tauri::command]
fn capture_live_application_context(
    collector_id: Option<String>,
    include_external: Option<bool>,
) -> Result<Value, String> {
    context_collectors::capture_live_context(
        collector_id.as_deref(),
        include_external.unwrap_or(false),
    )
}

#[tauri::command]
fn dev_read_clipboard_text() -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err(command_error(
            "DEV_COMMAND_DISABLED",
            "dev_read_clipboard_text is only available in debug builds",
        ));
    }
    let payload = clipboard::read_clipboard_payload()
        .map_err(|error| preserve_command_error("CLIPBOARD_READ_FAILED", error))?
        .ok_or_else(|| command_error("CLIPBOARD_EMPTY", "clipboard is empty"))?;
    match payload {
        clipboard::StandardClipboardPayload::Text(text) => Ok(text.text),
        clipboard::StandardClipboardPayload::Files(paths) => Ok(paths.join("\n")),
        clipboard::StandardClipboardPayload::Image(_) => Err(command_error(
            "CLIPBOARD_NOT_TEXT",
            "clipboard currently contains an image payload",
        )),
    }
}

fn capture_clip_payload(
    payload: clipboard::StandardClipboardPayload,
    source_label: Option<String>,
    observed_at: i64,
) -> Result<CaptureClipPayload, String> {
    capture_clip_payload_with_options(payload, source_label, observed_at, true)
}

/// 带「是否采集应用上下文」开关的入库实现。application snapshot 内部含 System Events
/// osascript（本机实测单次 >1s、预算 500ms），只适合后台线程；唤起热路径（open_panel
/// 显示前补采）必须传 false 跳过，缺失的 source_app 元数据由轮询线程 ≤100ms 后的全量
/// 采集补齐（同 content_hash 幂等 UPDATE，不产生重复行）。
fn capture_clip_payload_with_options(
    payload: clipboard::StandardClipboardPayload,
    source_label: Option<String>,
    observed_at: i64,
    allow_application_context: bool,
) -> Result<CaptureClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let image_store = clipboard::ImageStore::new(image_storage_path()?);
    let draft = clipboard::build_clipboard_draft(payload, &image_store)?;
    let content = draft.content.trim().to_string();
    if content.is_empty() && draft.plain_text.trim().is_empty() {
        return Err(command_error("CLIPBOARD_CONTENT_EMPTY", "content is empty"));
    }
    let hash = draft.content_hash.clone();
    let primary_format = draft.primary_format.clone();
    let source_label_value = source_label.unwrap_or_else(|| "Clipboard".to_string());
    let include_application_context =
        allow_application_context && should_capture_application_context();
    let application_snapshot = capture_application_snapshot(include_application_context);
    let delayed_external_context = include_application_context
        && application_snapshot.is_some()
        && context_collectors::delayed_collection_enabled();
    let source_app = application_snapshot
        .as_ref()
        .map(|snapshot| &snapshot.source_app);
    let application_context = if include_application_context {
        application_snapshot
            .as_ref()
            .map(|snapshot| snapshot.application_context.clone())
    } else {
        None
    };
    let capture_context = make_capture_context(
        &source_label_value,
        source_app,
        application_context.clone(),
        observed_at,
        &primary_format,
        &draft.available_formats,
        delayed_external_context,
    );
    let delayed_application_context = if delayed_external_context {
        application_context.clone()
    } else {
        None
    };
    let capture_context_json = json_string(&capture_context)?;
    let source_app_name = source_app.map(|s| s.name.as_str()).unwrap_or("");
    let source_app_bundle = source_app.map(|s| s.bundle_id.as_str()).unwrap_or("");
    let source_app_executable = source_app.map(|s| s.executable_path.as_str()).unwrap_or("");
    let source_app_icon = source_app.and_then(|s| s.icon_base64.as_deref());
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
            "UPDATE clips SET last_seen_at = ?1, updated_at = ?1,
                capture_context_json = ?2, source_app_name = ?3, source_app_bundle = ?4,
                source_app_executable = ?5, source_app_icon = ?6 WHERE id = ?7",
            params![
                observed_at,
                capture_context_json,
                source_app_name,
                source_app_bundle,
                source_app_executable,
                source_app_icon,
                id
            ],
        )
        .map_err(|error| error.to_string())?;
        let item = load_clip(&conn, &id)?;
        if let Some(application_context) = delayed_application_context {
            context_collectors::schedule_delayed_collection(id.clone(), application_context);
        }
        return Ok(CaptureClipPayload {
            status: "promoted".to_string(),
            item,
        });
    }

    let id = format!("clip_{hash}_{observed_at}");
    let available_formats_json = json_string(&draft.available_formats)?;
    let representations_json = json_string(&draft.representations)?;
    let analysis_basis = if draft.plain_text.trim().is_empty() {
        &content
    } else {
        &draft.plain_text
    };
    let analysis = analyze_clip(analysis_basis, &source_label_value);
    let mut default_tag_values = default_tags(&analysis, analysis_basis);
    if source_label_value.to_lowercase().contains("agent")
        || source_label_value.to_lowercase().contains("mcp")
        || source_label_value.to_lowercase().contains("ai")
    {
        default_tag_values.push("AI".to_string());
    }
    let tags = normalize_tags(default_tag_values).join(",");
    let metadata_json = json_string(&draft.metadata)?;
    conn.execute(
        "INSERT INTO clips (
            id, content, content_hash, primary_format, available_formats, representations_json,
            plain_text, search_text, sub_kind, width, height, size, file_types, thumbnail_path, image_file,
            is_sensitive, capture_context_json, metadata_json, agent_context_json,
            kind, bucket, source, source_label, favorite, tags,
            copy_count, created_at, updated_at, last_seen_at, title, summary, url, host, payload_kind,
            source_app_name, source_app_bundle, source_app_executable, source_app_icon
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, '{}', ?19, 'history', 'clipboard', ?20, 0, ?21, 0, ?22, ?22, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31)",
        params![
            id,
            content,
            hash,
            primary_format,
            available_formats_json,
            representations_json,
            draft.plain_text,
            draft.search_text,
            draft.sub_kind,
            draft.width,
            draft.height,
            draft.size,
            draft.file_types,
            draft.thumbnail_path,
            draft.image_file,
            if draft.is_sensitive { 1 } else { 0 },
            capture_context_json,
            metadata_json,
            draft.kind,
            source_label_value,
            tags,
            observed_at,
            analysis.title,
            analysis.summary,
            analysis.url,
            analysis.host,
            draft.payload_kind,
            source_app_name,
            source_app_bundle,
            source_app_executable,
            source_app_icon
        ],
    )
    .map_err(|error| error.to_string())?;
    upsert_fts(&conn, &id)?;
    if let Some(application_context) = delayed_application_context {
        context_collectors::schedule_delayed_collection(id.clone(), application_context);
    }
    let item = load_clip(&conn, &id)?;
    Ok(CaptureClipPayload {
        status: "created".to_string(),
        item,
    })
}

fn clipboard_payload_fingerprint(payload: &clipboard::StandardClipboardPayload) -> String {
    match payload {
        clipboard::StandardClipboardPayload::Text(text) => {
            if let Some(html) = text.html.as_ref().filter(|value| !value.trim().is_empty()) {
                content_hash("text/html", html.as_bytes())
            } else if let Some(rtf) = text.rtf.as_ref().filter(|value| !value.trim().is_empty()) {
                content_hash("text/rtf", rtf.as_bytes())
            } else {
                content_hash("text/plain", text.text.as_bytes())
            }
        }
        clipboard::StandardClipboardPayload::Image(image) => {
            content_hash("image/png", &image.bytes)
        }
        clipboard::StandardClipboardPayload::Files(paths) => {
            content_hash("application/file-list", paths.join("\n").as_bytes())
        }
    }
}

fn apply_capture_settings(
    payload: clipboard::StandardClipboardPayload,
) -> Result<Option<clipboard::StandardClipboardPayload>, String> {
    let settings = read_user_settings()
        .map(|payload| payload.settings)
        .unwrap_or_else(|_| json!({}));
    let bool_setting = |key: &str, default_value: bool| {
        settings
            .get(key)
            .and_then(Value::as_bool)
            .unwrap_or(default_value)
    };
    let number_setting = |key: &str, default_value: f64| {
        settings
            .get(key)
            .and_then(Value::as_f64)
            .unwrap_or(default_value)
    };

    match payload {
        clipboard::StandardClipboardPayload::Text(mut text) => {
            if !bool_setting("captureTextEnabled", true) {
                return Ok(None);
            }
            if !bool_setting("captureHtmlEnabled", true) {
                text.html = None;
            }
            if !bool_setting("captureRtfEnabled", true) {
                text.rtf = None;
            }
            let max_bytes =
                (number_setting("textMaxSizeMb", 5.0).clamp(1.0, 100.0) * 1024.0 * 1024.0) as usize;
            let largest_text = [
                text.text.as_bytes().len(),
                text.html
                    .as_ref()
                    .map(|value| value.as_bytes().len())
                    .unwrap_or(0),
                text.rtf
                    .as_ref()
                    .map(|value| value.as_bytes().len())
                    .unwrap_or(0),
            ]
            .into_iter()
            .max()
            .unwrap_or(0);
            if largest_text > max_bytes {
                return Ok(None);
            }
            let sensitivity_basis = [
                text.text.as_str(),
                text.html.as_deref().unwrap_or(""),
                text.rtf.as_deref().unwrap_or(""),
            ]
            .join("\n");
            if clipboard::detect_text(&sensitivity_basis).is_sensitive
                && !bool_setting("captureSensitiveEnabled", false)
            {
                return Ok(None);
            }
            Ok(Some(clipboard::StandardClipboardPayload::Text(text)))
        }
        clipboard::StandardClipboardPayload::Image(image) => {
            if !bool_setting("captureImageEnabled", true) {
                return Ok(None);
            }
            let max_bytes = (number_setting("imageMaxSizeMb", 25.0).clamp(1.0, 1024.0)
                * 1024.0
                * 1024.0) as usize;
            if image.bytes.len() > max_bytes {
                return Ok(None);
            }
            Ok(Some(clipboard::StandardClipboardPayload::Image(image)))
        }
        clipboard::StandardClipboardPayload::Files(paths) => {
            if !bool_setting("captureFileEnabled", true) {
                return Ok(None);
            }
            Ok(Some(clipboard::StandardClipboardPayload::Files(paths)))
        }
    }
}

pub(crate) fn log_to_file(level: &str, module: &str, message: &str) {
    // 非阻塞：只把格式化好的日志行投递给后台写线程，绝不在调用线程（往往是 IPC / 粘贴 /
    // 唤起热路径）上做 fs::OpenOptions + write_all。show/hide/copy/paste 每次都产生若干条
    // 日志，同步落盘是整体「停顿感」的主要来源之一。
    if !should_write_app_log(level, module, message) {
        return;
    }
    if let Ok(line) = build_log_line(level, &format!("[{}] {}", module, message), "") {
        log_writer_send(line);
    }
}

/// 为剪贴板热路径中的系统命令提供有界等待；超时只影响可选上下文，不阻断主记录流程。
#[cfg(target_os = "macos")]
fn run_system_command_with_timeout(
    mut command: Command,
    label: &str,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            let message = format!("{label} spawn failed: {error}; fallback=clipboard-only");
            log_to_file("warn", "application-context", &message);
            message
        })?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("{label} output failed: {error}"))?;
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                    log_to_file(
                        "warn",
                        "application-context",
                        &format!(
                            "{label} exited status={} stderr={}; fallback=clipboard-only",
                            output.status,
                            stderr.chars().take(240).collect::<String>()
                        ),
                    );
                    return Err(format!("{label} exited with {}", output.status));
                }
                return Ok(output);
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let message = format!(
                    "{label} timed out after {}ms; fallback=clipboard-only",
                    timeout.as_millis()
                );
                log_to_file("warn", "application-context", &message);
                return Err(message);
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => return Err(format!("{label} wait failed: {error}")),
        }
    }
}

fn log_environment_snapshot(module: &str) {
    let settings_path_text = settings_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let database_path_text = database_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let log_path_text = log_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let exe = std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let bundle_path = current_app_bundle_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let accessibility = check_accessibility_permission_platform()
        .map(|payload| payload.status)
        .unwrap_or_else(|_| "unknown".to_string());
    let diagnostics = get_accessibility_diagnostics_platform().ok();
    let (panel_width, panel_height) = resolve_panel_dims();
    let snapshot = json!({
        "event": "environment_snapshot",
        "appVersion": APP_VERSION,
        "bundleIdentifier": APP_BUNDLE_IDENTIFIER,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "uname": command_output_optional("uname", &["-a"]),
        "macos": command_output_optional("sw_vers", &[]),
        "webkit": webkit_environment_snapshot(),
        "currentExe": exe,
        "bundlePath": bundle_path,
        "settingsPath": settings_path_text,
        "databasePath": database_path_text,
        "logPath": log_path_text,
        "accessibility": accessibility,
        "signatureIdentifier": diagnostics.as_ref().map(|value| value.code_signature_identifier.clone()).unwrap_or_default(),
        "signatureKind": diagnostics.as_ref().map(|value| value.signature_kind.clone()).unwrap_or_default(),
        "cdHash": diagnostics.as_ref().map(|value| value.cd_hash.clone()).unwrap_or_default(),
        "tccRecordCount": diagnostics.as_ref().map(|value| value.tcc_records.len()).unwrap_or(0),
        "mcpTools": mcp_tool_names(),
        "panel": {
            "width": panel_width,
            "height": panel_height,
            "positionStrategy": read_user_settings()
                .ok()
                .and_then(|settings| settings.settings.get("positionStrategy").and_then(Value::as_str).map(ToString::to_string))
                .unwrap_or_else(|| "followCursor".to_string())
        }
    });
    log_to_file("info", module, &snapshot.to_string());
}

/// 构造一条 JSON 日志行（含时间戳）。非阻塞 log_to_file 与同步的 append_app_log 命令共用。
fn build_log_line(level: &str, message: &str, context: &str) -> Result<String, String> {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64;
    let entry = json!({
        "tsMs": timestamp_ms,
        "level": normalize_log_level(level),
        "message": message,
        "context": context,
    });
    Ok(format!(
        "{}\n",
        serde_json::to_string(&entry).map_err(|error| error.to_string())?
    ))
}

/// 后台日志写线程的发送端（OnceLock + Mutex，因为 mpsc::Sender 不是 Sync）。
/// 首次发送时 spawn 一个专用线程，批量异步落盘，把所有文件 I/O 移出热路径。
static LOG_WRITER_TX: std::sync::OnceLock<std::sync::Mutex<std::sync::mpsc::Sender<String>>> =
    std::sync::OnceLock::new();
static DEBUG_LOGS_ENABLED_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<(Instant, bool)>>> =
    std::sync::OnceLock::new();

fn debug_logs_enabled_cached() -> bool {
    let cache = DEBUG_LOGS_ENABLED_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    let Ok(mut cached) = cache.lock() else {
        return false;
    };
    let now = Instant::now();
    if let Some((checked_at, enabled)) = *cached {
        if now.duration_since(checked_at) < Duration::from_secs(5) {
            return enabled;
        }
    }
    let enabled = read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("debugLogsEnabled")
                .and_then(Value::as_bool)
        })
        .unwrap_or(false);
    *cached = Some((now, enabled));
    enabled
}

fn is_verbose_info_log(module: &str, message: &str) -> bool {
    matches!(
        module,
        "clipboard-monitor"
            | "panel-focus"
            | "panel-open-perf"
            | "panel-pin"
            | "panel-position"
            | "panel-toggle"
            | "paste-focus"
            | "shortcut"
    ) || message == "clipboard-promote: refreshed full list"
        || message == "keyboard-detail"
        || message.starts_with("panel-keyboard:")
        || message.starts_with("panel-pin:")
        || message.starts_with("paste-ui:")
}

fn should_write_app_log(level: &str, module: &str, message: &str) -> bool {
    let normalized_level = normalize_log_level(level);
    if normalized_level == "debug" {
        return debug_logs_enabled_cached();
    }
    if normalized_level == "info" && is_verbose_info_log(module, message) {
        return debug_logs_enabled_cached();
    }
    true
}

fn log_writer_send(line: String) {
    let mutex = LOG_WRITER_TX.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        thread::spawn(move || {
            let mut buffer: Vec<String> = Vec::with_capacity(64);
            while let Ok(pending) = rx.recv() {
                buffer.push(pending);
                // 抽干当前已就绪的行，批量写一次，减少 open/write 系统调用次数。
                while buffer.len() < 256 {
                    match rx.try_recv() {
                        Ok(more) => buffer.push(more),
                        Err(_) => break,
                    }
                }
                let path = match log_path() {
                    Ok(path) => path,
                    Err(_) => {
                        buffer.clear();
                        continue;
                    }
                };
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) {
                    let mut joined = String::with_capacity(buffer.iter().map(|s| s.len()).sum());
                    for piece in buffer.drain(..) {
                        joined.push_str(&piece);
                    }
                    let _ = file.write_all(joined.as_bytes());
                }
                buffer.clear();
            }
        });
        std::sync::Mutex::new(tx)
    });
    if let Ok(sender) = mutex.lock() {
        let _ = sender.send(line);
    }
}

fn cleanup_logs_if_needed() {
    let result = cleanup_app_logs();
    if let Err(e) = result {
        eprintln!("[LOG] cleanup failed: {}", e);
    }
}

/// 日志清理的可配置项（从用户设置读取，缺失用默认）。
struct LogCleanupSettings {
    /// 触发清理的体积阈值（MB）。0 = 不按体积清理（仅按保留天数）。
    max_size_mb: u32,
    /// 体积超阈值时保留最新条目的比例（0.1~0.95）。
    keep_ratio: f64,
    /// 最大日志行数。0 = 不按行数清理。
    max_lines: usize,
    /// 按天数清理：丢弃超过 N 天的条目。0 = 不按天数清理。
    retention_days: u32,
    /// error/warn 日志保留天数。
    error_retention_days: u32,
    /// info/debug 等详情日志保留天数。
    detail_retention_days: u32,
    /// 后台是否自动周期清理（false = 仅手动「立即清理」）。
    auto_cleanup: bool,
    /// 自动清理检查间隔（分钟）。
    interval_min: u64,
}

fn read_log_cleanup_settings() -> LogCleanupSettings {
    let mut s = LogCleanupSettings {
        max_size_mb: 10,
        keep_ratio: 0.6,
        retention_days: 0,
        max_lines: 20_000,
        error_retention_days: 7,
        detail_retention_days: 3,
        auto_cleanup: true,
        interval_min: 1440,
    };
    if let Ok(settings) = read_user_settings() {
        let v = &settings.settings;
        if let Some(n) = v.get("logMaxSizeMb").and_then(Value::as_u64) {
            s.max_size_mb = (n as u32).clamp(1, 1024);
        }
        if let Some(n) = v.get("logKeepRatio").and_then(Value::as_f64) {
            s.keep_ratio = n.clamp(0.1, 0.95);
        }
        if let Some(n) = v.get("logMaxLines").and_then(Value::as_u64) {
            s.max_lines = (n as usize).clamp(1_000, 1_000_000);
        }
        if let Some(n) = v.get("logRetentionDays").and_then(Value::as_u64) {
            s.retention_days = n as u32;
        }
        if let Some(n) = v.get("logErrorRetentionDays").and_then(Value::as_u64) {
            s.error_retention_days = (n as u32).clamp(1, 365);
        }
        if let Some(n) = v.get("logDetailRetentionDays").and_then(Value::as_u64) {
            s.detail_retention_days = (n as u32).clamp(1, 365);
        }
        if let Some(b) = v.get("logAutoCleanup").and_then(Value::as_bool) {
            s.auto_cleanup = b;
        }
        if let Some(n) = v.get("logCleanupIntervalMin").and_then(Value::as_u64) {
            s.interval_min = n.clamp(60, 1440);
        }
    }
    s
}

#[tauri::command]
fn cleanup_app_logs() -> Result<String, String> {
    let cfg = read_log_cleanup_settings();
    let path = log_path()?;
    if !path.exists() {
        return Ok("log file does not exist".to_string());
    }

    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    let max_size_bytes = (cfg.max_size_mb as u64) * 1024 * 1024;

    let mut entries: Vec<(i64, String, String)> = Vec::new();
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if let Some(entry) = parse_log_line(&line) {
            entries.push((entry.ts_ms, entry.level, line));
        }
    }
    let original_lines = entries.len();

    // 1) 按日志级别裁剪：错误/警告 7 天，普通详情 3 天。
    let now_ms = now_millis().unwrap_or(0);
    let detail_cutoff = now_ms - (cfg.detail_retention_days as i64) * 86_400_000;
    let error_cutoff = now_ms - (cfg.error_retention_days as i64) * 86_400_000;
    entries.retain(|(ts, level, _)| {
        if level == "error" || level == "warn" {
            *ts >= error_cutoff
        } else {
            *ts >= detail_cutoff
        }
    });

    // 兼容旧配置：如果用户显式配置了更短的全局保留天数，继续收紧。
    if cfg.retention_days > 0 {
        let cutoff = now_ms - (cfg.retention_days as i64) * 86_400_000;
        entries.retain(|(ts, _, _)| *ts >= cutoff);
    }

    // 2) 体积超阈值（max_size_mb > 0 且超出）：保留最新 keep_ratio（至少 100 行）
    let size_over = cfg.max_size_mb > 0 && file_size > max_size_bytes;
    if size_over {
        entries.sort_by(|a, b| b.0.cmp(&a.0)); // 最新在前
        let keep = (entries.len() as f64 * cfg.keep_ratio).max(100.0) as usize;
        entries.truncate(keep);
    }

    // 3) 行数超阈值：保留最新 max_lines 行。
    let line_over = cfg.max_lines > 0 && entries.len() > cfg.max_lines;
    if line_over {
        entries.sort_by(|a, b| b.0.cmp(&a.0)); // 最新在前
        entries.truncate(cfg.max_lines);
    }

    let dropped = original_lines.saturating_sub(entries.len());
    if dropped == 0 {
        return Ok(format!(
            "log size {} bytes, {} lines, no cleanup needed (max={}MB maxLines={} errorRetentionDays={} detailRetentionDays={})",
            file_size,
            original_lines,
            cfg.max_size_mb,
            cfg.max_lines,
            cfg.error_retention_days,
            cfg.detail_retention_days
        ));
    }

    // 回写：恢复时间顺序（旧→新）保持追加顺序
    if size_over || line_over {
        entries.reverse();
    }
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    for (_, _, line) in &entries {
        writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    }
    let new_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();

    Ok(format!(
        "log cleaned: {} -> {} bytes, {} -> {} lines (maxSize={}MB keepRatio={} maxLines={} errorRetentionDays={} detailRetentionDays={})",
        file_size,
        new_size,
        original_lines,
        entries.len(),
        cfg.max_size_mb,
        cfg.keep_ratio,
        cfg.max_lines,
        cfg.error_retention_days,
        cfg.detail_retention_days
    ))
}

#[tauri::command]
fn get_log_stats() -> Result<LogStatsPayload, String> {
    let path = log_path()?;
    let mut size_bytes: u64 = 0;
    let mut line_count: u64 = 0;
    let mut oldest_ts_ms: i64 = 0;
    if path.exists() {
        size_bytes = fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if let Ok(file) = fs::File::open(&path) {
            for line in BufReader::new(file).lines().map_while(Result::ok) {
                line_count += 1;
                if let Some(entry) = parse_log_line(&line) {
                    if oldest_ts_ms == 0 || entry.ts_ms < oldest_ts_ms {
                        oldest_ts_ms = entry.ts_ms;
                    }
                }
            }
        }
    }
    let cfg = read_log_cleanup_settings();
    Ok(LogStatsPayload {
        path: path.to_string_lossy().to_string(),
        size_bytes,
        line_count,
        oldest_ts_ms,
        max_size_mb: cfg.max_size_mb,
        keep_ratio: cfg.keep_ratio,
        retention_days: cfg.retention_days,
        auto_cleanup: cfg.auto_cleanup,
        interval_min: cfg.interval_min,
    })
}

#[tauri::command]
pub(crate) fn query_clip_records(
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
pub(crate) fn search_clip_records(input: SearchClipsRequest) -> Result<QueryClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let limit = input.limit.unwrap_or(50).clamp(1, 200);
    let cursor_seen_at = input
        .cursor
        .as_deref()
        .and_then(|value| value.split(':').next())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(i64::MAX);
    let text = input.text.unwrap_or_default();
    let bucket = input.bucket.unwrap_or_else(|| "all".to_string());
    let has_text = !text.trim().is_empty();
    let mut sql = if has_text {
        "SELECT DISTINCT clips.id FROM clip_fts JOIN clips ON clips.id = clip_fts.id".to_string()
    } else {
        "SELECT DISTINCT clips.id FROM clips".to_string()
    };
    let mut clauses = Vec::new();
    let mut values: Vec<SqlValue> = Vec::new();

    if has_text {
        clauses.push("clip_fts MATCH ?".to_string());
        values.push(SqlValue::Text(fts_query(&text)));
    }
    match bucket.as_str() {
        "trash" => clauses.push("clips.deleted_at IS NOT NULL".to_string()),
        "all" => clauses.push("clips.deleted_at IS NULL".to_string()),
        value => {
            clauses.push("clips.deleted_at IS NULL".to_string());
            clauses.push("clips.bucket = ?".to_string());
            values.push(SqlValue::Text(value.to_string()));
        }
    }
    clauses.push("clips.last_seen_at < ?".to_string());
    values.push(SqlValue::Integer(cursor_seen_at));

    push_in_clause(&mut clauses, &mut values, "clips.kind", input.kinds);
    push_in_clause(&mut clauses, &mut values, "clips.payload_kind", input.types);

    if let Some(tags) = input.tags {
        for tag in normalize_tags(tags) {
            clauses.push("lower(',' || clips.tags || ',') LIKE ?".to_string());
            values.push(SqlValue::Text(format!("%,{},%", tag.to_lowercase())));
        }
    }
    if let Some(file_extensions) = input.file_extensions {
        let extensions = normalize_tags(file_extensions);
        if !extensions.is_empty() {
            let placeholders = std::iter::repeat("lower(clips.file_types) LIKE ?")
                .take(extensions.len())
                .collect::<Vec<_>>()
                .join(" OR ");
            clauses.push(format!("({placeholders})"));
            for extension in extensions {
                values.push(SqlValue::Text(format!("%{}%", extension.to_lowercase())));
            }
        }
    }
    if let Some(favorite) = input.favorite {
        clauses.push("clips.favorite = ?".to_string());
        values.push(SqlValue::Integer(if favorite { 1 } else { 0 }));
    }

    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY clips.last_seen_at DESC LIMIT ?");
    values.push(SqlValue::Integer(limit));

    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(values), |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(load_clip(&conn, &row.map_err(|error| error.to_string())?)?);
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

fn push_in_clause(
    clauses: &mut Vec<String>,
    values: &mut Vec<SqlValue>,
    column: &str,
    raw_values: Option<Vec<String>>,
) {
    let normalized = raw_values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return;
    }
    let placeholders = std::iter::repeat("?")
        .take(normalized.len())
        .collect::<Vec<_>>()
        .join(", ");
    clauses.push(format!("{column} IN ({placeholders})"));
    for value in normalized {
        values.push(SqlValue::Text(value));
    }
}

#[tauri::command]
pub(crate) fn soft_delete_clip_records(ids: Vec<String>) -> Result<DeleteClipPayload, String> {
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIP_DELETE_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIP_DELETE_FAILED", error))?;
    let deleted_at =
        now_millis().map_err(|error| preserve_command_error("CLIP_DELETE_FAILED", error))?;
    for id in &ids {
        conn.execute(
            "UPDATE clips SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![deleted_at, id],
        )
        .map_err(|error| command_error("CLIP_DELETE_FAILED", error.to_string()))?;
        conn.execute("DELETE FROM clip_fts WHERE id = ?1", params![id])
            .map_err(|error| command_error("CLIP_DELETE_FAILED", error.to_string()))?;
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
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIP_RESTORE_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIP_RESTORE_FAILED", error))?;
    let now = now_millis().map_err(|error| preserve_command_error("CLIP_RESTORE_FAILED", error))?;
    for id in &ids {
        conn.execute(
            "UPDATE clips SET deleted_at = NULL, updated_at = ?1, bucket = 'history' WHERE id = ?2",
            params![now, id],
        )
        .map_err(|error| command_error("CLIP_RESTORE_FAILED", error.to_string()))?;
        upsert_fts(&conn, id)
            .map_err(|error| preserve_command_error("CLIP_RESTORE_FAILED", error))?;
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
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIP_HARD_DELETE_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIP_HARD_DELETE_FAILED", error))?;
    let image_store = clipboard::ImageStore::new(
        image_storage_path()
            .map_err(|error| preserve_command_error("CLIP_HARD_DELETE_FAILED", error))?,
    );
    for id in &ids {
        let image_file_name: Option<String> = conn
            .query_row(
                "SELECT content FROM clips WHERE id = ?1 AND primary_format = 'image/png'",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| command_error("CLIP_HARD_DELETE_FAILED", error.to_string()))?;
        conn.execute("DELETE FROM clip_fts WHERE id = ?1", params![id])
            .map_err(|error| command_error("CLIP_HARD_DELETE_FAILED", error.to_string()))?;
        conn.execute("DELETE FROM clips WHERE id = ?1", params![id])
            .map_err(|error| command_error("CLIP_HARD_DELETE_FAILED", error.to_string()))?;
        if let Some(file_name) = image_file_name {
            if let Err(error) = image_store.remove(&file_name) {
                log_to_file(
                    "warn",
                    "clipboard-image",
                    &format!(
                        "remove image file failed id={} file={} error={}",
                        id, file_name, error
                    ),
                );
            }
        }
    }
    Ok(HardDeleteClipPayload {
        hard_deleted_ids: ids,
    })
}

#[tauri::command]
pub(crate) fn update_clip_record(input: UpdateClipInput) -> Result<ClipItemPayload, String> {
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))?;
    let now = now_millis().map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))?;
    if let Some(content) = input.content {
        let content = content.trim().to_string();
        if content.is_empty() {
            return Err(command_error("CLIPBOARD_CONTENT_EMPTY", "content is empty"));
        }
        let detection = clipboard::detect_text(&content);
        let payload_kind = detection.payload_kind;
        let primary_format = primary_format_from_payload(&payload_kind).to_string();
        let hash = content_hash(&primary_format, content.as_bytes());
        let available_formats = vec![primary_format.clone()];
        let available_formats_json = json_string(&available_formats)?;
        let representations = build_representations(&content, &payload_kind);
        let representations_json = json_string(&representations)?;
        let tags = if let Some(tags) = input.tags.clone() {
            normalize_tags(tags)
        } else {
            let existing: Option<String> = conn
                .query_row(
                    "SELECT tags FROM clips WHERE id = ?1 AND deleted_at IS NULL",
                    params![input.id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
            existing
                .unwrap_or_default()
                .split(',')
                .map(ToString::to_string)
                .collect()
        };
        let duplicate_id: Option<String> = conn
            .query_row(
                "SELECT id FROM clips WHERE content_hash = ?1 AND id <> ?2 LIMIT 1",
                params![hash, input.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
        if let Some(duplicate_id) = duplicate_id {
            return Err(command_error(
                "CLIP_DUPLICATE_CONTENT",
                format!("content duplicates existing clip {duplicate_id}"),
            ));
        }
        let analysis = analyze_clip(&content, "Edit");
        conn.execute(
            "UPDATE clips SET
                content = ?1,
                content_hash = ?2,
                primary_format = ?3,
                available_formats = ?4,
                representations_json = ?5,
                plain_text = ?6,
                search_text = ?6,
                sub_kind = ?7,
                size = ?8,
                kind = ?9,
                tags = ?10,
                title = ?11,
                summary = ?12,
                url = ?13,
                host = ?14,
                payload_kind = ?15,
                is_sensitive = ?16,
                updated_at = ?17
             WHERE id = ?18 AND deleted_at IS NULL",
            params![
                content,
                hash,
                primary_format,
                available_formats_json,
                representations_json,
                content,
                detection.sub_kind,
                content.as_bytes().len() as i64,
                analysis_kind_from_payload(&payload_kind),
                tags.join(","),
                analysis.title,
                analysis.summary,
                analysis.url,
                analysis.host,
                payload_kind,
                if detection.is_sensitive { 1 } else { 0 },
                now,
                input.id
            ],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
        upsert_fts(&conn, &input.id)
            .map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))?;
        log_to_file(
            "info",
            "clip-edit",
            &format!(
                "saved id={} chars={} payloadKind={}",
                input.id,
                content.chars().count(),
                payload_kind
            ),
        );
    }
    if let Some(tags) = input.tags {
        conn.execute(
            "UPDATE clips SET tags = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![normalize_tags(tags).join(","), now, input.id],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
        upsert_fts(&conn, &input.id)
            .map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))?;
    }
    if let Some(bucket) = input.bucket {
        conn.execute(
            "UPDATE clips SET bucket = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![bucket, now, input.id],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
    }
    if let Some(favorite) = input.favorite {
        conn.execute(
            "UPDATE clips SET favorite = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![if favorite { 1 } else { 0 }, now, input.id],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
    }
    if let Some(pinned) = input.pinned {
        conn.execute(
            "UPDATE clips SET pinned = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![if pinned { 1 } else { 0 }, now, input.id],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
    }
    if let Some(note) = input.note {
        conn.execute(
            "UPDATE clips SET note = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![note, now, input.id],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
    }
    if let Some(metadata) = input.metadata {
        conn.execute(
            "UPDATE clips SET metadata_json = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![
                json_string(&metadata).map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))?,
                now,
                input.id
            ],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
    }
    if let Some(agent_context) = input.agent_context {
        conn.execute(
            "UPDATE clips SET agent_context_json = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![
                json_string(&agent_context).map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))?,
                now,
                input.id
            ],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
    }
    if input.copied.unwrap_or(false) {
        conn.execute(
            "UPDATE clips SET copy_count = copy_count + 1, last_copied_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, input.id],
        )
        .map_err(|error| command_error("CLIP_UPDATE_FAILED", error.to_string()))?;
    }
    load_clip(&conn, &input.id).map_err(|error| preserve_command_error("CLIP_UPDATE_FAILED", error))
}

#[tauri::command]
pub(crate) fn export_clip_records(include_deleted: Option<bool>) -> Result<ExportClipPayload, String> {
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIP_EXPORT_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIP_EXPORT_FAILED", error))?;
    let items = export_items(&conn, include_deleted.unwrap_or(false))
        .map_err(|error| preserve_command_error("CLIP_EXPORT_FAILED", error))?;
    Ok(ExportClipPayload {
        exported_at: now_millis()
            .map_err(|error| preserve_command_error("CLIP_EXPORT_FAILED", error))?,
        count: items.len() as i64,
        items,
    })
}

fn text_export_file_stem(title: &str, index: usize) -> String {
    let stem = title
        .trim()
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
        .take(80)
        .collect::<String>();
    if stem.is_empty() {
        format!("item-{}", index + 1)
    } else {
        stem
    }
}

/// 将多选详情中的每条内容分别写入 Downloads，返回导出目录和文件路径。
/// 文件名只使用安全字符并带有序号，避免标题中的路径片段覆盖导出目录外的文件。
#[tauri::command]
fn export_clip_text_files<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    items: Vec<ExportTextFileInput>,
) -> Result<ExportTextFilesPayload, String> {
    if items.is_empty() {
        return Err(command_error(
            "CLIP_TEXT_EXPORT_EMPTY",
            "No text items were selected",
        ));
    }

    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| command_error("CLIP_TEXT_EXPORT_PATH_FAILED", error.to_string()))?;
    let timestamp =
        now_millis().map_err(|error| preserve_command_error("CLIP_TEXT_EXPORT_FAILED", error))?;
    let export_dir = download_dir.join(format!("ClipForge-Text-Export-{}", timestamp));
    fs::create_dir_all(&export_dir)
        .map_err(|error| command_error("CLIP_TEXT_EXPORT_DIRECTORY_FAILED", error.to_string()))?;

    let mut files = Vec::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        let file_name = format!(
            "{:02}-{}.txt",
            index + 1,
            text_export_file_stem(&item.title, index)
        );
        let path = export_dir.join(file_name);
        fs::write(&path, item.content.as_bytes())
            .map_err(|error| command_error("CLIP_TEXT_EXPORT_FILE_FAILED", error.to_string()))?;
        files.push(path.to_string_lossy().to_string());
    }

    Ok(ExportTextFilesPayload {
        directory: export_dir.to_string_lossy().to_string(),
        count: files.len() as i64,
        files,
    })
}

#[tauri::command]
pub(crate) fn import_clip_records(items: Vec<ImportClipInput>) -> Result<ImportClipPayload, String> {
    let conn =
        open_clip_db().map_err(|error| preserve_command_error("CLIP_IMPORT_FAILED", error))?;
    init_schema(&conn).map_err(|error| preserve_command_error("CLIP_IMPORT_FAILED", error))?;
    import_items(&conn, items).map_err(|error| preserve_command_error("CLIP_IMPORT_FAILED", error))
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

fn settings_window_path(section: Option<&str>) -> Result<&'static str, String> {
    match section {
        None => Ok("settings.html"),
        Some("onboarding") => Ok("settings.html?section=onboarding"),
        Some(value) => Err(format!("Unsupported settings section: {}", value)),
    }
}

/// 记录设置窗口的原生状态，避免前端只看到 command resolve 却无法判断窗口是否真正显示。
fn log_settings_window_state<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, action: &str) {
    let url = window
        .url()
        .map(|value| value.to_string())
        .unwrap_or_else(|error| format!("url-error: {}", error));
    let visible = window
        .is_visible()
        .map(|value| value.to_string())
        .unwrap_or_else(|error| format!("visible-error: {}", error));
    let focused = window
        .is_focused()
        .map(|value| value.to_string())
        .unwrap_or_else(|error| format!("focused-error: {}", error));
    log_to_file(
        "info",
        "settings-window",
        &format!(
            "{}: url={} visible={} focused={}",
            action, url, visible, focused
        ),
    );
}

fn set_regular_activation_policy<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    app.set_activation_policy(tauri::ActivationPolicy::Regular)
        .map_err(|error| {
            command_error(
                "SETTINGS_WINDOW_ACTIVATION_POLICY_FAILED",
                error.to_string(),
            )
        })
}

#[cfg(target_os = "macos")]
fn activate_settings_app() {
    let Some(mtm) = tauri_nspanel::objc2_foundation::MainThreadMarker::new() else {
        log_to_file(
            "warn",
            "settings-window",
            "activate skipped because settings window open did not run on the main thread",
        );
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    let policy_updated =
        NSApplication::setActivationPolicy(&app, NSApplicationActivationPolicy::Regular);
    #[allow(deprecated)]
    NSApplication::activateIgnoringOtherApps(&app, true);
    let running_app = NSRunningApplication::currentApplication();
    let activated =
        running_app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows);
    log_to_file(
        "info",
        "settings-window",
        &format!(
            "activated settings app: policyUpdated={} runningActivated={}",
            policy_updated, activated
        ),
    );
}

#[cfg(not(target_os = "macos"))]
fn activate_settings_app() {}

#[cfg(target_os = "macos")]
fn focus_settings_window_native<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Err(error) = window.with_webview(|webview| unsafe {
        let ns_window: &AppKitNSWindow = &*webview.ns_window().cast::<AppKitNSWindow>();
        ns_window.makeKeyAndOrderFront(None);
        ns_window.orderFrontRegardless();
        log_to_file(
            "info",
            "settings-window",
            &format!(
                "native focus: visible={} key={}",
                ns_window.isVisible(),
                ns_window.isKeyWindow()
            ),
        );
    }) {
        log_to_file(
            "warn",
            "settings-window",
            &format!("native focus failed: {}", error),
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn focus_settings_window_native<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

fn open_settings_window_internal<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    section: Option<&str>,
) -> Result<(), String> {
    let settings_path = settings_window_path(section)?;
    if let Some(window) = app.get_webview_window("settings") {
        set_regular_activation_policy(&app)?;
        if section.is_some() {
            let mut url = window.url().map_err(|error| error.to_string())?;
            let (path, query) = settings_path
                .split_once('?')
                .map_or((settings_path, None), |(path, query)| (path, Some(query)));
            url.set_path(path);
            url.set_query(query);
            window.navigate(url).map_err(|error| {
                command_error("SETTINGS_WINDOW_NAVIGATE_FAILED", error.to_string())
            })?;
        }
        window
            .show()
            .map_err(|error| command_error("SETTINGS_WINDOW_SHOW_FAILED", error.to_string()))?;
        activate_settings_app();
        focus_settings_window_native(&window);
        window
            .set_focus()
            .map_err(|error| command_error("SETTINGS_WINDOW_FOCUS_FAILED", error.to_string()))?;
        log_settings_window_state(&window, "reused settings window");
        return Ok(());
    }

    set_regular_activation_policy(&app)?;
    let window = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(settings_path.into()))
        .title(native_tr("window.settings.title"))
        .inner_size(720.0, 600.0)
        .min_inner_size(640.0, 480.0)
        .resizable(true)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .visible_on_all_workspaces(false)
        .build()
        .map_err(|error| command_error("SETTINGS_WINDOW_BUILD_FAILED", error.to_string()))?;

    if let Err(error) = window.set_size(LogicalSize::new(720.0, 600.0)) {
        log_to_file(
            "warn",
            "settings-window",
            &format!("set size failed: {}", error),
        );
    }
    if let Err(error) = window.set_always_on_top(false) {
        log_to_file(
            "warn",
            "settings-window",
            &format!("set always-on-top failed: {}", error),
        );
    }
    if let Err(error) = window.set_visible_on_all_workspaces(false) {
        log_to_file(
            "warn",
            "settings-window",
            &format!("set visible-on-all-workspaces failed: {}", error),
        );
    }
    if let Err(error) = window.center() {
        log_to_file(
            "warn",
            "settings-window",
            &format!("center failed: {}", error),
        );
    }
    window
        .show()
        .map_err(|error| command_error("SETTINGS_WINDOW_SHOW_FAILED", error.to_string()))?;
    activate_settings_app();
    focus_settings_window_native(&window);
    window
        .set_focus()
        .map_err(|error| command_error("SETTINGS_WINDOW_FOCUS_FAILED", error.to_string()))?;
    log_settings_window_state(&window, "created settings window");
    Ok(())
}

/// 打开设置窗口的普通入口：保持进入 `settings.html`，不携带初始分类参数。
#[tauri::command]
fn open_settings_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    open_settings_window_internal(app, None)
}

/// 打开设置窗口并进入指定分类；分类使用白名单，避免前端传入任意 URL。
#[tauri::command]
fn open_settings_window_with_section<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    section: String,
) -> Result<(), String> {
    open_settings_window_internal(app, Some(section.as_str()))
}

fn open_onboarding_window_internal<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: &str,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("onboarding") {
        set_regular_activation_policy(&app)?;
        window
            .show()
            .map_err(|error| command_error("ONBOARDING_WINDOW_SHOW_FAILED", error.to_string()))?;
        activate_settings_app();
        focus_settings_window_native(&window);
        window
            .set_focus()
            .map_err(|error| command_error("ONBOARDING_WINDOW_FOCUS_FAILED", error.to_string()))?;
        log_to_file(
            "info",
            "onboarding-window",
            &format!("reused onboarding window source={source}"),
        );
        return Ok(());
    }

    set_regular_activation_policy(&app)?;
    let window = WebviewWindowBuilder::new(
        &app,
        "onboarding",
        WebviewUrl::App("onboarding.html".into()),
    )
    .title(native_tr("window.onboarding.title"))
    .inner_size(640.0, 560.0)
    .min_inner_size(640.0, 560.0)
    .resizable(false)
    .decorations(true)
    .transparent(false)
    .always_on_top(false)
    .visible_on_all_workspaces(false)
    .build()
    .map_err(|error| command_error("ONBOARDING_WINDOW_BUILD_FAILED", error.to_string()))?;
    if let Err(error) = window.center() {
        log_to_file(
            "warn",
            "onboarding-window",
            &format!("center failed: {}", error),
        );
    }
    window
        .show()
        .map_err(|error| command_error("ONBOARDING_WINDOW_SHOW_FAILED", error.to_string()))?;
    activate_settings_app();
    focus_settings_window_native(&window);
    window
        .set_focus()
        .map_err(|error| command_error("ONBOARDING_WINDOW_FOCUS_FAILED", error.to_string()))?;
    log_to_file(
        "info",
        "onboarding-window",
        &format!("created onboarding window source={source}"),
    );
    Ok(())
}

#[tauri::command]
fn open_onboarding_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    open_onboarding_window_internal(app, "manual")
}

fn maybe_open_onboarding_on_startup<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        // 可达性检查不依赖设置，放到锁外（铁律 2：锁内只做读-改-写）。
        let accessibility_missing = check_accessibility_permission_platform()
            .map(|payload| payload.status != "granted")
            .unwrap_or(false);
        // 写路径统一走 settings_service 门面：锁内读-改-原子写，锁释放后才开窗。
        // 任一步失败都不开窗：onboardingShownAt 未落盘时下次启动会重试，避免双重引导。
        let outcome = settings_service::run_settings_write(|settings| {
            let onboarding_completed = settings
                .get("onboardingCompleted")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let already_shown = settings
                .get("onboardingShownAt")
                .and_then(Value::as_i64)
                .is_some();
            if onboarding_completed || already_shown || !accessibility_missing {
                log_to_file(
                    "debug",
                    "onboarding-window",
                    &format!(
                        "startup guide skipped completed={} shown={} accessibilityMissing={}",
                        onboarding_completed, already_shown, accessibility_missing
                    ),
                );
                return Ok((None, false));
            }
            let shown_at = now_millis().unwrap_or_default();
            let mut next = settings.clone();
            if let Some(object) = next.as_object_mut() {
                object.insert("onboardingShownAt".to_string(), json!(shown_at));
            }
            Ok((Some(next), true))
        });
        match outcome {
            Ok(true) => {
                if let Err(error) = open_onboarding_window_internal(app, "startup-permission-check")
                {
                    log_to_file(
                        "warn",
                        "onboarding-window",
                        &format!("startup open onboarding failed: {error}"),
                    );
                }
            }
            Ok(false) => {}
            Err(error) => log_to_file(
                "warn",
                "onboarding-window",
                &format!("startup onboarding settings write failed: {error}"),
            ),
        }
    });
}

#[tauri::command]
fn cleanup_clip_records(
    retention_days: i64,
    max_active_items: Option<i64>,
) -> Result<CleanupClipPayload, String> {
    let conn = open_clip_db()?;
    init_schema(&conn)?;
    let ran_at = now_millis()?;
    let retention_ms = retention_days.max(1) * 24 * 60 * 60 * 1000;
    let cutoff = ran_at - retention_ms;
    let retention_hard_deleted = conn
        .execute(
            "DELETE FROM clips WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
            params![cutoff],
        )
        .map_err(|error| error.to_string())? as i64;
    let max_active_items = max_active_items.unwrap_or(500).clamp(50, 5000);
    let active_count = conn
        .query_row(
            "SELECT COUNT(*) FROM clips WHERE deleted_at IS NULL",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let overflow = (active_count - max_active_items).max(0);
    let mut overflow_ids = Vec::new();
    if overflow > 0 {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM clips
                 WHERE deleted_at IS NULL AND favorite = 0
                 ORDER BY last_seen_at ASC, created_at ASC
                 LIMIT ?1",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![overflow], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        for row in rows {
            overflow_ids.push(row.map_err(|error| error.to_string())?);
        }
    }
    for id in &overflow_ids {
        conn.execute("DELETE FROM clips WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
    }
    let overflow_hard_deleted = overflow_ids.len() as i64;
    conn.execute(
        "DELETE FROM clip_fts WHERE id NOT IN (SELECT id FROM clips WHERE deleted_at IS NULL)",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(CleanupClipPayload {
        hard_deleted: retention_hard_deleted + overflow_hard_deleted,
        retention_hard_deleted,
        overflow_hard_deleted,
        ran_at,
    })
}

#[tauri::command]
fn get_clipforge_database_path() -> Result<String, String> {
    Ok(database_path()?.to_string_lossy().to_string())
}

#[tauri::command]
fn get_image_storage_path() -> Result<String, String> {
    let path = image_storage_path()?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// 设置页「数据」分类的存储统计：文件大小 + 记录数，供占用展示与清理决策参考。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataStatsPayload {
    /// SQLite 数据库主文件字节数（不含 -wal/-shm 临时文件）。
    db_bytes: i64,
    /// json5 用户设置文件字节数。
    settings_bytes: i64,
    /// 图片缓存目录递归总字节数（目录缺失按 0）。
    images_bytes: i64,
    /// 活动剪贴板记录数（未进回收站）。
    clip_count: i64,
    /// 回收站记录数。
    trash_count: i64,
}

/// 递归统计目录字节数。纯只读：目录不存在或条目不可读时按 0 计，不因缓存缺失让统计失败。
fn dir_size_bytes(path: &std::path::Path) -> i64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0i64;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            total += dir_size_bytes(&entry.path());
        } else {
            total += entry.metadata().map(|meta| meta.len() as i64).unwrap_or(0);
        }
    }
    total
}

/// 读取数据存储统计：数据库/设置文件/图片缓存大小与活动、回收站记录数。
/// 边界：不创建缺失目录、不初始化数据库 schema；clips 表尚未建时记录数按 0 返回。
#[tauri::command]
fn get_clipforge_data_stats() -> Result<DataStatsPayload, String> {
    let db_path = database_path()?;
    let settings_file = settings_path()?;
    let images_dir = image_storage_path()?;
    let file_size = |path: &std::path::Path| -> i64 {
        std::fs::metadata(path)
            .map(|meta| meta.len() as i64)
            .unwrap_or(0)
    };
    let conn = open_clip_db()?;
    let has_clips_table: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'clips'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let (clip_count, trash_count) = if has_clips_table > 0 {
        conn.query_row(
            "SELECT
                COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END), 0)
             FROM clips",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| error.to_string())?
    } else {
        (0, 0)
    };
    Ok(DataStatsPayload {
        db_bytes: file_size(&db_path),
        settings_bytes: file_size(&settings_file),
        images_bytes: dir_size_bytes(&images_dir),
        clip_count,
        trash_count,
    })
}

fn system_native_locale() -> &'static str {
    if native_system_language().starts_with("zh") {
        "zh-CN"
    } else {
        "en-US"
    }
}

fn native_system_language() -> String {
    macos_user_language()
        .or_else(|| {
            std::env::var("LANG")
                .or_else(|_| std::env::var("LC_ALL"))
                .or_else(|_| std::env::var("LC_MESSAGES"))
                .ok()
        })
        .unwrap_or_default()
        .to_lowercase()
}

#[cfg(target_os = "macos")]
fn macos_user_language() -> Option<String> {
    // macOS GUI/WebView 跟随 AppleLanguages/AppleLocale，而不是 shell LANG。
    for key in ["AppleLanguages", "AppleLocale"] {
        let output = std::process::Command::new("defaults")
            .args(["read", "-g", key])
            .output()
            .ok()?;
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(language) = text
            .split(|character: char| {
                character.is_whitespace() || matches!(character, '(' | ')' | '"' | '\'' | ',' | ';')
            })
            .find(|token| !token.trim().is_empty())
        {
            return Some(language.trim().to_string());
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn macos_user_language() -> Option<String> {
    None
}

fn native_tr(key: &str) -> &'static str {
    let zh = current_native_locale() == "zh-CN";
    match (zh, key) {
        (true, "window.settings.title") => "ClipForge 设置",
        (false, "window.settings.title") => "ClipForge Settings",
        (true, "window.onboarding.title") => "ClipForge 引导",
        (false, "window.onboarding.title") => "ClipForge Onboarding",
        (true, "tray.openQuick") => "打开快捷面板",
        (false, "tray.openQuick") => "Open Quick Panel",
        (true, "tray.preferences") => "偏好设置…",
        (false, "tray.preferences") => "Preferences...",
        (true, "tray.pauseListening") => "⏸ 暂停监听剪贴板",
        (false, "tray.pauseListening") => "⏸ Pause Clipboard Monitoring",
        (true, "tray.resumeListening") => "▶ 恢复监听剪贴板",
        (false, "tray.resumeListening") => "▶ Resume Clipboard Monitoring",
        (true, "tray.quit") => "退出 ClipForge",
        (false, "tray.quit") => "Quit ClipForge",
        _ => "ClipForge",
    }
}

#[tauri::command]
fn append_app_log(
    level: String,
    message: String,
    context: Option<String>,
) -> Result<String, String> {
    // 这是前端可调用的命令（设置页日志查看/清理用到），保持同步语义并返回路径。
    // 内部高频日志走 log_to_file（非阻塞后台线程，见 log_writer_send）。
    if !should_write_app_log(&level, "", &message) {
        return Ok(log_path()?.to_string_lossy().to_string());
    }
    let line = build_log_line(&level, &message, &context.unwrap_or_default())?;
    let path = log_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
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

fn command_output_optional(program: &str, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .output()
        .map(|output| {
            format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
            .trim()
            .to_string()
        })
        .unwrap_or_default()
}

fn webkit_environment_snapshot() -> Value {
    json!({
        "frameworkVersion": command_output_optional(
            "defaults",
            &[
                "read",
                "/System/Library/Frameworks/WebKit.framework/Resources/Info",
                "CFBundleShortVersionString"
            ],
        ),
        "frameworkBundleVersion": command_output_optional(
            "defaults",
            &[
                "read",
                "/System/Library/Frameworks/WebKit.framework/Resources/Info",
                "CFBundleVersion"
            ],
        ),
        "frameworkPath": "/System/Library/Frameworks/WebKit.framework"
    })
}

#[tauri::command]
fn export_diagnostics_bundle<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    frontend: Option<Value>,
) -> Result<DiagnosticsExportPayload, String> {
    log_environment_snapshot("diagnostics");
    let created_at = now_millis()?;
    let diagnostics_dir = settings_path()?
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("diagnostics");
    fs::create_dir_all(&diagnostics_dir).map_err(|error| error.to_string())?;
    let report_path = diagnostics_dir.join(format!("clipforge-diagnostics-{}.json", created_at));

    let panel = app
        .get_webview_window("main")
        .map(|window| panel_trigger_payload(&window, "diagnostics-export", "current", ""));
    let logs = query_app_logs(None, None, Some(300)).unwrap_or(QueryAppLogPayload {
        path: log_path()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        items: Vec::new(),
        limit: 300,
    });
    let log_count = logs.items.len();
    let settings = read_user_settings().ok();
    let accessibility_prompt_marker = accessibility_prompt_marker_path().ok().map(|path| {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        json!({
            "path": path.to_string_lossy().to_string(),
            "exists": path.exists(),
            "content": parse_json5_like(&raw).unwrap_or_else(|_| json!({ "raw": raw })),
        })
    });

    let report = json!({
        "schemaVersion": 1,
        "createdAt": created_at,
        "app": {
            "name": "ClipForge",
            "version": APP_VERSION,
            "bundleIdentifier": APP_BUNDLE_IDENTIFIER,
            "currentExe": std::env::current_exe().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "bundlePath": current_app_bundle_path().map(|path| path.to_string_lossy().to_string()).unwrap_or_default()
        },
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "family": std::env::consts::FAMILY,
            "uname": command_output_optional("uname", &["-a"]),
            "macos": command_output_optional("sw_vers", &[]),
            "webkit": webkit_environment_snapshot()
        },
        "frontend": frontend,
        "paths": {
            "settings": settings_path().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "database": database_path().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "imageStorage": image_storage_path().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "log": log_path().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "accessibilityFirstUsePrompt": accessibility_prompt_marker_path().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "diagnostics": report_path.to_string_lossy().to_string()
        },
        "settings": settings,
        "accessibility": {
            "status": check_accessibility_permission_platform().ok(),
            "diagnostics": get_accessibility_diagnostics_platform().ok(),
            "firstUsePrompt": accessibility_prompt_marker
        },
        "panel": panel,
        "mcp": get_mcp_status().ok(),
        "logs": {
            "stats": get_log_stats().ok(),
            "recent": logs
        },
        "commands": {
            "resetAccessibility": format!("tccutil reset Accessibility {}", APP_BUNDLE_IDENTIFIER),
            "removeQuarantine": "xattr -r -d com.apple.quarantine /Applications/ClipForge.app",
            "mcp": "/Applications/ClipForge.app/Contents/MacOS/clipforge --mcp"
        },
        "privacyNote": "This report contains recent ClipForge application logs and may include short clipboard previews recorded by diagnostics logs. It does not export the clipboard database."
    });

    fs::write(
        &report_path,
        serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    log_to_file(
        "info",
        "diagnostics",
        &format!("exported diagnostics to {}", report_path.to_string_lossy()),
    );
    Ok(DiagnosticsExportPayload {
        path: report_path.to_string_lossy().to_string(),
        created_at,
        log_count,
        summary: format!("已导出诊断报告，包含 {} 条最近日志。", log_count),
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
fn show_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: Option<String>,
) -> Result<PanelTriggerPayload, String> {
    open_panel(&app, source.as_deref().unwrap_or("command"))
}

#[tauri::command]
fn hide_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    hide_panel(&app, "command")
}

#[tauri::command]
fn toggle_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    source: Option<String>,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    if window.is_visible().unwrap_or(false) {
        hide_panel(&app, source.as_deref().unwrap_or("toggle"))
    } else {
        open_panel(&app, source.as_deref().unwrap_or("toggle"))
    }
}

#[tauri::command]
fn focus_quick_panel_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    show_panel_window(&app, &window);
    Ok(panel_trigger_payload(&window, "focus", "manual-focus", ""))
}

#[tauri::command]
fn release_focus_command<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    hide_panel_before_paste(&app);
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    Ok(panel_trigger_payload(
        &window,
        "release-focus",
        "hidden",
        "",
    ))
}

#[tauri::command]
fn get_panel_trigger_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    Ok(panel_trigger_payload(&window, "status", "current", ""))
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

#[tauri::command]
fn get_accessibility_diagnostics() -> Result<AccessibilityDiagnosticsPayload, String> {
    get_accessibility_diagnostics_platform()
}

#[tauri::command]
fn reset_accessibility_permission() -> Result<AccessibilityPermissionPayload, String> {
    reset_accessibility_permission_platform()
}


#[cfg(target_os = "macos")]
fn focused_input_bounds_platform() -> Result<FocusedInputBoundsPayload, String> {
    if let Ok(cache) = focus_bounds_cache().lock() {
        if cache.valid {
            if let Ok(now) = now_millis() {
                if now - cache.updated_at < FOCUS_CACHE_MAX_AGE_MS {
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

#[cfg(target_os = "macos")]
fn snapshot_paste_target_bounds(reason: &str, fallback_point: Option<(f64, f64)>) {
    let target_app = frontmost_app_identity();
    if let Some((_, bundle_id)) = &target_app {
        if let Ok(mut slot) = paste_target_app_bundle_cache().lock() {
            *slot = bundle_id.clone();
        }
    } else if let Ok(mut slot) = paste_target_app_bundle_cache().lock() {
        slot.clear();
    }
    let target_app_log = target_app
        .as_ref()
        .map(|(name, bundle_id)| format!("{}|{}", name, bundle_id))
        .unwrap_or_else(|| "unknown".to_string());

    let payload = native_focused_input_bounds().ok();
    let Some(bounds) = payload else {
        if let Some((x, y)) = fallback_point {
            let cache = CachedFocusBounds {
                x,
                y,
                width: 1.0,
                height: 1.0,
                source: "cursor-fallback".to_string(),
                valid: true,
                updated_at: now_millis().unwrap_or(0),
            };
            if let Ok(mut slot) = paste_target_bounds_cache().lock() {
                *slot = cache;
            }
            log_to_file(
                "info",
                "paste-focus",
                &format!(
                    "snapshot fallback reason={} source=cursor-fallback point=({},{}) frontmost={}",
                    reason, x, y, target_app_log
                ),
            );
        } else {
            if let Ok(mut slot) = paste_target_bounds_cache().lock() {
                *slot = CachedFocusBounds::default();
            }
            log_to_file(
                "debug",
                "paste-focus",
                &format!(
                    "snapshot skipped reason={} no focused bounds frontmost={}",
                    reason, target_app_log
                ),
            );
        }
        return;
    };
    let valid = bounds.width > 0.0 && bounds.height > 0.0 && bounds.source != "fallback";
    if !valid {
        if let Ok(mut slot) = paste_target_bounds_cache().lock() {
            *slot = CachedFocusBounds::default();
        }
        log_to_file(
            "debug",
            "paste-focus",
            &format!(
                "snapshot skipped reason={} invalid bounds=({},{},{},{}) source={} frontmost={}",
                reason,
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height,
                bounds.source,
                target_app_log
            ),
        );
        return;
    }
    let cache = CachedFocusBounds {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        source: bounds.source.to_string(),
        valid: true,
        updated_at: now_millis().unwrap_or(0),
    };
    if let Ok(mut slot) = paste_target_bounds_cache().lock() {
        *slot = cache.clone();
    }
    log_to_file(
        "info",
        "paste-focus",
        &format!(
            "snapshot reason={} source={} bounds=({},{},{},{}) point=({},{}) frontmost={}",
            reason,
            bounds.source,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            paste_target_click_point(&cache).0,
            paste_target_click_point(&cache).1,
            target_app_log
        ),
    );
}

#[cfg(not(target_os = "macos"))]
fn snapshot_paste_target_bounds(_reason: &str, _fallback_point: Option<(f64, f64)>) {}

#[cfg(target_os = "macos")]
fn restore_paste_target_focus() -> String {
    let activation = activate_paste_target_app();
    let cache = match paste_target_bounds_cache().lock() {
        Ok(cache) => cache.clone(),
        Err(error) => return format!("restore=lock-failed {} error={}", activation, error),
    };
    if !cache.valid {
        return format!("restore=skipped reason=no-valid-target {}", activation);
    }
    let age_ms = now_millis().unwrap_or(0) - cache.updated_at;
    if age_ms > PASTE_TARGET_CACHE_MAX_AGE_MS {
        return format!(
            "restore=skipped reason=stale ageMs={} {}",
            age_ms, activation
        );
    }
    // 点击已禁用（见 click_paste_target_bounds 的说明）；这里仅 activate 恢复焦点，
    // 仍保留一次调用以维持调用链，并记录快照坐标供排查。
    let click_result = click_paste_target_bounds(&cache);
    if let Err(error) = click_result {
        return format!(
            "restore=failed source={} ageMs={} {} error={}",
            cache.source, age_ms, activation, error
        );
    }
    format!(
        "restore=activate-only source={} ageMs={} {} bounds=({},{},{},{})",
        cache.source, age_ms, activation, cache.x, cache.y, cache.width, cache.height
    )
}

#[cfg(target_os = "macos")]
fn frontmost_app_identity_including_self() -> Option<(String, String)> {
    // 原生 NSRunningApplication.frontmostApplication：无 TCC 授权依赖、亚毫秒返回。
    // 旧实现 fork osascript 查 System Events，本机单次 >1s 且 500ms 预算内必超时，
    // 导致粘贴目标 bundle 缓存长期为空、粘贴前无法激活目标 App（内容落不进输入框）。
    use tauri_nspanel::objc2_app_kit::NSWorkspace;
    let front = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let name = front
        .localizedName()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let bundle_id = front.bundleIdentifier()?.to_string();
    if bundle_id.trim().is_empty() {
        return None;
    }
    Some((name.trim().to_string(), bundle_id))
}

#[cfg(target_os = "macos")]
fn frontmost_app_identity() -> Option<(String, String)> {
    let (name, bundle_id) = frontmost_app_identity_including_self()?;
    if bundle_id.trim() == APP_BUNDLE_IDENTIFIER {
        return None;
    }
    Some((name, bundle_id))
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn is_clipforge_frontmost_identity(name: &str, bundle_id: &str) -> bool {
    bundle_id == APP_BUNDLE_IDENTIFIER
        || ((name == "ClipForge" || name == "clipforge")
            && (bundle_id == "missing value" || bundle_id.is_empty()))
}

#[cfg(target_os = "macos")]
fn activate_paste_target_app() -> String {
    let bundle_id = match paste_target_app_bundle_cache().lock() {
        Ok(value) => value.clone(),
        Err(error) => return format!("activate=lock-failed error={}", error),
    };
    if bundle_id.trim().is_empty() {
        return "activate=skipped reason=no-target-app".to_string();
    }
    match Command::new("open").arg("-b").arg(&bundle_id).output() {
        Ok(output) if output.status.success() => format!("activate=open-ok bundle={}", bundle_id),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr)
                .trim()
                .replace('\n', " ");
            format!(
                "activate=failed bundle={} status={} error={}",
                bundle_id, output.status, stderr
            )
        }
        Err(error) => format!("activate=failed bundle={} error={}", bundle_id, error),
    }
}

#[cfg(not(target_os = "macos"))]
fn restore_paste_target_focus() -> String {
    "restore=unsupported".to_string()
}

#[cfg(target_os = "macos")]
fn paste_target_click_point(cache: &CachedFocusBounds) -> (f64, f64) {
    if cache.source == "cursor-fallback" {
        return (cache.x, cache.y);
    }
    let x = if cache.source == "focused-caret" {
        cache.x + (cache.width / 2.0).clamp(1.0, 8.0)
    } else {
        cache.x + (cache.width / 2.0)
    };
    let y = cache.y + (cache.height / 2.0).clamp(1.0, cache.height.max(1.0));
    (x, y)
}

#[cfg(target_os = "macos")]
fn click_paste_target_bounds(_cache: &CachedFocusBounds) -> Result<(), String> {
    // 故意不再合成鼠标点击。旧实现会在【快照后最多 12 秒】的屏幕坐标上 post 真实左键点击，
    // 期间用户切窗 / 滚动 / 弹层，点击就会落到错误控件（提交 / 删除 / 链接 / 其它 App），
    // 不可逆且有数据风险。目标输入框的键盘焦点改由 activate_paste_target_app() 恢复
    // （activate 会把焦点交回该 App 面板出现前最后聚焦的控件）。保留签名以最小化改动面。
    Ok(())
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
    use core_foundation::base::CFRange;
    use core_foundation::string::CFString;
    use core_graphics::geometry::{CGPoint, CGRect, CGSize};

    const AX_ERROR_SUCCESS: i32 = 0;
    // AXValueType：1=CGPoint 2=CGSize 3=CFRange 4=CGRect（ApplicationServices/AXValue.h）。
    const AX_VALUE_POINT: usize = 1;
    const AX_VALUE_SIZE: usize = 2;
    const AX_VALUE_RANGE: usize = 3;
    const AX_VALUE_RECT: usize = 4;

    // 原生 AX 直查（辅助功能权限已授予）：系统级焦点应用 → 焦点元素 → 选区光标/元素 bounds。
    // 语义与旧 System Events AppleScript 一致：焦点是自身 → Err；读不到 → Err（上层退光标兜底）。
    unsafe {
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() {
            return Err("AXUIElementCreateSystemWide failed".to_string());
        }
        let result = (|| {
            let mut focused_app: *mut std::os::raw::c_void = std::ptr::null_mut();
            let status = AXUIElementCopyAttributeValue(
                system_wide,
                CFString::new("AXFocusedApplication").as_concrete_TypeRef(),
                &mut focused_app,
            );
            if status != AX_ERROR_SUCCESS || focused_app.is_null() {
                return Err(format!("AXFocusedApplication failed status={status}"));
            }
            let mut pid: i32 = 0;
            let pid_status = AXUIElementGetPid(focused_app, &mut pid);
            CFRelease(focused_app);
            if pid_status != AX_ERROR_SUCCESS {
                return Err(format!("AXUIElementGetPid failed status={pid_status}"));
            }
            if pid == std::process::id() as i32 {
                return Err("focused app is ClipForge itself".to_string());
            }

            let mut focused_element: *mut std::os::raw::c_void = std::ptr::null_mut();
            let element_status = AXUIElementCopyAttributeValue(
                system_wide,
                CFString::new("AXFocusedUIElement").as_concrete_TypeRef(),
                &mut focused_element,
            );
            if element_status != AX_ERROR_SUCCESS || focused_element.is_null() {
                return Err(format!("AXFocusedUIElement failed status={element_status}"));
            }

            // 1) 选区光标优先（AXSelectedTextRange → AXBoundsForRange → focused-caret）。
            let mut range_value: *mut std::os::raw::c_void = std::ptr::null_mut();
            let range_status = AXUIElementCopyAttributeValue(
                focused_element,
                CFString::new("AXSelectedTextRange").as_concrete_TypeRef(),
                &mut range_value,
            );
            if range_status == AX_ERROR_SUCCESS && !range_value.is_null() {
                let mut range = CFRange {
                    location: 0,
                    length: 0,
                };
                let has_range = AXValueGetValue(
                    range_value,
                    AX_VALUE_RANGE,
                    &mut range as *mut CFRange as *mut std::os::raw::c_void,
                ) != 0;
                CFRelease(range_value);
                if has_range {
                    let range_param = AXValueCreate(
                        AX_VALUE_RANGE,
                        &range as *const CFRange as *const std::os::raw::c_void,
                    );
                    if !range_param.is_null() {
                        let mut bounds_value: *mut std::os::raw::c_void = std::ptr::null_mut();
                        let bounds_status = AXUIElementCopyParameterizedAttributeValue(
                            focused_element,
                            CFString::new("AXBoundsForRange").as_concrete_TypeRef(),
                            range_param,
                            &mut bounds_value,
                        );
                        CFRelease(range_param);
                        if bounds_status == AX_ERROR_SUCCESS && !bounds_value.is_null() {
                            let mut rect = CGRect {
                                origin: CGPoint { x: 0.0, y: 0.0 },
                                size: CGSize {
                                    width: 0.0,
                                    height: 0.0,
                                },
                            };
                            let has_rect = AXValueGetValue(
                                bounds_value,
                                AX_VALUE_RECT,
                                &mut rect as *mut CGRect as *mut std::os::raw::c_void,
                            ) != 0;
                            CFRelease(bounds_value);
                            if has_rect && rect.size.width > 0.0 && rect.size.height > 0.0 {
                                return Ok(NativeBounds {
                                    x: rect.origin.x,
                                    y: rect.origin.y,
                                    width: rect.size.width,
                                    height: rect.size.height,
                                    source: "focused-caret",
                                });
                            }
                        }
                    }
                }
            }

            // 2) 退到焦点元素整体 bounds（AXPosition + AXSize → focused-input）。
            let mut position_value: *mut std::os::raw::c_void = std::ptr::null_mut();
            let position_status = AXUIElementCopyAttributeValue(
                focused_element,
                CFString::new("AXPosition").as_concrete_TypeRef(),
                &mut position_value,
            );
            let mut size_value: *mut std::os::raw::c_void = std::ptr::null_mut();
            let size_status = AXUIElementCopyAttributeValue(
                focused_element,
                CFString::new("AXSize").as_concrete_TypeRef(),
                &mut size_value,
            );
            if position_status != AX_ERROR_SUCCESS || size_status != AX_ERROR_SUCCESS {
                CFRelease(focused_element);
                return Err(format!(
                    "AXPosition/AXSize failed status={position_status}/{size_status}"
                ));
            }
            let mut point = CGPoint { x: 0.0, y: 0.0 };
            let mut size = CGSize {
                width: 0.0,
                height: 0.0,
            };
            let has_point = AXValueGetValue(
                position_value,
                AX_VALUE_POINT,
                &mut point as *mut CGPoint as *mut std::os::raw::c_void,
            ) != 0;
            let has_size = AXValueGetValue(
                size_value,
                AX_VALUE_SIZE,
                &mut size as *mut CGSize as *mut std::os::raw::c_void,
            ) != 0;
            CFRelease(position_value);
            CFRelease(size_value);
            CFRelease(focused_element);
            if has_point && has_size && size.width > 0.0 && size.height > 0.0 {
                return Ok(NativeBounds {
                    x: point.x,
                    y: point.y,
                    width: size.width,
                    height: size.height,
                    source: "focused-input",
                });
            }
            Err("focused element bounds unavailable".to_string())
        })();
        CFRelease(system_wide);
        result
    }
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
            message: "未获得辅助功能权限。主面板会快速显示在当前屏幕右侧，不再等待输入位置探测。"
                .to_string(),
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
    let prompt_key = unsafe {
        core_foundation::string::CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt)
    };
    let prompt_value = CFBoolean::true_value();
    let options =
        CFDictionary::from_CFType_pairs(&[(prompt_key.as_CFType(), prompt_value.as_CFType())]);
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
            message: "已请求 macOS 辅助功能授权。请在系统设置中勾选 ClipForge 或当前 dev 进程。"
                .to_string(),
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn request_accessibility_permission_platform() -> Result<AccessibilityPermissionPayload, String> {
    check_accessibility_permission_platform()
}

#[cfg(target_os = "macos")]
fn get_accessibility_diagnostics_platform() -> Result<AccessibilityDiagnosticsPayload, String> {
    let trusted = unsafe { AXIsProcessTrusted() != 0 };
    let executable_path = std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let app_bundle_path = current_app_bundle_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let target_for_codesign = if app_bundle_path.is_empty() {
        executable_path.clone()
    } else {
        app_bundle_path.clone()
    };
    let signature_output =
        command_output_for_log("codesign", &["-dv", "--verbose=4", &target_for_codesign])
            .unwrap_or_default();
    let requirement_output =
        command_output_for_log("codesign", &["-d", "-r-", &target_for_codesign])
            .unwrap_or_default();
    let code_signature_identifier = parse_codesign_field(&signature_output, "Identifier");
    let signature_kind = parse_codesign_field(&signature_output, "Signature");
    let team_identifier = parse_codesign_field(&signature_output, "TeamIdentifier");
    let cd_hash = parse_codesign_field(&signature_output, "CDHash");
    let designated_requirement = requirement_output
        .lines()
        .find_map(|line| line.trim().strip_prefix("# designated => "))
        .unwrap_or_default()
        .to_string();
    let (tcc_records, tcc_query_error) = query_accessibility_tcc_records();
    let message = if trusted {
        "当前运行的 ClipForge 已获得辅助功能权限。".to_string()
    } else if tcc_records.is_empty() {
        "当前运行的 ClipForge 未在 macOS 辅助功能授权库中找到匹配记录。请确认系统设置里勾选的是这里显示的当前应用路径。".to_string()
    } else {
        "检测到 ClipForge 相关授权记录，但当前进程仍未被系统信任；通常是旧构建/旧路径/旧签名残留，需要重置后重新授权。".to_string()
    };
    Ok(AccessibilityDiagnosticsPayload {
        trusted,
        expected_bundle_identifier: APP_BUNDLE_IDENTIFIER.to_string(),
        executable_path,
        app_bundle_path,
        code_signature_identifier,
        signature_kind,
        team_identifier,
        cd_hash,
        designated_requirement,
        tcc_records,
        tcc_query_error,
        message,
    })
}

#[cfg(not(target_os = "macos"))]
fn get_accessibility_diagnostics_platform() -> Result<AccessibilityDiagnosticsPayload, String> {
    Ok(AccessibilityDiagnosticsPayload {
        trusted: false,
        expected_bundle_identifier: APP_BUNDLE_IDENTIFIER.to_string(),
        executable_path: std::env::current_exe()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        app_bundle_path: String::new(),
        code_signature_identifier: "unsupported".to_string(),
        signature_kind: "unsupported".to_string(),
        team_identifier: "unsupported".to_string(),
        cd_hash: String::new(),
        designated_requirement: String::new(),
        tcc_records: Vec::new(),
        tcc_query_error: None,
        message: "当前平台不使用 macOS TCC 辅助功能授权。".to_string(),
    })
}

#[cfg(target_os = "macos")]
fn reset_accessibility_permission_platform() -> Result<AccessibilityPermissionPayload, String> {
    let status = Command::new("tccutil")
        .args(["reset", "Accessibility", APP_BUNDLE_IDENTIFIER])
        .status()
        .map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!(
            "tccutil reset Accessibility {} failed: {}",
            APP_BUNDLE_IDENTIFIER, status
        ));
    }
    log_to_file(
        "info",
        "accessibility",
        &format!(
            "reset Accessibility permission for {}",
            APP_BUNDLE_IDENTIFIER
        ),
    );
    check_accessibility_permission_platform()
}

#[cfg(not(target_os = "macos"))]
fn reset_accessibility_permission_platform() -> Result<AccessibilityPermissionPayload, String> {
    check_accessibility_permission_platform()
}

#[cfg(target_os = "macos")]
fn maybe_prompt_accessibility_on_first_panel<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    reason: &str,
) {
    if ACCESSIBILITY_FIRST_USE_PROMPT_CHECKED.swap(true, Ordering::SeqCst) {
        return;
    }
    let app_handle = app.clone();
    let reason_owned = reason.to_string();
    thread::spawn(move || {
        if accessibility_prompt_marker_path()
            .map(|path| path.exists())
            .unwrap_or(false)
        {
            log_to_file(
                "debug",
                "accessibility",
                "first-use permission prompt skipped: marker exists",
            );
            return;
        }

        let before = match check_accessibility_permission_platform() {
            Ok(payload) => payload,
            Err(error) => {
                log_to_file(
                    "warn",
                    "accessibility",
                    &format!("first-use permission check failed: {}", error),
                );
                return;
            }
        };

        let (status, message, prompted) = if before.status == "granted" {
            (
                before.status,
                "辅助功能权限已生效，无需首次授权引导。".to_string(),
                false,
            )
        } else {
            ACCESSIBILITY_PROMPTED.store(true, Ordering::SeqCst);
            log_to_file(
                "warn",
                "accessibility",
                &format!(
                    "first-use permission prompt requested, reason={} status_before={}",
                    reason_owned, before.status
                ),
            );
            match request_accessibility_permission_platform() {
                Ok(permission) => (permission.status, permission.message, true),
                Err(error) => ("error".to_string(), error, true),
            }
        };

        let created_at = now_millis().unwrap_or_default();
        let marker = json!({
            "schemaVersion": 1,
            "createdAt": created_at,
            "reason": reason_owned,
            "prompted": prompted,
            "status": status.clone(),
            "message": message.clone(),
            "bundleIdentifier": APP_BUNDLE_IDENTIFIER,
            "currentExe": std::env::current_exe().map(|path| path.to_string_lossy().to_string()).unwrap_or_default(),
            "note": "ClipForge only shows the automatic macOS Accessibility permission prompt once. Use Settings to request/reset it again."
        });
        if let Ok(path) = accessibility_prompt_marker_path() {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Err(error) = fs::write(
                &path,
                serde_json::to_string_pretty(&marker).unwrap_or_else(|_| "{}".to_string()),
            ) {
                log_to_file(
                    "warn",
                    "accessibility",
                    &format!("write first-use permission marker failed: {}", error),
                );
            }
        }

        let _ = app_handle.emit(
            "clipforge://accessibility-first-prompt",
            json!({
                "status": status.clone(),
                "message": message.clone(),
                "prompted": prompted,
                "createdAt": created_at,
            }),
        );

        if status == "granted" {
            log_to_file(
                "info",
                "accessibility",
                "first-use permission already granted in current process",
            );
            return;
        }

        for attempt in 1..=60 {
            thread::sleep(Duration::from_millis(500));
            if unsafe { AXIsProcessTrusted() != 0 } {
                log_to_file(
                    "info",
                    "accessibility",
                    &format!(
                        "first-use permission became active without restart after {}ms",
                        attempt * 500
                    ),
                );
                let _ = app_handle.emit(
                    "clipforge://accessibility-first-prompt",
                    json!({
                        "status": "granted",
                        "message": "辅助功能权限已在当前进程生效，可继续粘贴/键入。",
                        "prompted": prompted,
                        "createdAt": now_millis().unwrap_or_default(),
                    }),
                );
                return;
            }
        }

        log_to_file(
            "warn",
            "accessibility",
            "first-use permission still missing after prompt; if System Settings already shows enabled, restart ClipForge or reset stale TCC record from Settings",
        );
    });
}

#[cfg(not(target_os = "macos"))]
fn maybe_prompt_accessibility_on_first_panel<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _reason: &str,
) {
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let macos_dir = exe.parent()?;
    if macos_dir.file_name()?.to_string_lossy() != "MacOS" {
        return None;
    }
    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()?.to_string_lossy() != "Contents" {
        return None;
    }
    contents_dir.parent().map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn command_output_for_log(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(format!("{}{}", stdout, stderr))
}

#[cfg(target_os = "macos")]
fn parse_codesign_field(output: &str, key: &str) -> String {
    let prefix = format!("{}=", key);
    output
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix(&prefix)
                .map(|value| value.to_string())
        })
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn query_accessibility_tcc_records() -> (Vec<TccAccessibilityRecordPayload>, Option<String>) {
    let mut records = Vec::new();
    let mut errors = Vec::new();
    for (database, path) in accessibility_tcc_database_paths() {
        match query_accessibility_tcc_records_from_db(&database, &path) {
            Ok(mut next) => records.append(&mut next),
            Err(error) => errors.push(format!("{}: {}", database, error)),
        }
    }
    let error = if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    };
    (records, error)
}

#[cfg(target_os = "macos")]
fn accessibility_tcc_database_paths() -> Vec<(String, PathBuf)> {
    let mut paths = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        paths.push((
            "user".to_string(),
            home.join("Library")
                .join("Application Support")
                .join("com.apple.TCC")
                .join("TCC.db"),
        ));
    }
    paths.push((
        "system".to_string(),
        PathBuf::from("/Library")
            .join("Application Support")
            .join("com.apple.TCC")
            .join("TCC.db"),
    ));
    paths
}

#[cfg(target_os = "macos")]
fn query_accessibility_tcc_records_from_db(
    database: &str,
    path: &PathBuf,
) -> Result<Vec<TccAccessibilityRecordPayload>, String> {
    let conn = match Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(conn) => conn,
        Err(error) => return Err(format!("{}: {}", path.display(), error)),
    };
    let mut stmt = match conn.prepare(
        "SELECT client, client_type, auth_value, length(csreq), hex(csreq), datetime(last_modified, 'unixepoch') \
         FROM access \
         WHERE service = 'kTCCServiceAccessibility' \
           AND (lower(client) LIKE '%clipforge%' OR client = ?1) \
         ORDER BY last_modified DESC \
         LIMIT 12",
    ) {
        Ok(stmt) => stmt,
        Err(error) => return Err(error.to_string()),
    };
    let rows = match stmt.query_map([APP_BUNDLE_IDENTIFIER], |row| {
        let auth_value: i64 = row.get(2)?;
        let csreq_len: Option<i64> = row.get(3)?;
        let csreq_hex: Option<String> = row.get(4)?;
        Ok(TccAccessibilityRecordPayload {
            database: database.to_string(),
            client: row.get(0)?,
            client_type: row.get(1)?,
            auth_value,
            auth_label: tcc_auth_label(auth_value).to_string(),
            csreq_summary: summarize_tcc_csreq(
                csreq_len.unwrap_or(0),
                csreq_hex.as_deref().unwrap_or(""),
            ),
            last_modified: row.get(5)?,
        })
    }) {
        Ok(rows) => rows,
        Err(error) => return Err(error.to_string()),
    };
    let mut records = Vec::new();
    for row in rows {
        match row {
            Ok(record) => records.push(record),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(records)
}

#[cfg(target_os = "macos")]
fn summarize_tcc_csreq(byte_len: i64, hex: &str) -> String {
    let normalized = hex.trim().to_ascii_lowercase();
    if normalized.is_empty() || byte_len <= 0 {
        return "none".to_string();
    }
    if normalized.starts_with("fade0c0000000028000000010000000800000014") && normalized.len() >= 80
    {
        return format!("cdhash {}", &normalized[40..80]);
    }
    let identifier_hex = APP_BUNDLE_IDENTIFIER
        .as_bytes()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    if normalized.contains(&identifier_hex) {
        return format!("identifier {}", APP_BUNDLE_IDENTIFIER);
    }
    format!("blob {} bytes", byte_len)
}

#[cfg(target_os = "macos")]
#[allow(dead_code)] // 保留供 get_accessibility_diagnostics 只读诊断使用；已从粘贴热路径移除自动调用
fn current_code_signature_cd_hash() -> Option<String> {
    let executable_path = std::env::current_exe().ok()?;
    let target_for_codesign = current_app_bundle_path().unwrap_or(executable_path);
    let output = command_output_for_log(
        "codesign",
        &["-dv", "--verbose=4", &target_for_codesign.to_string_lossy()],
    )
    .ok()?;
    let cd_hash = parse_codesign_field(&output, "CDHash").to_ascii_lowercase();
    if cd_hash.is_empty() {
        None
    } else {
        Some(cd_hash)
    }
}

#[cfg(target_os = "macos")]
#[allow(dead_code)] // 保留供只读诊断使用；不再在粘贴路径自动触发（避免清掉自身授权）
fn stale_accessibility_cdhash_record(
    current_cd_hash: &str,
) -> Option<TccAccessibilityRecordPayload> {
    if current_cd_hash.is_empty() {
        return None;
    }
    let (records, _) = query_accessibility_tcc_records();
    records.into_iter().find(|record| {
        record.auth_value == 2
            && record.csreq_summary.starts_with("cdhash ")
            && !record.csreq_summary.ends_with(current_cd_hash)
    })
}

#[cfg(target_os = "macos")]
#[allow(dead_code)] // 仅保留给设置页「显式重置权限」调用；粘贴热路径不再自动 reset（会清掉自身授权）
fn reset_stale_accessibility_permission(
    record: &TccAccessibilityRecordPayload,
    current_cd_hash: &str,
) {
    if ACCESSIBILITY_STALE_RESET.swap(true, Ordering::SeqCst) {
        return;
    }
    log_to_file(
        "warn",
        "accessibility",
        &format!(
            "stale TCC Accessibility record detected: db={} client={} auth={} csreq={} currentCdHash={}; resetting bundle id once",
            record.database, record.client, record.auth_label, record.csreq_summary, current_cd_hash
        ),
    );
    match Command::new("tccutil")
        .args(["reset", "Accessibility", APP_BUNDLE_IDENTIFIER])
        .status()
    {
        Ok(status) if status.success() => {
            log_to_file(
                "info",
                "accessibility",
                &format!(
                    "stale Accessibility permission reset for {}",
                    APP_BUNDLE_IDENTIFIER
                ),
            );
        }
        Ok(status) => {
            log_to_file(
                "warn",
                "accessibility",
                &format!(
                    "stale Accessibility permission reset failed for {}: {}",
                    APP_BUNDLE_IDENTIFIER, status
                ),
            );
        }
        Err(error) => {
            log_to_file(
                "warn",
                "accessibility",
                &format!(
                    "stale Accessibility permission reset command failed: {}",
                    error
                ),
            );
        }
    }
}

fn tcc_auth_label(value: i64) -> &'static str {
    match value {
        0 => "denied",
        1 => "unknown",
        2 => "allowed",
        3 => "limited",
        _ => "unknown",
    }
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
    // 数据目录隔离（测试/开发专用）：设置 CLIPFORGE_DATA_DIR 后，设置、数据库、日志、
    // 图片缓存等全部数据都写到该目录，用于 tauri dev 并行验证真实交互而不触碰正式数据。
    // 未设置时保持原行为（~/Library/Application Support/ClipForge），生产环境不受影响。
    if let Ok(custom_dir) = std::env::var("CLIPFORGE_DATA_DIR") {
        let trimmed = custom_dir.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed).join("settings.json5"));
        }
    }
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

fn accessibility_prompt_marker_path() -> Result<PathBuf, String> {
    Ok(settings_path()?
        .parent()
        .ok_or_else(|| "settings parent is not available".to_string())?
        .join("accessibility-first-use.json"))
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

fn image_storage_path() -> Result<PathBuf, String> {
    Ok(settings_path()?
        .parent()
        .ok_or_else(|| "settings parent is not available".to_string())?
        .join("resources")
        .join("clipboard-images"))
}

pub(crate) fn open_clip_db() -> Result<Connection, String> {
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
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

pub(crate) fn init_schema(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if version < 2 {
        conn.execute_batch(
            "
            DROP TABLE IF EXISTS clip_fts;
            DROP TABLE IF EXISTS clips;
            DROP TABLE IF EXISTS clip_semantic_index;
            ",
        )
        .map_err(|error| error.to_string())?;
    }
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS clips (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            primary_format TEXT NOT NULL,
            available_formats TEXT NOT NULL DEFAULT '[]',
            representations_json TEXT NOT NULL DEFAULT '[]',
            plain_text TEXT NOT NULL DEFAULT '',
            search_text TEXT,
            sub_kind TEXT,
            width INTEGER,
            height INTEGER,
            size INTEGER,
            file_types TEXT,
            thumbnail_path TEXT,
            image_file TEXT,
            is_sensitive INTEGER NOT NULL DEFAULT 0,
            capture_context_json TEXT NOT NULL DEFAULT '{}',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            agent_context_json TEXT NOT NULL DEFAULT '{}',
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
            host TEXT,
            note TEXT NOT NULL DEFAULT '',
            pinned INTEGER NOT NULL DEFAULT 0,
            payload_kind TEXT NOT NULL DEFAULT 'text',
            use_count INTEGER NOT NULL DEFAULT 1,
            source_app_name TEXT NOT NULL DEFAULT '',
            source_app_bundle TEXT NOT NULL DEFAULT '',
            source_app_executable TEXT NOT NULL DEFAULT '',
            source_app_icon TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_content_hash ON clips(content_hash);
        CREATE INDEX IF NOT EXISTS idx_clips_recent ON clips(deleted_at, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clips_bucket_recent ON clips(bucket, deleted_at, last_seen_at DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS clip_fts USING fts5(id UNINDEXED, content, plain_text, search_text, title, summary, tags);
        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY,
            folder_id TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            shortcut TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS clip_semantic_index (
            clip_id TEXT PRIMARY KEY,
            model TEXT NOT NULL DEFAULT 'local-keyword',
            vector BLOB,
            keywords TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(clip_id) REFERENCES clips(id) ON DELETE CASCADE
        );
        PRAGMA user_version = 2;
        ",
    )
    .map_err(|error| error.to_string())?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_clips_pinned_recent ON clips(pinned DESC, last_seen_at DESC)", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn content_hash(kind: &str, content: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(kind.as_bytes());
    hasher.update(b":");
    hasher.update(content);
    hasher.finalize().to_hex().to_string()
}

fn primary_format_from_payload(payload_kind: &str) -> &'static str {
    match payload_kind {
        "image" => "image/png",
        "file" => "application/file-list",
        "html" => "text/html",
        "rtf" => "text/rtf",
        _ => "text/plain",
    }
}

fn payload_kind_from_primary_format(primary_format: &str, fallback: &str) -> String {
    match primary_format {
        "image/png" => "image".to_string(),
        "application/file-list" => "file".to_string(),
        "text/html" => "html".to_string(),
        "text/rtf" => "rtf".to_string(),
        "text/uri-list" => "link".to_string(),
        _ => fallback.to_string(),
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for raw_tag in tags {
        let trimmed = raw_tag.trim().trim_start_matches('#').trim();
        let tag = trimmed
            .strip_prefix("tag:")
            .or_else(|| trimmed.strip_prefix("TAG:"))
            .unwrap_or(trimmed)
            .trim()
            .chars()
            .take(32)
            .collect::<String>();
        if tag.is_empty() {
            continue;
        }
        if out
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&tag))
        {
            continue;
        }
        out.push(tag);
        if out.len() >= 12 {
            break;
        }
    }
    out
}

fn build_representations(content: &str, payload_kind: &str) -> Vec<ClipboardRepresentationPayload> {
    let primary_format = primary_format_from_payload(payload_kind).to_string();
    let size = content.as_bytes().len() as i64;
    let hash = content_hash(&primary_format, content.as_bytes());
    vec![ClipboardRepresentationPayload {
        format: primary_format,
        storage: "inline".to_string(),
        content: Some(content.to_string()),
        file_name: None,
        size: Some(size),
        hash: Some(hash),
        preferred: true,
    }]
}

fn json_string<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn parse_json_value(raw: String) -> Value {
    serde_json::from_str(&raw).unwrap_or_else(|_| json!({}))
}

fn parse_json_vec_string(raw: String) -> Vec<String> {
    serde_json::from_str(&raw).unwrap_or_default()
}

fn parse_representations(raw: String) -> Vec<ClipboardRepresentationPayload> {
    serde_json::from_str(&raw).unwrap_or_default()
}

/// 应用上下文包含 URL、窗口标题和工作区线索，默认开启但允许用户关闭敏感来源采集。
fn should_capture_application_context() -> bool {
    read_user_settings()
        .ok()
        .and_then(|payload| {
            payload
                .settings
                .get("captureApplicationContext")
                .and_then(Value::as_bool)
        })
        .unwrap_or(true)
}

fn make_capture_context(
    source_label: &str,
    source_app: Option<&SourceAppInfo>,
    application_context: Option<Value>,
    observed_at: i64,
    primary_format: &str,
    available_formats: &[String],
    delayed_external_context: bool,
) -> CaptureContextPayload {
    CaptureContextPayload {
        schema_version: 2,
        surface: "clipboard".to_string(),
        source_label: source_label.to_string(),
        source_app: source_app.map(|app| {
            json!({
                "name": app.name,
                "bundleId": app.bundle_id,
                "executablePath": app.executable_path,
                "hasIcon": app.icon_base64.is_some(),
            })
        }),
        application_context,
        collectors: json!({
            "status": if delayed_external_context { "pending" } else { "not-requested" },
            "results": [],
            "diagnostics": [],
        }),
        observed_at,
        primary_format: primary_format.to_string(),
        available_formats: available_formats.to_vec(),
        environment: json!({
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "appVersion": env!("CARGO_PKG_VERSION"),
        }),
    }
}

fn detect_payload_kind(content: &str) -> String {
    clipboard::detect_text(content).payload_kind
}

pub(crate) fn now_millis() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64)
}

pub(crate) fn analyze_clip(content: &str, source_label: &str) -> ClipAnalysisPayload {
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

pub(crate) fn analysis_kind(analysis: &ClipAnalysisPayload) -> String {
    if analysis.url.is_some() {
        "link"
    } else if analysis.is_markdown {
        "markdown"
    } else {
        "text"
    }
    .to_string()
}

fn analysis_kind_from_payload(payload_kind: &str) -> String {
    match payload_kind {
        "html" | "rtf" | "file" | "image" => "attachment",
        "json" | "chart" | "table" => payload_kind,
        "markdown" => "markdown",
        _ => "text",
    }
    .to_string()
}

pub(crate) fn default_tags(analysis: &ClipAnalysisPayload, content: &str) -> Vec<String> {
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
    for token in content.split_whitespace() {
        let tag = token
            .trim_matches(|ch: char| {
                matches!(
                    ch,
                    '#' | ',' | '.' | ';' | ':' | '!' | '?' | ')' | ']' | '}' | '"' | '\''
                )
            })
            .trim_start_matches('#');
        if token.starts_with('#') && !tag.is_empty() {
            tags.push(tag.to_string());
        }
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
        "INSERT INTO clip_fts(id, content, plain_text, search_text, title, summary, tags)
         SELECT id, content, plain_text, COALESCE(search_text, plain_text), title, summary, tags FROM clips WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn load_clip(conn: &Connection, id: &str) -> Result<ClipItemPayload, String> {
    conn.query_row(
        "SELECT id, content, content_hash, primary_format, available_formats, representations_json,
                plain_text, search_text, sub_kind, width, height, size, file_types, thumbnail_path,
                image_file, is_sensitive, capture_context_json, metadata_json, agent_context_json,
                kind, bucket, source_label, favorite, tags, copy_count,
                created_at, updated_at, last_seen_at, last_copied_at, title, summary, url, host,
                source_app_name, source_app_bundle, source_app_executable, source_app_icon, payload_kind
         FROM clips WHERE id = ?1",
        params![id],
        |row| {
            let tags_raw: String = row.get(23)?;
            let title: String = row.get(29)?;
            let summary: String = row.get(30)?;
            let url: Option<String> = row.get(31)?;
            let host: Option<String> = row.get(32)?;
            let source: String = row.get(21)?;
            let source_app_name: String = row.get(33)?;
            let source_app_bundle: String = row.get(34)?;
            let source_app_executable: String = row.get(35)?;
            let source_app_icon: Option<String> = row.get(36)?;
            let primary_format: String = row.get(3)?;
            let payload_kind_raw: String = row.get(37)?;
            let payload_kind = payload_kind_from_primary_format(&primary_format, &payload_kind_raw);
            let available_formats = parse_json_vec_string(row.get(4)?);
            let representations = parse_representations(row.get(5)?);
            let capture_context = serde_json::from_str::<CaptureContextPayload>(&row.get::<_, String>(16)?)
                .unwrap_or_else(|_| CaptureContextPayload {
                    schema_version: 1,
                    surface: "clipboard".to_string(),
                    source_label: source.clone(),
                    source_app: None,
                    application_context: None,
                    collectors: json!({
                        "status": "not-requested",
                        "results": [],
                        "diagnostics": ["capture context was not readable"],
                    }),
                    observed_at: row.get::<_, i64>(27).unwrap_or_default(),
                    primary_format: primary_format.clone(),
                    available_formats: available_formats.clone(),
                    environment: json!({}),
                });
            let is_markdown = summary.contains("```") || payload_kind == "markdown";
            let source_app = if source_app_name.is_empty() {
                None
            } else {
                Some(SourceAppPayload {
                    name: source_app_name,
                    bundle_id: source_app_bundle,
                    executable_path: source_app_executable,
                    icon_base64: source_app_icon,
                })
            };
            Ok(ClipItemPayload {
                id: row.get(0)?,
                content: row.get(1)?,
                content_hash: row.get(2)?,
                kind: row.get(19)?,
                bucket: row.get(20)?,
                source: source.clone(),
                favorite: row.get::<_, i64>(22)? == 1,
                tags: tags_raw
                    .split(',')
                    .filter(|tag| !tag.is_empty())
                    .map(ToString::to_string)
                    .collect(),
                copy_count: row.get(24)?,
                created_at: row.get(25)?,
                updated_at: row.get(26)?,
                last_seen_at: row.get(27)?,
                last_copied_at: row.get(28)?,
                analysis: ClipAnalysisPayload {
                    source_name: source,
                    badge: if url.is_some() { "URL" } else { "T" }.to_string(),
                    title,
                    summary,
                    url,
                    host,
                    is_markdown,
                },
                payload_kind,
                primary_format,
                available_formats,
                representations,
                plain_text: row.get(6)?,
                search_text: row.get(7)?,
                sub_kind: row.get(8)?,
                width: row.get(9)?,
                height: row.get(10)?,
                size: row.get(11)?,
                file_types: row.get(12)?,
                thumbnail_path: row.get(13)?,
                image_file: row.get(14)?,
                is_sensitive: row.get::<_, i64>(15)? == 1,
                capture_context,
                metadata: parse_json_value(row.get(17)?),
                agent_context: parse_json_value(row.get(18)?),
                source_app,
            })
        },
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            command_error("CLIP_NOT_FOUND", format!("clip not found: {id}"))
        }
        other => command_error("CLIP_LOAD_FAILED", other.to_string()),
    })
}

fn export_items(conn: &Connection, include_deleted: bool) -> Result<Vec<Value>, String> {
    let sql = if include_deleted {
        "SELECT id, content, kind, bucket, source_label, favorite, tags, copy_count,
                created_at, updated_at, last_seen_at, last_copied_at, deleted_at,
                title, summary, url, host, note, pinned, payload_kind, use_count
         FROM clips ORDER BY last_seen_at DESC"
    } else {
        "SELECT id, content, kind, bucket, source_label, favorite, tags, copy_count,
                created_at, updated_at, last_seen_at, last_copied_at, deleted_at,
                title, summary, url, host, note, pinned, payload_kind, use_count
         FROM clips WHERE deleted_at IS NULL ORDER BY last_seen_at DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "content": row.get::<_, String>(1)?,
                "kind": row.get::<_, String>(2)?,
                "bucket": row.get::<_, String>(3)?,
                "sourceLabel": row.get::<_, String>(4)?,
                "favorite": row.get::<_, i64>(5)? == 1,
                "tags": row.get::<_, String>(6)?.split(',').filter(|tag| !tag.is_empty()).map(ToString::to_string).collect::<Vec<_>>(),
                "copyCount": row.get::<_, i64>(7)?,
                "createdAt": row.get::<_, i64>(8)?,
                "updatedAt": row.get::<_, i64>(9)?,
                "lastSeenAt": row.get::<_, i64>(10)?,
                "lastCopiedAt": row.get::<_, Option<i64>>(11)?,
                "deletedAt": row.get::<_, Option<i64>>(12)?,
                "title": row.get::<_, String>(13)?,
                "summary": row.get::<_, String>(14)?,
                "url": row.get::<_, Option<String>>(15)?,
                "host": row.get::<_, Option<String>>(16)?,
                "note": row.get::<_, String>(17)?,
                "pinned": row.get::<_, i64>(18)? == 1,
                "payloadKind": row.get::<_, String>(19)?,
                "useCount": row.get::<_, i64>(20)?,
            }))
        })
        .map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}

fn import_items(
    conn: &Connection,
    items: Vec<ImportClipInput>,
) -> Result<ImportClipPayload, String> {
    let mut imported = 0;
    let mut skipped = 0;
    for item in items {
        let content = item.content.trim().to_string();
        if content.is_empty() {
            skipped += 1;
            continue;
        }
        let now = now_millis()?;
        let payload_kind = detect_payload_kind(&content);
        let hash = content_hash(&payload_kind, content.as_bytes());
        let id = item.id.unwrap_or_else(|| format!("clip_{hash}_{now}"));
        let analysis = analyze_clip(&content, item.source_label.as_deref().unwrap_or("Import"));
        let tags = item
            .tags
            .unwrap_or_else(|| default_tags(&analysis, &content))
            .join(",");
        let created_at = item.created_at.unwrap_or(now);
        let updated_at = item.updated_at.unwrap_or(created_at);
        let last_seen_at = item.last_seen_at.unwrap_or(updated_at);
        let kind = item.kind.unwrap_or_else(|| analysis_kind(&analysis));
        let bucket = item.bucket.unwrap_or_else(|| "history".to_string());
        let source_label = item.source_label.unwrap_or_else(|| "Import".to_string());
        conn.execute(
            "INSERT INTO clips (
                id, content, content_hash, kind, bucket, source, source_label, favorite, tags,
                copy_count, created_at, updated_at, last_seen_at, title, summary, url, host,
                note, pinned, payload_kind, use_count
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'import', ?6, ?7, ?8, 0, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 1)
            ON CONFLICT(content_hash) DO UPDATE SET
                last_seen_at = excluded.last_seen_at,
                updated_at = excluded.updated_at,
                deleted_at = NULL",
            params![
                id,
                content,
                hash,
                kind,
                bucket,
                source_label,
                if item.favorite.unwrap_or(false) { 1 } else { 0 },
                tags,
                created_at,
                updated_at,
                last_seen_at,
                analysis.title,
                analysis.summary,
                analysis.url,
                analysis.host,
                item.note.unwrap_or_default(),
                if item.pinned.unwrap_or(false) { 1 } else { 0 },
                payload_kind,
            ],
        )
        .map_err(|error| error.to_string())?;
        let target_id: String = conn
            .query_row(
                "SELECT id FROM clips WHERE content_hash = ?1 LIMIT 1",
                params![hash],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        upsert_fts(conn, &target_id)?;
        imported += 1;
    }
    Ok(ImportClipPayload { imported, skipped })
}

#[tauri::command]
fn check_file_paths(paths: Vec<String>) -> Result<Vec<FilePathStatusPayload>, String> {
    Ok(paths
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .map(|path| {
            let normalized = normalize_file_path_for_check(&path);
            let metadata = fs::metadata(&normalized).ok();
            FilePathStatusPayload {
                path,
                exists: metadata.is_some(),
                is_file: metadata.as_ref().is_some_and(|meta| meta.is_file()),
                is_dir: metadata.as_ref().is_some_and(|meta| meta.is_dir()),
            }
        })
        .collect())
}

fn normalize_file_path_for_check(path: &str) -> PathBuf {
    let trimmed = path.trim();
    let without_scheme = trimmed.strip_prefix("file://").unwrap_or(trimmed);
    if let Some(rest) = without_scheme.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            return home.join(rest);
        }
    }
    PathBuf::from(without_scheme)
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

pub(crate) fn suppress_writeback_for(duration: Duration) {
    WRITEBACK_SUPPRESS.store(true, Ordering::SeqCst);
    thread::spawn(move || {
        thread::sleep(duration);
        WRITEBACK_SUPPRESS.store(false, Ordering::SeqCst);
    });
}

fn should_skip_writeback() -> bool {
    WRITEBACK_SUPPRESS.load(Ordering::SeqCst)
}

#[cfg(target_os = "macos")]
fn paste_accessibility_status_for_log() -> String {
    if unsafe { AXIsProcessTrusted() != 0 } {
        "granted".to_string()
    } else {
        "missing".to_string()
    }
}

#[cfg(not(target_os = "macos"))]
fn paste_accessibility_status_for_log() -> String {
    "unsupported".to_string()
}

#[cfg(target_os = "macos")]
fn ensure_paste_accessibility_permission() -> Result<(), String> {
    if unsafe { AXIsProcessTrusted() != 0 } {
        return Ok(());
    }
    // 注意：绝不在粘贴热路径上自动 `tccutil reset`。那会清掉 ClipForge 自己的辅助功能授权，
    // 之后 AXIsProcessTrusted() 持续为 false，导致每次粘贴都被这里 abort —— 自我放大成
    // 永久粘贴失败，直到用户重新授权并重启。stale cdhash 的只读检测 / 显式重置只在
    // get_accessibility_diagnostics 与手动「重置权限」里进行；重置后只读状态并引导用户去系统设置。
    if ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst) {
        log_to_file(
            "warn",
            "paste",
            "macOS accessibility permission still missing; prompt already requested in this process",
        );
        return Err(
            "macOS 辅助功能权限仍未对当前 ClipForge 生效。请在系统设置 > 隐私与安全性 > 辅助功能中勾选当前 ClipForge，然后重启 ClipForge 或在设置页刷新状态。".to_string(),
        );
    }
    log_to_file(
        "warn",
        "paste",
        "macOS accessibility permission missing before paste; requesting permission prompt",
    );
    let permission = request_accessibility_permission_platform()?;
    if permission.status == "granted" {
        return Ok(());
    }
    Err(format!(
        "macOS 辅助功能权限未开启，系统会拦截自动粘贴按键。请在系统设置 > 隐私与安全性 > 辅助功能中允许 ClipForge 后重试。status={}",
        permission.status
    ))
}

#[cfg(not(target_os = "macos"))]
fn ensure_paste_accessibility_permission() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn frontmost_app_for_log() -> String {
    let script = r#"
tell application "System Events"
    set frontApp to first application process whose frontmost is true
    set appName to name of frontApp
    set bundleId to bundle identifier of frontApp
    return appName & "|" & bundleId
end tell
"#;
    let output = Command::new("osascript").arg("-e").arg(script).output();
    match output {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if raw.is_empty() {
                "unknown".to_string()
            } else {
                raw
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                "unavailable".to_string()
            } else {
                format!("unavailable:{}", stderr.replace('\n', " "))
            }
        }
        Err(error) => format!("unavailable:{}", error),
    }
}

#[cfg(not(target_os = "macos"))]
fn frontmost_app_for_log() -> String {
    "unsupported".to_string()
}

#[cfg(target_os = "macos")]
fn focused_ui_for_log() -> String {
    let script = r#"
tell application "System Events"
    set frontApp to first application process whose frontmost is true
    set appName to name of frontApp
    set bundleId to bundle identifier of frontApp
    try
        set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
        set roleValue to ""
        set subroleValue to ""
        set titleValue to ""
        try
            set roleValue to value of attribute "AXRole" of focusedElement
        end try
        try
            set subroleValue to value of attribute "AXSubrole" of focusedElement
        end try
        try
            set titleValue to value of attribute "AXTitle" of focusedElement
        end try
        return appName & "|" & bundleId & "|role=" & roleValue & "|subrole=" & subroleValue & "|title=" & titleValue
    on error errMsg
        return appName & "|" & bundleId & "|focusError=" & errMsg
    end try
end tell
"#;
    let output = Command::new("osascript").arg("-e").arg(script).output();
    match output {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if raw.is_empty() {
                "unknown".to_string()
            } else {
                raw.replace('\n', " ")
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if stderr.is_empty() {
                "unavailable".to_string()
            } else {
                format!("unavailable:{}", stderr.replace('\n', " "))
            }
        }
        Err(error) => format!("unavailable:{}", error),
    }
}

#[cfg(not(target_os = "macos"))]
fn focused_ui_for_log() -> String {
    "unsupported".to_string()
}

#[cfg(target_os = "macos")]
fn panel_state_for_log<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    if let Ok(panel) = app.get_webview_panel("main") {
        return format!("panelVisible={}", panel.is_visible());
    }
    if let Some(window) = app.get_webview_window("main") {
        return format!(
            "windowVisible={} focused={}",
            window.is_visible().unwrap_or(false),
            window.is_focused().unwrap_or(false)
        );
    }
    "unavailable".to_string()
}

#[cfg(not(target_os = "macos"))]
fn panel_state_for_log<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    if let Some(window) = app.get_webview_window("main") {
        return format!(
            "windowVisible={} focused={}",
            window.is_visible().unwrap_or(false),
            window.is_focused().unwrap_or(false)
        );
    }
    "unavailable".to_string()
}

fn wait_for_panel_release_before_paste<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    timeout: Duration,
) -> u128 {
    if is_panel_pinned() {
        return 0;
    }
    let started = std::time::Instant::now();
    loop {
        let elapsed = started.elapsed();
        if elapsed >= timeout {
            return elapsed.as_millis();
        }
        let released = panel_released_for_paste(app);
        if released {
            return elapsed.as_millis();
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(target_os = "macos")]
fn panel_released_for_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    if let Ok(panel) = app.get_webview_panel("main") {
        if panel.is_visible() {
            return false;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        return !window.is_focused().unwrap_or(false);
    }
    true
}

#[cfg(not(target_os = "macos"))]
fn panel_released_for_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        return !window.is_visible().unwrap_or(false) && !window.is_focused().unwrap_or(false);
    }
    true
}

/// 粘贴热路径是否输出 osascript 级诊断（frontmost/focusedUi 每次 fork osascript ~80-230ms）。
/// 默认关闭；排查时设环境变量 CLIPFORGE_VERBOSE_PASTE=1 开启。
fn paste_verbose_diagnostics() -> bool {
    std::env::var("CLIPFORGE_VERBOSE_PASTE")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn paste_settle_delay_ms(source: &str) -> u64 {
    match source {
        "cmd-number" => 50,
        "enter" => 40,
        "click" => 30,
        _ => 40,
    }
}

#[cfg(target_os = "macos")]
fn hide_panel_before_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if is_panel_pinned() {
        log_to_file(
            "info",
            "paste",
            "hide before paste skipped because panel is pinned",
        );
        return;
    }
    if let Ok(panel) = app.get_webview_panel("main") {
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide panel before paste: visibleBefore={}",
                panel.is_visible()
            ),
        );
        panel.resign_key_window();
        panel.hide();
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide panel before paste: visibleAfter={}",
                panel.is_visible()
            ),
        );
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide window before paste fallback: visibleBefore={} focusedBefore={}",
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false)
            ),
        );
        let _ = window.hide();
    }
}

#[cfg(not(target_os = "macos"))]
fn hide_panel_before_paste<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if is_panel_pinned() {
        log_to_file(
            "info",
            "paste",
            "hide before paste skipped because panel is pinned",
        );
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        log_to_file(
            "debug",
            "paste",
            &format!(
                "hide window before paste: visibleBefore={} focusedBefore={}",
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false)
            ),
        );
        let _ = window.hide();
    }
}

#[cfg(target_os = "macos")]
fn simulate_platform_paste() -> Result<String, String> {
    let mut errors = Vec::new();
    match simulate_cg_event_paste(CGEventTapLocation::HID, "HID") {
        Ok(details) => return Ok(details),
        Err(error) => errors.push(error),
    }
    match simulate_cg_event_paste(CGEventTapLocation::Session, "Session") {
        Ok(details) => return Ok(details),
        Err(error) => errors.push(error),
    }
    match simulate_system_events_paste() {
        Ok(details) => Ok(details),
        Err(error) => {
            errors.push(error);
            Err(errors.join("; "))
        }
    }
}

#[cfg(target_os = "macos")]
fn simulate_system_events_paste() -> Result<String, String> {
    let script = r#"tell application "System Events" to keystroke "v" using command down"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("system-events paste spawn failed: {}", error))?;
    if output.status.success() {
        return Ok("method=system-events sequence=keystroke-command-v".to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr)
        .trim()
        .replace('\n', " ");
    if stderr.is_empty() {
        Err(format!("system-events paste exited with {}", output.status))
    } else {
        Err(format!(
            "system-events paste exited with {}: {}",
            output.status, stderr
        ))
    }
}

#[cfg(target_os = "macos")]
fn simulate_cg_event_paste(tap: CGEventTapLocation, tap_label: &str) -> Result<String, String> {
    const KEY_COMMAND: u16 = 0x37;
    const KEY_V: u16 = 0x09;
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "create CGEventSource failed".to_string())?;

    post_keyboard_event(
        &source,
        KEY_COMMAND,
        true,
        CGEventFlags::CGEventFlagCommand,
        tap,
    )?;
    thread::sleep(Duration::from_millis(12));
    post_keyboard_event(&source, KEY_V, true, CGEventFlags::CGEventFlagCommand, tap)?;
    thread::sleep(Duration::from_millis(24));
    post_keyboard_event(&source, KEY_V, false, CGEventFlags::CGEventFlagCommand, tap)?;
    thread::sleep(Duration::from_millis(12));
    post_keyboard_event(
        &source,
        KEY_COMMAND,
        false,
        CGEventFlags::CGEventFlagNull,
        tap,
    )?;

    Ok(format!(
        "method=cg-event tap={} sequence=command-down,v-down,v-up,command-up",
        tap_label
    ))
}

#[cfg(target_os = "macos")]
fn post_keyboard_event(
    source: &CGEventSource,
    keycode: u16,
    key_down: bool,
    flags: CGEventFlags,
    tap: CGEventTapLocation,
) -> Result<(), String> {
    let event = CGEvent::new_keyboard_event(source.clone(), keycode, key_down).map_err(|_| {
        format!(
            "create key event failed keycode={} down={}",
            keycode, key_down
        )
    })?;
    event.set_flags(flags);
    event.post(tap);
    Ok(())
}

#[cfg(target_os = "windows")]
fn simulate_platform_paste() -> Result<String, String> {
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
                Ok("simulator=powershell".to_string())
            } else {
                Err(format!("powershell paste exited with {status}"))
            }
        })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn simulate_platform_paste() -> Result<String, String> {
    for (program, args) in [
        ("wtype", vec!["-M", "ctrl", "v", "-m", "ctrl"]),
        ("xdotool", vec!["key", "ctrl+v"]),
    ] {
        if let Ok(status) = Command::new(program).args(args).status() {
            if status.success() {
                return Ok(format!("simulator={}", program));
            }
        }
    }
    Err("No supported paste simulator found. Install wtype or xdotool.".to_string())
}

/// 托盘菜单 id（用于切换监听状态后通过 app.tray_by_id 重建菜单刷新文案）。
const TRAY_ID: &str = "main-tray";

#[cfg(target_os = "macos")]
fn log_runtime_identity() {
    match get_accessibility_diagnostics_platform() {
        Ok(diagnostics) => {
            let tcc_summary = diagnostics
                .tcc_records
                .iter()
                .map(|record| {
                    format!(
                        "{}:{}:{}:{}",
                        record.database, record.client, record.auth_label, record.csreq_summary
                    )
                })
                .collect::<Vec<_>>()
                .join("|");
            log_to_file(
                "info",
                "startup",
                &format!(
                    "runtime identity bundleId={} signatureId={} signatureKind={} cdHash={} trusted={} appPath={} tccRecords={} tccError={}",
                    diagnostics.expected_bundle_identifier,
                    diagnostics.code_signature_identifier,
                    diagnostics.signature_kind,
                    diagnostics.cd_hash,
                    diagnostics.trusted,
                    diagnostics.app_bundle_path,
                    tcc_summary,
                    diagnostics.tcc_query_error.unwrap_or_default()
                ),
            );
        }
        Err(error) => log_to_file(
            "warn",
            "startup",
            &format!("runtime identity diagnostics failed: {}", error),
        ),
    }
}

#[cfg(not(target_os = "macos"))]
fn log_runtime_identity() {}

/// 构建托盘右键菜单。监听开关的文案随 LISTEN_PAUSED 当前状态变化，
/// 因此切换后调用方需 set_menu 重建以刷新显示。
fn build_tray_menu<R: tauri::Runtime, M: Manager<R>>(manager: &M) -> Result<Menu<R>, String> {
    let open_quick = MenuItemBuilder::with_id("open_quick", native_tr("tray.openQuick"))
        .accelerator(&current_global_shortcut_value())
        .build(manager)
        .map_err(|e| e.to_string())?;
    let preferences = MenuItemBuilder::with_id("preferences", native_tr("tray.preferences"))
        .build(manager)
        .map_err(|e| e.to_string())?;
    let listen_label = if is_listen_paused() {
        native_tr("tray.resumeListening")
    } else {
        native_tr("tray.pauseListening")
    };
    let toggle_listen = MenuItemBuilder::with_id("toggle_listen", listen_label)
        .build(manager)
        .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id("quit", native_tr("tray.quit"))
        .build(manager)
        .map_err(|e| e.to_string())?;
    Menu::with_items(manager, &[&open_quick, &preferences, &toggle_listen, &quit])
        .map_err(|e| e.to_string())
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        configure_quick_panel_window(&window);
        #[cfg(target_os = "macos")]
        {
            if let Ok(panel) = app.get_webview_panel("main") {
                panel.hide();
            } else {
                let _ = window.hide();
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = window.hide();
        }
    }
    let app_handle = app.handle().clone();
    sync_global_shortcut_registration(&app_handle);
    log_to_file(
        "info",
        "startup",
        &format!(
            "ClipForge {} starting, activationPolicy=Accessory, shortcut={}",
            APP_VERSION,
            current_global_shortcut_value()
        ),
    );
    log_runtime_identity();
    log_environment_snapshot("startup");
    if let Err(error) = start_mcp_server_with_reason("app-startup") {
        log_to_file(
            "warn",
            "mcp",
            &format!("auto start MCP server failed: {}", error),
        );
    }
    let menu = build_tray_menu(app)?;
    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("ClipForge")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_quick" => show_quick_panel(app, "tray"),
            "preferences" => {
                if let Err(e) = open_settings_window(app.clone()) {
                    log_to_file("warn", "tray", &format!("open settings failed: {}", e));
                }
            }
            "toggle_listen" => {
                let next_paused = !is_listen_paused();
                set_listen_paused(next_paused);
                log_to_file(
                    "info",
                    "clipboard-monitor",
                    if next_paused {
                        "listen paused (toggle from tray)"
                    } else {
                        "listen resumed (toggle from tray)"
                    },
                );
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    match build_tray_menu(app) {
                        Ok(new_menu) => {
                            if let Err(e) = tray.set_menu(Some(new_menu)) {
                                log_to_file("warn", "tray", &format!("set_menu failed: {}", e));
                            }
                        }
                        Err(e) => {
                            log_to_file("warn", "tray", &format!("rebuild menu failed: {}", e))
                        }
                    }
                }
            }
            "quit" => {
                cleanup_agent_children();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
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

    // 启动时从持久化设置恢复面板固定状态，保证 Rust 静态与前端 settings 一致：
    // 否则重启后前端读到 panelPinned=true（黑按钮）但 Rust PANEL_PINNED 仍为 false，
    // 任何走 Rust hide_panel 的路径（托盘/快捷键 toggle/命令）会误隐藏已固定面板。
    if let Ok(settings) = read_user_settings() {
        sync_launch_at_login_from_settings(&app_handle, &settings.settings, "app-startup");
        if let Some(pinned) = settings
            .settings
            .get("panelPinned")
            .and_then(Value::as_bool)
        {
            PANEL_PINNED.store(pinned, Ordering::Relaxed);
            log_to_file(
                "debug",
                "panel-pin",
                &format!("restored pinned={} from settings on startup", pinned),
            );
        }
    }
    maybe_open_onboarding_on_startup(app.handle().clone());

    // 启动后台剪贴板监听：脱离 WebView，隐藏时也能工作。
    // 监听、去重、设置过滤和入库统一收敛在 clipboard::watcher，避免保留第二条采集路径。
    clipboard::watcher::init(app.handle().clone());

    #[cfg(debug_assertions)]
    schedule_dev_window_trigger(app.handle().clone());

    Ok(())
}

#[cfg(debug_assertions)]
fn schedule_dev_window_trigger<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    let Ok(target) = std::env::var("CLIPFORGE_DEV_OPEN") else {
        return;
    };
    let target = target.trim().to_ascii_lowercase();
    if target.is_empty() {
        return;
    }

    // 仅用于 `pnpm tauri dev` 的验收入口：默认窗口仍保持 hidden，不改变正式产品启动行为。
    thread::spawn(move || {
        if matches!(target.as_str(), "panel" | "quick" | "quick-panel") {
            prepare_dev_quick_probe_target(app.clone());
        }
        thread::sleep(std::time::Duration::from_millis(900));
        let target_for_main = target.clone();
        let app_for_main = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let result = match target_for_main.as_str() {
                "panel" | "quick" | "quick-panel" => {
                    open_panel(&app_for_main, "dev-open").map(|_| ())
                }
                "settings"
                | "settings:forms"
                | "settings:code-tabs"
                | "settings:tooltip"
                | "settings:diagnostics"
                | "settings:interactions" => {
                    open_settings_window(app_for_main.clone())
                }
                "settings:onboarding" | "onboarding" => {
                    open_settings_window_internal(app_for_main.clone(), Some("onboarding"))
                }
                value => Err(format!(
                    "Unsupported CLIPFORGE_DEV_OPEN value: {} (expected panel/settings/settings:forms/settings:code-tabs/settings:tooltip/settings:diagnostics/settings:interactions/settings:onboarding)",
                    value
                )),
            };
            match result {
                Ok(()) => {
                    log_to_file(
                        "info",
                        "dev-open",
                        &format!("CLIPFORGE_DEV_OPEN={} triggered", target_for_main),
                    );
                    schedule_dev_perf_probe(app_for_main.clone(), target_for_main.clone());
                }
                Err(error) => log_to_file(
                    "warn",
                    "dev-open",
                    &format!("CLIPFORGE_DEV_OPEN={} failed: {}", target_for_main, error),
                ),
            }
        }) {
            log_to_file(
                "warn",
                "dev-open",
                &format!("CLIPFORGE_DEV_OPEN={} dispatch failed: {}", target, error),
            );
        }
    });
}

#[cfg(debug_assertions)]
fn dev_open_window_label(target: &str) -> &'static str {
    match target {
        "settings"
        | "settings:forms"
        | "settings:code-tabs"
        | "settings:tooltip"
        | "settings:diagnostics"
        | "settings:interactions"
        | "settings:onboarding"
        | "onboarding" => "settings",
        _ => "main",
    }
}

#[cfg(debug_assertions)]
fn dev_perf_probe_repeat_count() -> u32 {
    std::env::var("CLIPFORGE_DEV_PERF_REPEAT")
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .map(|value| value.clamp(1, 60))
        .unwrap_or(1)
}

#[cfg(debug_assertions)]
fn dev_env_truthy(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

#[cfg(debug_assertions)]
fn dev_quick_probe_enabled() -> bool {
    dev_env_truthy("CLIPFORGE_DEV_QUICK_PROBE")
}

#[cfg(debug_assertions)]
fn dev_quick_probe_target_mode() -> Option<&'static str> {
    match std::env::var("CLIPFORGE_DEV_PASTE_TARGET")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("browser") => Some("browser"),
        Some("clipforge") => Some("clipforge"),
        Some("textedit") => Some("textedit"),
        _ if dev_env_truthy("CLIPFORGE_DEV_TEXTEDIT_TARGET") => Some("textedit"),
        _ => None,
    }
}

#[cfg(debug_assertions)]
fn dev_quick_probe_requires_textedit_target() -> bool {
    matches!(dev_quick_probe_target_mode(), Some("textedit"))
}

#[cfg(debug_assertions)]
fn dev_quick_probe_can_run() -> bool {
    dev_quick_probe_enabled() && DEV_QUICK_PROBE_TARGET_READY.load(Ordering::Relaxed)
}

#[cfg(debug_assertions)]
fn set_dev_quick_probe_target_bundle(bundle_id: &str) {
    if let Ok(mut slot) = dev_quick_probe_target_bundle_cache().lock() {
        *slot = bundle_id.to_string();
    }
}

#[cfg(debug_assertions)]
fn restore_dev_quick_probe_target_bundle() {
    let bundle_id = match dev_quick_probe_target_bundle_cache().lock() {
        Ok(value) => value.clone(),
        Err(error) => {
            log_to_file(
                "warn",
                "dev-open",
                &format!("quick probe target bundle lock failed: {error}"),
            );
            return;
        }
    };
    if bundle_id.trim().is_empty() {
        return;
    }
    if let Ok(mut slot) = paste_target_app_bundle_cache().lock() {
        *slot = bundle_id.clone();
    }
    log_to_file(
        "debug",
        "dev-open",
        &format!("quick probe restored paste target bundle={bundle_id}"),
    );
}

#[cfg(debug_assertions)]
fn dev_settings_changed_probe_enabled() -> bool {
    dev_env_truthy("CLIPFORGE_DEV_SETTINGS_CHANGED_PROBE")
}

#[cfg(debug_assertions)]
fn dev_i18n_probe_enabled() -> bool {
    dev_env_truthy("CLIPFORGE_DEV_I18N_PROBE")
}

#[cfg(debug_assertions)]
fn dev_settings_dom_probe_enabled() -> bool {
    dev_env_truthy("CLIPFORGE_DEV_SETTINGS_DOM_PROBE")
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn run_dev_command_with_timeout(
    mut command: Command,
    label: &str,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("{label} spawn failed: {error}"))?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("{label} output failed: {error}"));
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{label} timed out after {}ms", timeout.as_millis()));
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => return Err(format!("{label} wait failed: {error}")),
        }
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn run_dev_osascript(script: &str, timeout: Duration) -> Result<std::process::Output, String> {
    let mut command = Command::new("osascript");
    command.arg("-e").arg(script);
    run_dev_command_with_timeout(command, "osascript", timeout)
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn dev_browser_paste_target_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "clipforge-dev-paste-target-{}.html",
        std::process::id()
    ))
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn dev_browser_quick_probe_target_app() -> String {
    std::env::var("CLIPFORGE_DEV_BROWSER_TARGET_APP").unwrap_or_else(|_| "Safari".to_string())
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn prepare_dev_browser_quick_probe_target() -> Result<(), String> {
    let target_path = dev_browser_paste_target_path();
    let target_app = dev_browser_quick_probe_target_app();
    let html = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ClipForge Dev Paste Target</title>
    <style>
      html, body { margin: 0; height: 100%; font: 14px -apple-system, BlinkMacSystemFont, sans-serif; }
      body { display: grid; place-items: center; background: #f6f6f6; color: #111; }
      textarea { width: min(760px, calc(100vw - 48px)); height: min(360px, calc(100vh - 48px)); padding: 16px; }
    </style>
  </head>
  <body>
    <textarea id="clipforge-dev-paste-target" autofocus>ClipForge dev paste target
</textarea>
    <script>
      const target = document.getElementById("clipforge-dev-paste-target");
      const focusTarget = () => { target.focus(); target.selectionStart = target.value.length; target.selectionEnd = target.value.length; };
      window.addEventListener("load", focusTarget);
      window.addEventListener("focus", focusTarget);
      setTimeout(focusTarget, 250);
      setTimeout(focusTarget, 750);
    </script>
  </body>
</html>
"#;
    fs::write(&target_path, html).map_err(|error| format!("write target failed: {error}"))?;

    let mut command = Command::new("open");
    command.arg("-a").arg(&target_app).arg(&target_path);
    match run_dev_command_with_timeout(command, "open browser paste target", Duration::from_secs(3))
    {
        Ok(output) if output.status.success() => {
            thread::sleep(Duration::from_millis(1_200));
            match frontmost_app_identity() {
                Some((name, bundle)) if name == target_app => {
                    set_dev_quick_probe_target_bundle(&bundle);
                    Ok(())
                }
                Some((name, bundle)) => Err(format!(
                    "target app is not frontmost expected={} actual={}|{}",
                    target_app, name, bundle
                )),
                None => Err(format!(
                    "cannot confirm browser target is frontmost expected={}",
                    target_app
                )),
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr)
                .trim()
                .replace('\n', " ");
            Err(format!(
                "open failed status={} error={}",
                output.status, stderr
            ))
        }
        Err(error) => Err(error),
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn prepare_dev_clipforge_quick_probe_target<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    app.clone()
        .run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                set_regular_activation_policy(&app)?;
                let window = if let Some(window) = app.get_webview_window("dev-paste-target") {
                    window
                } else {
                    WebviewWindowBuilder::new(
                        &app,
                        "dev-paste-target",
                        WebviewUrl::App("dev-paste-target.html".into()),
                    )
                    .title("ClipForge Dev Paste Target")
                    .inner_size(760.0, 420.0)
                    .min_inner_size(420.0, 260.0)
                    .resizable(true)
                    .decorations(true)
                    .transparent(false)
                    .always_on_top(true)
                    .visible_on_all_workspaces(false)
                    .build()
                    .map_err(|error| format!("dev paste target build failed: {error}"))?
                };
                window
                    .show()
                    .map_err(|error| format!("dev paste target show failed: {error}"))?;
                let _ = window.set_always_on_top(true);
                let _ = window.center();
                activate_settings_app();
                focus_settings_window_native(&window);
                window
                    .set_focus()
                    .map_err(|error| format!("dev paste target focus failed: {error}"))?;
                let _ = window.eval(
                    r#"
(() => {
  const target = document.getElementById("clipforge-dev-paste-target");
  if (!target) return;
  target.focus();
  target.selectionStart = target.value.length;
  target.selectionEnd = target.value.length;
})()
"#,
                );
                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|error| format!("dev paste target dispatch failed: {error}"))?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|error| format!("dev paste target result timeout: {error}"))??;

    thread::sleep(Duration::from_millis(700));
    match frontmost_app_identity_including_self() {
        Some((name, bundle)) if is_clipforge_frontmost_identity(&name, &bundle) => {
            set_dev_quick_probe_target_bundle(APP_BUNDLE_IDENTIFIER);
            log_to_file(
                "info",
                "dev-open",
                &format!("quick probe clipforge target frontmost {name}|{bundle}"),
            );
            Ok(())
        }
        Some((name, bundle)) => Err(format!(
            "ClipForge target is not frontmost expected={} actual={}|{}",
            APP_BUNDLE_IDENTIFIER, name, bundle
        )),
        None => Err(format!(
            "cannot confirm ClipForge target is frontmost expected={}",
            APP_BUNDLE_IDENTIFIER
        )),
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn verify_dev_quick_probe_paste_target() -> Result<(), String> {
    if !dev_quick_probe_enabled() {
        return Ok(());
    }
    if !DEV_QUICK_PROBE_TARGET_READY.load(Ordering::Relaxed) {
        return Err("controlled target is not ready".to_string());
    }
    if matches!(dev_quick_probe_target_mode(), Some("clipforge")) {
        return match frontmost_app_identity_including_self() {
            Some((name, bundle)) if is_clipforge_frontmost_identity(&name, &bundle) => {
                log_to_file(
                    "debug",
                    "dev-open",
                    &format!("quick probe paste target verified {name}|{bundle}"),
                );
                Ok(())
            }
            Some((name, bundle)) => Err(format!(
                "frontmost target changed expected={} actual={}|{}",
                APP_BUNDLE_IDENTIFIER, name, bundle
            )),
            None => Err(format!(
                "cannot confirm frontmost target expected={}",
                APP_BUNDLE_IDENTIFIER
            )),
        };
    }
    let expected_app = match dev_quick_probe_target_mode() {
        Some("browser") => dev_browser_quick_probe_target_app(),
        Some("textedit") => "TextEdit".to_string(),
        Some(value) => return Err(format!("unsupported target mode {value}")),
        None => return Err("target mode is missing".to_string()),
    };
    match frontmost_app_identity() {
        Some((name, bundle)) if name == expected_app => {
            log_to_file(
                "debug",
                "dev-open",
                &format!("quick probe paste target verified {name}|{bundle}"),
            );
            Ok(())
        }
        Some((name, bundle)) => Err(format!(
            "frontmost target changed expected={} actual={}|{}",
            expected_app, name, bundle
        )),
        None => Err(format!(
            "cannot confirm frontmost target expected={}",
            expected_app
        )),
    }
}

#[cfg(all(debug_assertions, not(target_os = "macos")))]
fn verify_dev_quick_probe_paste_target() -> Result<(), String> {
    if dev_quick_probe_enabled() {
        return Err(
            "controlled paste target verification is only implemented on macOS".to_string(),
        );
    }
    Ok(())
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn prepare_dev_textedit_quick_probe_target() -> Result<(), String> {
    let script = r#"
tell application "TextEdit"
  activate
  make new document
  set text of front document to "ClipForge dev paste target\n"
end tell
"#;
    match run_dev_osascript(script, Duration::from_secs(3)) {
        Ok(output) if output.status.success() => {
            set_dev_quick_probe_target_bundle("com.apple.TextEdit");
            Ok(())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr)
                .trim()
                .replace('\n', " ");
            Err(format!(
                "TextEdit target failed status={} error={}",
                output.status, stderr
            ))
        }
        Err(error) => Err(format!("TextEdit target spawn failed: {error}")),
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn prepare_dev_quick_probe_target<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    DEV_QUICK_PROBE_TARGET_READY.store(false, Ordering::Relaxed);
    set_dev_quick_probe_target_bundle("");
    if !dev_quick_probe_enabled() {
        return;
    }
    let Some(target_mode) = dev_quick_probe_target_mode() else {
        log_to_file(
            "warn",
            "dev-open",
            "quick probe requires CLIPFORGE_DEV_PASTE_TARGET=clipforge|browser or CLIPFORGE_DEV_TEXTEDIT_TARGET=1 because it triggers real paste",
        );
        return;
    };
    let prepared = match target_mode {
        "browser" => prepare_dev_browser_quick_probe_target(),
        "clipforge" => prepare_dev_clipforge_quick_probe_target(app.clone()),
        "textedit" => prepare_dev_textedit_quick_probe_target(),
        _ => Err(format!("unsupported quick probe target {target_mode}")),
    };
    match prepared {
        Ok(()) => {
            DEV_QUICK_PROBE_TARGET_READY.store(true, Ordering::Relaxed);
            log_to_file(
                "info",
                "dev-open",
                &format!("quick probe prepared {target_mode} target"),
            );
        }
        Err(error) => log_to_file(
            "warn",
            "dev-open",
            &format!("quick probe {target_mode} target failed: {error}"),
        ),
    }
}

#[cfg(all(debug_assertions, not(target_os = "macos")))]
fn prepare_dev_quick_probe_target<R: tauri::Runtime>(_app: tauri::AppHandle<R>) {}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn cleanup_dev_quick_probe_target<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    if !dev_quick_probe_enabled() {
        return;
    }
    if matches!(dev_quick_probe_target_mode(), Some("clipforge")) {
        let app_for_cleanup = app.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            if let Some(window) = app_for_cleanup.get_webview_window("dev-paste-target") {
                if let Err(error) = window.close() {
                    log_to_file(
                        "warn",
                        "dev-open",
                        &format!("quick probe ClipForge target cleanup failed: {error}"),
                    );
                } else {
                    log_to_file("info", "dev-open", "quick probe closed ClipForge target");
                }
            }
        }) {
            log_to_file(
                "warn",
                "dev-open",
                &format!("quick probe ClipForge cleanup dispatch failed: {error}"),
            );
        }
        DEV_QUICK_PROBE_TARGET_READY.store(false, Ordering::Relaxed);
        return;
    }
    if matches!(dev_quick_probe_target_mode(), Some("browser")) {
        let target_path = dev_browser_paste_target_path();
        if let Err(error) = fs::remove_file(&target_path) {
            log_to_file(
                "warn",
                "dev-open",
                &format!(
                    "quick probe browser target cleanup failed path={} error={}",
                    target_path.display(),
                    error
                ),
            );
        } else {
            log_to_file("info", "dev-open", "quick probe removed browser target");
        }
        DEV_QUICK_PROBE_TARGET_READY.store(false, Ordering::Relaxed);
        return;
    }
    if !dev_quick_probe_requires_textedit_target() {
        return;
    }
    let script = r#"tell application "TextEdit" to close front document saving no"#;
    match run_dev_osascript(script, Duration::from_secs(3)) {
        Ok(output) if output.status.success() => {
            log_to_file("info", "dev-open", "quick probe closed TextEdit target");
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr)
                .trim()
                .replace('\n', " ");
            log_to_file(
                "warn",
                "dev-open",
                &format!(
                    "quick probe TextEdit cleanup failed status={} error={}",
                    output.status, stderr
                ),
            );
        }
        Err(error) => log_to_file(
            "warn",
            "dev-open",
            &format!("quick probe TextEdit cleanup spawn failed: {error}"),
        ),
    }
    DEV_QUICK_PROBE_TARGET_READY.store(false, Ordering::Relaxed);
}

#[cfg(all(debug_assertions, not(target_os = "macos")))]
fn cleanup_dev_quick_probe_target<R: tauri::Runtime>(_app: tauri::AppHandle<R>) {}

#[cfg(debug_assertions)]
fn dev_quick_probe_script(probe_index: u32) -> String {
    format!(
        r#"
(() => {{
  const perf = window.__clipforgePerf;
  const list = document.querySelector(".quick-menu");
  const rows = Array.from(document.querySelectorAll(".quick-row"));
  if (!perf || !list || rows.length === 0) {{
    return {{ ok: false, reason: "missing-elements", hasPerf: Boolean(perf), hasList: Boolean(list), rows: rows.length }};
  }}
  const row = rows[{probe_index} % rows.length];
  list.scrollTop = Math.min(list.scrollHeight, ({probe_index} + 1) * 36);
  list.dispatchEvent(new Event("scroll", {{ bubbles: true }}));
  row.focus();
  const copyEvent = new KeyboardEvent("keydown", {{
    key: "c",
    code: "KeyC",
    metaKey: true,
    bubbles: true,
    cancelable: true
  }});
  row.dispatchEvent(copyEvent);
  window.setTimeout(() => {{
    const pasteEvent = new KeyboardEvent("keydown", {{
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true
    }});
    row.dispatchEvent(pasteEvent);
  }}, 80);
  return {{ ok: true, rows: rows.length, index: {probe_index} % rows.length }};
}})()
"#
    )
}

#[cfg(debug_assertions)]
fn dev_patch_settings_on_main<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    patch: Value,
    reason: &'static str,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    let app_for_patch = app.clone();
    app.run_on_main_thread(move || {
        let result = settings_service_patch(
            app_for_patch.clone(),
            patch,
            Some("dev-open".to_string()),
            Some(reason.to_string()),
            None,
        )
        .map(|_| ());
        let _ = tx.send(result);
    })
    .map_err(|error| format!("dispatch failed: {error}"))?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|error| format!("result timeout: {error}"))?
}

#[cfg(debug_assertions)]
fn run_dev_settings_changed_probe<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    if !dev_settings_changed_probe_enabled() {
        return;
    }

    let Ok(settings) = read_user_settings() else {
        log_to_file(
            "warn",
            "dev-open",
            "settings_changed probe skipped: cannot read settings",
        );
        return;
    };
    let Some(original) = settings.settings.get("logMaxLines").and_then(Value::as_u64) else {
        log_to_file(
            "warn",
            "dev-open",
            "settings_changed probe skipped: logMaxLines is missing",
        );
        return;
    };
    let temporary = if original >= 2_000_000 {
        original.saturating_sub(1).max(100)
    } else {
        original + 1
    };

    let first_result = dev_patch_settings_on_main(
        app.clone(),
        json!({ "logMaxLines": temporary }),
        "settings-changed-probe",
    );
    match first_result {
        Ok(()) => log_to_file(
            "info",
            "dev-open",
            &format!(
                "settings_changed probe patched logMaxLines {} -> {}",
                original, temporary
            ),
        ),
        Err(error) => {
            log_to_file(
                "warn",
                "dev-open",
                &format!("settings_changed probe patch failed: {error}"),
            );
            return;
        }
    }

    thread::sleep(Duration::from_millis(250));
    if let Err(error) = dev_patch_settings_on_main(
        app,
        json!({ "logMaxLines": original }),
        "settings-changed-probe-restore",
    ) {
        log_to_file(
            "warn",
            "dev-open",
            &format!("settings_changed probe restore failed: {error}"),
        );
        return;
    }
    log_to_file(
        "info",
        "dev-open",
        &format!("settings_changed probe restored logMaxLines={original}"),
    );
    thread::sleep(Duration::from_millis(500));
}

#[cfg(debug_assertions)]
fn log_dev_i18n_window_snapshot<R: tauri::Runtime>(app: tauri::AppHandle<R>, label: &'static str) {
    let app_for_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(window) = app_for_main.get_webview_window("settings") else {
            log_to_file(
                "warn",
                "dev-open",
                &format!("i18n probe snapshot skipped label={label}: settings window not found"),
            );
            return;
        };
        let label_json = serde_json::to_string(label).unwrap_or_else(|_| "\"unknown\"".to_string());
        let script = format!(
            r#"
(() => {{
  return {{
    label: {label_json},
    lang: document.documentElement.lang,
    title: document.title,
    bodyText: (document.body?.innerText ?? "").slice(0, 240)
  }};
}})()
"#
        );
        if let Err(error) = window.eval_with_callback(script, move |payload| {
            log_to_file(
                "info",
                "dev-open",
                &format!("i18n probe snapshot {payload}"),
            );
        }) {
            log_to_file(
                "warn",
                "dev-open",
                &format!("i18n probe snapshot failed label={label}: {error}"),
            );
        }
    });
}

#[cfg(debug_assertions)]
fn run_dev_i18n_probe<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    if !dev_i18n_probe_enabled() {
        return;
    }
    let original_language = read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("language")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        })
        .unwrap_or_else(|| "system".to_string());
    log_to_file(
        "info",
        "dev-open",
        &format!(
            "i18n probe started original={} nativeLocale={}",
            original_language,
            current_native_locale()
        ),
    );
    log_dev_i18n_window_snapshot(app.clone(), "initial");
    thread::sleep(Duration::from_millis(250));
    for (label, language) in [("zh", "zh-CN"), ("en", "en-US"), ("system", "system")] {
        match dev_patch_settings_on_main(app.clone(), json!({ "language": language }), "i18n-probe")
        {
            Ok(()) => {
                thread::sleep(Duration::from_millis(350));
                log_to_file(
                    "info",
                    "dev-open",
                    &format!(
                        "i18n probe patched label={} language={} nativeLocale={}",
                        label,
                        language,
                        current_native_locale()
                    ),
                );
                log_dev_i18n_window_snapshot(app.clone(), label);
                thread::sleep(Duration::from_millis(250));
            }
            Err(error) => log_to_file(
                "warn",
                "dev-open",
                &format!(
                    "i18n probe patch failed label={} language={}: {}",
                    label, language, error
                ),
            ),
        }
    }
    if let Err(error) = dev_patch_settings_on_main(
        app.clone(),
        json!({ "language": original_language }),
        "i18n-probe-restore",
    ) {
        log_to_file(
            "warn",
            "dev-open",
            &format!("i18n probe restore failed: {error}"),
        );
        return;
    }
    thread::sleep(Duration::from_millis(350));
    log_to_file(
        "info",
        "dev-open",
        &format!(
            "i18n probe restored language={} nativeLocale={}",
            original_language,
            current_native_locale()
        ),
    );
    log_dev_i18n_window_snapshot(app, "restored");
    thread::sleep(Duration::from_millis(250));
}

#[cfg(debug_assertions)]
fn dev_settings_dom_probe_script(target: &str) -> String {
    let target_json = serde_json::to_string(target).unwrap_or_else(|_| "\"unknown\"".to_string());
    r#"
(() => {
  const target = __CLIPFORGE_DOM_PROBE_TARGET__;
  const result = {
    scope: "settings-dom",
    target,
    pass: false,
    checks: [],
    startedAt: new Date().toISOString()
  };
  window.__clipforgeDevSettingsDomProbeResult = result;
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const one = (selector, root = document) => root.querySelector(selector);
  const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const add = (name, pass, reason, details) => {
    const check = { name, pass: Boolean(pass) };
    if (!pass && reason) check.reason = text(reason);
    if (details !== undefined) check.details = details;
    result.checks.push(check);
    result.pass = Boolean(result.endedAt) && result.checks.every((item) => item.pass);
  };
  const click = async (name, element) => {
    if (!element) {
      add(name, false, "element not found");
      return false;
    }
    try {
      element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      element.click();
      await sleep(160);
      add(name, true);
      return true;
    } catch (error) {
      add(name, false, error?.message || String(error));
      return false;
    }
  };
  const scheduleClick = async (name, element) => {
    if (!element) {
      add(name, false, "element not found");
      return false;
    }
    try {
      element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      window.setTimeout(() => {
        try {
          element.click();
        } catch (error) {
          console.warn("clipforge dev probe scheduled click failed", name, error);
        }
      }, 0);
      add(name, true);
      await sleep(220);
      return true;
    } catch (error) {
      add(name, false, error?.message || String(error));
      return false;
    }
  };
  const openSection = async (section) => {
    const button = one(`[data-dev-probe="settings-sidebar-item:${section}"]`);
    const clicked = await click(`settings.section.click.${section}`, button);
    if (!clicked) return false;
    const active = one(`[data-dev-probe="settings-sidebar-item:${section}"][aria-current="page"]`);
    add(`settings.section.active.${section}`, Boolean(active), "section did not become active");
    return Boolean(active);
  };
  const openTab = async (tab) => {
    const trigger = one(`[data-dev-probe="settings-section-tab:${tab}"]`);
    const clicked = await click(`settings.tab.click.${tab}`, trigger);
    if (!clicked) return false;
    const active = one(`[data-dev-probe="settings-section-tab:${tab}"][data-state="active"], [data-dev-probe="settings-section-tab:${tab}"][aria-selected="true"]`);
    add(`settings.tab.active.${tab}`, Boolean(active), "tab did not become active");
    return Boolean(active);
  };
  const waitFor = async (name, predicate, timeoutMs = 2200) => {
    const started = Date.now();
    let details;
    while (Date.now() - started < timeoutMs) {
      try {
        const value = predicate();
        if (value) {
          add(name, true, undefined, value === true ? undefined : value);
          return true;
        }
        details = value;
      } catch (error) {
        details = error?.message || String(error);
      }
      await sleep(80);
    }
    add(name, false, "condition did not become true", details);
    return false;
  };
  const setNativeValue = (element, value) => {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(element, String(value));
    else element.value = String(value);
  };
  const tauriInvoke = () => {
    if (typeof window.__TAURI__?.core?.invoke === "function") return window.__TAURI__.core.invoke;
    if (typeof window.__TAURI_INTERNALS__?.invoke === "function") return window.__TAURI_INTERNALS__.invoke;
    return null;
  };
  const readClipboardForProbe = async () => {
    let webError = "";
    try {
      return { text: text(await navigator.clipboard.readText()), source: "web" };
    } catch (error) {
      webError = error?.message || String(error);
    }
    const invoke = tauriInvoke();
    if (!invoke) {
      throw new Error(webError || "Tauri invoke is unavailable");
    }
    return {
      text: text(await invoke("dev_read_clipboard_text")),
      source: "native",
      webError,
    };
  };
  const waitForSavedFeedback = async (name) => waitFor(name, () => {
    const feedback = one('[data-dev-probe="settings-save-feedback"], [data-dev-probe="settings-section-save-chip"]');
    if (!feedback) return false;
    const className = String(feedback.className || "");
    return className.includes("saved") ? { text: text(feedback.textContent) } : false;
  }, 3200);
  const changeSegment = async (probeId, checkName) => {
    const control = one(`[data-dev-probe="${probeId}"]`);
    const buttons = all("button", control);
    const current = buttons.find((button) => button.getAttribute("data-state") === "on" || button.getAttribute("aria-pressed") === "true");
    const targetButton = buttons.find((button) => button !== current && !button.disabled) ?? buttons[0];
    const before = current?.getAttribute("value") || text(current?.textContent);
    if (!targetButton) {
      add(`${checkName}.present`, false, "segment option not found");
      return false;
    }
    await click(`${checkName}.click`, targetButton);
    const after = all("button", control).find((button) => button.getAttribute("data-state") === "on" || button.getAttribute("aria-pressed") === "true");
    add(`${checkName}.changed`, Boolean(after) && after !== current, "segment value did not change", {
      before,
      after: after?.getAttribute("value") || text(after?.textContent),
    });
    return waitForSavedFeedback(`${checkName}.saved`);
  };
  const changeNumber = async (probeId, checkName) => {
    const input = one(`[data-dev-probe="${probeId}"] input[type="number"]`);
    if (!input) {
      add(`${checkName}.present`, false, "number input not found");
      return false;
    }
    const before = Number(input.value);
    const min = Number(input.min || "0");
    const max = Number(input.max || "999999");
    const next = Number.isFinite(before) && before < max ? before + 1 : Math.max(min, before - 1);
    setNativeValue(input, next);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: String(next) }));
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await sleep(180);
    add(`${checkName}.changed`, Number(input.value) === next, "number input value did not change", { before, after: Number(input.value), next });
    return waitForSavedFeedback(`${checkName}.saved`);
  };
  const changeSlider = async (probeId, checkName) => {
    const input = one(`[data-dev-probe="${probeId}"] input[type="range"]`);
    if (!input) {
      add(`${checkName}.present`, false, "range input not found");
      return false;
    }
    const before = Number(input.value);
    const min = Number(input.min || "0");
    const max = Number(input.max || "100");
    const next = before < max ? before + 1 : Math.max(min, before - 1);
    setNativeValue(input, next);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: String(next) }));
    input.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
    await sleep(180);
    add(`${checkName}.changed`, Number(input.value) === next, "range input value did not change", { before, after: Number(input.value), next });
    return waitForSavedFeedback(`${checkName}.saved`);
  };
  const changeSwitch = async (probeId, checkName) => {
    const button = one(`[data-dev-probe="${probeId}"] [role="switch"]`);
    if (!button) {
      add(`${checkName}.present`, false, "switch not found");
      return false;
    }
    const before = button.getAttribute("aria-checked");
    await click(`${checkName}.click`, button);
    const after = button.getAttribute("aria-checked");
    add(`${checkName}.changed`, before !== after, "switch state did not change", { before, after });
    return waitForSavedFeedback(`${checkName}.saved`);
  };
  const copyCurrentCodeTab = async (tab) => {
    const tabTrigger = one(`[data-dev-probe="settings-code-tab:${tab}"]`);
    if (tabTrigger) await click(`settings.codeTabs.${tab}.tab.click`, tabTrigger);
    const copyButton = one(`[data-dev-probe="settings-code-copy:${tab}"]`);
    if (!copyButton) {
      add(`settings.codeTabs.${tab}.copy.present`, false, "copy button not found");
      return false;
    }
    copyButton.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    await click(`settings.codeTabs.${tab}.copy.click`, copyButton);
    copyButton.focus?.();
    const panel = copyButton.closest(".settings-redesign-code-tabs-panel");
    const expected = text(panel?.querySelector("pre")?.textContent);
    let clipboardResult;
    try {
      clipboardResult = await readClipboardForProbe();
    } catch (error) {
      add(`settings.codeTabs.${tab}.copy.clipboard`, false, error?.message || String(error));
      return false;
    }
    const clipboardText = clipboardResult.text;
    add(`settings.codeTabs.${tab}.copy.reachable`, true, undefined, {
      label: text(copyButton.textContent),
      disabled: Boolean(copyButton.disabled),
      clipboardLength: clipboardText.length,
      readSource: clipboardResult.source,
      webError: clipboardResult.webError,
    });
    add(
      `settings.codeTabs.${tab}.copy.matches`,
      clipboardText === expected,
      "clipboard content did not match code tab content",
      {
        expectedLength: expected.length,
        clipboardLength: clipboardText.length,
      },
    );
    return true;
  };
  const probeFormSaving = async () => {
    await openSection("display-panel");
    await openTab("density");
    await changeSegment("settings-control:panelDensity", "settings.form.toggleGroup.panelDensity");
    await changeNumber("settings-control:quickItemLimit", "settings.form.number.quickItemLimit");
    await openTab("size");
    await changeSlider("settings-control:panelBackgroundOpacity", "settings.form.slider.panelBackgroundOpacity");
    await openTab("test");
    await changeSwitch("settings-control:enableScrollCollapse", "settings.form.switch.enableScrollCollapse");
  };
  const probeAllCodeTabs = async () => {
    const hasMcpSection = await openSection("mcp-agent");
    if (!hasMcpSection) return;
    await openTab("install");
    const codeTabs = all('[data-dev-probe="settings-code-tabs"], .settings-redesign-code-tabs');
    const codeTabTriggers = all('[data-dev-probe^="settings-code-tab:"], .settings-redesign-code-tabs-trigger');
    add("settings.codeTabs.present", codeTabs.length > 0, "Code Tabs not found after opening MCP install tab", { count: codeTabs.length });
    add("settings.codeTabs.triggers", codeTabTriggers.length > 0, "Code Tab triggers not found", { count: codeTabTriggers.length });
    await copyCurrentCodeTab("install");
    await copyCurrentCodeTab("command");
    await openTab("json-rpc");
    await copyCurrentCodeTab("tools");
    await copyCurrentCodeTab("json-rpc");
    await openTab("provider");
    await copyCurrentCodeTab("provider");
  };
  const probeTooltipKeyboard = async () => {
    await openSection("display-panel");
    await openTab("density");
    const firstTab = one('[data-dev-probe="settings-section-tab:density"]');
    if (firstTab) {
      firstTab.focus();
      firstTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      await sleep(180);
      add("settings.keyboard.tabs.arrowRight", Boolean(one('[data-dev-probe="settings-section-tab:size"][data-state="active"], [data-dev-probe="settings-section-tab:size"][aria-selected="true"]')), "ArrowRight did not move section tab focus/selection");
    } else {
      add("settings.keyboard.tabs.present", false, "density tab not found");
    }

    await openSection("storage-logs");
    await openTab("data");
    const tooltipTrigger = one(".readonly-field-copy:not(:disabled), .readonly-field-value");
    if (tooltipTrigger) {
      tooltipTrigger.dispatchEvent(new MouseEvent("pointerenter", { bubbles: true, cancelable: true }));
      tooltipTrigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true }));
      tooltipTrigger.focus?.();
      await sleep(520);
      add("settings.tooltip.opens", Boolean(one(".settings-tooltip-content")), "tooltip content did not open");
      tooltipTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await waitFor(
        "settings.tooltip.escape",
        () => !one('.settings-tooltip-content[data-state="open"], [data-slot="tooltip-overlay"][data-state="open"]'),
        1400,
      );
    } else {
      add("settings.tooltip.trigger.present", false, "tooltip trigger not found");
    }
  };

  const probeDiagnosticsAndUpdate = async () => {
    await openSection("storage-logs");
    await openTab("diagnostics");
    await click("settings.diagnostics.refresh.click", one('[data-dev-probe="settings-action:diagnostics.refresh"]'));
    await waitFor("settings.diagnostics.refresh.feedback", () => {
      const panel = one('[data-dev-probe="settings-status:diagnostics"]');
      return panel && (panel.className.includes("good") || panel.className.includes("danger")) ? { text: text(panel.textContent) } : false;
    }, 2400);
    await click("settings.diagnostics.export.click", one('[data-dev-probe="settings-action:diagnostics.export"]'));
    await waitFor("settings.diagnostics.export.feedback", () => {
      const panel = one('[data-dev-probe="settings-status:diagnostics"]');
      return panel && !panel.className.includes("pending") ? { text: text(panel.textContent) } : false;
    }, 4200);
    const cleanupButton = one('[data-dev-probe="settings-action:diagnostics.cleanup"]');
    await click("settings.diagnostics.cleanup.confirm.click", cleanupButton);
    await click("settings.diagnostics.cleanup.run.click", one('[data-dev-probe="settings-action:diagnostics.cleanup"]'));
    await waitFor("settings.diagnostics.cleanup.feedback", () => {
      const panel = one('[data-dev-probe="settings-status:diagnostics"]');
      return panel && !panel.className.includes("pending") ? { text: text(panel.textContent) } : false;
    }, 4200);

    await openSection("update-distribution");
    await openTab("update-flow");
    const updatePanel = one('[data-dev-probe="settings-status:update-flow"]');
    add("settings.updateFlow.panel.present", visible(updatePanel), "update flow status panel not visible");
    add("settings.updateFlow.actions.present", all('[data-dev-probe^="settings-action:update."]').length >= 4, "update flow actions missing");
    await click("settings.updateFlow.check.click", one('[data-dev-probe="settings-action:update.check"]'));
    await waitFor("settings.updateFlow.check.feedback", () => {
      const panel = one('[data-dev-probe="settings-status:update-flow"]');
      const body = text(panel?.textContent);
      return body.length > 0 ? { text: body } : false;
    }, 3600);
  };

  const probeKeyboardTooltipAndActions = async () => {
    await probeTooltipKeyboard();
    await probeDiagnosticsAndUpdate();
  };

  async function probeSettingsSurface() {
    const sidebar = one('[data-dev-probe="settings-sidebar"], .settings-redesign-sidebar');
    const sidebarItems = all('[data-dev-probe^="settings-sidebar-item:"], .settings-redesign-sidebar-item');
    add("settings.sidebar.visible", visible(sidebar), "settings sidebar is not visible", { count: sidebarItems.length });
    add("settings.sidebar.items", sidebarItems.length >= 3, "expected at least three settings sections", { count: sidebarItems.length });
    add("settings.content.visible", visible(one(".settings-window-content")), "settings content area is not visible");
    add("settings.tabs.visible", visible(one('[data-dev-probe^="settings-section-tabs:"], .settings-section-tabs')), "settings section tabs are not visible");

    for (const section of ["display-panel", "capture-content", "shortcut-language"]) {
      await openSection(section);
    }
    for (const tab of ["onboarding", "shortcut", "language"]) {
      await openTab(tab);
    }

    await probeFormSaving();
    await probeAllCodeTabs();
    await probeKeyboardTooltipAndActions();
  }

  async function probeOnboardingSurface() {
    const shouldProbeOnboarding = target === "settings:onboarding" || target === "onboarding";
    if (!shouldProbeOnboarding) return;
    await openSection("shortcut-language");
    await openTab("onboarding");
    const wizard = one('[data-dev-probe="onboarding-wizard"]');
    const stepButtons = all('[data-dev-probe^="onboarding-step:"]');
    const stepKeys = ["welcome", "accessibility", "capture", "shortcut", "tour"];
    add("onboarding.wizard.visible", visible(wizard), "onboarding wizard is not visible");
    add("onboarding.stepper.count", stepButtons.length === 5, "expected five onboarding steps", { count: stepButtons.length });
    for (const key of stepKeys) {
      await click(`onboarding.step.click.${key}`, one(`[data-dev-probe="onboarding-step:${key}"]`));
      const active = one(`[data-dev-probe="onboarding-step:${key}"][aria-current="step"]`);
      add(`onboarding.step.active.${key}`, Boolean(active), "step did not become active");
    }

    await click("onboarding.capture.open", one('[data-dev-probe="onboarding-step:capture"]'));
    const capturePanel = one('[data-dev-probe="onboarding-capture-panel"]');
    const captureToggles = all('[data-dev-probe="onboarding-capture-toggles"] [role="switch"]');
    add("onboarding.capture.panel.visible", visible(capturePanel), "capture panel is not visible", { count: captureToggles.length });
    if (captureToggles[0]) {
      const before = captureToggles[0].getAttribute("aria-checked");
      await click("onboarding.capture.toggle.click", captureToggles[0]);
      const after = captureToggles[0].getAttribute("aria-checked");
      add("onboarding.capture.toggle.changed", before !== after, "capture toggle state did not change", { before, after });
    } else {
      add("onboarding.capture.toggle.present", false, "capture toggle not found");
    }

    await click("onboarding.accessibility.open", one('[data-dev-probe="onboarding-step:accessibility"]'));
    add("onboarding.accessibility.request.present", Boolean(one('[data-dev-probe="onboarding-accessibility-request"]')), "accessibility request button not found");
    const refreshButton = one('[data-dev-probe="onboarding-accessibility-refresh"]');
    if (refreshButton) await click("onboarding.accessibility.refresh.click", refreshButton);

    await click("onboarding.finish.openTour", one('[data-dev-probe="onboarding-step:tour"]'));
    const primary = one('[data-dev-probe="onboarding-primary"]');
    await click("onboarding.finish.click", primary);
    const completed = one(".onboarding-completed-state, .onboarding-completed-badge");
    add("onboarding.finish.completedState", visible(completed), "finish did not render completed state");

    await openSection("capture-content");
    await openSection("shortcut-language");
    await openTab("onboarding");
    add("onboarding.reopen.visible", visible(one('[data-dev-probe="onboarding-wizard"]')), "onboarding did not reopen from settings tabs");
  }

  (async () => {
    try {
      await sleep(100);
      if (target === "settings:onboarding" || target === "onboarding") {
        await probeOnboardingSurface();
      } else if (target === "settings:forms") {
        await probeFormSaving();
      } else if (target === "settings:code-tabs") {
        await probeAllCodeTabs();
      } else if (target === "settings:tooltip") {
        await probeTooltipKeyboard();
      } else if (target === "settings:diagnostics") {
        await probeDiagnosticsAndUpdate();
      } else if (target === "settings:interactions") {
        await probeKeyboardTooltipAndActions();
      } else {
        await probeSettingsSurface();
      }
    } catch (error) {
      add("probe.exception", false, error?.stack || error?.message || String(error));
    } finally {
      result.pass = result.checks.every((item) => item.pass);
      result.endedAt = new Date().toISOString();
    }
  })();
  return { scope: "settings-dom", target, started: true };
})()
"#
    .replace("__CLIPFORGE_DOM_PROBE_TARGET__", &target_json)
}

#[cfg(debug_assertions)]
fn dev_top_nav_dom_probe_script(target: &str) -> String {
    let target_json = serde_json::to_string(target).unwrap_or_else(|_| "\"unknown\"".to_string());
    r#"
(() => {
  const target = __CLIPFORGE_DOM_PROBE_TARGET__;
  const result = {
    scope: "top-nav-dom",
    target,
    pass: false,
    checks: [],
    startedAt: new Date().toISOString()
  };
  window.__clipforgeDevTopNavDomProbeResult = result;
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const one = (selector) => document.querySelector(selector);
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const shellView = () => {
    const shell = one(".app-shell");
    if (!shell) return "";
    for (const className of shell.classList) {
      if (className.startsWith("view-")) return className.slice("view-".length);
    }
    return "";
  };
  const add = (name, pass, reason, details) => {
    const check = { name, pass: Boolean(pass) };
    if (!pass && reason) check.reason = String(reason).slice(0, 160);
    if (details !== undefined) check.details = details;
    result.checks.push(check);
    result.pass = result.checks.every((item) => item.pass);
  };
  const click = async (name, element) => {
    if (!element) {
      add(name, false, "element not found");
      return false;
    }
    try {
      element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      element.click();
      await sleep(160);
      add(name, true);
      return true;
    } catch (error) {
      add(name, false, error?.message || String(error));
      return false;
    }
  };
  const pressKey = async (name, key, options = {}) => {
    try {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      const dispatched = window.dispatchEvent(event);
      await sleep(160);
      add(name, event.defaultPrevented || dispatched === false, "shortcut did not prevent default", {
        key,
        defaultPrevented: event.defaultPrevented,
      });
      return event.defaultPrevented || dispatched === false;
    } catch (error) {
      add(name, false, error?.message || String(error));
      return false;
    }
  };
  const assertView = (name, expected) => {
    const view = shellView();
    add(name, view === expected, `expected ${expected}, got ${view || "unknown"}`, { view });
  };
  const assertBottomClear = () => {
    const workspace = one(".quick-workspace");
    if (!workspace) {
      add("topNav.list.bottomClear", true, undefined, { skipped: "workspace missing" });
      return;
    }
    const workspaceRect = workspace.getBoundingClientRect();
    const bottomDock = one(".bottom-dock, .bottom-nav, .dock-bottom");
    add(
      "topNav.list.bottomClear",
      !bottomDock && workspaceRect.height > 120 && workspaceRect.bottom <= window.innerHeight + 1,
      "quick workspace is clipped or a bottom dock is still present",
      {
        hasBottomDock: Boolean(bottomDock),
        workspaceHeight: workspaceRect.height,
        workspaceBottom: workspaceRect.bottom,
        viewportHeight: window.innerHeight,
      },
    );
  };

  (async () => {
    try {
      await sleep(100);
      const toolbar = one('[data-dev-probe="top-toolbar"], .top-toolbar');
      add("topNav.toolbar.present", Boolean(toolbar), "top toolbar not found");
      add("topNav.toolbar.dragRegion", toolbar?.hasAttribute("data-tauri-drag-region"), "top toolbar missing drag region");
      add("topNav.viewActions.present", Boolean(one('[data-dev-probe="top-view-actions"], .top-view-actions')), "top view actions not found");
      add("topNav.history.present", Boolean(one('[data-dev-probe="top-view-history"]')), "history top tab not found");
      add("topNav.favorites.present", Boolean(one('[data-dev-probe="top-view-favorites"]')), "favorites top tab not found");
      add("topNav.search.present", Boolean(one('[data-dev-probe="top-search-slot"], .top-toolbar-search-slot')), "search slot not found");
      add("topNav.agent.present", Boolean(one('[data-dev-probe="top-agent-button"], .top-agent-button')), "agent button not found");
      add("topNav.menu.present", Boolean(one('[data-dev-probe="top-menu-trigger"], .top-menu-trigger')), "top menu trigger not found");
      await click("topNav.history.click", one('[data-dev-probe="top-view-history"]'));
      assertView("topNav.history.active", "history");
      assertBottomClear();
      await click("topNav.favorites.click", one('[data-dev-probe="top-view-favorites"]'));
      assertView("topNav.favorites.active", "favorites");
      assertBottomClear();
      await click("topNav.menu.click", one('[data-dev-probe="top-menu-trigger"], .top-menu-trigger'));
      const trashMenuItem = one('[data-dev-probe="top-menu-trash"]');
      add("topNav.menu.trash.present", Boolean(trashMenuItem), "trash menu item not found");
      add("topNav.menu.settings.present", Boolean(one('[data-dev-probe="top-menu-settings"]')), "settings menu item not found");
      add("topNav.menu.onboarding.absent", !document.body.textContent.includes("Onboarding"), "onboarding menu entry is still visible");
      if (trashMenuItem) {
        await click("topNav.trash.click", trashMenuItem);
        assertView("topNav.trash.active", "trash");
        assertBottomClear();
      }
      await click("topNav.history.clickAfterTrash", one('[data-dev-probe="top-view-history"]'));
      await pressKey("topNav.shortcut.trash.prevented", "t");
      assertView("topNav.shortcut.trash.active", "trash");
      await pressKey("topNav.shortcut.settings.prevented", ",", { metaKey: true });
      result.visible = visible(toolbar);
    } catch (error) {
      add("probe.exception", false, error?.stack || error?.message || String(error));
    } finally {
      result.pass = result.checks.every((item) => item.pass);
      result.endedAt = new Date().toISOString();
    }
  })();
  return { scope: "top-nav-dom", target, started: true };
})()
"#
    .replace("__CLIPFORGE_DOM_PROBE_TARGET__", &target_json)
}

#[cfg(debug_assertions)]
fn run_dev_settings_dom_probe<R: tauri::Runtime>(app: tauri::AppHandle<R>, target: &str) {
    if !dev_settings_dom_probe_enabled() {
        return;
    }
    let target = target.to_string();
    log_to_file(
        "info",
        "dev-open",
        &format!("settings_dom_probe started target={target}"),
    );

    let start_app = app.clone();
    let start_target = target.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Some(window) = start_app.get_webview_window("settings") {
            if let Err(error) = window.eval(dev_settings_dom_probe_script(&start_target)) {
                log_to_file(
                    "warn",
                    "dev-open",
                    &format!("settings_dom_probe settings start failed: {error}"),
                );
            }
        } else {
            log_to_file(
                "warn",
                "dev-open",
                r#"settings_dom_probe settings {"scope":"settings-dom","pass":false,"checks":[{"name":"settings.window.present","pass":false,"reason":"settings window not found"}]}"#,
            );
        }
        if let Some(window) = start_app.get_webview_window("main") {
            if let Err(error) = window.eval(dev_top_nav_dom_probe_script(&start_target)) {
                log_to_file(
                    "warn",
                    "dev-open",
                    &format!("settings_dom_probe top_nav start failed: {error}"),
                );
            }
        } else {
            log_to_file(
                "warn",
                "dev-open",
                r#"settings_dom_probe top_nav {"scope":"top-nav-dom","pass":false,"checks":[{"name":"main.window.present","pass":false,"reason":"main window not found"}]}"#,
            );
        }
    }) {
        log_to_file(
            "warn",
            "dev-open",
            &format!("settings_dom_probe start dispatch failed: {error}"),
        );
        return;
    }

    thread::sleep(Duration::from_millis(45_000));

    let finish_app = app.clone();
    let finish_target = target.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        if let Some(window) = finish_app.get_webview_window("settings") {
            let script = r#"
(() => window.__clipforgeDevSettingsDomProbeResult ?? {
  scope: "settings-dom",
  pass: false,
  checks: [{ name: "settings.result.present", pass: false, reason: "probe result missing" }]
})()
"#;
            if let Err(error) = window.eval_with_callback(script, move |payload| {
                log_to_file(
                    "info",
                    "dev-open",
                    &format!(
                        "CLIPFORGE_DEV_OPEN={} settings_dom_probe settings {}",
                        finish_target, payload
                    ),
                );
            }) {
                log_to_file(
                    "warn",
                    "dev-open",
                    &format!("settings_dom_probe settings result failed: {error}"),
                );
            }
        }
        if let Some(window) = finish_app.get_webview_window("main") {
            let script = r#"
(() => window.__clipforgeDevTopNavDomProbeResult ?? {
  scope: "top-nav-dom",
  pass: false,
  checks: [{ name: "topNav.result.present", pass: false, reason: "probe result missing" }]
})()
"#;
            if let Err(error) = window.eval_with_callback(script, move |payload| {
                log_to_file(
                    "info",
                    "dev-open",
                    &format!("settings_dom_probe top_nav {}", payload),
                );
            }) {
                log_to_file(
                    "warn",
                    "dev-open",
                    &format!("settings_dom_probe top_nav result failed: {error}"),
                );
            }
        }
    }) {
        log_to_file(
            "warn",
            "dev-open",
            &format!("settings_dom_probe result dispatch failed: {error}"),
        );
    }
}

#[cfg(debug_assertions)]
fn schedule_dev_perf_probe<R: tauri::Runtime>(app: tauri::AppHandle<R>, target: String) {
    thread::spawn(move || {
        thread::sleep(std::time::Duration::from_millis(3_000));
        let repeat_count = dev_perf_probe_repeat_count();
        let window_label = dev_open_window_label(&target);
        if window_label == "main" {
            for probe_index in 0..repeat_count {
                let app_for_emit = app.clone();
                let target_for_emit = target.clone();
                let target_for_emit_dispatch = target_for_emit.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    if let Some(window) = app_for_emit.get_webview_window("main") {
                        if let Err(error) = window.emit("clipforge://show-quick-panel", "dev-open")
                        {
                            log_to_file(
                                "warn",
                                "dev-open",
                                &format!(
                                    "CLIPFORGE_DEV_OPEN={} perf_probe show event {}/{} failed: {}",
                                    target_for_emit,
                                    probe_index + 1,
                                    repeat_count,
                                    error
                                ),
                            );
                        }
                    }
                }) {
                    log_to_file(
                        "warn",
                        "dev-open",
                        &format!(
                            "CLIPFORGE_DEV_OPEN={} perf_probe show dispatch {}/{} failed: {}",
                            target_for_emit_dispatch,
                            probe_index + 1,
                            repeat_count,
                            error
                        ),
                    );
                }
                if dev_quick_probe_enabled() && !dev_quick_probe_can_run() {
                    log_to_file(
                        "warn",
                        "dev-open",
                        "quick_probe skipped: controlled paste target is not ready",
                    );
                } else if dev_quick_probe_can_run() {
                    thread::sleep(std::time::Duration::from_millis(180));
                    restore_dev_quick_probe_target_bundle();
                    let app_for_eval = app.clone();
                    let target_for_eval = target.clone();
                    let target_for_eval_dispatch = target_for_eval.clone();
                    if let Err(error) = app.run_on_main_thread(move || {
                        let Some(window) = app_for_eval.get_webview_window("main") else {
                            return;
                        };
                        if let Err(error) = window.eval(dev_quick_probe_script(probe_index)) {
                            log_to_file(
                                "warn",
                                "dev-open",
                                &format!(
                                    "CLIPFORGE_DEV_OPEN={} quick_probe eval {}/{} failed: {}",
                                    target_for_eval,
                                    probe_index + 1,
                                    repeat_count,
                                    error
                                ),
                            );
                        }
                    }) {
                        log_to_file(
                            "warn",
                            "dev-open",
                            &format!(
                                "CLIPFORGE_DEV_OPEN={} quick_probe dispatch {}/{} failed: {}",
                                target_for_eval_dispatch,
                                probe_index + 1,
                                repeat_count,
                                error
                            ),
                        );
                    }
                    thread::sleep(std::time::Duration::from_millis(820));
                }
                if probe_index + 1 < repeat_count {
                    thread::sleep(std::time::Duration::from_millis(450));
                }
            }
            thread::sleep(std::time::Duration::from_millis(1_200));
        } else if window_label == "settings" {
            for probe_index in 0..repeat_count {
                let app_for_eval = app.clone();
                let target_for_eval = target.clone();
                let target_for_eval_dispatch = target_for_eval.clone();
                if let Err(error) = app.run_on_main_thread(move || {
                    let Some(window) = app_for_eval.get_webview_window("settings") else {
                        return;
                    };
                    let script = format!(
                        r#"
(() => {{
  const items = Array.from(document.querySelectorAll(".settings-redesign-sidebar-item"));
  if (items.length === 0) return {{ clicked: false, count: 0 }};
  const item = items[{probe_index} % items.length];
  item.click();
  return {{ clicked: true, count: items.length }};
}})()
"#
                    );
                    if let Err(error) = window.eval(script) {
                        log_to_file(
                            "warn",
                            "dev-open",
                            &format!(
                                "CLIPFORGE_DEV_OPEN={} perf_probe settings click {}/{} failed: {}",
                                target_for_eval,
                                probe_index + 1,
                                repeat_count,
                                error
                            ),
                        );
                    }
                }) {
                    log_to_file(
                        "warn",
                        "dev-open",
                        &format!(
                            "CLIPFORGE_DEV_OPEN={} perf_probe settings dispatch {}/{} failed: {}",
                            target_for_eval_dispatch,
                            probe_index + 1,
                            repeat_count,
                            error
                        ),
                    );
                }
                if probe_index + 1 < repeat_count {
                    thread::sleep(std::time::Duration::from_millis(120));
                }
            }
            thread::sleep(std::time::Duration::from_millis(1_000));
        }
        if window_label == "settings" {
            run_dev_settings_changed_probe(app.clone());
            run_dev_i18n_probe(app.clone());
            run_dev_settings_dom_probe(app.clone(), &target);
        }
        let app_for_main = app.clone();
        let target_for_main = target.clone();
        if let Err(error) = app.run_on_main_thread(move || {
            let window_label = dev_open_window_label(&target_for_main);
            let Some(window) = app_for_main.get_webview_window(window_label) else {
                log_to_file(
                    "warn",
                    "dev-open",
                    &format!(
                        "CLIPFORGE_DEV_OPEN={} perf_probe skipped: window {} not found",
                        target_for_main, window_label
                    ),
                );
                return;
            };
            let target_json = serde_json::to_string(&target_for_main)
                .unwrap_or_else(|_| "\"unknown\"".to_string());
            let script = format!(
                r#"
(() => {{
  const perf = window.__clipforgePerf;
  const settingsButtons = Array.from(document.querySelectorAll(".settings-redesign-sidebar-item"));
  const layoutSelectors = [
    ".quick-panel",
    ".quick-workspace",
    ".quick-menu",
    ".quick-row",
    ".quick-content",
    ".quick-line",
    ".topbar",
    "button",
    "input",
    "[role='button']"
  ].join(",");
  const layoutElements = Array.from(document.querySelectorAll(layoutSelectors));
  const viewportWidth = window.innerWidth;
  const documentOverflowX = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
  const bodyOverflowX = Math.max(0, document.body.scrollWidth - viewportWidth);
  const escapedElements = layoutElements
    .map((element) => {{
      const rect = element.getBoundingClientRect();
      return {{
        className: element.className || element.tagName,
        tagName: element.tagName,
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      }};
    }})
    .filter((item) => (documentOverflowX > 0 || bodyOverflowX > 0) && item.width > 0 && (item.left < -1 || item.right > viewportWidth + 1))
    .slice(0, 12);
  const controlOverflow = layoutElements
    .filter((element) => {{
      const style = window.getComputedStyle(element);
      const expectedTextClamp = element.classList?.contains("quick-line") || element.classList?.contains("quick-line-mid");
      const hasVisibleText = (element.textContent ?? "").trim().length > 0;
      const iconOnly = element.classList?.contains("icon-button") || element.classList?.contains("top-menu-trigger");
      return hasVisibleText && !iconOnly && !expectedTextClamp && style.overflowX === "visible" && element.scrollWidth > element.clientWidth + 1;
    }})
    .map((element) => ({{
      className: element.className || element.tagName,
      tagName: element.tagName,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }}))
    .slice(0, 12);
  const sourceCounts = (perf?.samples ?? []).reduce((counts, sample) => {{
    const source = sample?.meta?.sampleSource ?? "unknown";
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }}, {{}});
  // 垂直几何探针（验收专用）：找出渲染到视口顶边之上/底边之下的元素，并给出列表结构坐标。
  const rectOf = (element) => {{
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {{ top: Math.round(rect.top * 10) / 10, bottom: Math.round(rect.bottom * 10) / 10, height: Math.round(rect.height * 10) / 10 }};
  }};
  const viewportHeight = window.innerHeight;
  const verticalEscaped = Array.from(document.querySelectorAll("body *"))
    .map((element) => {{
      const rect = element.getBoundingClientRect();
      return {{ tag: element.tagName, cls: String(element.className ?? "").slice(0, 60), top: Math.round(rect.top * 10) / 10, bottom: Math.round(rect.bottom * 10) / 10, height: Math.round(rect.height * 10) / 10, text: (element.textContent ?? "").trim().slice(0, 30) }};
    }})
    .filter((item) => item.height > 4 && item.top < -1 && item.bottom > 0)
    .slice(0, 10);
  const scroller = Array.from(document.querySelectorAll("div")).find((el) => el.classList.contains("thin-scroll"));
  const articles = Array.from(document.querySelectorAll("article")).slice(0, 4).map(rectOf);
  const mainEl = document.querySelector("main");
  const bodyEl = document.body;
  const vgeom = {{
    viewportHeight,
    scrollY: window.scrollY,
    html: rectOf(document.documentElement),
    body: rectOf(bodyEl),
    bodyStyle: {{
      margin: getComputedStyle(bodyEl).margin,
      padding: getComputedStyle(bodyEl).padding,
      display: getComputedStyle(bodyEl).display,
      alignItems: getComputedStyle(bodyEl).alignItems,
      justifyContent: getComputedStyle(bodyEl).justifyContent,
      minHeight: getComputedStyle(bodyEl).minHeight
    }},
    bodyChildren: Array.from(bodyEl.children).map((child) => rectOf(child)),
    mainTransform: mainEl ? getComputedStyle(mainEl).transform : null,
    mainAnimation: mainEl ? getComputedStyle(mainEl).animationName : null,
    main: rectOf(mainEl),
    header: rectOf(document.querySelector("header")),
    footer: rectOf(document.querySelector("footer")),
    firstArticles: articles,
    scroller: scroller ? {{ top: Math.round(scroller.getBoundingClientRect().top * 10) / 10, scrollTop: scroller.scrollTop, clientHeight: scroller.clientHeight, scrollHeight: scroller.scrollHeight }} : null,
    verticalEscaped
  }};
  return {{
    target: {target_json},
    href: window.location.href,
    title: document.title,
    documentLang: document.documentElement.lang,
    repeatCount: {repeat_count},
    hasPerfCollector: Boolean(perf),
    settingsButtonCount: settingsButtons.length,
    vgeom,
    layout: {{
      viewportWidth,
      documentOverflowX,
      bodyOverflowX,
      escapedCount: escapedElements.length,
      escapedElements,
      controlOverflowCount: controlOverflow.length,
      controlOverflow
    }},
    sourceCounts,
    sampleCount: perf?.samples?.length ?? 0,
    summary: typeof perf?.summary === "function" ? perf.summary() : []
  }};
}})()
"#
            );
            let target_for_callback = target_for_main.clone();
            if let Err(error) = window.eval_with_callback(script, move |payload| {
                log_to_file(
                    "info",
                    "dev-open",
                    &format!(
                        "CLIPFORGE_DEV_OPEN={} perf_probe {}",
                        target_for_callback, payload
                    ),
                );
            }) {
                log_to_file(
                    "warn",
                    "dev-open",
                    &format!(
                        "CLIPFORGE_DEV_OPEN={} perf_probe eval failed: {}",
                        target_for_main, error
                    ),
                );
            }
        }) {
            log_to_file(
                "warn",
                "dev-open",
                &format!(
                    "CLIPFORGE_DEV_OPEN={} perf_probe dispatch failed: {}",
                    target, error
                ),
            );
        }
        if window_label == "main" {
            cleanup_dev_quick_probe_target(app.clone());
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    start_focus_prefetch_thread();
    let mut builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = app.get_webview_window("main") {
                    window.set_skip_taskbar(true).unwrap_or(());
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    configure_quick_panel_window(&window);
                }
            }
            setup_app(app)
        })
        .invoke_handler(tauri::generate_handler![
            write_clipboard_item,
            paste_clipboard_item,
            init_clip_database,
            get_build_info,
            check_update,
            download_update,
            install_update,
            ignore_update_version,
            agent_get_config,
            agent_list_providers,
            agent_list_provider_models,
            agent_check_provider,
            agent_detect,
            agent_prepare_run,
            agent_start_run,
            agent_cancel_run,
            agent_get_run,
            agent_get_transcript,
            agent_restore_session,
            capture_clip_record,
            capture_current_clipboard,
            capture_live_application_context,
            dev_read_clipboard_text,
            query_clip_records,
            search_clip_records,
            soft_delete_clip_records,
            restore_clip_records,
            hard_delete_clip_records,
            update_clip_record,
            save_editor_draft,
            export_clip_records,
            export_clip_text_files,
            import_clip_records,
            check_file_paths,
            cleanup_clip_records,
            read_user_settings,
            write_user_settings,
            get_clipforge_settings,
            settings_get_public,
            settings_patch_public,
            settings_replace_public,
            settings_reset_public,
            settings_service_get,
            settings_service_patch,
            settings_service_replace,
            settings_service_reset,
            settings_service_agent_providers,
            settings_service_agent_check,
            settings_service_agent_models,
            get_clipforge_config_path,
            get_clipforge_database_path,
            get_clipforge_data_stats,
            get_image_storage_path,
            update_clipforge_settings,
            append_app_log,
            get_app_log_path,
            query_app_logs,
            cleanup_app_logs,
            get_log_stats,
            export_diagnostics_bundle,
            set_panel_mode,
            open_settings_window,
            open_settings_window_with_section,
            open_onboarding_window,
            get_launch_at_login,
            set_launch_at_login,
            show_quick_panel_command,
            hide_quick_panel_command,
            toggle_quick_panel_command,
            set_panel_pinned_command,
            is_panel_pinned_command,
            focus_quick_panel_command,
            release_focus_command,
            get_panel_trigger_status,
            focused_input_bounds,
            check_accessibility_permission,
            open_accessibility_settings,
            request_accessibility_permission,
            get_accessibility_diagnostics,
            reset_accessibility_permission,
            start_mcp_server,
            stop_mcp_server,
            get_mcp_status,
        ])
        .build(tauri::generate_context!())
        .expect("error while building ClipForge")
        .run(|_app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                cleanup_agent_children();
            }
        });
}

fn open_panel<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    reason: &str,
) -> Result<PanelTriggerPayload, String> {
    let panel_started = Instant::now();
    let mut panel_last_step = panel_started;
    // 唤起前同步补采一次剪贴板：快速复制后立刻唤起时，100ms 轮询尚未采到新条目，
    // 面板首帧先显示旧列表，300ms 后前端 manual 补采才把新条目顶到首行——列表在
    // 手指落下后才跳动（用户反馈「每次唤起后界面刷新、第一条改变」）。提前到显示前
    // 采集，首帧即最终态。capture_clip_payload 按 content_hash 幂等（重复调用仅
    // promote 同一行），轮询线程稍后重采不会产生重复条目。文本读板 ~1ms、图片数十 ms，
    // 在唤起热路径可接受。
    if !is_listen_paused() && !should_skip_writeback() {
        if let Ok(Some(raw_payload)) = clipboard::read_clipboard_payload() {
            if let Ok(Some(payload)) = apply_capture_settings(raw_payload) {
                let now = now_millis().unwrap_or(0);
                if let Err(error) = capture_clip_payload_with_options(
                    payload,
                    Some("Clipboard".to_string()),
                    now,
                    false,
                ) {
                    log_to_file(
                        "debug",
                        "panel-open-perf",
                        &format!("open_panel: pre-show capture skipped: {}", error),
                    );
                }
            }
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        maybe_prompt_accessibility_on_first_panel(app, reason);
        log_panel_open_step(
            reason,
            "first-permission-dispatch",
            panel_started,
            &mut panel_last_step,
        );
        let strategy = get_strategy_for_source(reason);
        let strategy_clone = strategy.clone();
        log_panel_open_step(
            reason,
            "resolve-strategy",
            panel_started,
            &mut panel_last_step,
        );

        // 入口诊断：来源 -> 策略，以及【逻辑点】光标与其所在屏。配合下游各 position_* 的结果日志，
        // 可完整复现一次唤起的定位决策链（用于排查「出现在错误的屏/位置」）。
        let (cx, cy) = cursor_logical_point(&window).unwrap_or((-1.0, -1.0));
        let cursor_monitor = monitor_for_logical_point(&window, cx, cy)
            .map(|m| get_monitor_id(&m))
            .unwrap_or_default();
        log_panel_open_step(
            reason,
            "cursor-monitor",
            panel_started,
            &mut panel_last_step,
        );
        let acc = check_accessibility_permission_platform()
            .map(|a| a.status)
            .unwrap_or_default();
        log_panel_open_step(
            reason,
            "accessibility-status",
            panel_started,
            &mut panel_last_step,
        );
        log_to_file(
            "debug",
            "panel-position",
            &format!(
            "open_panel: source={} strategy={:?} cursor=({},{}) cursor_monitor={} accessibility={}",
                reason, strategy, cx, cy, cursor_monitor, acc
            ),
        );
        // 粘贴目标快照只用于「粘贴时 activate 目标 App」所需的 bundle id，且其内部会
        // fork osascript（frontmost_app_identity + native_focused_input_bounds）。放到后台
        // 线程执行，避免在唤起热路径上阻塞——用户从面板出现到选中条目通常 >100ms，足够缓存就绪。
        {
            let reason_owned = reason.to_string();
            let fallback = if cx >= 0.0 && cy >= 0.0 {
                Some((cx, cy))
            } else {
                None
            };
            thread::spawn(move || {
                snapshot_paste_target_bounds(&reason_owned, fallback);
            });
        }

        // 宽高可由用户设置覆盖（默认 420×488）。
        let (panel_width, panel_h) = resolve_panel_dims();
        // 1. 计算面板高度（基于当前显示器工作区）
        let panel_height = panel_position(&window, panel_width, panel_h)
            .map(|(_, _, h)| h)
            .unwrap_or(panel_h);
        let _ = window.set_size(LogicalSize::new(panel_width, panel_height));
        log_panel_open_step(
            reason,
            "size-and-height",
            panel_started,
            &mut panel_last_step,
        );

        // 2. 同步应用定位策略（单次定位，不重复）
        let position_source: String =
            match apply_position_strategy(&window, strategy, panel_width, panel_height) {
                Some((x, y)) => {
                    set_panel_position(&window, x, y);
                    format!("sync-{:?}", strategy_clone)
                }
                None => {
                    // 策略失败时用 fallback 居中
                    if let Some((fx, fy, _)) = panel_position(&window, panel_width, panel_height) {
                        set_panel_position(&window, fx, fy);
                    }
                    format!("fallback-{:?}", strategy_clone)
                }
            };
        log_panel_open_step(reason, "position", panel_started, &mut panel_last_step);

        // 3. 显示窗口
        show_panel_window(app, &window);
        log_panel_open_step(reason, "show-window", panel_started, &mut panel_last_step);
        let _ = window.emit("clipforge://show-quick-panel", reason);
        log_panel_open_step(reason, "emit-show", panel_started, &mut panel_last_step);

        // 不再在显示后用焦点输入框位置【覆盖】定位：那条 osascript 异步路径会在面板已可见时
        // 再次 set_panel_position，造成「先出现在光标处、再跳到输入框处」的可见跳动（用户反映像
        // bug 一样闪烁）。按需求：触发那一刻位置确定即可（上面的同步 apply_position_strategy），
        // 显示之后不再移动面板，消除闪烁。

        let payload = panel_trigger_payload(
            &window,
            reason,
            &position_source,
            &format!("{:?}", strategy_clone),
        );
        log_panel_open_step(reason, "payload", panel_started, &mut panel_last_step);
        Ok(payload)
    } else {
        Err("main window is not available".to_string())
    }
}

fn hide_panel<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    reason: &str,
) -> Result<PanelTriggerPayload, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;

    // 面板已固定时，尊重用户意图：不隐藏（失焦/外部点击/切换 App 都保持可见）。
    if is_panel_pinned() {
        log_to_file("debug", "panel-pin", "hide skipped: panel is pinned");
        return Ok(panel_trigger_payload(&window, reason, "pinned", ""));
    }

    save_panel_position(&window);

    #[cfg(target_os = "macos")]
    {
        if let Ok(panel) = app.get_webview_panel("main") {
            panel.resign_key_window();
            panel.hide();
        } else {
            let _ = window.hide();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.hide();
    }
    let _ = window.emit("clipforge://hide-quick-panel", reason);
    Ok(panel_trigger_payload(&window, reason, "hidden", ""))
}

fn show_quick_panel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, reason: &str) {
    if let Err(error) = open_panel(app, reason) {
        let _ = append_app_log(
            "warn".to_string(),
            "Open quick panel failed".to_string(),
            Some(error),
        );
    }
}

/// 切换面板可见性。快捷键用这个而非 show_quick_panel：
/// 面板已可见时再按快捷键应当【隐藏】（toggle），否则面板常驻可见、再按 show 是 no-op，
/// 主观上表现为「快捷键只生效一次」。
fn toggle_quick_panel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, reason: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    let panel_visible = app
        .get_webview_panel("main")
        .ok()
        .map(|panel| panel.is_visible())
        .unwrap_or(false);
    // 诊断「需要按两下才触发」：记录每次 toggle 的决策依据（show/hide）与当时的可见/聚焦状态。
    // 若用户反映第一次按下没反应，看这条日志即可判断是走了 hide 分支（可见性误判）还是
    // show 分支后焦点没进来（非激活 NSPanel 的 key-window 问题）。
    log_to_file(
        "info",
        "panel-toggle",
        &format!(
            "toggle reason={} decision={} windowVisible={} windowFocused={} panelVisible={}",
            reason,
            if visible { "hide" } else { "show" },
            visible,
            focused,
            panel_visible
        ),
    );
    if visible {
        let _ = hide_panel(app, reason);
    } else {
        show_quick_panel(app, reason);
    }
}

/// 面板「固定」状态：true 时失焦/外部点击不自动隐藏（参考 EcoPaste CLIPBOARD_WINDOW_PINNED）。
pub(crate) static PANEL_PINNED: AtomicBool = AtomicBool::new(false);

fn is_panel_pinned() -> bool {
    PANEL_PINNED.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_panel_pinned_command(pinned: bool) -> Result<bool, String> {
    PANEL_PINNED.store(pinned, Ordering::Relaxed);
    log_to_file(
        "info",
        "panel-pin",
        &format!("set pinned = {} (stay-in-place)", pinned),
    );
    Ok(pinned)
}

/// 权威查询固定状态（对齐 EcoPaste should_auto_hide：隐藏决策统一以 Rust 标志为准，
/// 避免前端 settingsRef 与 Rust PANEL_PINNED 不同步导致固定后仍被前端 appWindow.hide() 误关）。
#[tauri::command]
fn is_panel_pinned_command() -> bool {
    is_panel_pinned()
}

/// 剪贴板「监听暂停」标志：true 时后台监听线程跳过采集（对齐 EcoPaste 托盘暂停监听）。
/// 仅影响读取入库；写回抑制、粘贴模拟、面板交互不受影响。进程内状态，重启重置。
static LISTEN_PAUSED: AtomicBool = AtomicBool::new(false);

fn is_listen_paused() -> bool {
    LISTEN_PAUSED.load(Ordering::Relaxed)
}

fn set_listen_paused(paused: bool) -> bool {
    LISTEN_PAUSED.store(paused, Ordering::Relaxed);
    paused
}

fn panel_trigger_payload<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    source: &str,
    position_source: &str,
    focused_input_source: &str,
) -> PanelTriggerPayload {
    let position = window.outer_position().ok();
    let size = window.outer_size().ok();
    let accessibility =
        check_accessibility_permission_platform().unwrap_or(AccessibilityPermissionPayload {
            status: "unsupported".to_string(),
            can_read_focused_input: false,
            message: "accessibility status unavailable".to_string(),
        });
    PanelTriggerPayload {
        visible: window.is_visible().unwrap_or(false),
        focused: window.is_focused().unwrap_or(false),
        x: position.as_ref().map(|value| value.x as f64).unwrap_or(0.0),
        y: position.as_ref().map(|value| value.y as f64).unwrap_or(0.0),
        width: size.as_ref().map(|value| value.width as f64).unwrap_or(0.0),
        height: size
            .as_ref()
            .map(|value| value.height as f64)
            .unwrap_or(0.0),
        source: source.to_string(),
        position_source: position_source.to_string(),
        focused_input_source: focused_input_source.to_string(),
        used_focused_input: position_source.starts_with("focused-input"),
        accessibility_status: accessibility.status,
        message: accessibility.message,
    }
}

#[cfg(target_os = "macos")]
fn set_panel_position<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, x: f64, y: f64) {
    let _ = window.set_position(LogicalPosition::new(x, y));
}

#[cfg(not(target_os = "macos"))]
fn set_panel_position<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, x: f64, y: f64) {
    let _ = window.set_position(LogicalPosition::new(x, y));
}

#[allow(dead_code)] // 原供「显示后用焦点输入框位置覆盖面板定位」的异步线程使用；该线程会引发可见跳动已移除。
fn compute_panel_position<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    focus: &CachedFocusBounds,
) -> Option<(f64, f64, f64)> {
    let monitors = window.available_monitors().ok()?;
    let focus_x = focus.x;
    let focus_y = focus.y;
    let focus_width = focus.width;
    let focus_height = focus.height;

    let target_monitor = monitors
        .into_iter()
        .find(|monitor| {
            let scale = monitor.scale_factor();
            let work_area = monitor.work_area();
            let position = work_area.position.to_logical::<f64>(scale);
            let size = work_area.size.to_logical::<f64>(scale);
            focus_x >= position.x
                && focus_x < position.x + size.width
                && focus_y >= position.y
                && focus_y < position.y + size.height
        })
        .or_else(|| window.current_monitor().ok().flatten())?;

    let target_scale = target_monitor.scale_factor();
    let work_area = target_monitor.work_area();
    let position = work_area.position.to_logical::<f64>(target_scale);
    let size = work_area.size.to_logical::<f64>(target_scale);
    let max_height = (size.height - QUICK_PANEL_MARGIN * 2.0).min(QUICK_PANEL_MAX_HEIGHT);
    let panel_height = resolve_panel_dims()
        .1
        .min(max_height.max(QUICK_PANEL_MIN_HEIGHT))
        .max(QUICK_PANEL_MIN_HEIGHT);

    let center_x = focus_x + focus_width / 2.0;
    let input_bottom_y = focus_y + focus_height;
    let panel_x = (center_x - panel_width / 2.0).max(position.x + QUICK_PANEL_MARGIN);
    let panel_y = (input_bottom_y + QUICK_PANEL_MARGIN)
        .min(position.y + size.height - panel_height - QUICK_PANEL_MARGIN);

    let min_x = position.x + QUICK_PANEL_MARGIN;
    let max_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
    let min_y = position.y + QUICK_PANEL_MARGIN;
    let max_y = position.y + size.height - panel_height - QUICK_PANEL_MARGIN;
    let final_x = panel_x.clamp(min_x, max_x.max(min_x));
    let final_y = panel_y.clamp(min_y, max_y.max(min_y));

    log_to_file("debug", "panel-position", &format!(
        "compute: focus=({},{}) size=({},{}), monitor=({},{}) size=({},{}) scale={}, result=({},{}) height={}",
        focus_x, focus_y, focus_width, focus_height,
        position.x, position.y, size.width, size.height, target_scale,
        final_x, final_y, panel_height
    ));

    Some((final_x, final_y, panel_height))
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
            sync_nonactivating_panel_focus_tag(&panel);
            panel.set_collection_behavior(
                CollectionBehavior::new()
                    .full_screen_auxiliary()
                    .can_join_all_spaces()
                    .into(),
            );
            panel.set_hides_on_deactivate(false);
            panel.set_works_when_modal(true);
            log_to_file(
                "info",
                "panel-focus",
                &format!(
                    "configured mac panel: canBecomeKey={} canBecomeMain={} hidesOnDeactivate={} fullScreenAuxiliary=true version={}",
                    panel.can_become_key_window(),
                    panel.can_become_main_window(),
                    panel.hides_on_deactivate(),
                    APP_VERSION
                ),
            );
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
fn sync_nonactivating_panel_focus_tag<R: tauri::Runtime>(panel: &Arc<dyn tauri_nspanel::Panel<R>>) {
    unsafe {
        let raw_panel = panel.as_ref().as_panel();
        let responds: bool = tauri_nspanel::objc2::msg_send![
            raw_panel,
            respondsToSelector: tauri_nspanel::objc2::sel!(_setPreventsActivation:)
        ];
        if !responds {
            log_to_file(
                "warn",
                "panel-focus",
                "_setPreventsActivation: unavailable; nonactivating keyboard focus may fail",
            );
            return;
        }
        let _: () = tauri_nspanel::objc2::msg_send![raw_panel, _setPreventsActivation: true];
        log_to_file(
            "debug",
            "panel-focus",
            "synced nonactivating preventsActivation=true",
        );
    }
}

#[cfg(target_os = "macos")]
fn show_panel_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    show_floating_window_by_label(app, "main", window);
}

/// 通用浮窗显示：把指定 label 的窗口设为 NSPanel status-level 浮动面板并置于最前。
/// 剪贴板主面板等浮窗共用同一「悬浮于其他应用之上」能力，按 label 泛化。
#[cfg(target_os = "macos")]
fn show_floating_window_by_label<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    window: &tauri::WebviewWindow<R>,
) {
    if let Ok(panel) = app.get_webview_panel(label) {
        panel.set_level(quick_panel_level());
        panel.order_front_regardless();
        panel.show_and_make_key();
        // 二次唤起时 NSPanel 已 resign_key，show_and_make_key 后再补一次 webview 级
        // set_focus，确保键盘事件能进面板（修复「第二次触发不聚焦、快捷键不生效」）。
        let _ = window.set_focus();
        focus_webview_for_input(window);
        log_to_file(
            "info",
            "panel-focus",
            &format!(
                "show floating window {}: panelVisible={} windowVisible={} focused={} canBecomeKey={} hidesOnDeactivate={}",
                label,
                panel.is_visible(),
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false),
                panel.can_become_key_window(),
                panel.hides_on_deactivate()
            ),
        );
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        log_to_file(
            "warn",
            "panel-focus",
            &format!(
                "show floating window {} fallback window path: visible={} focused={}",
                label,
                window.is_visible().unwrap_or(false),
                window.is_focused().unwrap_or(false)
            ),
        );
    }
}

#[cfg(target_os = "macos")]
fn focus_webview_for_input<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Err(error) = window.with_webview(|webview| unsafe {
        let ns_window: &AppKitNSWindow = &*webview.ns_window().cast::<AppKitNSWindow>();
        let webview_responder: &NSResponder = &*webview.inner().cast::<NSResponder>();
        let accepted = ns_window.makeFirstResponder(Some(webview_responder));
        log_to_file(
            "debug",
            "panel-focus",
            &format!("makeFirstResponder(WKWebView) accepted={}", accepted),
        );
    }) {
        log_to_file(
            "warn",
            "panel-focus",
            &format!("focus WKWebView failed: {}", error),
        );
    }
}

#[cfg(target_os = "macos")]
fn quick_panel_level() -> i64 {
    PanelLevel::Status.value()
}

#[cfg(not(target_os = "macos"))]
fn show_panel_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) {
    show_floating_window_by_label(app, "main", window);
}

#[cfg(not(target_os = "macos"))]
fn show_floating_window_by_label<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _label: &str,
    window: &tauri::WebviewWindow<R>,
) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn panel_position<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    fallback_height: f64,
) -> Option<(f64, f64, f64)> {
    // 优先用【逻辑点】光标命中屏；光标读不到时退到 primary（不用 current_monitor，隐藏态陈旧）。
    let monitor = cursor_logical_point(window)
        .and_then(|(x, y)| monitor_for_logical_point(window, x, y))
        .or_else(|| window.primary_monitor().ok().flatten())?;

    {
        let scale = monitor.scale_factor();
        let work_area = monitor.work_area();
        let position = work_area.position.to_logical::<f64>(scale);
        let size = work_area.size.to_logical::<f64>(scale);
        let max_height = (size.height - QUICK_PANEL_MARGIN * 2.0).min(QUICK_PANEL_MAX_HEIGHT);
        let panel_height = fallback_height
            .min(max_height.max(QUICK_PANEL_MIN_HEIGHT))
            .max(QUICK_PANEL_MIN_HEIGHT);
        let fallback_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
        let fallback_y = position.y + ((size.height - panel_height) / 2.0).max(QUICK_PANEL_MARGIN);
        let (x, y) = (fallback_x, fallback_y);
        let min_x = position.x + QUICK_PANEL_MARGIN;
        let max_x = position.x + size.width - panel_width - QUICK_PANEL_MARGIN;
        let min_y = position.y + QUICK_PANEL_MARGIN;
        let max_y = position.y + size.height - panel_height - QUICK_PANEL_MARGIN;
        let final_x = x.clamp(min_x, max_x.max(min_x));
        let final_y = y.clamp(min_y, max_y.max(min_y));

        log_to_file(
            "debug",
            "panel-position",
            &format!(
                "fallback: monitor=({},{}) size=({},{}) scale={}, result=({},{}) height={}",
                position.x,
                position.y,
                size.width,
                size.height,
                scale,
                final_x,
                final_y,
                panel_height
            ),
        );

        Some((final_x, final_y, panel_height))
    }
}

fn mark_native_position_failure() {
    if let Ok(now) = now_millis() {
        LAST_NATIVE_POSITION_FAILURE_MS.store(now, Ordering::Relaxed);
    }
}

fn get_monitor_id(monitor: &tauri::Monitor) -> String {
    monitor
        .name()
        .map_or("primary".to_string(), |v| v.to_string())
}

/// 返回当前鼠标在【全局逻辑点】坐标系下的位置（主屏左上为原点）。
///
/// macOS 优先用 `CGEvent.location()`，避免 tao `cursor_position()` 在混合 DPI 多屏下用
/// 【主屏】scale 把逻辑点转物理、再被 `monitor_from_point`(期望逻辑点) 误判屏的连锁错误。
/// 任一原生调用失败时，回退到 tao 的物理坐标并按主屏 scale 折算回逻辑点。
#[cfg(target_os = "macos")]
fn cursor_logical_point<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Option<(f64, f64)> {
    if let Ok(source) = CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
        if let Ok(event) = CGEvent::new(source) {
            let point = event.location();
            return Some((point.x, point.y));
        }
    }
    let scale = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    window
        .cursor_position()
        .ok()
        .map(|p| (p.x / scale.max(0.0001), p.y / scale.max(0.0001)))
}

#[cfg(not(target_os = "macos"))]
fn cursor_logical_point<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Option<(f64, f64)> {
    let scale = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    window
        .cursor_position()
        .ok()
        .map(|p| (p.x / scale.max(0.0001), p.y / scale.max(0.0001)))
}

/// 在【逻辑点】空间下找到包含 (x, y) 的显示器。
///
/// 顺序：`monitor_from_point`(期望逻辑点) → 自行用 work_area 逻辑边界做命中测试
/// (兜底缝隙/越界/混合 DPI 边界) → primary。
/// 注意：绝不回退到 `current_monitor()`，面板隐藏时它指向「上次所在屏」，是多屏错位的根因。
fn monitor_for_logical_point<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    x: f64,
    y: f64,
) -> Option<tauri::Monitor> {
    if let Some(monitor) = window.monitor_from_point(x, y).ok().flatten() {
        log_to_file(
            "debug",
            "panel-position",
            &format!(
                "monitor_pick: point=({},{}) -> {} [monitor_from_point]",
                x,
                y,
                get_monitor_id(&monitor)
            ),
        );
        return Some(monitor);
    }
    if let Ok(monitors) = window.available_monitors() {
        for monitor in monitors {
            let scale = monitor.scale_factor();
            let work_area = monitor.work_area();
            let position = work_area.position.to_logical::<f64>(scale);
            let size = work_area.size.to_logical::<f64>(scale);
            if x >= position.x
                && x < position.x + size.width
                && y >= position.y
                && y < position.y + size.height
            {
                log_to_file(
                    "debug",
                    "panel-position",
                    &format!(
                        "monitor_pick: point=({},{}) -> {} [work_area-containment]",
                        x,
                        y,
                        get_monitor_id(&monitor)
                    ),
                );
                return Some(monitor);
            }
        }
    }
    // 关键失败模式：光标点不落在任何显示器（缝隙/越界/混合 DPI 单位异常）。
    // 用 warn 标出，便于在日志里直接定位「为何选了 primary 而不是光标屏」。
    let primary = window.primary_monitor().ok().flatten();
    log_to_file(
        "warn",
        "panel-position",
        &format!(
            "monitor_pick: point=({},{}) -> {} [PRIMARY FALLBACK: cursor not on any monitor]",
            x,
            y,
            primary.as_ref().map(get_monitor_id).unwrap_or_default()
        ),
    );
    primary
}

fn get_current_monitor_from_cursor<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Option<tauri::Monitor> {
    let (x, y) = cursor_logical_point(window)?;
    monitor_for_logical_point(window, x, y)
}

fn position_follow_cursor<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) -> Option<(f64, f64)> {
    // 统一在【逻辑点】空间计算：cursor_logical_point 与 work_area.to_logical(scale) 同空间，
    // 下游 set_position(LogicalPosition) 也按逻辑点解释，消除 Retina(2x) 下「物理当逻辑」的 2× 偏移。
    let (cursor_x, cursor_y) = cursor_logical_point(window)?;
    let monitor = monitor_for_logical_point(window, cursor_x, cursor_y)?;
    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let monitor_pos = work_area.position.to_logical::<f64>(scale);
    let monitor_size = work_area.size.to_logical::<f64>(scale);

    let max_x = monitor_pos.x + monitor_size.width - panel_width - QUICK_PANEL_MARGIN;
    let max_y = monitor_pos.y + monitor_size.height - panel_height - QUICK_PANEL_MARGIN;
    let min_x = monitor_pos.x + QUICK_PANEL_MARGIN;
    let min_y = monitor_pos.y + QUICK_PANEL_MARGIN;

    let x = cursor_x.clamp(min_x, max_x.max(min_x));
    let y = cursor_y.clamp(min_y, max_y.max(min_y));

    log_to_file(
        "debug",
        "panel-position",
        &format!(
            "followCursor: cursor=({},{}) monitor=({},{}) size=({},{}) scale={} result=({},{})",
            cursor_x,
            cursor_y,
            monitor_pos.x,
            monitor_pos.y,
            monitor_size.width,
            monitor_size.height,
            scale,
            x,
            y
        ),
    );

    Some((x, y))
}

fn position_center<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) -> Option<(f64, f64)> {
    let monitor = get_current_monitor_from_cursor(window)?;
    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let monitor_pos = work_area.position.to_logical::<f64>(scale);
    let monitor_size = work_area.size.to_logical::<f64>(scale);

    let x = monitor_pos.x + (monitor_size.width - panel_width) / 2.0;
    let y = monitor_pos.y + (monitor_size.height - panel_height) / 2.0;

    log_to_file(
        "debug",
        "panel-position",
        &format!(
            "center: monitor=({},{}) size=({},{}) result=({},{})",
            monitor_pos.x, monitor_pos.y, monitor_size.width, monitor_size.height, x, y
        ),
    );

    Some((x, y))
}

fn position_tray_center<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(script) = read_command(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\"\n    set dockPos to position of dock\n    set dockSize to size of dock\nend tell\nreturn item 1 of dockPos as string & \",\" & item 2 of dockPos as string & \",\" & item 1 of dockSize as string & \",\" & item 2 of dockSize as string",
            ],
        ) {
            let parts: Vec<&str> = script.trim().split(',').collect();
            if parts.len() == 4 {
                if let (Ok(dock_x), Ok(dock_y), Ok(dock_w), Ok(dock_h)) = (
                    parts[0].parse::<f64>(),
                    parts[1].parse::<f64>(),
                    parts[2].parse::<f64>(),
                    parts[3].parse::<f64>(),
                ) {
                    // 用【光标命中屏】（点托盘时光标就在托盘图标上方），而非 current_monitor()
                    // （面板上次所在屏）——否则多屏下面板会跑到错误的那块屏。
                    let (screen_width, screen_height, _scale) = get_current_monitor_from_cursor(window)
                        .map(|m| {
                            let s = m.size();
                            let sf = m.scale_factor();
                            (s.width as f64 / sf, s.height as f64 / sf, sf)
                        })
                        .unwrap_or((1920.0, 1080.0, 1.0));

                    let is_bottom = dock_y > screen_height / 2.0;
                    let is_right = dock_x > screen_width / 2.0;
                    let is_left = !is_right;

                    let win_size = window.inner_size().ok();
                    let win_width = win_size.map(|s| s.width as f64).unwrap_or(460.0);
                    let win_height = win_size.map(|s| s.height as f64).unwrap_or(680.0);

                    let x = if is_left {
                        dock_w + 10.0
                    } else if is_right {
                        screen_width - dock_w - win_width - 10.0
                    } else {
                        dock_x + dock_w / 2.0 - win_width / 2.0
                    };

                    let y = if is_bottom {
                        dock_y - win_height - 10.0
                    } else {
                        dock_h + 10.0
                    };

                    window.set_position(tauri::LogicalPosition::new(x, y))
                        .map_err(|e| format!("Move window to tray center failed: {}", e))?;
                    log_to_file("debug", "panel-position", &format!(
                        "trayCenter: dock=({},{}) size=({},{}) result=({},{})",
                        dock_x, dock_y, dock_w, dock_h, x, y
                    ));
                    return Ok(());
                }
            }
        }
    }

    use tauri_plugin_positioner::{Position, WindowExt};
    window
        .move_window(Position::BottomCenter)
        .map_err(|e| format!("Move window to tray center failed: {}", e))?;
    log_to_file(
        "debug",
        "panel-position",
        "trayCenter: positioner fallback called",
    );
    Ok(())
}

fn position_window_center<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(script) = read_command(
            "osascript",
            &[
                "-e",
                "tell application \"System Events\"\n    set frontApp to name of first application process whose frontmost is true\nend tell\n\ntell application frontApp\n    set frontWindow to front window\n    if frontWindow exists then\n        set winBounds to bounds of frontWindow\n        return item 1 of winBounds as string & \",\" & item 2 of winBounds as string & \",\" & item 3 of winBounds as string & \",\" & item 4 of winBounds as string\n    else\n        return \"\"\n    end if\nend tell",
            ],
        ) {
            let parts: Vec<&str> = script.trim().split(',').collect();
            if parts.len() == 4 {
                if let (Ok(x), Ok(y), Ok(w), Ok(h)) = (
                    parts[0].parse::<f64>(),
                    parts[1].parse::<f64>(),
                    parts[2].parse::<f64>(),
                    parts[3].parse::<f64>(),
                ) {
                    let window_width = w - x;
                    let window_height = h - y;
                    let center_x = x + window_width / 2.0 - panel_width / 2.0;
                    let center_y = y + window_height / 2.0 - panel_height / 2.0;

                    log_to_file("debug", "panel-position", &format!(
                        "windowCenter: window=({},{}) size=({},{}) result=({},{})",
                        x, y, window_width, window_height, center_x, center_y
                    ));

                    return Some((center_x, center_y));
                }
            }
        }
    }

    log_to_file(
        "debug",
        "panel-position",
        "windowCenter: no front window found",
    );
    None
}

fn position_last_position<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) -> Option<(f64, f64)> {
    let last_pos = panel_last_position().lock().ok()?.clone()?;
    let monitors = window.available_monitors().ok()?;

    let target_monitor = monitors
        .into_iter()
        .find(|m| get_monitor_id(m) == last_pos.monitor_id.clone().unwrap_or_default())
        .or_else(|| get_current_monitor_from_cursor(window));

    let Some(monitor) = target_monitor else {
        log_to_file(
            "warn",
            "panel-position",
            "lastPosition: no matching monitor found, fallback to center",
        );
        return position_center(window, panel_width, panel_height);
    };

    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let monitor_pos = work_area.position.to_logical::<f64>(scale);
    let monitor_size = work_area.size.to_logical::<f64>(scale);

    let x = monitor_pos.x + last_pos.x * monitor_size.width;
    let y = monitor_pos.y + last_pos.y * monitor_size.height;

    let max_x = monitor_pos.x + monitor_size.width - panel_width - QUICK_PANEL_MARGIN;
    let max_y = monitor_pos.y + monitor_size.height - panel_height - QUICK_PANEL_MARGIN;
    let min_x = monitor_pos.x + QUICK_PANEL_MARGIN;
    let min_y = monitor_pos.y + QUICK_PANEL_MARGIN;

    let final_x = x.clamp(min_x, max_x.max(min_x));
    let final_y = y.clamp(min_y, max_y.max(min_y));

    log_to_file(
        "debug",
        "panel-position",
        &format!(
            "lastPosition: normalized=({},{}) monitor=({},{}) size=({},{}) result=({},{})",
            last_pos.x,
            last_pos.y,
            monitor_pos.x,
            monitor_pos.y,
            monitor_size.width,
            monitor_size.height,
            final_x,
            final_y
        ),
    );

    Some((final_x, final_y))
}

fn save_panel_position<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let Ok(position) = window.outer_position() else {
        log_to_file(
            "warn",
            "panel-position",
            "save: failed to get window position",
        );
        return;
    };

    // outer_position() 返回【物理像素】。先在物理空间里找到面板所在的显示器
    // （面板可见，物理 position 与 work_area(物理) 同空间，可正确处理混合 DPI），
    // 再用该屏 scale 折算成逻辑点做归一化。原先把物理当逻辑点归一化，会污染持久化的 LastPosition。
    let px = position.x;
    let py = position.y;
    let monitor = window
        .available_monitors()
        .ok()
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let wa = m.work_area();
                px >= wa.position.x
                    && px < wa.position.x + wa.size.width as i32
                    && py >= wa.position.y
                    && py < wa.position.y + wa.size.height as i32
            })
        })
        .or_else(|| get_current_monitor_from_cursor(window));
    let Some(monitor) = monitor else {
        log_to_file(
            "warn",
            "panel-position",
            "save: failed to resolve panel monitor",
        );
        return;
    };

    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let monitor_pos = work_area.position.to_logical::<f64>(scale);
    let monitor_size = work_area.size.to_logical::<f64>(scale);

    let logical_x = px as f64 / scale.max(0.0001);
    let logical_y = py as f64 / scale.max(0.0001);

    let normalized_x = ((logical_x - monitor_pos.x) / monitor_size.width).clamp(0.0, 1.0);
    let normalized_y = ((logical_y - monitor_pos.y) / monitor_size.height).clamp(0.0, 1.0);

    if let Ok(mut last_pos) = panel_last_position().lock() {
        *last_pos = Some(NormalizedPosition {
            x: normalized_x,
            y: normalized_y,
            monitor_id: Some(get_monitor_id(&monitor)),
        });

        log_to_file(
            "debug",
            "panel-position",
            &format!(
                "save: position=({},{}) normalized=({},{}) monitor={}",
                logical_x,
                logical_y,
                normalized_x,
                normalized_y,
                get_monitor_id(&monitor)
            ),
        );
    } else {
        log_to_file(
            "warn",
            "panel-position",
            "save: failed to lock last position cache",
        );
    }
}

/// 取【激活（最上层非系统）窗体】的几何 frame，单位为 CG 全局逻辑点（左上原点），
/// 与本文件统一的逻辑点空间一致。原生 CGWindowList，无需辅助功能权限、无 osascript 阻塞。
#[cfg(target_os = "macos")]
fn active_window_frame_logical() -> Option<(f64, f64, f64, f64)> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::window::{
        kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    };

    // CGWindowListCopyWindowInfo 的数组元素是 CFDictionary。CFDictionary<CFString,CFType>
    // 未实现 ConcreteCFType、不能 downcast；这里取出每个元素的原始引用再 wrap 成强类型 dict。
    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let array = core_graphics::window::copy_window_info(options, 0)?;

    for item in array.iter() {
        let raw: *const std::ffi::c_void = *item;
        if raw.is_null() {
            continue;
        }
        let dict: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(raw as _) };

        // 跳过系统壳层 / ClipForge 自身窗口；列表按 z-order，第一个有效项即激活窗体。
        let owner_name = dict
            .find(&CFString::new("kCGWindowOwnerName"))
            .and_then(|owner| owner.downcast::<CFString>())
            .map(|s| s.to_string());
        if let Some(ref name) = owner_name {
            if matches!(
                name.as_str(),
                "Dock"
                    | "Window Server"
                    | "SystemUIServer"
                    | "ControlCenter"
                    | "Control Centre"
                    | "ClipForge"
            ) {
                continue;
            }
        }

        let Some(bounds_value) = dict.find(&CFString::new("kCGWindowBounds")) else {
            continue;
        };
        let bounds_raw: *const std::ffi::c_void = bounds_value.as_concrete_TypeRef();
        if bounds_raw.is_null() {
            continue;
        }
        let bounds: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(bounds_raw as _) };
        let read = |key: &str| -> Option<f64> {
            bounds
                .find(&CFString::new(key))
                .and_then(|v| v.downcast::<CFNumber>())
                .and_then(|n| n.to_f64())
        };
        let (Some(x), Some(y), Some(width), Some(height)) =
            (read("X"), read("Y"), read("Width"), read("Height"))
        else {
            continue;
        };
        if width < 1.0 || height < 1.0 {
            continue;
        }
        log_to_file(
            "debug",
            "panel-position",
            &format!(
                "activeWindowFrame: owner={:?} frame=({},{},{},{})",
                owner_name, x, y, width, height
            ),
        );
        return Some((x, y, width, height));
    }
    log_to_file(
        "debug",
        "panel-position",
        "activeWindowFrame: no eligible window found",
    );
    None
}

#[cfg(not(target_os = "macos"))]
fn active_window_frame_logical() -> Option<(f64, f64, f64, f64)> {
    None
}

/// 把面板定位到【激活窗体几何中心】，并夹进该窗体所在屏的 work_area。
/// 作为所有策略的稳定兜底（用户要求：定位不准时至少落在激活窗体中间）。
fn position_active_window_center<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) -> Option<(f64, f64)> {
    let (wx, wy, ww, wh) = active_window_frame_logical()?;
    let center_x = wx + ww / 2.0 - panel_width / 2.0;
    let center_y = wy + wh / 2.0 - panel_height / 2.0;
    let monitor = monitor_for_logical_point(window, wx + ww / 2.0, wy + wh / 2.0)?;
    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let pos = work_area.position.to_logical::<f64>(scale);
    let size = work_area.size.to_logical::<f64>(scale);
    let min_x = pos.x + QUICK_PANEL_MARGIN;
    let max_x = pos.x + size.width - panel_width - QUICK_PANEL_MARGIN;
    let min_y = pos.y + QUICK_PANEL_MARGIN;
    let max_y = pos.y + size.height - panel_height - QUICK_PANEL_MARGIN;
    let x = center_x.clamp(min_x, max_x.max(min_x));
    let y = center_y.clamp(min_y, max_y.max(min_y));
    log_to_file(
        "debug",
        "panel-position",
        &format!(
            "activeWindowCenter: window=({},{},{},{}) monitor=({},{}) result=({},{})",
            wx, wy, ww, wh, pos.x, pos.y, x, y
        ),
    );
    Some((x, y))
}

fn apply_position_strategy<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    strategy: PanelPositionStrategy,
    panel_width: f64,
    panel_height: f64,
) -> Option<(f64, f64)> {
    // 统一兜底链：主策略 → 激活窗体中心 → 光标跟随 → 屏幕中心。
    // 任一主策略失败都不会落到错屏/越界；最差也落在「当前激活窗体中间」（用户兜底要求）。
    let ladder = |primary: Option<(f64, f64)>| -> Option<(f64, f64)> {
        let primary_used = primary.is_some();
        let result = primary
            .or_else(|| position_active_window_center(window, panel_width, panel_height))
            .or_else(|| position_follow_cursor(window, panel_width, panel_height))
            .or_else(|| position_center(window, panel_width, panel_height));
        log_to_file(
            "debug",
            "panel-position",
            &format!("ladder: primary_used={} result={:?}", primary_used, result),
        );
        result
    };
    match strategy {
        PanelPositionStrategy::TrayCenter => {
            if position_tray_center(window).is_ok() {
                // position_tray_center 内部已自行 set_position
                return None;
            }
            log_to_file(
                "warn",
                "panel-position",
                "TrayCenter failed, fallback ladder",
            );
            ladder(None)
        }
        PanelPositionStrategy::FollowCursor => {
            ladder(position_follow_cursor(window, panel_width, panel_height))
        }
        PanelPositionStrategy::Center => ladder(position_center(window, panel_width, panel_height)),
        PanelPositionStrategy::WindowCenter => {
            ladder(position_window_center(window, panel_width, panel_height))
        }
        PanelPositionStrategy::LastPosition => {
            ladder(position_last_position(window, panel_width, panel_height))
        }
        // 真正的「跟随输入框」需要辅助功能(AX)，是异步的（见 open_panel 的异步覆盖）。
        // 同步阶段先用「激活窗体中心」兜底，再退光标/屏幕中心——避免名义跟随输入框却退化成
        // FollowCursor 的旧实现(Gap#2)。AX 命中且与光标同屏时，异步覆盖会精修到光标位置。
        PanelPositionStrategy::FocusInput => ladder(position_active_window_center(
            window,
            panel_width,
            panel_height,
        )),
    }
}

fn get_strategy_for_source(source: &str) -> PanelPositionStrategy {
    match source {
        "tray" => PanelPositionStrategy::TrayCenter,
        "shortcut" => PanelPositionStrategy::FollowCursor,
        "command" => PanelPositionStrategy::Center,
        _ => PanelPositionStrategy::FollowCursor,
    }
}

fn mcp_tool_specs() -> Vec<McpToolSpec> {
    vec![
        McpToolSpec {
            name: "clipboard.context.get",
            description: "Get a safe redacted ClipboardContextSnapshot by id.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "includeContent": { "type": "boolean" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.context.compose",
            description: "Compose an AgentContextSet from ids, favorites, search-result, all, or current scope.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["current", "selected", "favorites", "search-result", "all"] },
                    "ids": { "type": "array", "items": { "type": "string" } },
                    "text": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "types": { "type": "array", "items": { "type": "string" } },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.context.live",
            description: "Capture a live, metadata-only snapshot of the current frontmost application. External collectors require explicit includeExternal=true and the enableExternalContextCollectors setting.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "collectorId": { "type": "string", "description": "Optional external collector id to run." },
                    "includeExternal": { "type": "boolean", "description": "Run matching user-installed read-only collectors." }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.context.collectors.list",
            description: "List built-in and user-installed application context collectors plus their diagnostics.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.context.collector.contract",
            description: "Return the application context collector v1 contract, safety rules, and Chrome adapter example.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.context.collector.debug",
            description: "Run one matching external collector against the current frontmost application and return its input, output, timing, and redaction diagnostics.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "collectorId": { "type": "string" },
                    "fixture": { "type": "object", "description": "Optional synthetic collector input for development without opening the target app." }
                },
                "required": ["collectorId"]
            }),
        },
        McpToolSpec {
            name: "clipboard.content.parse",
            description: "Parse URL, file path, JSON, command, code block, error log, and Markdown candidates without executing them.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.capture",
            description: "Capture content as a standardized ClipForge item.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string" },
                    "sourceLabel": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.update",
            description: "Update a clipboard item through the unified write interface.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "favorite": { "type": "boolean" },
                    "pinned": { "type": "boolean" },
                    "bucket": { "type": "string" },
                    "metadata": { "type": "object" },
                    "agentContext": { "type": "object" }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipboard.copy",
            description: "Copy a standardized ClipForge item by id.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "text": { "type": "string" },
                    "pasteMode": { "type": "string", "enum": ["rich", "plain", "filesAsPaths"] }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.search",
            description: "Search ClipForge clipboard history with text, tags, type, kind, bucket, favorite, and file extension filters.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "bucket": { "type": "string" },
                    "types": { "type": "array", "items": { "type": "string" } },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "favorite": { "type": "boolean" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.settings.get",
            description: "Read redacted ClipForge settings, schema, writePolicy, redaction rules, and revision.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "includeSchema": { "type": "boolean" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.settings.patch",
            description: "Patch ClipForge settings through the unified Settings Service. Prefer this over replace.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "patch": { "type": "object" },
                    "actor": { "type": "string" },
                    "reason": { "type": "string" },
                    "expectedRevision": { "type": "string" },
                    "includeSchema": { "type": "boolean" }
                },
                "required": ["patch"]
            }),
        },
        McpToolSpec {
            name: "clipf.settings.replace",
            description: "Replace the full ClipForge settings document. Requires confirmed=true.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "settings": { "type": "object" },
                    "actor": { "type": "string" },
                    "reason": { "type": "string" },
                    "expectedRevision": { "type": "string" },
                    "confirmed": { "type": "boolean" },
                    "includeSchema": { "type": "boolean" }
                },
                "required": ["settings", "confirmed"]
            }),
        },
        McpToolSpec {
            name: "clipf.settings.reset",
            description: "Reset a ClipForge settings scope. Requires scope and confirmed=true.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["all", "agent", "shortcuts", "display", "capture", "storage", "logs", "tags"] },
                    "actor": { "type": "string" },
                    "reason": { "type": "string" },
                    "expectedRevision": { "type": "string" },
                    "confirmed": { "type": "boolean" },
                    "includeSchema": { "type": "boolean" }
                },
                "required": ["scope", "confirmed"]
            }),
        },
        McpToolSpec {
            name: "clipf.agent.providers",
            description: "List redacted Agent providers resolved from Settings Service.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipf.agent.check",
            description: "Check readiness for the default or selected Agent provider without blocking the quick panel.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "providerId": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.agent.models",
            description: "List available models for the default or selected OpenAI-compatible Agent provider.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "providerId": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.skill.list",
            description: "List private clipboard skill summaries. Frontend local drafts are not exposed as secrets.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.skill.save_draft",
            description: "Return a confirm-write skill draft envelope; actual enablement remains user-confirmed.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "promptTemplate": { "type": "string" }
                },
                "required": ["name", "promptTemplate"]
            }),
        },
        McpToolSpec {
            name: "clipboard.skill.run",
            description: "Prepare a private skill run with explicit context scope and permission trimming.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "skillId": { "type": "string" },
                    "contextSet": { "type": "object" }
                }
            }),
        },
        McpToolSpec {
            name: "clipboard.plugin.list",
            description: "List built-in ClipForge plugin manifests and capability boundaries.",
            input_schema: || json!({ "type": "object", "properties": {} }),
        },
        McpToolSpec {
            name: "clipboard.plugin.call",
            description: "Resolve a plugin action into a preview/action envelope. Built-in calls do not execute unsafe actions.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "pluginId": { "type": "string" },
                    "actionId": { "type": "string" },
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "target": { "type": "string" }
                },
                "required": ["pluginId"]
            }),
        },
        McpToolSpec {
            name: "clipboard.agent.run",
            description: "Prepare an Agent run from prompt and contextSet. Execution requires explicit confirmation outside MCP.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "providerId": { "type": "string" },
                    "prompt": { "type": "string" },
                    "contextSet": { "type": "object" },
                    "allowFullContent": { "type": "boolean" }
                },
                "required": ["prompt"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.context",
            description: "Build a safe EditorContextSnapshot for a clipboard item and optional draft.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.preview_patch",
            description: "Preview editor content/tag changes. Does not write to database.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "replacement": { "type": "string" },
                    "tagPatch": { "type": "object" }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.apply_patch",
            description: "Apply a user-confirmed editor patch through save_editor_draft.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "replacement": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "confirmed": { "type": "boolean" }
                },
                "required": ["id", "replacement", "confirmed"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.save",
            description: "Save an editor draft through the unified native editor command.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["id", "content"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.render_template",
            description: "Render a simple editor template against safe variables.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "template": { "type": "string" },
                    "variables": { "type": "object" }
                },
                "required": ["template"]
            }),
        },
        McpToolSpec {
            name: "clipboard.editor.suggest_update",
            description: "Return a local EditorSuggestionResult with content/tag patch preview only.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "sessionId": { "type": "string" },
                    "draftVersion": { "type": "integer" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipf.capture",
            description: "Capture current text into ClipForge history.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string" },
                    "sourceLabel": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.get",
            description: "Get a ClipForge item by id. Agent instruction example: use clipf.get id=clip_xxx",
            input_schema: || json!({
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipf.list",
            description: "List recent ClipForge clipboard history. Agent instruction example: use clipf.list limit=9",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "bucket": { "type": "string", "enum": ["all", "history", "archive", "snippet", "trash"] },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 },
                    "cursor": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.search",
            description: "Search ClipForge clipboard history with text, tags, type, kind, bucket, favorite, and file extension filters.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "bucket": { "type": "string", "enum": ["all", "history", "archive", "snippet", "trash"] },
                    "types": { "type": "array", "items": { "type": "string" } },
                    "type": { "type": "string" },
                    "kinds": { "type": "array", "items": { "type": "string" } },
                    "kind": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "tag": { "type": "string" },
                    "fileExtensions": { "type": "array", "items": { "type": "string" } },
                    "fileExtension": { "type": "string" },
                    "favorite": { "type": "boolean" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 },
                    "cursor": { "type": "string" }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.analyze",
            description: "Analyze text with ClipForge content detection without writing it to history.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string" },
                    "sourceLabel": { "type": "string" }
                },
                "required": ["content"]
            }),
        },
        McpToolSpec {
            name: "clipf.copy",
            description: "Copy a standardized ClipForge item by id, or capture text first and then copy the generated item. Agent instruction example: use clipf.copy id=clip_xxx",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "text": { "type": "string" },
                    "pasteMode": { "type": "string", "enum": ["rich", "plain", "filesAsPaths"] }
                }
            }),
        },
        McpToolSpec {
            name: "clipf.update",
            description: "Update a clipboard item content, favorite, pinned, note, or bucket.",
            input_schema: || json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "content": { "type": "string" },
                    "tags": { "type": "array", "items": { "type": "string" } },
                    "favorite": { "type": "boolean" },
                    "pinned": { "type": "boolean" },
                    "note": { "type": "string" },
                    "metadata": { "type": "object" },
                    "agentContext": { "type": "object" },
                    "bucket": { "type": "string" }
                },
                "required": ["id"]
            }),
        },
        McpToolSpec {
            name: "clipf.delete",
            description: "Move clipboard items to trash.",
            input_schema: || json!({
                "type": "object",
                "properties": { "ids": { "type": "array", "items": { "type": "string" } } },
                "required": ["ids"]
            }),
        },
        McpToolSpec {
            name: "clipf.export",
            description: "Export ClipForge history as JSON.",
            input_schema: || json!({ "type": "object", "properties": { "includeDeleted": { "type": "boolean" } } }),
        },
        McpToolSpec {
            name: "clipf.import",
            description: "Import ClipForge history from JSON items.",
            input_schema: || json!({
                "type": "object",
                "properties": { "items": { "type": "array", "items": { "type": "object" } } },
                "required": ["items"]
            }),
        },
    ]
}

