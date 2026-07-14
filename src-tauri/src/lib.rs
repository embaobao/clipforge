#![recursion_limit = "256"]

use rusqlite::{
    params, params_from_iter, types::Value as SqlValue, Connection, OpenFlags, OptionalExtension,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod clipboard;

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
use tauri_nspanel::objc2_app_kit::{NSResponder, NSWindow as AppKitNSWindow};
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

#[derive(Clone)]
struct SourceAppInfo {
    name: String,
    bundle_id: String,
    executable_path: String,
    icon_base64: Option<String>,
}

fn current_source_app() -> Option<SourceAppInfo> {
    #[cfg(target_os = "macos")]
    {
        current_source_app_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
fn current_source_app_macos() -> Option<SourceAppInfo> {
    let script = r#"
tell application "System Events"
    set frontApp to first application process whose frontmost is true
    set appName to name of frontApp
    set bundleId to bundle identifier of frontApp
    set execPath to POSIX path of (application file of frontApp as alias)
    return appName & "|" & bundleId & "|" & execPath
end tell
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = raw.split('|').collect();
    if parts.len() < 3 {
        return None;
    }
    let name = parts[0].to_string();
    let bundle_id = parts[1].to_string();
    let executable_path = parts[2].to_string();
    let icon_base64 = bundle_icon_base64(&executable_path);
    Some(SourceAppInfo {
        name,
        bundle_id,
        executable_path,
        icon_base64,
    })
}

#[cfg(target_os = "macos")]
fn bundle_icon_base64(bundle_path: &str) -> Option<String> {
    use base64::Engine as _;
    use image::ImageEncoder as _;

    let path = PathBuf::from(bundle_path);
    if !path.exists() {
        return None;
    }
    let icon = file_icon_provider::get_file_icon(&path, 64).ok()?;
    let mut png_bytes = Vec::with_capacity((icon.width * icon.height * 4) as usize / 2);
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    encoder
        .write_image(
            &icon.pixels,
            icon.width,
            icon.height,
            image::ExtendedColorType::Rgba8,
        )
        .ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png_bytes)
    ))
}

