//! 应用日志服务：非阻塞写线程、级别过滤、行解析、清理与统计。
//! 从 lib.rs 平移（S3 切片）；命令壳（append_app_log/query_app_logs 等）仍留在 lib.rs。

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppLogEntryPayload {
    pub(crate) ts_ms: i64,
    pub(crate) level: String,
    pub(crate) message: String,
    pub(crate) context: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryAppLogPayload {
    pub(crate) path: String,
    pub(crate) items: Vec<AppLogEntryPayload>,
    pub(crate) limit: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogStatsPayload {
    pub(crate) path: String,
    pub(crate) size_bytes: u64,
    pub(crate) line_count: u64,
    pub(crate) oldest_ts_ms: i64,
    pub(crate) max_size_mb: u32,
    pub(crate) keep_ratio: f64,
    pub(crate) retention_days: u32,
    pub(crate) auto_cleanup: bool,
    pub(crate) interval_min: u64,
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

pub(crate) fn debug_logs_enabled_cached() -> bool {
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
    let enabled = crate::settings_service::read_user_settings()
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

pub(crate) fn cleanup_logs_if_needed() {
    let result = cleanup_app_logs_impl();
    if let Err(e) = result {
        eprintln!("[LOG] cleanup failed: {}", e);
    }
}

/// 日志清理的可配置项（从用户设置读取，缺失用默认）。
pub(crate) struct LogCleanupSettings {
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
    pub(crate) auto_cleanup: bool,
    /// 自动清理检查间隔（分钟）。
    pub(crate) interval_min: u64,
}

pub(crate) fn read_log_cleanup_settings() -> LogCleanupSettings {
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
    if let Ok(settings) = crate::settings_service::read_user_settings() {
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

pub(crate) fn cleanup_app_logs_impl() -> Result<String, String> {
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
    let now_ms = crate::now_millis().unwrap_or(0);
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

pub(crate) fn get_log_stats_impl() -> Result<LogStatsPayload, String> {
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

/// append_app_log 的跨模块入口：#[tauri::command] 对 pub(crate) 函数会
/// `#[macro_export]` 提升隐藏宏到 crate 根，与根内文本定义冲突（E0255），
/// 故命令保持私有、调用方走本 helper（行为与字符串不变）。
pub(crate) fn append_app_log_impl(
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

pub(crate) fn query_app_logs_impl(
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

pub(crate) fn get_app_log_path_impl() -> Result<String, String> {
    Ok(log_path()?.to_string_lossy().to_string())
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

pub(crate) fn parse_log_line(line: &str) -> Option<AppLogEntryPayload> {
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

pub(crate) fn log_path() -> Result<PathBuf, String> {
    Ok(crate::settings_path()?
        .parent()
        .ok_or_else(|| "settings parent is not available".to_string())?
        .join("clipforge.jsonl"))
}