#[cfg(not(target_os = "macos"))]
fn current_source_app_macos() -> Option<SourceAppInfo> {
    None
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
static MCP_CHILD: std::sync::OnceLock<Arc<Mutex<Option<Child>>>> = std::sync::OnceLock::new();
static AGENT_RUNS: std::sync::OnceLock<Arc<Mutex<HashMap<String, AgentRunState>>>> =
    std::sync::OnceLock::new();
static AGENT_READINESS_CACHE: std::sync::OnceLock<
    Arc<Mutex<HashMap<String, AgentProviderReadiness>>>,
> = std::sync::OnceLock::new();
static PANEL_LAST_POSITION: std::sync::OnceLock<Arc<Mutex<Option<NormalizedPosition>>>> =
    std::sync::OnceLock::new();
static POSITION_DEBOUNCE: std::sync::OnceLock<Arc<Mutex<Option<std::time::Instant>>>> =
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

fn mcp_child() -> Arc<Mutex<Option<Child>>> {
    MCP_CHILD.get_or_init(|| Arc::new(Mutex::new(None))).clone()
}

fn agent_runs() -> Arc<Mutex<HashMap<String, AgentRunState>>> {
    AGENT_RUNS
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

fn agent_readiness_cache() -> Arc<Mutex<HashMap<String, AgentProviderReadiness>>> {
    AGENT_READINESS_CACHE
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

fn panel_last_position() -> Arc<Mutex<Option<NormalizedPosition>>> {
    PANEL_LAST_POSITION
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone()
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

#[derive(Deserialize)]
struct ReleaseManifest {
    version: String,
    notes: Option<String>,
    platforms: Option<std::collections::HashMap<String, ReleasePlatform>>,
    clipforge: Option<ReleaseManifestMeta>,
}

#[derive(Deserialize)]
struct ReleasePlatform {
    signature: Option<String>,
    url: Option<String>,
}

#[derive(Deserialize)]
struct ReleaseManifestMeta {
    channel: Option<String>,
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
struct McpStatusPayload {
    enabled: bool,
    running: bool,
    transport: String,
    command: String,
    tools: Vec<String>,
    message: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardAgentProviderConfig {
    id: String,
    label: String,
    kind: String,
    configured: bool,
    command_preview: String,
    redacted_config: Value,
    last_readiness: Option<AgentProviderReadiness>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardAgentToolDescriptor {
    name: String,
    description: String,
    permission: String,
    write: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProviderReadiness {
    provider_id: String,
    status: String,
    reason: String,
    checked_at: i64,
    command_preview: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentDetectCandidate {
    provider_id: String,
    label: String,
    kind: String,
    command: String,
    args: Vec<String>,
    configured: bool,
    base_url: Option<String>,
    api_key: Option<String>,
    api_key_ref: Option<String>,
    model_id: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfigPayload {
    active_provider_id: Option<String>,
    providers: Vec<ClipboardAgentProviderConfig>,
    tools: Vec<ClipboardAgentToolDescriptor>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentProviderModelsPayload {
    provider_id: String,
    active_model_id: Option<String>,
    models: Vec<String>,
    source: String,
    message: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentInvocationConfig {
    provider_id: Option<String>,
    prompt: String,
    context_set: Value,
    allow_full_content: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentStartRunInput {
    run_id: Option<String>,
    provider_id: Option<String>,
    prompt: String,
    context_set: Value,
    confirmed: Option<bool>,
    allow_full_content: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunPayload {
    id: String,
    conversation_id: String,
    provider_id: String,
    status: String,
    prompt_preview: String,
    command_preview: String,
    context_summary: String,
    output: String,
    error_code: Option<String>,
    error_message: Option<String>,
    exit_code: Option<i32>,
    created_at: i64,
    updated_at: i64,
    started_at: Option<i64>,
    finished_at: Option<i64>,
    duration_ms: Option<i64>,
}

#[derive(Clone, Copy)]
enum AgentRunStatus {
    Idle,
    Preparing,
    WaitingConfirmation,
    Running,
    Streaming,
    Succeeded,
    Failed,
    Cancelling,
    Cancelled,
}

impl AgentRunStatus {
    fn as_str(self) -> &'static str {
        match self {
            AgentRunStatus::Idle => "idle",
            AgentRunStatus::Preparing => "preparing",
            AgentRunStatus::WaitingConfirmation => "waiting_confirmation",
            AgentRunStatus::Running => "running",
            AgentRunStatus::Streaming => "streaming",
            AgentRunStatus::Succeeded => "succeeded",
            AgentRunStatus::Failed => "failed",
            AgentRunStatus::Cancelling => "cancelling",
            AgentRunStatus::Cancelled => "cancelled",
        }
    }

    fn is_active(self) -> bool {
        matches!(
            self,
            AgentRunStatus::Preparing
                | AgentRunStatus::WaitingConfirmation
                | AgentRunStatus::Running
                | AgentRunStatus::Streaming
                | AgentRunStatus::Cancelling
        )
    }
}

fn agent_status_from_str(status: &str) -> Option<AgentRunStatus> {
    match status {
        "idle" => Some(AgentRunStatus::Idle),
        "preparing" => Some(AgentRunStatus::Preparing),
        "waiting_confirmation" => Some(AgentRunStatus::WaitingConfirmation),
        "running" => Some(AgentRunStatus::Running),
        "streaming" => Some(AgentRunStatus::Streaming),
        "succeeded" => Some(AgentRunStatus::Succeeded),
        "failed" => Some(AgentRunStatus::Failed),
        "cancelling" => Some(AgentRunStatus::Cancelling),
        "cancelled" => Some(AgentRunStatus::Cancelled),
        _ => None,
    }
}

fn agent_status(status: AgentRunStatus) -> String {
    status.as_str().to_string()
}

fn set_agent_run_status(payload: &mut AgentRunPayload, status: AgentRunStatus, now: i64) {
    payload.status = agent_status(status);
    payload.updated_at = now;
    if matches!(
        status,
        AgentRunStatus::Succeeded | AgentRunStatus::Failed | AgentRunStatus::Cancelled
    ) {
        payload.finished_at = Some(now);
        payload.duration_ms = payload.started_at.map(|started| now - started);
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentPreparedRunPayload {
    run: AgentRunPayload,
    requires_confirmation: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTranscriptRowPayload {
    id: String,
    run_id: String,
    kind: String,
    text: String,
    scroll_anchor: bool,
    created_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentUiMessagePayload {
    run_id: String,
    message_id: String,
    role: String,
    parts: Value,
    metadata: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAgUiEventPayload {
    run_id: String,
    message_id: String,
    event_type: String,
    role: String,
    text: Option<String>,
    status: Option<String>,
    tool_name: Option<String>,
    arguments_preview: Option<String>,
    result_preview: Option<String>,
    custom_event: Option<String>,
    custom_payload: Option<Value>,
    created_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunSnapshotPayload {
    run: AgentRunPayload,
    transcript: Vec<AgentTranscriptRowPayload>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionSnapshotPayload {
    runs: Vec<AgentRunSnapshotPayload>,
    active_run_id: Option<String>,
    restored_at: i64,
}

struct AgentRunState {
    payload: AgentRunPayload,
    transcript: Vec<AgentTranscriptRowPayload>,
    child: Option<Child>,
    foreground_clip_id: Option<String>,
}

fn is_active_agent_status(status: &str) -> bool {
    agent_status_from_str(status).is_some_and(AgentRunStatus::is_active)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeClipPayload {
    content: String,
    kind: String,
    analysis: ClipAnalysisPayload,
    tags: Vec<String>,
}

struct McpToolSpec {
    name: &'static str,
    description: &'static str,
    input_schema: fn() -> Value,
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
fn save_editor_draft(input: SaveEditorDraftInput) -> Result<ClipItemPayload, String> {
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

fn agent_trace_id(prefix: &str) -> String {
    now_millis()
        .map(|ts| format!("{prefix}_{ts}"))
        .unwrap_or_else(|_| format!("{prefix}_unknown"))
}

fn agent_tool_descriptors() -> Vec<ClipboardAgentToolDescriptor> {
    vec![
        ClipboardAgentToolDescriptor {
            name: "clipboard.context.get".to_string(),
            description: "读取当前或指定剪贴板条目的安全上下文快照".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.context.compose".to_string(),
            description: "按当前、选中、收藏、搜索结果或最近历史组合上下文集合".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.content.parse".to_string(),
            description: "解析 URL、文件路径、JSON、命令、代码块、错误日志和 Markdown 候选"
                .to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.capture".to_string(),
            description: "显式写入一条新的 ClipForge 历史".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.update".to_string(),
            description: "通过可见结果动作更新内容、标签、收藏、归档等字段".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.copy".to_string(),
            description: "按统一多类型写回接口复制剪贴板条目".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.search".to_string(),
            description: "使用文本、tag、type、kind、bucket、favorite、file extension 检索"
                .to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.skill.list".to_string(),
            description: "列出私域剪贴板 skill 摘要".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.skill.save_draft".to_string(),
            description: "保存用户确认后的私域 skill 草稿".to_string(),
            permission: "confirm-write".to_string(),
            write: true,
        },
        ClipboardAgentToolDescriptor {
            name: "clipboard.skill.run".to_string(),
            description: "用当前上下文集合手动运行私域 skill".to_string(),
            permission: "read-summary".to_string(),
            write: false,
        },
    ]
}

fn split_agent_command_template(template: &str) -> Option<(String, Vec<String>)> {
    let parts = template
        .split_whitespace()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let (command, args) = parts.split_first()?;
    Some((command.clone(), args.to_vec()))
}

fn agent_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        let gui_paths = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            "/Applications/Cursor.app/Contents/Resources/app/bin",
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin",
        ];
        return format!("{}:{}", gui_paths.join(":"), current);
    }
    #[cfg(not(target_os = "macos"))]
    {
        current
    }
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn value_bool(value: &Value, key: &str, default: bool) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn value_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn configured_default_agent_provider_id() -> Option<String> {
    let settings = read_user_settings().ok()?.settings;
    settings
        .get("agent")
        .and_then(|agent| {
            value_string(
                agent,
                &[
                    "defaultProviderId",
                    "default_provider_id",
                    "defaultAgentId",
                    "default_agent_id",
                ],
            )
        })
        .or_else(|| {
            value_string(
                &settings,
                &[
                    "defaultProviderId",
                    "default_provider_id",
                    "defaultAgentId",
                    "default_agent_id",
                ],
            )
        })
}

fn configured_agent_providers_from_settings() -> Vec<AgentDetectCandidate> {
    let settings = read_user_settings()
        .map(|payload| payload.settings)
        .unwrap_or(Value::Null);
    let providers = settings
        .get("agent")
        .and_then(|agent| agent.get("providers"))
        .and_then(Value::as_array)
        .or_else(|| settings.get("agentProviders").and_then(Value::as_array));
    let Some(providers) = providers else {
        return Vec::new();
    };
    providers
        .iter()
        .enumerate()
        .filter_map(|(index, provider)| {
            if !provider.is_object() || !value_bool(provider, "enabled", true) {
                return None;
            }
            let kind = value_string(provider, &["kind"])
                .unwrap_or_else(|| "openai-compatible".to_string());
            let fallback_id = format!("settings-agent-{index}");
            let provider_id = value_string(provider, &["id"]).unwrap_or(fallback_id);
            let label =
                value_string(provider, &["label", "name"]).unwrap_or_else(|| provider_id.clone());
            if kind == "openai-compatible" || kind == "openapi" || kind == "openai" {
                let base_url = value_string(provider, &["baseUrl", "baseURL", "endpoint"])
                    .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
                let model_id = value_string(provider, &["modelId", "model"]);
                let api_key = value_string(provider, &["apiKey"]);
                let api_key_ref = value_string(provider, &["apiKeyEnv", "apiKeyRef"])
                    .or_else(|| Some("CLIPFORGE_AGENT_OPENAI_API_KEY".to_string()));
                let configured = model_id.is_some()
                    && (api_key.is_some()
                        || api_key_ref
                            .as_deref()
                            .and_then(|key| std::env::var(key).ok())
                            .map(|value| !value.trim().is_empty())
                            .unwrap_or(false));
                return Some(AgentDetectCandidate {
                    provider_id,
                    label,
                    kind: "openai-compatible".to_string(),
                    command: "python3".to_string(),
                    args: vec![
                        "-u".to_string(),
                        "-c".to_string(),
                        "<openai-compatible-stream-bridge>".to_string(),
                    ],
                    configured,
                    base_url: Some(base_url),
                    api_key,
                    api_key_ref,
                    model_id,
                    timeout_seconds: provider.get("timeoutSeconds").and_then(Value::as_u64),
                });
            }
            if kind == "local-cli" || kind == "cli" || kind == "local-cli-configured" {
                let command = value_string(provider, &["command"])?;
                return Some(local_agent_candidate(
                    &provider_id,
                    &label,
                    &command,
                    value_string_array(provider, "args"),
                    true,
                ));
            }
            None
        })
        .collect()
}

fn agent_detect_candidates() -> Vec<AgentDetectCandidate> {
    let mut candidates = Vec::new();
    candidates.extend(configured_agent_providers_from_settings());
    if let Ok(template) = std::env::var("CLIPFORGE_AGENT_COMMAND") {
        if let Some((command, args)) = split_agent_command_template(&template) {
            candidates.push(local_agent_candidate(
                "local-configured",
                "Configured local command",
                &command,
                args,
                true,
            ));
        }
    }
    candidates.extend([
        local_agent_candidate("claude-cli", "Claude CLI", "claude", Vec::new(), false),
        local_agent_candidate("codex-cli", "Codex CLI", "codex", Vec::new(), false),
        local_agent_candidate("qwen-cli", "Qwen CLI", "qwen", Vec::new(), false),
    ]);
    candidates.push(openai_compatible_agent_candidate());
    candidates
}

fn local_agent_candidate(
    provider_id: &str,
    label: &str,
    command: &str,
    args: Vec<String>,
    configured: bool,
) -> AgentDetectCandidate {
    AgentDetectCandidate {
        provider_id: provider_id.to_string(),
        label: label.to_string(),
        kind: if configured {
            "local-cli-configured"
        } else {
            "local-cli"
        }
        .to_string(),
        command: command.to_string(),
        args,
        configured,
        base_url: None,
        api_key: None,
        api_key_ref: None,
        model_id: None,
        timeout_seconds: None,
    }
}

fn openai_compatible_agent_candidate() -> AgentDetectCandidate {
    let base_url = std::env::var("CLIPFORGE_AGENT_OPENAI_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let model_id = std::env::var("CLIPFORGE_AGENT_OPENAI_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let api_key_ref = "CLIPFORGE_AGENT_OPENAI_API_KEY".to_string();
    let configured = model_id.is_some()
        && std::env::var(&api_key_ref)
            .ok()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
    AgentDetectCandidate {
        provider_id: "openai-compatible".to_string(),
        label: "OpenAI-compatible".to_string(),
        kind: "openai-compatible".to_string(),
        command: "python3".to_string(),
        args: vec![
            "-u".to_string(),
            "-c".to_string(),
            "<openai-compatible-stream-bridge>".to_string(),
        ],
        configured,
        base_url: Some(base_url),
        api_key: None,
        api_key_ref: Some(api_key_ref),
        model_id,
        timeout_seconds: None,
    }
}

fn command_preview(candidate: &AgentDetectCandidate) -> String {
    if candidate.kind == "openai-compatible" {
        return format!(
            "OpenAI-compatible streamText model={} baseURL={} apiKeyRef={}",
            candidate.model_id.as_deref().unwrap_or("not-configured"),
            candidate.base_url.as_deref().unwrap_or("not-configured"),
            candidate.api_key_ref.as_deref().unwrap_or("not-configured")
        );
    }
    if candidate.args.is_empty() {
        candidate.command.clone()
    } else {
        format!("{} {}", candidate.command, candidate.args.join(" "))
    }
}

fn cached_agent_readiness(provider_id: &str) -> Option<AgentProviderReadiness> {
    agent_readiness_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(provider_id).cloned())
}

fn cache_agent_readiness(readiness: AgentProviderReadiness) -> AgentProviderReadiness {
    if let Ok(mut cache) = agent_readiness_cache().lock() {
        cache.insert(readiness.provider_id.clone(), readiness.clone());
    }
    readiness
}

fn agent_candidate_by_id(provider_id: Option<&str>) -> Option<AgentDetectCandidate> {
    let candidates = agent_detect_candidates();
    if let Some(provider_id) = provider_id {
        candidates
            .iter()
            .find(|candidate| candidate.provider_id == provider_id)
            .cloned()
            .or_else(|| candidates.first().cloned())
    } else {
        candidates.first().cloned()
    }
}

fn check_agent_candidate(candidate: &AgentDetectCandidate) -> AgentProviderReadiness {
    let checked_at = now_millis().unwrap_or(0);
    if candidate.kind == "openai-compatible" {
        let missing_key = candidate
            .api_key
            .as_deref()
            .map(str::trim)
            .map(str::is_empty)
            .unwrap_or_else(|| {
                candidate
                    .api_key_ref
                    .as_deref()
                    .and_then(|key| std::env::var(key).ok())
                    .map(|value| value.trim().is_empty())
                    .unwrap_or(true)
            });
        if missing_key || candidate.model_id.is_none() {
            return cache_agent_readiness(AgentProviderReadiness {
                provider_id: candidate.provider_id.clone(),
                status: "not-configured".to_string(),
                reason: "configure modelId plus apiKey or apiKeyEnv in settings.json5 to enable OpenAI-compatible provider".to_string(),
                checked_at,
                command_preview: command_preview(candidate),
            });
        }
        let bridge_ready = Command::new("sh")
            .arg("-lc")
            .arg("command -v python3")
            .env("PATH", agent_path_env())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        return cache_agent_readiness(AgentProviderReadiness {
            provider_id: candidate.provider_id.clone(),
            status: if bridge_ready { "ready" } else { "not-found" }.to_string(),
            reason: if bridge_ready {
                "OpenAI-compatible config is present; runtime bridge is available"
            } else {
                "python3 bridge runtime is not available in merged PATH"
            }
            .to_string(),
            checked_at,
            command_preview: command_preview(candidate),
        });
    }
    let path = agent_path_env();
    let mut child = match Command::new("sh")
        .arg("-lc")
        .arg(format!(
            "command -v {}",
            shell_escape_word(&candidate.command)
        ))
        .env("PATH", path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            return cache_agent_readiness(AgentProviderReadiness {
                provider_id: candidate.provider_id.clone(),
                status: "health-timeout".to_string(),
                reason: error.to_string(),
                checked_at,
                command_preview: command_preview(candidate),
            });
        }
    };
    let started = std::time::Instant::now();
    let status_result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started.elapsed() >= Duration::from_millis(1500) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err("provider detect exceeded 1500ms".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => break Err(error.to_string()),
        }
    };
    let (status, reason): (String, String) = match status_result {
        Ok(status) if status.success() => {
            ("ready".to_string(), "command found in PATH".to_string())
        }
        Ok(status) if status.code() == Some(126) => (
            "permission-denied".to_string(),
            "command exists but is not executable".to_string(),
        ),
        Ok(_) if candidate.configured => (
            "not-found".to_string(),
            "configured command is not available in merged PATH".to_string(),
        ),
        Ok(_) => (
            "not-configured".to_string(),
            "candidate command is not available in merged PATH".to_string(),
        ),
        Err(error) => ("health-timeout".to_string(), error),
    };
    cache_agent_readiness(AgentProviderReadiness {
        provider_id: candidate.provider_id.clone(),
        status,
        reason,
        checked_at,
        command_preview: command_preview(candidate),
    })
}

fn check_openai_compatible_models(candidate: &AgentDetectCandidate) -> AgentProviderModelsPayload {
    if candidate.kind != "openai-compatible" {
        return AgentProviderModelsPayload {
            provider_id: candidate.provider_id.clone(),
            active_model_id: candidate.model_id.clone(),
            models: Vec::new(),
            source: "unsupported-provider".to_string(),
            message: "Model listing is only available for OpenAI-compatible providers".to_string(),
        };
    }

    let mut models = Vec::new();
    if let Some(model_id) = candidate.model_id.as_deref() {
        models.push(model_id.to_string());
    }
    models.extend(
        [
            "gpt-4.1-mini",
            "gpt-4.1",
            "gpt-4o-mini",
            "gpt-4o",
            "o4-mini",
            "o3-mini",
        ]
        .iter()
        .map(|model| model.to_string()),
    );
    models.sort();
    models.dedup();

    AgentProviderModelsPayload {
        provider_id: candidate.provider_id.clone(),
        active_model_id: candidate.model_id.clone(),
        models,
        source: "static-openai-compatible".to_string(),
        message: "Static model suggestions; edit settings.json5 to use a custom modelId"
            .to_string(),
    }
}

fn shell_escape_word(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/'))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn provider_configs_with_readiness(check: bool) -> Vec<ClipboardAgentProviderConfig> {
    agent_detect_candidates()
        .into_iter()
        .map(|candidate| {
            let last_readiness = if check {
                Some(check_agent_candidate(&candidate))
            } else {
                cached_agent_readiness(&candidate.provider_id)
            };
            ClipboardAgentProviderConfig {
                id: candidate.provider_id.clone(),
                label: candidate.label.clone(),
                kind: candidate.kind.clone(),
                configured: candidate.configured,
                command_preview: command_preview(&candidate),
                redacted_config: if candidate.kind == "openai-compatible" {
                    json!({
                        "protocol": "openai-compatible",
                        "baseURL": candidate.base_url.as_deref().unwrap_or("not-configured"),
                        "apiKeyRef": candidate.api_key_ref.as_deref().unwrap_or("not-configured"),
                        "apiKey": "not-sent-to-react",
                        "hasInlineApiKey": candidate.api_key.as_deref().map(|value| !value.trim().is_empty()).unwrap_or(false),
                        "modelId": candidate.model_id.as_deref().unwrap_or("not-configured"),
                        "timeoutSeconds": candidate.timeout_seconds.unwrap_or(120)
                    })
                } else {
                    json!({
                        "command": candidate.command,
                        "argsCount": candidate.args.len(),
                        "apiKey": "not-sent-to-react",
                        "baseURL": "not-sent-to-react"
                    })
                },
                last_readiness,
            }
        })
        .collect()
}

fn compact_agent_text(value: &str, max: usize) -> String {
    let text = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        text
    } else {
        let mut out = text.chars().take(max.saturating_sub(1)).collect::<String>();
        out.push('…');
        out
    }
}

fn agent_context_summary(context_set: &Value, allow_full_content: bool) -> String {
    let mode = context_set
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("current");
    let references = context_set
        .get("references")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if references.is_empty() {
        return format!("mode={mode}; references=0");
    }
    let lines = references
        .iter()
        .take(20)
        .enumerate()
        .map(|(index, reference)| {
            let title = reference
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("untitled");
            let payload_kind = reference
                .get("payloadKind")
                .and_then(Value::as_str)
                .unwrap_or("text");
            let permission = reference
                .get("permissionScope")
                .and_then(Value::as_str)
                .unwrap_or("summary");
            let url = reference
                .get("primaryUrl")
                .and_then(Value::as_str)
                .unwrap_or("");
            let tags = reference
                .get("tags")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .take(8)
                        .collect::<Vec<_>>()
                        .join(",")
                })
                .unwrap_or_default();
            let preview_key = if allow_full_content {
                "textPreview"
            } else {
                "summary"
            };
            let preview = reference
                .get(preview_key)
                .and_then(Value::as_str)
                .or_else(|| reference.get("textPreview").and_then(Value::as_str))
                .unwrap_or("");
            format!(
                "{}. [{} permission={}] {} url={} tags={} preview={}",
                index + 1,
                payload_kind,
                permission,
                compact_agent_text(title, 80),
                compact_agent_text(url, 120),
                tags,
                compact_agent_text(preview, if allow_full_content { 1200 } else { 240 })
            )
        })
        .collect::<Vec<_>>();
    format!(
        "mode={mode}; references={}\n{}",
        references.len(),
        lines.join("\n")
    )
}

fn agent_context_foreground_clip_id(context_set: &Value) -> Option<String> {
    context_set
        .get("references")
        .and_then(Value::as_array)
        .and_then(|references| references.first())
        .and_then(|reference| reference.get("clipId"))
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(ToString::to_string)
}

fn compose_agent_prompt(input: &AgentInvocationConfig) -> String {
    let allow_full_content = input.allow_full_content.unwrap_or(false);
    [
        "You are ClipForge's clipboard agent runtime.".to_string(),
        "Use only the structured context below. Do not assume hidden clipboard content.".to_string(),
        "Write operations must be returned as suggestions unless the user confirms a visible action.".to_string(),
        "".to_string(),
        "Context snapshot:".to_string(),
        agent_context_summary(&input.context_set, allow_full_content),
        "".to_string(),
        "User request:".to_string(),
        input.prompt.clone(),
    ]
    .join("\n")
}

fn build_agent_run_payload(
    run_id: String,
    provider: &AgentDetectCandidate,
    prompt: &str,
    context_set: &Value,
    status: &str,
    now: i64,
    allow_full_content: bool,
) -> AgentRunPayload {
    AgentRunPayload {
        id: run_id,
        conversation_id: context_set
            .get("id")
            .and_then(Value::as_str)
            .map(|id| format!("conversation:{id}"))
            .unwrap_or_else(|| "conversation:current".to_string()),
        provider_id: provider.provider_id.clone(),
        status: status.to_string(),
        prompt_preview: compact_agent_text(prompt, 240),
        command_preview: command_preview(provider),
        context_summary: agent_context_summary(context_set, allow_full_content),
        output: String::new(),
        error_code: None,
        error_message: None,
        exit_code: None,
        created_at: now,
        updated_at: now,
        started_at: None,
        finished_at: None,
        duration_ms: None,
    }
}

fn log_agent_event(event: &str, run: &AgentRunPayload, extra: Value) {
    let snapshot = json!({
        "event": event,
        "runId": run.id,
        "conversationId": run.conversation_id,
        "providerId": run.provider_id,
        "status": run.status,
        "promptPreviewLength": run.prompt_preview.chars().count(),
        "contextSummaryLength": run.context_summary.chars().count(),
        "outputLength": run.output.chars().count(),
        "errorCode": run.error_code,
        "exitCode": run.exit_code,
        "durationMs": run.duration_ms,
        "redactedFields": ["prompt", "output", "contextSummary", "commandPreview"],
        "extra": extra,
    });
    log_to_file("info", "agent-runtime", &snapshot.to_string());
}

fn insert_agent_transcript(
    run_id: &str,
    kind: &str,
    text: &str,
    scroll_anchor: bool,
) -> AgentTranscriptRowPayload {
    AgentTranscriptRowPayload {
        id: agent_trace_id("agent_row"),
        run_id: run_id.to_string(),
        kind: kind.to_string(),
        text: text.to_string(),
        scroll_anchor,
        created_at: now_millis().unwrap_or(0),
    }
}

fn emit_agent_ui_message<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    run_id: &str,
    role: &str,
    text: &str,
    status: Option<&str>,
) {
    let message_id = format!("{role}:{run_id}");
    let event_type = if text.is_empty() {
        "STATE_DELTA"
    } else if matches!(status, Some("succeeded" | "failed" | "cancelled")) {
        "STATE_DELTA"
    } else {
        "TEXT_MESSAGE_CONTENT"
    };
    let event = AgentAgUiEventPayload {
        run_id: run_id.to_string(),
        message_id,
        event_type: event_type.to_string(),
        role: role.to_string(),
        text: if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        },
        status: status.map(str::to_string),
        tool_name: None,
        arguments_preview: None,
        result_preview: None,
        custom_event: None,
        custom_payload: None,
        created_at: now_millis().unwrap_or(0),
    };
    emit_agent_agui_event(app, event);
}

fn agent_agui_event_parts(event: &AgentAgUiEventPayload) -> Value {
    let mut parts = Vec::new();
    if let Some(text) = event.text.as_deref() {
        parts.push(json!({ "type": "text", "text": text }));
    }
    match event.event_type.as_str() {
        "TOOL_CALL" => {
            if let Some(name) = event.tool_name.as_deref() {
                parts.push(json!({
                    "type": "data-tool-call",
                    "data": {
                        "name": name,
                        "argumentsPreview": event.arguments_preview.as_deref().unwrap_or(""),
                        "status": event.status.as_deref().unwrap_or("running")
                    }
                }));
            }
        }
        "TOOL_RESULT" => {
            if let Some(name) = event.tool_name.as_deref() {
                parts.push(json!({
                    "type": "data-tool-result",
                    "data": {
                        "name": name,
                        "resultPreview": event.result_preview.as_deref().unwrap_or(""),
                        "status": event.status.as_deref().unwrap_or("succeeded")
                    }
                }));
            }
        }
        "CUSTOM" => {
            if let Some(custom_event) = event.custom_event.as_deref() {
                parts.push(json!({
                    "type": "data-custom",
                    "data": {
                        "event": custom_event,
                        "payload": event.custom_payload.clone().unwrap_or_else(|| json!({}))
                    }
                }));
            }
        }
        _ => {}
    }
    if let Some(status) = event.status.as_deref() {
        parts.push(json!({
            "type": "data-status",
            "data": { "status": status }
        }));
    }
    Value::Array(parts)
}

fn emit_agent_agui_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    event: AgentAgUiEventPayload,
) {
    let parts = agent_agui_event_parts(&event);
    let payload = AgentUiMessagePayload {
        run_id: event.run_id.clone(),
        message_id: event.message_id.clone(),
        role: event.role.clone(),
        parts,
        metadata: json!({
            "conversationId": format!("conversation:{}", event.run_id),
            "runId": event.run_id.clone(),
            "createdAt": event.created_at,
            "aguiEventType": event.event_type.clone(),
        }),
    };
    let _ = app.emit("agent_agui_event", &event);
    let _ = app.emit("agent_ui_message", payload);
}

fn cleanup_agent_children() {
    let runs_ref = agent_runs();
    let Ok(mut runs) = runs_ref.lock() else {
        return;
    };
    let now = now_millis().unwrap_or(0);
    for state in runs.values_mut() {
        if let Some(child) = state.child.as_mut() {
            let _ = child.kill();
        }
        if state.child.is_some() {
            state.child = None;
            if is_active_agent_status(&state.payload.status) {
                set_agent_run_status(&mut state.payload, AgentRunStatus::Cancelled, now);
            }
        }
    }
}

#[derive(Clone, Copy)]
enum AgentOutputMode {
    PlainText,
    StandardJsonEvents,
}

fn openai_compatible_bridge_script() -> &'static str {
    r#"
import json
import os
import sys
import urllib.error
import urllib.request

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)

try:
    config = json.loads(sys.stdin.read())
    base_url = (config.get("baseUrl") or "https://api.openai.com/v1").rstrip("/")
    model = config["modelId"]
    api_key_env = config.get("apiKeyEnv") or "CLIPFORGE_AGENT_OPENAI_API_KEY"
    api_key = config.get("apiKey") or os.environ.get(api_key_env, "")
    if not api_key:
        emit({"type": "error", "message": api_key_env + " is not set"})
        sys.exit(2)
    body = {
        "model": model,
        "stream": True,
        "messages": [
            {"role": "system", "content": "You are ClipForge's clipboard agent runtime. Return concise, actionable output."},
            {"role": "user", "content": config.get("prompt", "")},
        ],
    }
    request = urllib.request.Request(
        base_url + "/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=int(config.get("timeoutSeconds", 120))) as response:
        for raw in response:
            line = raw.decode("utf-8", "replace").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            chunk = json.loads(data)
            for choice in chunk.get("choices", []):
                delta = choice.get("delta", {})
                content = delta.get("content")
                if content:
                    emit({"type": "text", "delta": content})
                for tool_call in delta.get("tool_calls", []) or []:
                    function = tool_call.get("function", {}) or {}
                    emit({
                        "type": "tool_call",
                        "name": function.get("name") or tool_call.get("id") or "tool_call",
                        "argumentsPreview": function.get("arguments") or "",
                    })
except urllib.error.HTTPError as error:
    detail = error.read().decode("utf-8", "replace")
    emit({"type": "error", "message": "OpenAI-compatible HTTP error", "status": error.code, "detail": detail[:1000]})
    sys.exit(1)
except Exception as error:
    emit({"type": "error", "message": str(error)})
    sys.exit(1)
"#
}

fn handle_standard_agent_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    run_id: &str,
    line: &str,
) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return false;
    };
    match value.get("type").and_then(Value::as_str).unwrap_or("") {
        "text" => {
            let text = value
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if text.is_empty() {
                return true;
            }
            append_agent_output(run_id, &text, false);
            emit_agent_ui_message(app, run_id, "assistant", &text, Some("streaming"));
            let _ = app.emit(
                "agent_message_delta",
                json!({ "runId": run_id, "stream": "stdout", "text": text }),
            );
            true
        }
        "tool_call" => {
            let event = AgentAgUiEventPayload {
                run_id: run_id.to_string(),
                message_id: format!("assistant:{run_id}"),
                event_type: "TOOL_CALL".to_string(),
                role: "assistant".to_string(),
                text: None,
                status: Some("running".to_string()),
                tool_name: value
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                arguments_preview: value
                    .get("argumentsPreview")
                    .and_then(Value::as_str)
                    .map(|text| compact_agent_text(text, 800)),
                result_preview: None,
                custom_event: None,
                custom_payload: None,
                created_at: now_millis().unwrap_or(0),
            };
            emit_agent_agui_event(app, event);
            true
        }
        "tool_result" => {
            let event = AgentAgUiEventPayload {
                run_id: run_id.to_string(),
                message_id: format!("assistant:{run_id}"),
                event_type: "TOOL_RESULT".to_string(),
                role: "tool".to_string(),
                text: None,
                status: Some(
                    value
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("succeeded")
                        .to_string(),
                ),
                tool_name: value
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                arguments_preview: None,
                result_preview: value
                    .get("resultPreview")
                    .and_then(Value::as_str)
                    .map(|text| compact_agent_text(text, 800)),
                custom_event: None,
                custom_payload: None,
                created_at: now_millis().unwrap_or(0),
            };
            emit_agent_agui_event(app, event);
            true
        }
        "error" => {
            let message = value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("OpenAI-compatible provider error");
            append_agent_output(run_id, message, true);
            emit_agent_ui_message(app, run_id, "assistant", message, Some("failed"));
            true
        }
        _ => false,
    }
}

fn spawn_agent_output_reader<R, T>(
    app: tauri::AppHandle<R>,
    run_id: String,
    stream: &'static str,
    reader: T,
    stderr: bool,
    mode: AgentOutputMode,
) where
    R: tauri::Runtime,
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        let mut buffered = Vec::<String>::new();
        let mut last_emit = std::time::Instant::now();
        let flush = |items: &mut Vec<String>| {
            if items.is_empty() {
                return;
            }
            let text = items.join("\n");
            items.clear();
            append_agent_output(&run_id, &text, stderr);
            emit_agent_ui_message(&app, &run_id, "assistant", &text, Some("streaming"));
            let _ = app.emit(
                "agent_message_delta",
                json!({ "runId": run_id, "stream": stream, "text": text }),
            );
        };
        for line in reader.lines().map_while(Result::ok) {
            if matches!(mode, AgentOutputMode::StandardJsonEvents)
                && !stderr
                && handle_standard_agent_event(&app, &run_id, &line)
            {
                continue;
            }
            buffered.push(line);
            let buffered_len: usize = buffered.iter().map(|item| item.len()).sum();
            if buffered.len() >= 8
                || buffered_len >= 2048
                || last_emit.elapsed() >= Duration::from_millis(120)
            {
                flush(&mut buffered);
                last_emit = std::time::Instant::now();
            }
        }
        flush(&mut buffered);
    });
}

#[tauri::command]
fn agent_get_config() -> Result<AgentConfigPayload, String> {
    let providers = provider_configs_with_readiness(false);
    let default_provider_id = configured_default_agent_provider_id();
    let active_provider_id = default_provider_id
        .as_deref()
        .and_then(|default_id| providers.iter().find(|provider| provider.id == default_id))
        .or_else(|| providers.iter().find(|provider| provider.configured))
        .or_else(|| providers.first())
        .map(|provider| provider.id.clone());
    Ok(AgentConfigPayload {
        active_provider_id,
        providers,
        tools: agent_tool_descriptors(),
    })
}

#[tauri::command]
fn agent_list_providers() -> Result<Vec<ClipboardAgentProviderConfig>, String> {
    Ok(provider_configs_with_readiness(false))
}

#[tauri::command]
fn agent_check_provider(provider_id: Option<String>) -> Result<AgentProviderReadiness, String> {
    let candidate = agent_candidate_by_id(provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    Ok(check_agent_candidate(&candidate))
}

#[tauri::command]
fn agent_list_provider_models(
    provider_id: Option<String>,
) -> Result<AgentProviderModelsPayload, String> {
    let candidate = agent_candidate_by_id(provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    Ok(check_openai_compatible_models(&candidate))
}

/// 设置写入互斥锁（B2b）：保护 read-modify-write 全段，避免设置窗 + MCP/主面板并发写入导致 lost-update。
/// 只在编排函数（settings_service_*、update_clipforge_settings）里持有；底层 read/write 不加锁，避免重入死锁。
static SETTINGS_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 记录一次设置操作的耗时，超 300ms 写 app log（B6：300ms 性能预算可观测）。
fn log_slow_settings_operation(operation: &str, duration_ms: i64) {
    if duration_ms > 300 {
        log_to_file(
            "warn",
            "settings-service",
            &format!("slow {operation} durationMs={duration_ms} > 300"),
        );
    }
}

fn settings_revision(settings: &Value) -> String {
    let serialized = serde_json::to_string(settings).unwrap_or_else(|_| settings.to_string());
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    serialized.hash(&mut hasher);
    format!("rev_{:016x}", hasher.finish())
}

fn redact_settings_value(value: &Value) -> Value {
    let mut redacted = value.clone();
    // 抹掉明文 apiKey（B7）：schema 同时接受新结构 agent.providers[] 和 legacy 顶层 agentProviders[]，
    // 两条路径都要 redact，否则 settings_service_get 会泄漏 legacy provider 的 key。
    if let Some(providers) = redacted
        .get_mut("agentProviders")
        .and_then(Value::as_array_mut)
    {
        for provider in providers {
            redact_provider_api_key(provider);
        }
    }
    if let Some(agent) = redacted.get_mut("agent") {
        if let Some(providers) = agent.get_mut("providers").and_then(Value::as_array_mut) {
            for provider in providers {
                redact_provider_api_key(provider);
            }
        }
    }
    redacted
}

/// 抹掉单个 provider 配置里的明文 apiKey，统一返回 redacted 占位符。
fn redact_provider_api_key(provider: &mut Value) {
    if let Some(object) = provider.as_object_mut() {
        if object.contains_key("apiKey") {
            object.insert(
                "apiKey".to_string(),
                Value::String("[redacted]".to_string()),
            );
        }
    }
}

fn collect_changed_paths(previous: &Value, next: &Value, path: &str, out: &mut Vec<String>) {
    if previous == next {
        return;
    }
    match (previous.as_object(), next.as_object()) {
        (Some(previous_object), Some(next_object)) => {
            let mut keys = previous_object.keys().collect::<Vec<_>>();
            for key in next_object.keys() {
                if !previous_object.contains_key(key) {
                    keys.push(key);
                }
            }
            keys.sort();
            keys.dedup();
            for key in keys {
                let next_path = if path == "$" {
                    format!("$.{key}")
                } else {
                    format!("{path}.{key}")
                };
                collect_changed_paths(
                    previous_object.get(key).unwrap_or(&Value::Null),
                    next_object.get(key).unwrap_or(&Value::Null),
                    &next_path,
                    out,
                );
            }
        }
        _ => out.push(path.to_string()),
    }
}

fn settings_changed_paths(previous: &Value, next: &Value) -> Vec<String> {
    let mut out = Vec::new();
    collect_changed_paths(previous, next, "$", &mut out);
    if out.is_empty() {
        vec![]
    } else {
        out
    }
}

fn merge_settings_patch(base: &mut Value, patch: &Value) {
    if !base.is_object() || !patch.is_object() {
        *base = patch.clone();
        return;
    }
    let Some(base_object) = base.as_object_mut() else {
        return;
    };
    let Some(patch_object) = patch.as_object() else {
        return;
    };
    for (key, value) in patch_object {
        if value.is_null() {
            base_object.remove(key);
        } else if value.is_object() {
            let entry = base_object
                .entry(key.clone())
                .or_insert_with(|| Value::Object(Default::default()));
            merge_settings_patch(entry, value);
        } else {
            base_object.insert(key.clone(), value.clone());
        }
    }
}

fn settings_json_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "ClipForgeSettings",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "language": { "type": "string", "enum": ["system", "zh-CN", "en-US"] },
            "globalShortcut": { "type": "string", "minLength": 1 },
            "panelDensity": { "type": "string", "enum": ["dense", "normal", "comfortable"] },
            "contentDisplayMode": { "type": "string", "enum": ["summary", "middle", "raw"] },
            "quickItemLimit": { "type": "integer", "minimum": 1, "maximum": 100 },
            "maxStoredItems": { "type": "integer", "minimum": 1, "maximum": 100000 },
            "clipboardPollMs": { "type": "integer", "minimum": 100, "maximum": 60000 },
            "cleanupEnabled": { "type": "boolean" },
            "cleanupIntervalHours": { "type": "integer", "minimum": 1, "maximum": 8760 },
            "softDeletedRetentionDays": { "type": "integer", "minimum": 1, "maximum": 3650 },
            "enableMarkdownPreview": { "type": "boolean" },
            "fuzzySearchEnabled": { "type": "boolean" },
            "pinyinSearchEnabled": { "type": "boolean" },
            "tagMode": { "type": "string", "enum": ["similar", "rules", "off"] },
            "tagRules": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "id": { "type": "string", "minLength": 1 },
                        "label": { "type": "string", "minLength": 1, "maxLength": 32 },
                        "query": { "type": "string", "maxLength": 500 }
                    },
                    "required": ["id", "label", "query"]
                }
            },
            "positionStrategy": { "type": "string", "enum": ["trayCenter", "followCursor", "center", "windowCenter", "lastPosition", "focusInput"] },
            "panelBackgroundOpacity": { "type": "number", "minimum": 0.2, "maximum": 1 },
            "enableScrollCollapse": { "type": "boolean" },
            "panelWidth": { "type": "integer", "minimum": 300, "maximum": 1200 },
            "panelHeight": { "type": "integer", "minimum": 240, "maximum": 1200 },
            "onboardingCompleted": { "type": "boolean" },
            "logMaxSizeMb": { "type": "integer", "minimum": 1, "maximum": 2048 },
            "logKeepRatio": { "type": "number", "minimum": 0.05, "maximum": 1 },
            "logMaxLines": { "type": "integer", "minimum": 100, "maximum": 2000000 },
            "logRetentionDays": { "type": "integer", "minimum": 0, "maximum": 3650 },
            "logAutoCleanup": { "type": "boolean" },
            "logCleanupIntervalMin": { "type": "integer", "minimum": 1, "maximum": 1440 },
            "captureTextEnabled": { "type": "boolean" },
            "captureHtmlEnabled": { "type": "boolean" },
            "captureRtfEnabled": { "type": "boolean" },
            "captureImageEnabled": { "type": "boolean" },
            "captureFileEnabled": { "type": "boolean" },
            "captureSensitiveEnabled": { "type": "boolean" },
            "imageMaxSizeMb": { "type": "integer", "minimum": 1, "maximum": 4096 },
            "textMaxSizeMb": { "type": "integer", "minimum": 1, "maximum": 1024 },
            "agentProviders": { "$ref": "#/$defs/agentProvidersLegacy" },
            "agent": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "defaultProviderId": { "type": "string" },
                    "defaultAgentId": { "type": "string" },
                    "providers": { "$ref": "#/$defs/agentProviders" }
                }
            }
        },
        "$defs": {
            "agentProvidersLegacy": { "$ref": "#/$defs/agentProviders" },
            "agentProviders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "id": { "type": "string", "minLength": 1 },
                        "name": { "type": "string", "minLength": 1 },
                        "label": { "type": "string", "minLength": 1 },
                        "kind": { "type": "string", "enum": ["openai-compatible", "openai", "openapi", "local-cli", "cli", "local-cli-configured"] },
                        "enabled": { "type": "boolean" },
                        "baseUrl": { "type": "string" },
                        "baseURL": { "type": "string" },
                        "endpoint": { "type": "string" },
                        "modelId": { "type": "string" },
                        "model": { "type": "string" },
                        "apiKey": { "type": "string" },
                        "apiKeyEnv": { "type": "string" },
                        "apiKeyRef": { "type": "string" },
                        "timeoutSeconds": { "type": "integer", "minimum": 1, "maximum": 600 },
                        "command": { "type": "string" },
                        "args": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["id", "kind"]
                }
            }
        }
    })
}

fn resolve_schema_ref<'a>(root: &'a Value, schema: &'a Value) -> &'a Value {
    let Some(reference) = schema.get("$ref").and_then(Value::as_str) else {
        return schema;
    };
    if reference == "#/$defs/agentProviders" {
        return root
            .get("$defs")
            .and_then(|defs| defs.get("agentProviders"))
            .unwrap_or(schema);
    }
    if reference == "#/$defs/agentProvidersLegacy" {
        return root
            .get("$defs")
            .and_then(|defs| defs.get("agentProvidersLegacy"))
            .map(|value| resolve_schema_ref(root, value))
            .unwrap_or(schema);
    }
    schema
}

fn validate_settings_value(
    value: &Value,
    schema: &Value,
    root: &Value,
    path: &str,
    errors: &mut Vec<String>,
) {
    let schema = resolve_schema_ref(root, schema);
    if let Some(expected_type) = schema.get("type").and_then(Value::as_str) {
        let ok = match expected_type {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "number" => value.is_number(),
            "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
            _ => true,
        };
        if !ok {
            errors.push(format!("{path} must be {expected_type}"));
            return;
        }
    }
    if let Some(options) = schema.get("enum").and_then(Value::as_array) {
        if !options.iter().any(|item| item == value) {
            errors.push(format!(
                "{path} must be one of {}",
                Value::Array(options.clone())
            ));
        }
    }
    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|number| number < minimum) {
            errors.push(format!("{path} must be >= {minimum}"));
        }
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|number| number > maximum) {
            errors.push(format!("{path} must be <= {maximum}"));
        }
    }
    if let Some(min_length) = schema.get("minLength").and_then(Value::as_u64) {
        if value
            .as_str()
            .is_some_and(|text| text.chars().count() < min_length as usize)
        {
            errors.push(format!("{path} is shorter than {min_length}"));
        }
    }
    if let Some(max_length) = schema.get("maxLength").and_then(Value::as_u64) {
        if value
            .as_str()
            .is_some_and(|text| text.chars().count() > max_length as usize)
        {
            errors.push(format!("{path} is longer than {max_length}"));
        }
    }
    if let (Some(object), Some(properties)) = (
        value.as_object(),
        schema.get("properties").and_then(Value::as_object),
    ) {
        let additional = schema
            .get("additionalProperties")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        for (key, item) in object {
            let next_path = if path == "$" {
                format!("$.{key}")
            } else {
                format!("{path}.{key}")
            };
            if let Some(property_schema) = properties.get(key) {
                validate_settings_value(item, property_schema, root, &next_path, errors);
            } else if !additional {
                errors.push(format!("{next_path} is not a supported setting key"));
            }
        }
    }
    if let (Some(items), Some(item_schema)) = (value.as_array(), schema.get("items")) {
        for (index, item) in items.iter().enumerate() {
            validate_settings_value(item, item_schema, root, &format!("{path}[{index}]"), errors);
        }
    }
}

fn settings_validation_error(errors: Vec<String>) -> String {
    format!(
        "SETTINGS_SCHEMA_VALIDATION_FAILED: {}; hint=Use clipf.settings.get to inspect schema, then retry with a smaller patch.",
        errors.join("; ")
    )
}

fn validate_settings_patch(input: &Value) -> Result<(), String> {
    let schema = settings_json_schema();
    let mut errors = Vec::new();
    validate_settings_value(input, &schema, &schema, "$", &mut errors);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(settings_validation_error(errors))
    }
}

fn public_settings_payload(include_schema: bool) -> Result<Value, String> {
    let payload = read_user_settings()?;
    let settings = payload.settings;
    let revision = settings_revision(&settings);
    let updated_at = now_millis()?;
    Ok(json!({
        "settings": redact_settings_value(&settings),
        "schema": if include_schema { settings_json_schema() } else { Value::Null },
        "revision": revision,
        "updatedAt": updated_at,
        "source": "tauri",
        "writePolicy": {
            "recommendedMode": "patch",
            "replaceRequiresConfirmation": true,
            "resetRequiresConfirmation": true,
            "arrayMerge": "replace"
        },
        "warnings": [
            "Prefer settings patch updates. Full replacement is available only with confirmed=true.",
            "Arrays are replaced as complete values, including agent.providers and tagRules.",
            "Prefer agent.providers[].apiKeyEnv over persistent inline apiKey."
        ],
        "redaction": {
            "agent.providers[].apiKey": "write-only in UI and MCP responses should not depend on reading it back from provider list",
            "agent.providers[].apiKeyEnv": "preferred for persistent config"
        }
    }))
}

#[tauri::command]
fn settings_get_public() -> Result<Value, String> {
    public_settings_payload(true)
}

#[tauri::command]
fn settings_patch_public(input: Value) -> Result<Value, String> {
    validate_settings_patch(&input)?;
    let mut current = read_user_settings()?.settings;
    merge_settings_patch(&mut current, &input);
    write_user_settings(current)?;
    public_settings_payload(true)
}

#[tauri::command]
fn settings_replace_public(input: Value, confirmed: Option<bool>) -> Result<Value, String> {
    if confirmed != Some(true) {
        return Err("SETTINGS_REPLACE_REQUIRES_CONFIRMATION: use partial patch unless you intend to replace the full settings object".to_string());
    }
    validate_settings_patch(&input)?;
    write_user_settings(input)?;
    public_settings_payload(true)
}

#[tauri::command]
fn settings_reset_public(scope: Option<String>, confirmed: Option<bool>) -> Result<Value, String> {
    if confirmed != Some(true) {
        return Err("SETTINGS_RESET_REQUIRES_CONFIRMATION".to_string());
    }
    let scope = scope.unwrap_or_else(|| "all".to_string());
    let mut current = read_user_settings()?.settings;
    match scope.as_str() {
        "all" => current = json!({}),
        "agent" => {
            if let Some(object) = current.as_object_mut() {
                object.remove("agent");
                object.remove("agentProviders");
            }
        }
        key => {
            if let Some(object) = current.as_object_mut() {
                object.remove(key);
            } else {
                current = json!({});
            }
        }
    }
    write_user_settings(current)?;
    public_settings_payload(true)
}

fn ensure_expected_settings_revision(
    settings: &Value,
    expected_revision: Option<&str>,
) -> Result<String, String> {
    let revision = settings_revision(settings);
    if let Some(expected_revision) = expected_revision {
        if !expected_revision.trim().is_empty() && expected_revision != revision {
            return Err(format!(
                "SETTINGS_REVISION_CONFLICT: expected {expected_revision}, current {revision}; get latest settings before retrying"
            ));
        }
    }
    Ok(revision)
}

fn emit_settings_changed<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    previous_revision: String,
    revision: String,
    changed_paths: Vec<String>,
    actor: &str,
    mode: &str,
    updated_at: i64,
) {
    let _ = app.emit(
        "settings_changed",
        json!({
            "revision": revision,
            "previousRevision": previous_revision,
            "changedPaths": changed_paths,
            "actor": actor,
            "mode": mode,
            "updatedAt": updated_at
        }),
    );
}

fn settings_write_response(
    settings: Value,
    previous_revision: String,
    changed_paths: Vec<String>,
    include_schema: bool,
) -> Result<Value, String> {
    let mut payload = public_settings_payload(include_schema)?;
    payload["previousRevision"] = Value::String(previous_revision);
    payload["changedPaths"] = Value::Array(changed_paths.into_iter().map(Value::String).collect());
    payload["nextActions"] = json!([
        "Prefer settings_service_patch / clipf.settings.patch for follow-up changes.",
        "Use settings_service_get / clipf.settings.get to refresh schema and revision before replace/reset."
    ]);
    payload["settings"] = redact_settings_value(&settings);
    Ok(payload)
}

#[tauri::command]
fn settings_service_get(include_schema: Option<bool>) -> Result<Value, String> {
    // 记录耗时（B6）：300ms 是控制面操作的硬预算，超限写 log 便于回归追踪。
    let started = std::time::Instant::now();
    let mut payload = public_settings_payload(include_schema.unwrap_or(true))?;
    let duration_ms = started.elapsed().as_millis() as i64;
    payload["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("get", duration_ms);
    Ok(payload)
}

#[tauri::command]
fn settings_service_patch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    patch: Value,
    actor: Option<String>,
    reason: Option<String>,
    expected_revision: Option<String>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let _write_guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|error| format!("SETTINGS_LOCK_POISONED: {error}"))?;
    validate_settings_patch(&patch)?;
    let previous = read_user_settings()?.settings;
    let previous_revision =
        ensure_expected_settings_revision(&previous, expected_revision.as_deref())?;
    let mut next = previous.clone();
    merge_settings_patch(&mut next, &patch);
    let changed_paths = settings_changed_paths(&previous, &next);
    write_user_settings(next.clone())?;
    sync_global_shortcut_registration(&app);
    let updated_at = now_millis()?;
    let revision = settings_revision(&next);
    emit_settings_changed(
        &app,
        previous_revision.clone(),
        revision,
        changed_paths.clone(),
        actor.as_deref().unwrap_or("settings-window"),
        "patch",
        updated_at,
    );
    log_to_file(
        "info",
        "settings-service",
        &format!(
            "patch actor={} reason={} changed={}",
            actor.as_deref().unwrap_or("settings-window"),
            reason.as_deref().unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("patch", duration_ms);
    Ok(response)
}

#[tauri::command]
fn settings_service_replace<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    settings: Value,
    actor: Option<String>,
    reason: Option<String>,
    expected_revision: Option<String>,
    confirmed: Option<bool>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    if confirmed != Some(true) {
        return Err("SETTINGS_REPLACE_REQUIRES_CONFIRMATION: use patch for partial updates or retry with confirmed=true".to_string());
    }
    let _write_guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|error| format!("SETTINGS_LOCK_POISONED: {error}"))?;
    validate_settings_patch(&settings)?;
    let previous = read_user_settings()?.settings;
    let previous_revision =
        ensure_expected_settings_revision(&previous, expected_revision.as_deref())?;
    let changed_paths = settings_changed_paths(&previous, &settings);
    write_user_settings(settings.clone())?;
    sync_global_shortcut_registration(&app);
    let updated_at = now_millis()?;
    let revision = settings_revision(&settings);
    emit_settings_changed(
        &app,
        previous_revision.clone(),
        revision,
        changed_paths.clone(),
        actor.as_deref().unwrap_or("settings-window"),
        "replace",
        updated_at,
    );
    log_to_file(
        "warn",
        "settings-service",
        &format!(
            "replace actor={} reason={} changed={}",
            actor.as_deref().unwrap_or("settings-window"),
            reason.as_deref().unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(settings, previous_revision, changed_paths, true)?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("replace", duration_ms);
    Ok(response)
}

#[tauri::command]
fn settings_service_reset<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    scope: Option<String>,
    actor: Option<String>,
    reason: Option<String>,
    expected_revision: Option<String>,
    confirmed: Option<bool>,
) -> Result<Value, String> {
    let started = std::time::Instant::now();
    if confirmed != Some(true) {
        return Err(
            "SETTINGS_RESET_REQUIRES_CONFIRMATION: retry with scope and confirmed=true".to_string(),
        );
    }
    let _write_guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|error| format!("SETTINGS_LOCK_POISONED: {error}"))?;
    let scope = scope.ok_or_else(|| {
        "SETTINGS_RESET_REQUIRES_SCOPE: use one of all, agent, shortcuts, display, capture, storage, logs, tags".to_string()
    })?;
    let previous = read_user_settings()?.settings;
    let previous_revision =
        ensure_expected_settings_revision(&previous, expected_revision.as_deref())?;
    let mut next = previous.clone();
    match scope.as_str() {
        "all" => next = json!({}),
        "agent" => {
            if let Some(object) = next.as_object_mut() {
                object.remove("agent");
                object.remove("agentProviders");
            }
        }
        "shortcuts" => {
            if let Some(object) = next.as_object_mut() {
                object.remove("globalShortcut");
            }
        }
        "display" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "panelDensity",
                    "contentDisplayMode",
                    "positionStrategy",
                    "panelBackgroundOpacity",
                    "enableScrollCollapse",
                    "panelWidth",
                    "panelHeight",
                ] {
                    object.remove(key);
                }
            }
        }
        "capture" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "captureTextEnabled",
                    "captureHtmlEnabled",
                    "captureRtfEnabled",
                    "captureImageEnabled",
                    "captureFileEnabled",
                    "captureSensitiveEnabled",
                    "imageMaxSizeMb",
                    "textMaxSizeMb",
                ] {
                    object.remove(key);
                }
            }
        }
        "storage" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "quickItemLimit",
                    "maxStoredItems",
                    "clipboardPollMs",
                    "cleanupEnabled",
                    "cleanupIntervalHours",
                    "softDeletedRetentionDays",
                ] {
                    object.remove(key);
                }
            }
        }
        "logs" => {
            if let Some(object) = next.as_object_mut() {
                for key in [
                    "logMaxSizeMb",
                    "logKeepRatio",
                    "logMaxLines",
                    "logRetentionDays",
                    "logAutoCleanup",
                    "logCleanupIntervalMin",
                ] {
                    object.remove(key);
                }
            }
        }
        "tags" => {
            if let Some(object) = next.as_object_mut() {
                object.remove("tagMode");
                object.remove("tagRules");
            }
        }
        _ => {
            return Err("SETTINGS_RESET_INVALID_SCOPE: use one of all, agent, shortcuts, display, capture, storage, logs, tags".to_string());
        }
    }
    let changed_paths = settings_changed_paths(&previous, &next);
    write_user_settings(next.clone())?;
    sync_global_shortcut_registration(&app);
    let updated_at = now_millis()?;
    let revision = settings_revision(&next);
    emit_settings_changed(
        &app,
        previous_revision.clone(),
        revision,
        changed_paths.clone(),
        actor.as_deref().unwrap_or("settings-window"),
        "reset",
        updated_at,
    );
    log_to_file(
        "warn",
        "settings-service",
        &format!(
            "reset scope={} actor={} reason={} changed={}",
            scope,
            actor.as_deref().unwrap_or("settings-window"),
            reason.as_deref().unwrap_or(""),
            changed_paths.join(",")
        ),
    );
    let mut response = settings_write_response(next, previous_revision, changed_paths, true)?;
    let duration_ms = started.elapsed().as_millis() as i64;
    response["durationMs"] = json!(duration_ms);
    log_slow_settings_operation("reset", duration_ms);
    Ok(response)
}

#[tauri::command]
fn settings_service_agent_providers() -> Result<Value, String> {
    let config = agent_get_config()?;
    Ok(json!({
        "activeProviderId": config.active_provider_id,
        "providers": config.providers,
        "tools": config.tools,
        "revision": settings_revision(&read_user_settings()?.settings)
    }))
}

#[tauri::command]
fn settings_service_agent_check(
    provider_id: Option<String>,
) -> Result<AgentProviderReadiness, String> {
    agent_check_provider(provider_id)
}

#[tauri::command]
fn settings_service_agent_models(
    provider_id: Option<String>,
) -> Result<AgentProviderModelsPayload, String> {
    agent_list_provider_models(provider_id)
}

#[tauri::command]
fn agent_detect() -> Result<Vec<AgentProviderReadiness>, String> {
    Ok(agent_detect_candidates()
        .iter()
        .map(check_agent_candidate)
        .collect())
}

#[tauri::command]
fn agent_prepare_run(input: AgentInvocationConfig) -> Result<AgentPreparedRunPayload, String> {
    let provider = agent_candidate_by_id(input.provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    let now = now_millis()?;
    let prompt = compose_agent_prompt(&input);
    let run_id = agent_trace_id("agent_run");
    let foreground_clip_id = agent_context_foreground_clip_id(&input.context_set);
    let payload = build_agent_run_payload(
        run_id.clone(),
        &provider,
        &prompt,
        &input.context_set,
        AgentRunStatus::WaitingConfirmation.as_str(),
        now,
        input.allow_full_content.unwrap_or(false),
    );
    let transcript = vec![
        insert_agent_transcript(&run_id, "run-marker", "prepared", true),
        insert_agent_transcript(&run_id, "user-message", &input.prompt, true),
    ];
    agent_runs()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            run_id,
            AgentRunState {
                payload: payload.clone(),
                transcript,
                child: None,
                foreground_clip_id,
            },
        );
    log_agent_event(
        "prepared",
        &payload,
        json!({ "referenceCount": input.context_set.get("references").and_then(Value::as_array).map(|items| items.len()).unwrap_or(0) }),
    );
    Ok(AgentPreparedRunPayload {
        run: payload,
        requires_confirmation: true,
    })
}

#[tauri::command]
fn agent_start_run<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: AgentStartRunInput,
) -> Result<AgentRunPayload, String> {
    if input.confirmed != Some(true) {
        return Err("AGENT_RUN_CONFIRMATION_REQUIRED".to_string());
    }
    let provider = agent_candidate_by_id(input.provider_id.as_deref())
        .ok_or_else(|| "AGENT_PROVIDER_NOT_CONFIGURED".to_string())?;
    let run_id = input.run_id.unwrap_or_else(|| agent_trace_id("agent_run"));
    let foreground_clip_id = agent_context_foreground_clip_id(&input.context_set);
    if let Some(clip_id) = foreground_clip_id.as_deref() {
        let runs_ref = agent_runs();
        let runs = runs_ref.lock().map_err(|error| error.to_string())?;
        for state in runs.values() {
            if state.foreground_clip_id.as_deref() != Some(clip_id) {
                continue;
            }
            if state.payload.id == run_id && state.child.is_none() {
                continue;
            }
            if state.payload.id == run_id && state.child.is_some() {
                return Ok(state.payload.clone());
            }
            if state.child.is_some() || is_active_agent_status(&state.payload.status) {
                return Err(format!("AGENT_FOREGROUND_RUN_EXISTS:{}", state.payload.id));
            }
        }
    }
    let readiness = check_agent_candidate(&provider);
    if readiness.status != "ready" {
        let now = now_millis()?;
        let mut payload = build_agent_run_payload(
            run_id.clone(),
            &provider,
            &input.prompt,
            &input.context_set,
            AgentRunStatus::Failed.as_str(),
            now,
            input.allow_full_content.unwrap_or(false),
        );
        payload.error_code = Some(readiness.status.clone());
        payload.error_message = Some(readiness.reason.clone());
        set_agent_run_status(&mut payload, AgentRunStatus::Failed, now);
        agent_runs()
            .lock()
            .map_err(|error| error.to_string())?
            .insert(
                run_id.clone(),
                AgentRunState {
                    payload: payload.clone(),
                    transcript: vec![insert_agent_transcript(
                        &run_id,
                        "run-error",
                        &readiness.reason,
                        true,
                    )],
                    child: None,
                    foreground_clip_id,
                },
            );
        log_agent_event(
            "provider-unavailable",
            &payload,
            json!({ "readinessStatus": readiness.status }),
        );
        emit_agent_ui_message(
            &app,
            &run_id,
            "assistant",
            &readiness.reason,
            Some("failed"),
        );
        let _ = app.emit("agent_run_error", &payload);
        return Ok(payload);
    }

    let invocation = AgentInvocationConfig {
        provider_id: Some(provider.provider_id.clone()),
        prompt: input.prompt.clone(),
        context_set: input.context_set.clone(),
        allow_full_content: input.allow_full_content,
    };
    let prompt = compose_agent_prompt(&invocation);
    let now = now_millis()?;
    let output_mode = if provider.kind == "openai-compatible" {
        AgentOutputMode::StandardJsonEvents
    } else {
        AgentOutputMode::PlainText
    };
    let mut command = if provider.kind == "openai-compatible" {
        let mut command = Command::new("python3");
        command.args(["-u", "-c", openai_compatible_bridge_script()]);
        command
    } else {
        let mut command = Command::new(&provider.command);
        command.args(&provider.args);
        command
    };
    command
        .env("PATH", agent_path_env())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("AGENT_SPAWN_FAILED: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        if provider.kind == "openai-compatible" {
            let bridge_input = json!({
                "prompt": prompt.clone(),
                "baseUrl": provider.base_url.as_deref().unwrap_or("https://api.openai.com/v1"),
                "apiKey": provider.api_key.as_deref().unwrap_or(""),
                "apiKeyEnv": provider.api_key_ref.as_deref().unwrap_or("CLIPFORGE_AGENT_OPENAI_API_KEY"),
                "modelId": provider.model_id.as_deref().unwrap_or(""),
                "timeoutSeconds": provider.timeout_seconds.unwrap_or(120),
            });
            stdin
                .write_all(bridge_input.to_string().as_bytes())
                .map_err(|error| format!("AGENT_STDIN_FAILED: {error}"))?;
        } else {
            stdin
                .write_all(prompt.as_bytes())
                .map_err(|error| format!("AGENT_STDIN_FAILED: {error}"))?;
        }
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut payload = build_agent_run_payload(
        run_id.clone(),
        &provider,
        &prompt,
        &input.context_set,
        AgentRunStatus::Streaming.as_str(),
        now,
        input.allow_full_content.unwrap_or(false),
    );
    payload.started_at = Some(now);
    set_agent_run_status(&mut payload, AgentRunStatus::Streaming, now);
    let transcript = vec![
        insert_agent_transcript(&run_id, "run-marker", "started", true),
        insert_agent_transcript(&run_id, "user-message", &input.prompt, true),
    ];
    agent_runs()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            run_id.clone(),
            AgentRunState {
                payload: payload.clone(),
                transcript,
                child: Some(child),
                foreground_clip_id,
            },
        );
    log_agent_event(
        "started",
        &payload,
        json!({ "allowFullContent": input.allow_full_content.unwrap_or(false) }),
    );
    let _ = app.emit("agent_run_started", &payload);
    emit_agent_ui_message(
        &app,
        &run_id,
        "assistant",
        &format!("正在运行: {}", payload.command_preview),
        Some("streaming"),
    );

    if let Some(stdout) = stdout {
        spawn_agent_output_reader(
            app.clone(),
            run_id.clone(),
            "stdout",
            stdout,
            false,
            output_mode,
        );
    }
    if let Some(stderr) = stderr {
        spawn_agent_output_reader(
            app.clone(),
            run_id.clone(),
            "stderr",
            stderr,
            true,
            AgentOutputMode::PlainText,
        );
    }

    let app_for_wait = app.clone();
    let run_id_for_wait = run_id.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(80));
        let maybe_finished = {
            let runs_ref = agent_runs();
            let mut runs = match runs_ref.lock() {
                Ok(runs) => runs,
                Err(_) => return,
            };
            let Some(state) = runs.get_mut(&run_id_for_wait) else {
                return;
            };
            let Some(child) = state.child.as_mut() else {
                return;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    let now = now_millis().unwrap_or(0);
                    state.child = None;
                    let next_status = if status.success() {
                        AgentRunStatus::Succeeded
                    } else {
                        AgentRunStatus::Failed
                    };
                    state.payload.exit_code = status.code();
                    set_agent_run_status(&mut state.payload, next_status, now);
                    if !status.success() {
                        state.payload.error_code = Some("AGENT_EXIT_FAILED".to_string());
                        state.payload.error_message =
                            Some(format!("provider exited with code {:?}", status.code()));
                    }
                    let row_text = format!(
                        "finished status={} exit={:?}",
                        state.payload.status,
                        status.code()
                    );
                    state.transcript.push(insert_agent_transcript(
                        &run_id_for_wait,
                        "run-marker",
                        &row_text,
                        true,
                    ));
                    Some(state.payload.clone())
                }
                Ok(None) => None,
                Err(error) => {
                    let now = now_millis().unwrap_or(0);
                    state.child = None;
                    state.payload.error_code = Some("AGENT_WAIT_FAILED".to_string());
                    state.payload.error_message = Some(error.to_string());
                    set_agent_run_status(&mut state.payload, AgentRunStatus::Failed, now);
                    Some(state.payload.clone())
                }
            }
        };
        if let Some(payload) = maybe_finished {
            log_agent_event("finished", &payload, json!({ "terminal": true }));
            emit_agent_ui_message(
                &app_for_wait,
                &payload.id,
                "assistant",
                if payload.output.is_empty() {
                    payload.error_message.as_deref().unwrap_or(&payload.status)
                } else {
                    &payload.output
                },
                Some(&payload.status),
            );
            if payload.status == "succeeded" {
                let _ = app_for_wait.emit("agent_run_finished", &payload);
            } else {
                let _ = app_for_wait.emit("agent_run_error", &payload);
            }
            let _ = app_for_wait.emit(
                "agent_transcript_rows",
                agent_get_transcript(run_id_for_wait.clone()).unwrap_or_default(),
            );
            return;
        }
    });

    Ok(payload)
}

fn append_agent_output(run_id: &str, line: &str, stderr: bool) {
    let runs_ref = agent_runs();
    let Ok(mut runs) = runs_ref.lock() else {
        return;
    };
    let Some(state) = runs.get_mut(run_id) else {
        return;
    };
    if !state.payload.output.is_empty() {
        state.payload.output.push('\n');
    }
    state.payload.output.push_str(line);
    if state.payload.output.chars().count() > 60_000 {
        state.payload.output = state
            .payload
            .output
            .chars()
            .rev()
            .take(60_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }
    state.payload.updated_at = now_millis().unwrap_or(state.payload.updated_at);
    log_agent_event(
        "output-flush",
        &state.payload,
        json!({
            "stream": if stderr { "stderr" } else { "stdout" },
            "chunkLength": line.chars().count(),
        }),
    );
    state.transcript.push(insert_agent_transcript(
        run_id,
        if stderr {
            "stderr"
        } else {
            "assistant-message"
        },
        line,
        false,
    ));
}

#[tauri::command]
fn agent_cancel_run(run_id: String) -> Result<AgentRunPayload, String> {
    let now = now_millis()?;
    let runs_ref = agent_runs();
    let mut runs = runs_ref.lock().map_err(|error| error.to_string())?;
    let state = runs
        .get_mut(&run_id)
        .ok_or_else(|| "AGENT_RUN_NOT_FOUND".to_string())?;
    if state.child.is_some() {
        set_agent_run_status(&mut state.payload, AgentRunStatus::Cancelling, now);
    }
    if let Some(child) = state.child.as_mut() {
        let _ = child.kill();
    }
    state.child = None;
    set_agent_run_status(&mut state.payload, AgentRunStatus::Cancelled, now);
    state.transcript.push(insert_agent_transcript(
        &run_id,
        "run-marker",
        "cancelled",
        true,
    ));
    log_agent_event("cancelled", &state.payload, json!({ "terminal": true }));
    Ok(state.payload.clone())
}

#[tauri::command]
fn agent_get_run(run_id: String) -> Result<AgentRunPayload, String> {
    agent_runs()
        .lock()
        .map_err(|error| error.to_string())?
        .get(&run_id)
        .map(|state| state.payload.clone())
        .ok_or_else(|| "AGENT_RUN_NOT_FOUND".to_string())
}

#[tauri::command]
fn agent_get_transcript(run_id: String) -> Result<Vec<AgentTranscriptRowPayload>, String> {
    agent_runs()
        .lock()
        .map_err(|error| error.to_string())?
        .get(&run_id)
        .map(|state| state.transcript.clone())
        .ok_or_else(|| "AGENT_RUN_NOT_FOUND".to_string())
}

#[tauri::command]
fn agent_restore_session() -> Result<AgentSessionSnapshotPayload, String> {
    let runs_ref = agent_runs();
    let runs = runs_ref.lock().map_err(|error| error.to_string())?;
    let mut snapshots: Vec<AgentRunSnapshotPayload> = runs
        .values()
        .map(|state| AgentRunSnapshotPayload {
            run: state.payload.clone(),
            transcript: state.transcript.clone(),
        })
        .collect();
    snapshots.sort_by_key(|snapshot| snapshot.run.created_at);
    let active_run_id = snapshots
        .iter()
        .rev()
        .find(|snapshot| is_active_agent_status(&snapshot.run.status))
        .or_else(|| snapshots.last())
        .map(|snapshot| snapshot.run.id.clone());
    log_to_file(
        "info",
        "agent-runtime",
        &json!({
            "event": "restore-session",
            "runCount": snapshots.len(),
            "activeRunId": active_run_id.clone(),
            "redactedFields": ["prompt", "output", "contextSummary", "commandPreview", "transcriptText"],
        })
        .to_string(),
    );
    Ok(AgentSessionSnapshotPayload {
        runs: snapshots,
        active_run_id,
        restored_at: now_millis()?,
    })
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
fn check_update() -> Result<UpdateCheckState, String> {
    let now = now_millis()?;
    let mut state = base_update_state(now);
    if let Ok(manifest_path) = std::env::var("CLIPFORGE_UPDATE_MANIFEST") {
        state = check_update_manifest(&manifest_path, now);
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
fn download_update() -> Result<UpdateCheckState, String> {
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
    state.status = "ready".to_string();
    state.download_progress = Some(1.0);
    state.error_code = None;
    state.error_message = None;
    state.last_checked_at = Some(now);
    persist_update_state(&state)?;
    log_to_file(
        "info",
        "update-download",
        &format!(
            "status=ready version={}",
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
        state.error_code = Some("MANUAL_INSTALL_REQUIRED".to_string());
        state.error_message =
            Some("当前构建未绑定发布私钥，请从 GitHub Release 下载签名安装包安装。".to_string());
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

fn check_update_manifest(manifest_path: &str, now: i64) -> UpdateCheckState {
    let mut state = base_update_state(now);
    let raw = match fs::read_to_string(manifest_path) {
        Ok(raw) => raw,
        Err(error) => {
            state.status = "failed".to_string();
            state.error_code = Some("MANIFEST_READ_FAILED".to_string());
            state.error_message = Some(error.to_string());
            return state;
        }
    };
    let manifest: ReleaseManifest = match serde_json::from_str(&raw) {
        Ok(manifest) => manifest,
        Err(error) => {
            state.status = "failed".to_string();
            state.error_code = Some("MANIFEST_PARSE_FAILED".to_string());
            state.error_message = Some(error.to_string());
            return state;
        }
    };
    state.channel = manifest
        .clipforge
        .and_then(|meta| meta.channel)
        .unwrap_or_else(|| "stable".to_string());
    state.release_notes = manifest.notes;

    if state.ignored_version.as_deref() == Some(manifest.version.as_str()) {
        state.status = "latest".to_string();
        return state;
    }
    if !version_is_newer(&manifest.version, &state.current_version) {
        state.status = "latest".to_string();
        return state;
    }

    let platform_key = update_platform_key();
    let Some(platform) = manifest
        .platforms
        .as_ref()
        .and_then(|platforms| platforms.get(&platform_key))
    else {
        state.status = "failed".to_string();
        state.available_version = Some(manifest.version);
        state.error_code = Some("PLATFORM_NOT_FOUND".to_string());
        state.error_message = Some(format!("manifest missing platform {platform_key}"));
        return state;
    };
    if platform.url.as_deref().unwrap_or("").trim().is_empty() {
        state.status = "failed".to_string();
        state.available_version = Some(manifest.version);
        state.error_code = Some("ARTIFACT_URL_MISSING".to_string());
        state.error_message = Some("manifest platform url is empty".to_string());
        return state;
    }
    if platform
        .signature
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        state.status = "failed".to_string();
        state.available_version = Some(manifest.version);
        state.error_code = Some("SIGNATURE_MISSING".to_string());
        state.error_message = Some("manifest platform signature is empty".to_string());
        return state;
    }

    state.status = "available".to_string();
    state.available_version = Some(manifest.version);
    state.error_code = None;
    state.error_message = None;
    state
}

fn update_platform_key() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => other,
    };
    format!("{os}-{arch}")
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| {
        value
            .trim_start_matches('v')
            .split(['.', '-'])
            .take(3)
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let mut candidate_parts = parse(candidate);
    let mut current_parts = parse(current);
    candidate_parts.resize(3, 0);
    current_parts.resize(3, 0);
    candidate_parts > current_parts
}

#[cfg(test)]
mod update_tests {
    use super::*;

    fn write_manifest(name: &str, body: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("clipforge-{name}-{}.json", std::process::id()));
        fs::write(&path, body).expect("write manifest");
        path
    }

    #[test]
    fn compares_semver_versions() {
        assert!(version_is_newer("0.2.0", "0.1.9"));
        assert!(version_is_newer("v1.0.0", "0.9.9"));
        assert!(!version_is_newer("0.1.0", "0.1.0"));
        assert!(!version_is_newer("0.1.0", "0.1.1"));
    }

    #[test]
    fn reads_available_local_manifest() {
        let platform = update_platform_key();
        let path = write_manifest(
            "available",
            &format!(
                r#"{{
  "version": "99.99.98",
  "notes": "test update",
  "platforms": {{
    "{platform}": {{ "signature": "signed", "url": "https://example.invalid/clipforge.dmg" }}
  }},
  "clipforge": {{ "channel": "stable" }}
}}"#
            ),
        );
        let state = check_update_manifest(path.to_string_lossy().as_ref(), 1);
        assert_eq!(state.status, "available");
        assert_eq!(state.available_version.as_deref(), Some("99.99.98"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_unsigned_local_manifest() {
        let platform = update_platform_key();
        let path = write_manifest(
            "unsigned",
            &format!(
                r#"{{
  "version": "99.99.97",
  "platforms": {{
    "{platform}": {{ "signature": "", "url": "https://example.invalid/clipforge.dmg" }}
  }}
}}"#
            ),
        );
        let state = check_update_manifest(path.to_string_lossy().as_ref(), 1);
        assert_eq!(state.status, "failed");
        assert_eq!(state.error_code.as_deref(), Some("SIGNATURE_MISSING"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reports_missing_manifest_file() {
        let path =
            std::env::temp_dir().join(format!("clipforge-missing-{}.json", std::process::id()));
        let state = check_update_manifest(path.to_string_lossy().as_ref(), 1);
        assert_eq!(state.status, "failed");
        assert_eq!(state.error_code.as_deref(), Some("MANIFEST_READ_FAILED"));
    }

    #[test]
    fn reports_platform_mismatch() {
        let path = write_manifest(
            "platform-mismatch",
            r#"{
  "version": "99.99.96",
  "platforms": {
    "windows-x86_64": { "signature": "signed", "url": "https://example.invalid/clipforge.exe" }
  }
}"#,
        );
        let state = check_update_manifest(path.to_string_lossy().as_ref(), 1);
        assert_eq!(state.status, "failed");
        assert_eq!(state.error_code.as_deref(), Some("PLATFORM_NOT_FOUND"));
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
fn capture_clip_record(
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
fn capture_current_clipboard(
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

fn capture_clip_payload(
    payload: clipboard::StandardClipboardPayload,
    source_label: Option<String>,
    observed_at: i64,
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

    let id = format!("clip_{hash}_{observed_at}");
    let primary_format = draft.primary_format.clone();
    let available_formats_json = json_string(&draft.available_formats)?;
    let representations_json = json_string(&draft.representations)?;
    let source_label_value = source_label.unwrap_or_else(|| "Clipboard".to_string());
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
    let source_app = current_source_app();
    let capture_context = make_capture_context(
        &source_label_value,
        source_app.as_ref(),
        observed_at,
        &primary_format,
        &draft.available_formats,
    );
    let capture_context_json = json_string(&capture_context)?;
    let metadata_json = json_string(&draft.metadata)?;
    let source_app_name = source_app.as_ref().map(|s| s.name.as_str()).unwrap_or("");
    let source_app_bundle = source_app
        .as_ref()
        .map(|s| s.bundle_id.as_str())
        .unwrap_or("");
    let source_app_executable = source_app
        .as_ref()
        .map(|s| s.executable_path.as_str())
        .unwrap_or("");
    let source_app_icon = source_app.as_ref().and_then(|s| s.icon_base64.as_deref());
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

fn log_to_file(level: &str, module: &str, message: &str) {
    // 非阻塞：只把格式化好的日志行投递给后台写线程，绝不在调用线程（往往是 IPC / 粘贴 /
    // 唤起热路径）上做 fs::OpenOptions + write_all。show/hide/copy/paste 每次都产生若干条
    // 日志，同步落盘是整体「停顿感」的主要来源之一。
    if let Ok(line) = build_log_line(level, &format!("[{}] {}", module, message), "") {
        log_writer_send(line);
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
        interval_min: 10,
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
            s.interval_min = n.max(1);
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
fn search_clip_records(input: SearchClipsRequest) -> Result<QueryClipPayload, String> {
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
fn soft_delete_clip_records(ids: Vec<String>) -> Result<DeleteClipPayload, String> {
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
fn update_clip_record(input: UpdateClipInput) -> Result<ClipItemPayload, String> {
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
fn export_clip_records(include_deleted: Option<bool>) -> Result<ExportClipPayload, String> {
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

#[tauri::command]
fn import_clip_records(items: Vec<ImportClipInput>) -> Result<ImportClipPayload, String> {
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

#[tauri::command]
fn open_settings_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App("settings.html".into()))
            .title(native_tr("window.settings.title"))
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
fn get_clipforge_settings() -> Result<Value, String> {
    read_user_settings().map(|payload| payload.settings)
}

#[tauri::command]
fn get_clipforge_config_path() -> Result<String, String> {
    Ok(settings_path()?.to_string_lossy().to_string())
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

#[tauri::command]
fn update_clipforge_settings<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: Value,
) -> Result<Value, String> {
    // legacy 写路径也加锁 + 接入 settings_changed 事件总线（B2b + B5），消除多窗口漂移根因。
    let _write_guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|error| format!("SETTINGS_LOCK_POISONED: {error}"))?;
    let previous = read_user_settings()?.settings;
    let previous_revision = settings_revision(&previous);
    let mut current = previous.clone();
    merge_json_object(&mut current, input);
    let changed_paths = settings_changed_paths(&previous, &current);
    write_user_settings(current.clone())?;
    sync_global_shortcut_registration(&app);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        match build_tray_menu(&app) {
            Ok(menu) => {
                if let Err(error) = tray.set_menu(Some(menu)) {
                    log_to_file(
                        "warn",
                        "tray",
                        &format!("set_menu after settings update failed: {}", error),
                    );
                }
            }
            Err(error) => log_to_file(
                "warn",
                "tray",
                &format!("rebuild menu after settings update failed: {}", error),
            ),
        }
    }
    let updated_at = now_millis()?;
    let revision = settings_revision(&current);
    emit_settings_changed(
        &app,
        previous_revision,
        revision,
        changed_paths,
        "settings-window",
        "patch",
        updated_at,
    );
    Ok(current)
}

#[tauri::command]
fn write_user_settings(settings: Value) -> Result<(), String> {
    write_settings_atomic(&settings)
}

/// 原子写入用户设置（B2）：先写临时文件并 fsync，再 rename 覆盖目标文件。
///
/// 所有写路径（settings_service_*、update_clipforge_settings、legacy 命令）都经过这里。
/// 裸 `fs::write` 在崩溃/断电时会截断或清空 settings.json5，导致丢失全部用户配置；
/// temp + sync_all + rename 保证目标文件要么是旧内容、要么是完整新内容，不会出现半写状态。
fn write_settings_atomic(settings: &Value) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = format!(
        "// ClipForge user settings. JSON5-style comments are allowed.\n{}\n",
        serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?
    );
    // 临时文件必须与目标在同一目录、同一文件系统，rename 才原子。
    let temp_path = match path.file_name().and_then(|name| name.to_str()) {
        Some(name) => path.with_file_name(format!("{name}.tmp")),
        None => return Err("SETTINGS_PATH_INVALID: cannot resolve settings file name".to_string()),
    };
    use std::io::Write;
    {
        let mut file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
        file.write_all(body.as_bytes())
            .map_err(|error| error.to_string())?;
        // fsync 确保数据落盘后再 rename，否则断电仍可能丢数据。
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, &path).map_err(|error| format!("SETTINGS_ATOMIC_RENAME_FAILED: {error}"))
}

fn current_native_locale() -> &'static str {
    let preference = read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("language")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        })
        .unwrap_or_else(|| "system".to_string());
    match preference.as_str() {
        "zh-CN" => "zh-CN",
        "en-US" => "en-US",
        _ => {
            let env_language = std::env::var("LANG")
                .or_else(|_| std::env::var("LC_ALL"))
                .or_else(|_| std::env::var("LC_MESSAGES"))
                .unwrap_or_default()
                .to_lowercase();
            if env_language.starts_with("zh") {
                "zh-CN"
            } else {
                "en-US"
            }
        }
    }
}

fn native_tr(key: &str) -> &'static str {
    let zh = current_native_locale() == "zh-CN";
    match (zh, key) {
        (true, "window.settings.title") => "ClipForge 设置",
        (false, "window.settings.title") => "ClipForge Settings",
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

#[tauri::command]
fn start_mcp_server() -> Result<McpStatusPayload, String> {
    start_mcp_server_with_reason("settings")
}

fn start_mcp_server_with_reason(reason: &str) -> Result<McpStatusPayload, String> {
    let child_ref = mcp_child();
    let mut child_slot = child_ref.lock().map_err(|error| error.to_string())?;
    if let Some(child) = child_slot.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            return Ok(mcp_status_payload(
                true,
                true,
                "stdio",
                &format!("MCP server is already running ({reason})"),
            ));
        }
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let child = Command::new(exe)
        .arg("--mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    *child_slot = Some(child);
    log_to_file(
        "info",
        "mcp",
        &format!("MCP server started, reason={}", reason),
    );
    Ok(mcp_status_payload(
        true,
        true,
        "stdio",
        &format!("MCP server started ({reason})"),
    ))
}

#[tauri::command]
fn stop_mcp_server() -> Result<McpStatusPayload, String> {
    let child_ref = mcp_child();
    let mut child_slot = child_ref.lock().map_err(|error| error.to_string())?;
    if let Some(child) = child_slot.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *child_slot = None;
    Ok(mcp_status_payload(
        true,
        false,
        "stdio",
        "MCP server stopped",
    ))
}

#[tauri::command]
fn get_mcp_status() -> Result<McpStatusPayload, String> {
    let child_ref = mcp_child();
    let mut child_slot = child_ref.lock().map_err(|error| error.to_string())?;
    let running = if let Some(child) = child_slot.as_mut() {
        child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
    } else {
        false
    };
    if !running {
        *child_slot = None;
    }
    Ok(mcp_status_payload(
        true,
        running,
        "stdio",
        if running {
            "MCP server running"
        } else {
            "MCP server idle"
        },
    ))
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
fn frontmost_app_identity() -> Option<(String, String)> {
    let script = r#"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  return (name of frontApp) & "|" & (bundle identifier of frontApp)
end tell
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let (name, bundle_id) = raw.split_once('|')?;
    if bundle_id.trim().is_empty() || bundle_id.trim() == APP_BUNDLE_IDENTIFIER {
        return None;
    }
    Some((name.trim().to_string(), bundle_id.trim().to_string()))
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
    let escaped = bundle_id.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("tell application id \"{}\" to activate", escaped);
    match Command::new("osascript").arg("-e").arg(script).output() {
        Ok(output) if output.status.success() => format!("activate=ok bundle={}", bundle_id),
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
    let script = r#"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  try
    set frontAppName to name of frontApp
    if frontAppName is "ClipForge" then return ""
    set focusedElement to value of attribute "AXFocusedUIElement" of frontApp
    try
      set selectedRange to value of attribute "AXSelectedTextRange" of focusedElement
      set rangeBounds to value of parameterized attribute "AXBoundsForRange" of focusedElement with parameter selectedRange
      if (count of rangeBounds) is 4 then
        return (item 1 of rangeBounds as text) & "," & (item 2 of rangeBounds as text) & "," & (item 3 of rangeBounds as text) & "," & (item 4 of rangeBounds as text) & ",focused-caret"
      end if
    end try
    set elementPosition to value of attribute "AXPosition" of focusedElement
    set elementSize to value of attribute "AXSize" of focusedElement
    return (item 1 of elementPosition as text) & "," & (item 2 of elementPosition as text) & "," & (item 1 of elementSize as text) & "," & (item 2 of elementSize as text) & ",focused-input"
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
    parse_native_bounds_with_source(&raw, "focused-input")
        .ok_or_else(|| "focused input bounds unavailable".to_string())
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

fn parse_native_bounds_with_source(
    raw: &str,
    fallback_source: &'static str,
) -> Option<NativeBounds> {
    let trimmed = raw.trim();
    let source = if trimmed.ends_with(",focused-caret") {
        "focused-caret"
    } else if trimmed.ends_with(",focused-input") {
        "focused-input"
    } else {
        fallback_source
    };
    let numeric_part = trimmed
        .trim_end_matches(",focused-caret")
        .trim_end_matches(",focused-input");
    parse_native_bounds(numeric_part, source)
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
    request_accessibility_permission_platform()
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

fn merge_json_object(base: &mut Value, patch: Value) {
    if !base.is_object() {
        *base = Value::Object(Default::default());
    }
    let Some(base_object) = base.as_object_mut() else {
        return;
    };
    if let Some(patch_object) = patch.as_object() {
        for (key, value) in patch_object {
            base_object.insert(key.clone(), value.clone());
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
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
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

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    for existing in columns {
        if existing.map_err(|error| error.to_string())? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )
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

fn make_capture_context(
    source_label: &str,
    source_app: Option<&SourceAppInfo>,
    observed_at: i64,
    primary_format: &str,
    available_formats: &[String],
) -> CaptureContextPayload {
    CaptureContextPayload {
        schema_version: 1,
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

fn analysis_kind_from_payload(payload_kind: &str) -> String {
    match payload_kind {
        "html" | "rtf" | "file" | "image" => "attachment",
        "json" | "chart" | "table" => payload_kind,
        "markdown" => "markdown",
        _ => "text",
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

fn load_clip(conn: &Connection, id: &str) -> Result<ClipItemPayload, String> {
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

fn suppress_writeback_for(duration: Duration) {
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
    // get_accessibility_diagnostics 与手动「重置权限」里进行。
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

const DEFAULT_GLOBAL_SHORTCUT: &str = "Control+V";
const LEGACY_DEFAULT_GLOBAL_SHORTCUT: &str = "CommandOrControl+Shift+V";
const FALLBACK_GLOBAL_SHORTCUT: &str = "Control+V";

fn normalize_global_shortcut_value(raw: Option<&str>) -> String {
    let shortcut = raw.unwrap_or_default().trim();
    if shortcut.is_empty() || shortcut.eq_ignore_ascii_case(LEGACY_DEFAULT_GLOBAL_SHORTCUT) {
        DEFAULT_GLOBAL_SHORTCUT.to_string()
    } else {
        shortcut.to_string()
    }
}

fn current_global_shortcut_value() -> String {
    read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("globalShortcut")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        })
        .map(|value| normalize_global_shortcut_value(Some(&value)))
        .unwrap_or_else(|| DEFAULT_GLOBAL_SHORTCUT.to_string())
}

fn registered_global_shortcuts() -> Vec<String> {
    let configured = read_user_settings()
        .ok()
        .and_then(|settings| {
            settings
                .settings
                .get("globalShortcut")
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
        })
        .unwrap_or_default();
    let primary = normalize_global_shortcut_value(Some(&configured));
    let mut shortcuts = vec![
        primary,
        DEFAULT_GLOBAL_SHORTCUT.to_string(),
        FALLBACK_GLOBAL_SHORTCUT.to_string(),
    ];

    shortcuts.sort();
    shortcuts.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    shortcuts
}

fn sync_global_shortcut_registration<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let shortcuts = registered_global_shortcuts();
    if let Err(error) = app.global_shortcut().unregister_all() {
        let _ = append_app_log(
            "warn".to_string(),
            "Unregister global shortcuts failed".to_string(),
            Some(error.to_string()),
        );
    }

    for shortcut in &shortcuts {
        let shortcut_label = shortcut.clone();
        let pressed_label = shortcut.clone();
        if let Err(error) =
            app.global_shortcut()
                .on_shortcut(shortcut.as_str(), move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        log_to_file("debug", "shortcut", &format!("pressed {}", pressed_label));
                        toggle_quick_panel(app, "shortcut");
                    }
                })
        {
            let _ = append_app_log(
                "warn".to_string(),
                "Register global shortcut failed".to_string(),
                Some(format!("{}: {}", shortcut_label, error)),
            );
        }
    }

    log_to_file(
        "info",
        "shortcut",
        &format!("registered shortcuts: {}", shortcuts.join(", ")),
    );
}

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

    // 启动后台剪贴板监听：脱离 WebView，隐藏时也能工作。
    // 监听、去重、设置过滤和入库统一收敛在 clipboard::watcher，避免保留第二条采集路径。
    clipboard::watcher::init(app.handle().clone());

    Ok(())
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
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            query_clip_records,
            search_clip_records,
            soft_delete_clip_records,
            restore_clip_records,
            hard_delete_clip_records,
            update_clip_record,
            save_editor_draft,
            export_clip_records,
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
            get_mcp_status
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
    if let Some(window) = app.get_webview_window("main") {
        maybe_prompt_accessibility_on_first_panel(app, reason);
        let strategy = get_strategy_for_source(reason);
        let strategy_clone = strategy.clone();

        // 入口诊断：来源 -> 策略，以及【逻辑点】光标与其所在屏。配合下游各 position_* 的结果日志，
        // 可完整复现一次唤起的定位决策链（用于排查「出现在错误的屏/位置」）。
        let (cx, cy) = cursor_logical_point(&window).unwrap_or((-1.0, -1.0));
        let cursor_monitor = monitor_for_logical_point(&window, cx, cy)
            .map(|m| get_monitor_id(&m))
            .unwrap_or_default();
        let acc = check_accessibility_permission_platform()
            .map(|a| a.status)
            .unwrap_or_default();
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

        // 3. 显示窗口
        show_panel_window(app, &window);
        let _ = window.emit("clipforge://show-quick-panel", reason);

        // 不再在显示后用焦点输入框位置【覆盖】定位：那条 osascript 异步路径会在面板已可见时
        // 再次 set_panel_position，造成「先出现在光标处、再跳到输入框处」的可见跳动（用户反映像
        // bug 一样闪烁）。按需求：触发那一刻位置确定即可（上面的同步 apply_position_strategy），
        // 显示之后不再移动面板，消除闪烁。

        Ok(panel_trigger_payload(
            &window,
            reason,
            &position_source,
            &format!("{:?}", strategy_clone),
        ))
    } else {
        Err("main window is not available".to_string())
    }
}

fn async_position_debounced<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window_label: String,
    strategy: PanelPositionStrategy,
    panel_width: f64,
    panel_height: f64,
) {
    let now = std::time::Instant::now();
    let mut last_call = POSITION_DEBOUNCE
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .lock()
        .unwrap();

    if let Some(last) = *last_call {
        if now.duration_since(last) < std::time::Duration::from_millis(50) {
            return;
        }
    }
    *last_call = Some(now);

    thread::spawn(move || {
        thread::sleep(std::time::Duration::from_millis(10));

        if let Some(window) = app.get_webview_window(&window_label) {
            if let Some((x, y)) =
                apply_position_strategy(&window, strategy, panel_width, panel_height)
            {
                let _ = set_panel_position(&window, x, y);
            }
        }
    });
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
static PANEL_PINNED: AtomicBool = AtomicBool::new(false);

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
    if let Ok(panel) = app.get_webview_panel("main") {
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
                "show panel: panelVisible={} windowVisible={} focused={} canBecomeKey={} hidesOnDeactivate={}",
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
                "show panel fallback window path: visible={} focused={}",
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
    _app: &tauri::AppHandle<R>,
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
    let mut panel_height = fallback_height;
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
        panel_height = fallback_height
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

fn position_tray_center_fallback<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    panel_width: f64,
    panel_height: f64,
) -> Option<(f64, f64)> {
    match position_tray_center(window) {
        Ok(()) => None,
        Err(_) => {
            log_to_file("warn", "panel-position", "trayCenter fallback also failed");
            None
        }
    }
}

fn position_window_center<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
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

fn mcp_status_payload(
    enabled: bool,
    running: bool,
    transport: &str,
    message: &str,
) -> McpStatusPayload {
    McpStatusPayload {
        enabled,
        running,
        transport: transport.to_string(),
        command: format!(
            "{} --mcp",
            std::env::current_exe()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_else(|_| "clipforge".to_string())
        ),
        tools: mcp_tool_names()
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        message: message.to_string(),
    }
}

fn mcp_tool_names() -> Vec<&'static str> {
    mcp_tool_specs().into_iter().map(|tool| tool.name).collect()
}

pub fn run_mcp_stdio() -> Result<(), String> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                writeln!(
                    stdout,
                    "{}",
                    mcp_error(Value::Null, -32700, &error.to_string())
                )
                .map_err(|write_error| write_error.to_string())?;
                stdout.flush().map_err(|error| error.to_string())?;
                continue;
            }
        };
        if let Some(response) = handle_mcp_request(request) {
            writeln!(stdout, "{response}").map_err(|error| error.to_string())?;
            stdout.flush().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn handle_mcp_request(request: Value) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if method.starts_with("notifications/") {
        return None;
    }
    let response = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "clipforge", "version": "0.1.0" }
        })),
        "tools/list" => Ok(json!({ "tools": mcp_tools() })),
        "tools/call" => {
            let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
            call_mcp_tool(params)
        }
        _ => Err((-32601, format!("unknown method: {method}"))),
    };
    Some(match response {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => mcp_error_with_data(id, code, &message, method, None),
    })
}

fn mcp_error(id: Value, code: i64, message: &str) -> Value {
    mcp_error_with_data(id, code, message, "protocol", None)
}

fn mcp_error_with_data(
    id: Value,
    code: i64,
    message: &str,
    method: &str,
    tool: Option<&str>,
) -> Value {
    let trace_id = mcp_trace_id();
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message,
            "data": {
                "ok": false,
                "traceId": trace_id,
                "method": method,
                "tool": tool.unwrap_or(""),
                "businessChain": "mcp -> clipforge-service",
                "hint": mcp_error_hint(message),
                "expected": "Use tools/list to inspect schemas, then call tools/call with { name: \"clipf.*\", arguments: { ... } }."
            }
        }
    })
}

fn mcp_trace_id() -> String {
    now_millis()
        .map(|ts| format!("mcp_{ts}"))
        .unwrap_or_else(|_| "mcp_unknown".to_string())
}

fn mcp_error_hint(message: &str) -> &'static str {
    if message.contains("requires id") {
        "Provide a valid ClipForge item id, for example {\"id\":\"clip_xxx\"}."
    } else if message.contains("requires text or id") {
        "Provide either text or id. Prefer id when operating on an existing clipboard item."
    } else if message.contains("requires content") {
        "Provide content as a string."
    } else if message.contains("requires ids") {
        "Provide ids as an array, for example {\"ids\":[\"clip_xxx\"]}."
    } else if message.contains("unknown tool") {
        "Use the clipf.* tool namespace. Call tools/list before choosing a tool."
    } else {
        "Check the tool input schema and retry with the required arguments."
    }
}

fn mcp_tools() -> Vec<Value> {
    mcp_tool_specs()
        .into_iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": (tool.input_schema)(),
            })
        })
        .collect()
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

fn mcp_result_envelope(tool: &str, args: &Value, result: Value) -> Result<Value, (i64, String)> {
    let trace_id = mcp_trace_id();
    let source = mcp_source_payload(args);
    Ok(json!({
        "ok": true,
        "traceId": trace_id,
        "tool": tool,
        "source": source,
        "businessChain": "mcp -> clipforge-service -> local-store",
        "permissionDecision": {
            "decision": "allow",
            "reason": "local MCP stdio call with explicit tool arguments"
        },
        "redactedFields": [],
        "nextActions": mcp_next_actions(tool),
        "result": result,
    }))
}

fn mcp_source_payload(args: &Value) -> Value {
    json!({
        "surface": "mcp",
        "client": args.get("client").and_then(Value::as_str).unwrap_or("unknown-agent"),
        "sourceLabel": args.get("sourceLabel").and_then(Value::as_str).unwrap_or("MCP Agent"),
        "requestId": args.get("requestId").and_then(Value::as_str).unwrap_or("")
    })
}

fn json_string_vec(args: &Value, key: &str) -> Option<Vec<String>> {
    match args.get(key)? {
        Value::Array(values) => {
            let out = values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        Value::String(value) => {
            let out = value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        _ => None,
    }
}

fn mcp_next_actions(tool: &str) -> Vec<&'static str> {
    match tool {
        "clipboard.context.get" => vec![
            "clipboard.content.parse id=<item id>",
            "clipboard.update id=<item id>",
        ],
        "clipboard.context.compose" => vec![
            "clipboard.content.parse id=<item id>",
            "clipboard.search text=<keyword>",
        ],
        "clipboard.content.parse" => vec![
            "clipboard.capture content=<text>",
            "clipboard.search text=<keyword>",
        ],
        "clipboard.capture" => vec![
            "clipboard.context.get id=<returned id>",
            "clipboard.copy id=<returned id>",
        ],
        "clipboard.search" => vec![
            "clipboard.context.get id=<item id>",
            "clipboard.copy id=<item id>",
        ],
        "clipboard.copy" => vec!["paste in target app", "clipboard.update id=<item id>"],
        "clipboard.update" => vec!["clipboard.context.get id=<item id>"],
        "clipboard.editor.context" => vec![
            "clipboard.editor.preview_patch id=<item id>",
            "clipboard.editor.suggest_update id=<item id>",
        ],
        "clipboard.editor.preview_patch" => {
            vec!["clipboard.editor.apply_patch id=<item id> confirmed=true"]
        }
        "clipboard.editor.apply_patch" | "clipboard.editor.save" => {
            vec!["clipboard.editor.context id=<item id>"]
        }
        "clipboard.editor.render_template" => {
            vec!["clipboard.editor.preview_patch replacement=<rendered>"]
        }
        "clipboard.editor.suggest_update" => vec![
            "show tagPatch preview",
            "clipboard.editor.apply_patch confirmed=true",
        ],
        "clipboard.plugin.list" => vec!["clipboard.plugin.call pluginId=builtin.open-detail"],
        "clipboard.plugin.call" => vec![
            "show action preview",
            "clipboard.editor.preview_patch id=<item id>",
        ],
        "clipboard.agent.run" => vec![
            "show command preview",
            "agent_start_run confirmed=true from visible UI",
        ],
        "clipf.capture" => vec!["clipf.get id=<returned id>", "clipf.copy id=<returned id>"],
        "clipf.list" | "clipf.search" => vec!["clipf.get id=<item id>", "clipf.copy id=<item id>"],
        "clipf.get" => vec!["clipf.copy id=<item id>", "clipf.update id=<item id>"],
        "clipf.analyze" => vec![
            "clipf.capture content=<text>",
            "clipf.search text=<keyword>",
        ],
        "clipf.copy" => vec![
            "paste in target app",
            "clipf.update id=<item id> copied=true",
        ],
        _ => vec!["clipf.list limit=9"],
    }
}

fn builtin_plugin_manifests_value() -> Value {
    json!([
        {
            "id": "builtin.open-link",
            "name": "打开链接",
            "version": "1.0.0",
            "runtime": "builtin",
            "actions": [{ "id": "open-link", "type": "openUrl", "label": "打开链接" }],
            "matching": {
                "priority": 900,
                "contentKinds": ["link"],
                "payloadKinds": ["link", "html", "markdown", "text"],
                "urlPatterns": ["^https?://"]
            },
            "permissions": {
                "requiresUserConfirmation": false,
                "allowFullContent": false,
                "allowOpenUrl": true,
                "allowOpenApp": false,
                "allowRunCommand": false
            },
            "compatibility": { "app": ">=0.1.0", "contextSchema": 1 }
        },
        {
            "id": "builtin.open-detail",
            "name": "进入详情",
            "version": "1.0.0",
            "runtime": "builtin",
            "actions": [{ "id": "open-detail", "type": "navigateDetail", "label": "进入详情" }],
            "matching": {
                "priority": 100,
                "contentKinds": ["text", "markdown", "code", "command", "attachment", "json", "chart", "table"]
            },
            "permissions": {
                "requiresUserConfirmation": false,
                "allowFullContent": false,
                "allowOpenUrl": false,
                "allowOpenApp": false,
                "allowRunCommand": false
            },
            "compatibility": { "app": ">=0.1.0", "contextSchema": 1 }
        }
    ])
}

fn first_safe_http_url(content: &str) -> Option<String> {
    content
        .split_whitespace()
        .map(|part| {
            part.trim_matches(|ch: char| {
                matches!(ch, '<' | '>' | '"' | '\'' | ')' | ']' | ',' | ';')
            })
        })
        .find(|part| part.starts_with("http://") || part.starts_with("https://"))
        .map(ToString::to_string)
}

fn mcp_content_response(result: Value) -> Result<Value, (i64, String)> {
    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result).map_err(|error| (-32000, error.to_string()))?
        }]
    }))
}

fn mcp_context_reference(item: &ClipItemPayload, include_content: bool) -> Value {
    json!({
        "id": format!("clip:{}", item.id),
        "source": "clip",
        "clipId": item.id,
        "title": item.analysis.title,
        "summary": compact_agent_text(&item.analysis.summary, 320),
        "payloadKind": item.payload_kind,
        "primaryUrl": item.analysis.url,
        "textPreview": compact_agent_text(&item.content, if include_content { 2000 } else { 240 }),
        "tags": item.tags,
        "sourceAppName": item.source_app.as_ref().map(|source| source.name.clone()),
        "permissionScope": if include_content { "current-content" } else { "summary" },
        "contentLength": item.content.chars().count(),
        "captureContext": {
            "schemaVersion": item.capture_context.schema_version,
            "surface": item.capture_context.surface,
            "sourceLabel": item.capture_context.source_label,
            "observedAt": item.capture_context.observed_at,
            "primaryFormat": item.capture_context.primary_format,
            "availableFormats": item.capture_context.available_formats,
        },
        "provenance": {
            "agentContext": item.agent_context,
            "source": item.source,
            "bucket": item.bucket,
        }
    })
}

fn mcp_context_snapshot(item: &ClipItemPayload, include_content: bool) -> Value {
    let trace_id = mcp_trace_id();
    log_to_file(
        "info",
        "mcp-context-snapshot",
        &format!(
            "traceId={} contextSchema=ClipboardContextSnapshot.v1 clipId={} payloadKind={} includeContent={} contentLength={} tagCount={} sourceApp={}",
            trace_id,
            item.id,
            item.payload_kind,
            include_content,
            item.content.chars().count(),
            item.tags.len(),
            item.source_app
                .as_ref()
                .map(|source| source.name.as_str())
                .unwrap_or("")
        ),
    );
    json!({
        "schemaVersion": 1,
        "clip": mcp_context_reference(item, include_content),
        "permission": {
            "includeContent": include_content,
            "redactedFields": if include_content { Vec::<&str>::new() } else { vec!["content"] },
            "decision": if include_content { "user-authorized-content" } else { "summary-only" }
        },
        "trace": {
            "traceId": trace_id,
            "contextSchema": "ClipboardContextSnapshot.v1"
        }
    })
}

#[cfg(test)]
mod context_snapshot_tests {
    use super::*;

    fn test_clip(id: &str, content: &str, payload_kind: &str) -> ClipItemPayload {
        ClipItemPayload {
            id: id.to_string(),
            content: content.to_string(),
            content_hash: format!("hash-{id}"),
            created_at: 1,
            updated_at: 1,
            last_seen_at: 1,
            last_copied_at: None,
            source: "clipboard".to_string(),
            kind: payload_kind.to_string(),
            bucket: "history".to_string(),
            favorite: false,
            tags: vec!["AI".to_string(), "work".to_string()],
            copy_count: 0,
            analysis: ClipAnalysisPayload {
                source_name: "Example".to_string(),
                badge: "TXT".to_string(),
                title: format!("Title {id}"),
                summary: "Safe summary".to_string(),
                url: content
                    .split_whitespace()
                    .find(|part| part.starts_with("https://"))
                    .map(ToString::to_string),
                host: Some("example.com".to_string()),
                is_markdown: payload_kind == "markdown",
            },
            payload_kind: payload_kind.to_string(),
            primary_format: if payload_kind == "markdown" {
                "text/markdown"
            } else {
                "text/plain"
            }
            .to_string(),
            available_formats: vec!["text/plain".to_string()],
            representations: vec![ClipboardRepresentationPayload {
                format: "text/plain".to_string(),
                storage: "inline".to_string(),
                content: Some(content.to_string()),
                file_name: None,
                size: Some(content.len() as i64),
                hash: Some(format!("hash-{id}")),
                preferred: true,
            }],
            plain_text: content.to_string(),
            search_text: Some(content.to_string()),
            sub_kind: None,
            width: None,
            height: None,
            size: Some(content.len() as i64),
            file_types: if payload_kind == "file" {
                Some("txt".to_string())
            } else {
                None
            },
            thumbnail_path: None,
            image_file: None,
            is_sensitive: false,
            capture_context: CaptureContextPayload {
                schema_version: 1,
                surface: "unit-test".to_string(),
                source_label: "Unit Test".to_string(),
                source_app: Some(json!({ "name": "Safari", "bundleId": "com.apple.Safari" })),
                observed_at: 1,
                primary_format: "text/plain".to_string(),
                available_formats: vec!["text/plain".to_string()],
                environment: json!({ "platform": "test" }),
            },
            metadata: json!({ "note": "metadata is safe" }),
            agent_context: json!({ "generatedBy": "agent", "conversationId": "conv-test" }),
            source_app: Some(SourceAppPayload {
                name: "Safari".to_string(),
                bundle_id: "com.apple.Safari".to_string(),
                executable_path: "/Applications/Safari.app".to_string(),
                icon_base64: None,
            }),
        }
    }

    #[test]
    fn context_snapshot_covers_source_link_markdown_file_and_long_text() {
        let link = test_clip("link", "https://example.com/a?b=1", "link");
        let link_snapshot = mcp_context_snapshot(&link, false);
        assert_eq!(link_snapshot["schemaVersion"], 1);
        assert_eq!(link_snapshot["clip"]["sourceAppName"], "Safari");
        assert_eq!(
            link_snapshot["clip"]["primaryUrl"],
            "https://example.com/a?b=1"
        );
        assert_eq!(link_snapshot["clip"]["tags"][0], "AI");
        assert_eq!(
            link_snapshot["clip"]["provenance"]["agentContext"]["generatedBy"],
            "agent"
        );
        assert_eq!(link_snapshot["permission"]["decision"], "summary-only");
        assert_eq!(link_snapshot["permission"]["redactedFields"][0], "content");

        let markdown = test_clip("markdown", "# Heading\n\n- item", "markdown");
        let markdown_snapshot = mcp_context_snapshot(&markdown, false);
        assert_eq!(markdown_snapshot["clip"]["payloadKind"], "markdown");
        assert_eq!(
            markdown_snapshot["clip"]["captureContext"]["primaryFormat"],
            "text/plain"
        );

        let file = test_clip("file", "/Users/example/report.txt", "file");
        let file_snapshot = mcp_context_snapshot(&file, false);
        assert_eq!(file_snapshot["clip"]["payloadKind"], "file");
        assert_eq!(file_snapshot["clip"]["contentLength"], 25);

        let long_content = "0123456789 ".repeat(80);
        let long_item = test_clip("long", &long_content, "text");
        let summary_snapshot = mcp_context_snapshot(&long_item, false);
        let full_snapshot = mcp_context_snapshot(&long_item, true);
        assert!(
            summary_snapshot["clip"]["textPreview"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                <= 240
        );
        assert_eq!(
            full_snapshot["permission"]["decision"],
            "user-authorized-content"
        );
        assert!(full_snapshot["permission"]["redactedFields"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(
            full_snapshot["clip"]["textPreview"]
                .as_str()
                .unwrap()
                .chars()
                .count()
                > summary_snapshot["clip"]["textPreview"]
                    .as_str()
                    .unwrap()
                    .chars()
                    .count()
        );
    }
}

fn parse_clipboard_content_candidates(content: &str) -> Value {
    let trimmed = content.trim();
    let mut candidates = Vec::new();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        candidates.push(json!({ "type": "url", "value": trimmed, "confidence": "high" }));
    }
    if trimmed.starts_with('/') || trimmed.starts_with("~/") || trimmed.contains(":\\") {
        candidates.push(json!({ "type": "file-path", "value": compact_agent_text(trimmed, 500), "confidence": "medium" }));
    }
    if serde_json::from_str::<Value>(trimmed).is_ok() {
        candidates.push(json!({ "type": "json", "value": "valid-json", "confidence": "high" }));
    }
    for line in trimmed.lines().take(80) {
        let line_trimmed = line.trim();
        if line_trimmed.starts_with("```") {
            candidates.push(
                json!({ "type": "code-block", "value": "markdown-fence", "confidence": "medium" }),
            );
        }
        if line_trimmed.starts_with("http://") || line_trimmed.starts_with("https://") {
            candidates.push(json!({ "type": "url", "value": line_trimmed, "confidence": "high" }));
        }
        if line_trimmed.contains("Error:")
            || line_trimmed.contains("Exception")
            || line_trimmed.contains("Traceback")
        {
            candidates.push(json!({ "type": "error-log", "value": compact_agent_text(line_trimmed, 500), "confidence": "high" }));
        }
        if line_trimmed.starts_with('$')
            || line_trimmed.starts_with("pnpm ")
            || line_trimmed.starts_with("cargo ")
            || line_trimmed.starts_with("npm ")
        {
            candidates.push(json!({ "type": "command", "value": compact_agent_text(line_trimmed, 500), "confidence": "medium" }));
        }
        if line_trimmed.contains("](") && line_trimmed.contains(')') {
            candidates.push(json!({ "type": "markdown-link", "value": compact_agent_text(line_trimmed, 500), "confidence": "medium" }));
        }
    }
    candidates.dedup_by(|a, b| a == b);
    json!({
        "schemaVersion": 1,
        "contentLength": content.chars().count(),
        "candidates": candidates,
        "permissionDecision": {
            "decision": "parse-only",
            "reason": "Candidates are metadata only and are not executed."
        }
    })
}

fn json_tags_arg(args: &Value, fallback: &[String]) -> Vec<String> {
    args.get("tags")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|tag| {
                    tag.trim()
                        .trim_start_matches('#')
                        .trim_start_matches("tag:")
                        .trim()
                        .to_string()
                })
                .filter(|tag| !tag.is_empty())
                .take(12)
                .collect::<Vec<_>>()
        })
        .filter(|tags| !tags.is_empty())
        .unwrap_or_else(|| fallback.to_vec())
}

fn editor_context_snapshot(item: &ClipItemPayload, args: &Value) -> Value {
    let content = args
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or(&item.content);
    let tags = json_tags_arg(args, &item.tags);
    let session_id = args
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("mcp-editor-session");
    let draft_version = args
        .get("draftVersion")
        .and_then(Value::as_i64)
        .unwrap_or(1);
    json!({
        "schemaVersion": 1,
        "clip": {
            "id": item.id,
            "kind": item.kind,
            "payloadKind": item.payload_kind,
            "title": item.analysis.title,
            "summary": item.analysis.summary,
            "tags": item.tags,
            "sourceAppName": item.source_app.as_ref().map(|source| source.name.clone())
        },
        "editor": {
            "sessionId": session_id,
            "draftVersion": draft_version,
            "format": item.payload_kind,
            "selectionText": "",
            "contentLength": content.chars().count(),
            "tags": tags,
            "suggestedTags": extract_hash_tags(content),
            "dirty": content != item.content || tags != item.tags
        },
        "runtime": {
            "platform": std::env::consts::OS,
            "route": "/clip/$clipId",
            "activeView": "detail",
            "panelPinned": PANEL_PINNED.load(Ordering::Relaxed)
        },
        "permission": {
            "exposeFullContent": false,
            "redactedFields": ["previousClipboard.content", "sourceApp.executablePath"]
        }
    })
}

fn extract_hash_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for word in content.split_whitespace() {
        let tag = word
            .trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '#' && ch != '_' && ch != '-')
            .trim_start_matches('#')
            .trim();
        if tag.is_empty()
            || tag.len() > 32
            || tags
                .iter()
                .any(|current: &String| current.eq_ignore_ascii_case(tag))
        {
            continue;
        }
        tags.push(tag.to_string());
        if tags.len() >= 12 {
            break;
        }
    }
    tags
}

fn call_mcp_tool(params: Value) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| (-32602, "tools/call requires name".to_string()))?;
    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    log_to_file(
        "info",
        "mcp",
        &format!(
            "tool_call start tool={} source={} requestId={}",
            name,
            args.get("sourceLabel")
                .and_then(Value::as_str)
                .unwrap_or("MCP Agent"),
            args.get("requestId").and_then(Value::as_str).unwrap_or("")
        ),
    );
    let result = match name {
        "clipboard.capture" | "clipf.capture" => {
            let source_label = format!(
                "{} via {}",
                args.get("sourceLabel")
                    .and_then(Value::as_str)
                    .unwrap_or("MCP Agent"),
                name
            );
            let payload = if let Some(content) = args.get("content").and_then(Value::as_str) {
                capture_clip_record(
                    content.to_string(),
                    Some(source_label),
                    now_millis().map_err(|error| (-32000, error))?,
                )
                .map_err(|error| (-32000, error))?
            } else {
                capture_current_clipboard(
                    Some(source_label),
                    now_millis().map_err(|error| (-32000, error))?,
                )
                .map_err(|error| (-32000, error))?
            };
            serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))?
        }
        "clipboard.context.get" | "clipf.get" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, format!("{name} requires id")))?;
            let conn = open_clip_db().map_err(|error| (-32000, error))?;
            init_schema(&conn).map_err(|error| (-32000, error))?;
            let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
            if name == "clipboard.context.get" {
                mcp_context_snapshot(
                    &item,
                    args.get("includeContent")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                )
            } else {
                serde_json::to_value(item).map_err(|error| (-32000, error.to_string()))?
            }
        }
        "clipboard.context.compose" => {
            let conn = open_clip_db().map_err(|error| (-32000, error))?;
            init_schema(&conn).map_err(|error| (-32000, error))?;
            let mode = args
                .get("mode")
                .and_then(Value::as_str)
                .unwrap_or("current");
            let include_content = args
                .get("includeContent")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let items = if let Some(ids) = args.get("ids").and_then(Value::as_array) {
                ids.iter()
                    .filter_map(Value::as_str)
                    .filter_map(|id| load_clip(&conn, id).ok())
                    .collect::<Vec<_>>()
            } else if mode == "favorites" {
                search_clip_records(SearchClipsRequest {
                    text: None,
                    bucket: Some("all".to_string()),
                    kinds: None,
                    types: None,
                    tags: None,
                    file_extensions: None,
                    favorite: Some(true),
                    limit: args.get("limit").and_then(Value::as_i64).or(Some(20)),
                    cursor: None,
                })
                .map_err(|error| (-32000, error))?
                .items
            } else if mode == "search-result" {
                search_clip_records(SearchClipsRequest {
                    text: args
                        .get("text")
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                    bucket: Some("all".to_string()),
                    kinds: None,
                    types: json_string_vec(&args, "types"),
                    tags: json_string_vec(&args, "tags"),
                    file_extensions: json_string_vec(&args, "fileExtensions"),
                    favorite: args.get("favorite").and_then(Value::as_bool),
                    limit: args.get("limit").and_then(Value::as_i64).or(Some(20)),
                    cursor: None,
                })
                .map_err(|error| (-32000, error))?
                .items
            } else {
                query_clip_records(
                    None,
                    Some("all".to_string()),
                    args.get("limit").and_then(Value::as_i64).or(Some(20)),
                    None,
                )
                .map_err(|error| (-32000, error))?
                .items
            };
            json!({
                "contextSet": {
                    "id": agent_trace_id("mcp_context"),
                    "mode": mode,
                    "references": items.iter().map(|item| mcp_context_reference(item, include_content)).collect::<Vec<_>>(),
                    "createdAt": now_millis().unwrap_or(0),
                    "updatedAt": now_millis().unwrap_or(0),
                    "limits": {
                        "maxItems": args.get("limit").and_then(Value::as_i64).unwrap_or(20),
                        "maxCharsPerItem": if include_content { 2000 } else { 240 },
                        "maxTotalChars": if include_content { 12000 } else { 4000 }
                    }
                }
            })
        }
        "clipf.list" => {
            let payload = query_clip_records(
                None,
                args.get("bucket")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                args.get("limit").and_then(Value::as_i64),
                args.get("cursor")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
            )
            .map_err(|error| (-32000, error))?;
            serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))?
        }
        "clipboard.search" | "clipf.search" => {
            let payload = search_clip_records(SearchClipsRequest {
                text: args
                    .get("text")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                bucket: args
                    .get("bucket")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                kinds: json_string_vec(&args, "kinds").or_else(|| {
                    json_string_vec(&args, "kind")
                        .map(|values| values.into_iter().take(1).collect())
                }),
                types: json_string_vec(&args, "types").or_else(|| {
                    json_string_vec(&args, "type")
                        .map(|values| values.into_iter().take(1).collect())
                }),
                tags: json_string_vec(&args, "tags").or_else(|| {
                    json_string_vec(&args, "tag").map(|values| values.into_iter().take(1).collect())
                }),
                file_extensions: json_string_vec(&args, "fileExtensions")
                    .or_else(|| json_string_vec(&args, "fileExtension"))
                    .or_else(|| json_string_vec(&args, "file")),
                favorite: args.get("favorite").and_then(Value::as_bool),
                limit: args.get("limit").and_then(Value::as_i64),
                cursor: args
                    .get("cursor")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
            })
            .map_err(|error| (-32000, error))?;
            serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))?
        }
        "clipboard.content.parse" => {
            let content = if let Some(content) = args.get("content").and_then(Value::as_str) {
                content.to_string()
            } else if let Some(id) = args.get("id").and_then(Value::as_str) {
                let conn = open_clip_db().map_err(|error| (-32000, error))?;
                init_schema(&conn).map_err(|error| (-32000, error))?;
                load_clip(&conn, id)
                    .map_err(|error| (-32000, error))?
                    .content
            } else {
                return Err((
                    -32602,
                    "clipboard.content.parse requires content or id".to_string(),
                ));
            };
            parse_clipboard_content_candidates(&content)
        }
        "clipf.analyze" => {
            let content = args
                .get("content")
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, "clipf.analyze requires content".to_string()))?;
            let source_label = args
                .get("sourceLabel")
                .and_then(Value::as_str)
                .unwrap_or("MCP");
            let analysis = analyze_clip(content, source_label);
            let payload = AnalyzeClipPayload {
                content: content.to_string(),
                kind: analysis_kind(&analysis),
                tags: default_tags(&analysis, content),
                analysis,
            };
            serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))?
        }
        "clipboard.copy" | "clipf.copy" => {
            let conn = open_clip_db().map_err(|error| (-32000, error))?;
            init_schema(&conn).map_err(|error| (-32000, error))?;
            let item = if let Some(id) = args.get("id").and_then(Value::as_str) {
                load_clip(&conn, id).map_err(|error| (-32000, error))?
            } else {
                let text = args
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| (-32602, format!("{name} requires text or id")))?
                    .to_string();
                capture_clip_record(
                    text,
                    Some(format!(
                        "{} via {}",
                        args.get("sourceLabel")
                            .and_then(Value::as_str)
                            .unwrap_or("MCP Agent"),
                        name
                    )),
                    now_millis().map_err(|error| (-32000, error))?,
                )
                .map_err(|error| (-32000, error))?
                .item
            };
            let paste_mode = args.get("pasteMode").and_then(Value::as_str);
            suppress_writeback_for(Duration::from_millis(450));
            let write_result = clipboard::write_clipboard_item(&item, paste_mode)
                .map_err(|error| (-32000, error))?;
            let updated = update_clip_record(UpdateClipInput {
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
            .map_err(|error| (-32000, error))?;
            json!({
                "ok": true,
                "id": updated.id,
                "primaryFormat": updated.primary_format,
                "availableFormats": updated.available_formats,
                "writtenFormats": write_result.written_formats,
                "chars": write_result.text_fallback.chars().count()
            })
        }
        "clipboard.update" | "clipf.update" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, "clipf.update requires id".to_string()))?
                .to_string();
            let payload = update_clip_record(UpdateClipInput {
                id,
                content: args
                    .get("content")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                tags: args.get("tags").and_then(Value::as_array).map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect()
                }),
                bucket: args
                    .get("bucket")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                favorite: args.get("favorite").and_then(Value::as_bool),
                pinned: args.get("pinned").and_then(Value::as_bool),
                note: args
                    .get("note")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                metadata: args.get("metadata").cloned(),
                agent_context: args.get("agentContext").cloned(),
                copied: None,
            })
            .map_err(|error| (-32000, error))?;
            serde_json::to_value(payload).map_err(|error| (-32000, error.to_string()))?
        }
        "clipboard.skill.list" => json!({
            "skills": [],
            "source": "frontend-local-private-skills",
            "message": "Private skill drafts stay in the visible frontend store unless the user confirms native persistence."
        }),
        "clipboard.skill.save_draft" => {
            let name = args.get("name").and_then(Value::as_str).ok_or_else(|| {
                (
                    -32602,
                    "clipboard.skill.save_draft requires name".to_string(),
                )
            })?;
            let prompt_template = args
                .get("promptTemplate")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    (
                        -32602,
                        "clipboard.skill.save_draft requires promptTemplate".to_string(),
                    )
                })?;
            json!({
                "draft": {
                    "id": agent_trace_id("skill_draft"),
                    "name": name,
                    "description": args.get("description").and_then(Value::as_str).unwrap_or(""),
                    "promptTemplatePreview": compact_agent_text(prompt_template, 500),
                    "requiresUserConfirmation": true
                }
            })
        }
        "clipboard.skill.run" => {
            let context_set = args.get("contextSet").cloned().unwrap_or_else(|| json!({}));
            let trimmed_references = context_set
                .get("references")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .take(20)
                        .map(|item| {
                            json!({
                                "id": item.get("id").and_then(Value::as_str).unwrap_or(""),
                                "source": item.get("source").and_then(Value::as_str).unwrap_or(""),
                                "clipId": item.get("clipId").and_then(Value::as_str).unwrap_or(""),
                                "title": item.get("title").and_then(Value::as_str).unwrap_or(""),
                                "summary": compact_agent_text(item.get("summary").and_then(Value::as_str).unwrap_or(""), 320),
                                "payloadKind": item.get("payloadKind").and_then(Value::as_str).unwrap_or(""),
                                "primaryUrl": item.get("primaryUrl").and_then(Value::as_str).unwrap_or(""),
                                "tags": item.get("tags").cloned().unwrap_or_else(|| json!([])),
                                "permissionScope": item.get("permissionScope").and_then(Value::as_str).unwrap_or("summary"),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            json!({
                "status": "prepared",
                "skillId": args.get("skillId").and_then(Value::as_str).unwrap_or(""),
                "trimmedContextSet": {
                    "id": context_set.get("id").and_then(Value::as_str).unwrap_or(""),
                    "mode": context_set.get("mode").and_then(Value::as_str).unwrap_or("current"),
                    "references": trimmed_references,
                    "limits": context_set.get("limits").cloned().unwrap_or_else(|| json!({}))
                },
                "permissionDecision": {
                    "decision": "trimmed-summary-only",
                    "reason": "clipboard.skill.run must carry explicit context scope; full content is not forwarded through MCP skill run."
                },
                "requiresUserConfirmation": true
            })
        }
        "clipboard.plugin.list" => json!({
            "manifests": builtin_plugin_manifests_value(),
            "source": "builtin",
            "capabilitySchema": 1
        }),
        "clipboard.plugin.call" => {
            let plugin_id = args
                .get("pluginId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    (
                        -32602,
                        "clipboard.plugin.call requires pluginId".to_string(),
                    )
                })?;
            let action_id =
                args.get("actionId")
                    .and_then(Value::as_str)
                    .unwrap_or(match plugin_id {
                        "builtin.open-link" => "open-link",
                        "builtin.open-detail" => "open-detail",
                        _ => "",
                    });
            let loaded_item = if let Some(id) = args.get("id").and_then(Value::as_str) {
                let conn = open_clip_db().map_err(|error| (-32000, error))?;
                init_schema(&conn).map_err(|error| (-32000, error))?;
                Some(load_clip(&conn, id).map_err(|error| (-32000, error))?)
            } else {
                None
            };
            let content = args
                .get("content")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .or_else(|| loaded_item.as_ref().map(|item| item.content.clone()))
                .unwrap_or_default();
            let explicit_target = args.get("target").and_then(Value::as_str);
            match plugin_id {
                "builtin.open-link" => {
                    let target = explicit_target
                        .map(ToString::to_string)
                        .or_else(|| {
                            loaded_item
                                .as_ref()
                                .and_then(|item| item.analysis.url.clone())
                        })
                        .or_else(|| first_safe_http_url(&content))
                        .ok_or_else(|| {
                            (
                                -32602,
                                "builtin.open-link requires a safe http(s) target".to_string(),
                            )
                        })?;
                    json!({
                        "status": "resolved",
                        "pluginId": plugin_id,
                        "actionId": action_id,
                        "action": {
                            "type": "openUrl",
                            "target": target,
                            "requiresUserConfirmation": false
                        },
                        "execution": "preview-only",
                        "parsedTargets": parse_clipboard_content_candidates(&content)
                    })
                }
                "builtin.open-detail" => json!({
                    "status": "resolved",
                    "pluginId": plugin_id,
                    "actionId": action_id,
                    "action": {
                        "type": "navigateDetail",
                        "clipId": loaded_item.as_ref().map(|item| item.id.clone()).unwrap_or_default(),
                        "requiresUserConfirmation": false
                    },
                    "execution": "preview-only",
                    "parsedTargets": parse_clipboard_content_candidates(&content)
                }),
                _ => return Err((-32602, format!("unsupported pluginId: {plugin_id}"))),
            }
        }
        "clipboard.agent.run" => {
            let prompt = args
                .get("prompt")
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, "clipboard.agent.run requires prompt".to_string()))?
                .to_string();
            let prepared = agent_prepare_run(AgentInvocationConfig {
                provider_id: args
                    .get("providerId")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                prompt,
                context_set: args.get("contextSet").cloned().unwrap_or_else(|| json!({})),
                allow_full_content: args.get("allowFullContent").and_then(Value::as_bool),
            })
            .map_err(|error| (-32000, error))?;
            json!({
                "status": "prepared",
                "run": prepared.run,
                "requiresConfirmation": prepared.requires_confirmation,
                "execution": "not-started"
            })
        }
        "clipboard.editor.context" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, "clipboard.editor.context requires id".to_string()))?;
            let conn = open_clip_db().map_err(|error| (-32000, error))?;
            init_schema(&conn).map_err(|error| (-32000, error))?;
            let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
            editor_context_snapshot(&item, &args)
        }
        "clipboard.editor.preview_patch" => {
            let id = args.get("id").and_then(Value::as_str).ok_or_else(|| {
                (
                    -32602,
                    "clipboard.editor.preview_patch requires id".to_string(),
                )
            })?;
            let conn = open_clip_db().map_err(|error| (-32000, error))?;
            init_schema(&conn).map_err(|error| (-32000, error))?;
            let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
            let replacement = args
                .get("replacement")
                .and_then(Value::as_str)
                .unwrap_or(&item.content);
            json!({
                "preview": {
                    "id": agent_trace_id("editor_patch"),
                    "sessionId": args.get("sessionId").and_then(Value::as_str).unwrap_or("mcp-editor-session"),
                    "draftVersion": args.get("draftVersion").and_then(Value::as_i64).unwrap_or(1),
                    "contentPatch": {
                        "type": "replaceDocument",
                        "beforeChars": item.content.chars().count(),
                        "afterChars": replacement.chars().count(),
                        "preview": compact_agent_text(replacement, 1200)
                    },
                    "tagPatch": args.get("tagPatch").cloned().unwrap_or_else(|| json!({ "add": [], "remove": [], "keep": item.tags })),
                    "writesDatabase": false
                }
            })
        }
        "clipboard.editor.apply_patch" | "clipboard.editor.save" => {
            if name == "clipboard.editor.apply_patch"
                && args.get("confirmed").and_then(Value::as_bool) != Some(true)
            {
                return Err((
                    -32602,
                    "clipboard.editor.apply_patch requires confirmed=true".to_string(),
                ));
            }
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, format!("{name} requires id")))?
                .to_string();
            let content = args
                .get(if name == "clipboard.editor.apply_patch" {
                    "replacement"
                } else {
                    "content"
                })
                .and_then(Value::as_str)
                .ok_or_else(|| (-32602, format!("{name} requires content")))?;
            let conn = open_clip_db().map_err(|error| (-32000, error))?;
            init_schema(&conn).map_err(|error| (-32000, error))?;
            let item = load_clip(&conn, &id).map_err(|error| (-32000, error))?;
            let saved = save_editor_draft(SaveEditorDraftInput {
                id,
                session_id: args
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or("mcp-editor-session")
                    .to_string(),
                draft_version: args
                    .get("draftVersion")
                    .and_then(Value::as_i64)
                    .unwrap_or(1),
                content: content.to_string(),
                tags: json_tags_arg(&args, &item.tags),
                metadata: Some(json!({ "surface": "mcp", "tool": name })),
            })
            .map_err(|error| (-32000, error))?;
            serde_json::to_value(saved).map_err(|error| (-32000, error.to_string()))?
        }
        "clipboard.editor.render_template" => {
            let mut rendered = args
                .get("template")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    (
                        -32602,
                        "clipboard.editor.render_template requires template".to_string(),
                    )
                })?
                .to_string();
            if let Some(vars) = args.get("variables").and_then(Value::as_object) {
                for (key, value) in vars {
                    let token = format!("{{{{{key}}}}}");
                    let replacement = value
                        .as_str()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| value.to_string());
                    rendered = rendered.replace(&token, &replacement);
                }
            }
            json!({ "rendered": rendered, "chars": rendered.chars().count() })
        }
        "clipboard.editor.suggest_update" => {
            let id = args.get("id").and_then(Value::as_str).ok_or_else(|| {
                (
                    -32602,
                    "clipboard.editor.suggest_update requires id".to_string(),
                )
            })?;
            let conn = open_clip_db().map_err(|error| (-32000, error))?;
            init_schema(&conn).map_err(|error| (-32000, error))?;
            let item = load_clip(&conn, id).map_err(|error| (-32000, error))?;
            let content = args
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or(&item.content);
            let suggested = extract_hash_tags(content);
            json!({
                "suggestion": {
                    "id": agent_trace_id("editor_suggestion"),
                    "sessionId": args.get("sessionId").and_then(Value::as_str).unwrap_or("mcp-editor-session"),
                    "draftVersion": args.get("draftVersion").and_then(Value::as_i64).unwrap_or(1),
                    "contentPatch": Value::Null,
                    "tagPatch": {
                        "add": suggested.iter().filter(|tag| !item.tags.iter().any(|current| current.eq_ignore_ascii_case(tag))).collect::<Vec<_>>(),
                        "remove": [],
                        "keep": item.tags
                    },
                    "rationale": "从当前草稿中的 #tag 生成待确认 tagPatch；不直接写入数据库。",
                    "riskLevel": "low"
                }
            })
        }
        "clipf.delete" => {
            let ids = args
                .get("ids")
                .and_then(Value::as_array)
                .ok_or_else(|| (-32602, "clipf.delete requires ids".to_string()))?
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>();
            serde_json::to_value(soft_delete_clip_records(ids).map_err(|error| (-32000, error))?)
                .map_err(|error| (-32000, error.to_string()))?
        }
        "clipf.export" => serde_json::to_value(
            export_clip_records(args.get("includeDeleted").and_then(Value::as_bool))
                .map_err(|error| (-32000, error))?,
        )
        .map_err(|error| (-32000, error.to_string()))?,
        "clipf.import" => {
            let items_value = args
                .get("items")
                .cloned()
                .ok_or_else(|| (-32602, "clipf.import requires items".to_string()))?;
            let items = serde_json::from_value::<Vec<ImportClipInput>>(items_value)
                .map_err(|error| (-32602, error.to_string()))?;
            serde_json::to_value(import_clip_records(items).map_err(|error| (-32000, error))?)
                .map_err(|error| (-32000, error.to_string()))?
        }
        _ => return Err((-32602, format!("unknown tool: {name}"))),
    };
    log_to_file(
        "info",
        "mcp",
        &format!(
            "tool_call success tool={} source={} requestId={}",
            name,
            args.get("sourceLabel")
                .and_then(Value::as_str)
                .unwrap_or("MCP Agent"),
            args.get("requestId").and_then(Value::as_str).unwrap_or("")
        ),
    );
    mcp_content_response(mcp_result_envelope(name, &args, result)?)
}
