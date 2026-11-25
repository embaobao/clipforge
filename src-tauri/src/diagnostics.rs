//! 调试模式诊断模块：内存/数据/健康指标采集 + 诊断包导出。
//! 对应提案 [debug-mode-performance-observability](../../openspec/changes/debug-mode-performance-observability/proposal.md)。
//!
//! 设计约束：
//! - **零后台开销**：不做常驻采样线程，指标由 `diagnostics_get_metrics` 命令按需采集
//!   （设置页调试区打开时前端 1s 轮询）；没人看时一个线程都没有。
//! - **不碰热路径**：只读已有 DB/文件/日志，不向剪贴板采集/写回链路加任何埋点。
//! - **沙箱隔离**：所有路径经 `settings_path()` 派生，`CLIPFORGE_DATA_DIR` 对沙箱 dev
//!   自动生效，调试不污染稳定版数据。
//! - 内存取 macOS `task_info(TASK_VM_INFO)` 的 phys_footprint；结构布局经 C 探针在本机 macOS 26 验证。
//! - **口径边界**：`process_memory()` 只量 Rust 主进程（`mach_task_self()`）。WKWebView 的
//!   WebContent / GPU / Networking 由 launchd 托管、ppid=1，不在本进程内，也不在进程树里；
//!   实测稳定版主进程 48 MB 而 coalition 全量 256 MB，差约 5 倍。全量口径由
//!   `pnpm mem:report`（scripts/memory-baseline.mjs 按 lsappinfo coalition 归集）提供，
//!   本模块的数值只用于观察主进程趋势，禁止当作「应用总内存」。

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// 进程启动时刻（uptime 基准）：LazyLock 首次访问即初始化，等价于进程起始，
/// 无需单独的 init 入口；初始化器已知，按项目规则用 LazyLock 而非 OnceLock。
static STARTED_AT: std::sync::LazyLock<Instant> = std::sync::LazyLock::new(Instant::now);

/// task_vm_info 结构（mach/task_info.h，#[repr(C)] 与 C 布局逐字段对齐）。
/// 只用 resident_size(偏移 16)/resident_size_peak(24)/virtual_size(0)/phys_footprint(144)；
/// phys_footprint 之前的 18 个字段按 SDK 声明保证偏移正确，尾部 rev2/rev3 字段当前不用，
/// 按本机 SDK 总大小 372 字节补足余量——内核按 count=93 回写,缓冲区必须完整,
/// 否则栈溢出。SDK 变更时编译期大小断言先失败(task_info 只在字段尾部增长,偏移稳定)。
#[repr(C)]
struct TaskVmInfo {
    virtual_size: u64,                                // 0
    region_count: i32,                                // 8
    page_size: i32,                                   // 12
    resident_size: u64,                               // 16
    resident_size_peak: u64,                          // 24
    device: u64,                                      // 32
    device_peak: u64,                                 // 40
    internal: u64,                                    // 48
    internal_peak: u64,                               // 56
    external: u64,                                    // 64
    external_peak: u64,                               // 72
    reusable: u64,                                    // 80
    reusable_peak: u64,                               // 88
    purgeable_volatile_pmap: u64,                     // 96
    purgeable_volatile_resident: u64,                 // 104
    purgeable_volatile_virtual: u64,                  // 112
    compressed: u64,                                  // 120
    compressed_peak: u64,                             // 128
    compressed_lifetime: u64,                         // 136
    phys_footprint: u64,                              // 144
    _tail: [u8; TASK_VM_INFO_STRUCT_BYTES - 152 + 4], // 对齐到 8 字节后 376,≥372 足够容纳 93 字回写
}

/// 本机 SDK（macOS 26）struct task_vm_info 总字节数；编译期断言防漂移。
const TASK_VM_INFO_STRUCT_BYTES: usize = 372;
const _: () = assert!(
    std::mem::size_of::<TaskVmInfo>() >= TASK_VM_INFO_STRUCT_BYTES,
    "TaskVmInfo 缓冲区小于 SDK 结构,需校准"
);
/// TASK_VM_INFO_COUNT = 372/4 = 93 个 natural_t 字。
const TASK_VM_INFO_COUNT_WORDS: u32 = (std::mem::size_of::<TaskVmInfo>() / 4) as u32;

// Mach 端口与 task_info FFI（System 框架随 AppKit 链接，无需额外链接参数）。
#[cfg(target_os = "macos")]
#[link(name = "System", kind = "framework")]
extern "C" {
    fn mach_task_self() -> u32;
    fn task_info(target: u32, flavor: u32, info: *mut TaskVmInfo, count: *mut u32) -> i32;
}

/// 采集进程内存指标（字节）。非 macOS 或调用失败时返回 None，调用方降级为 null。
/// phys_footprint 与活动监视器同口径；virtual_size 是地址空间保留量（含 Guard 区），
/// 可达数百 GB，不是内存占用，前端必须分栏展示、禁止计入总量。
#[cfg(target_os = "macos")]
fn process_memory() -> Option<Value> {
    let mut info: TaskVmInfo = unsafe { std::mem::zeroed() };
    let mut count: u32 = TASK_VM_INFO_COUNT_WORDS;
    let status = unsafe {
        task_info(
            mach_task_self(),
            22, // TASK_VM_INFO flavor（C 探针在本机验证）
            &mut info,
            &mut count,
        )
    };
    if status != 0 {
        // KERN_SUCCESS = 0；失败不 panic，调试指标缺一项不影响其他数据。
        return None;
    }
    Some(json!({
        "physFootprintBytes": info.phys_footprint,
        "residentBytes": info.resident_size,
        "residentPeakBytes": info.resident_size_peak,
        "virtualBytes": info.virtual_size,
        // TASK_VM_INFO 已解析但此前未输出的细分：用于区分「真增长」与可回收缓存膨胀。
        // reusable / purgeable 同步上升时不应判为泄漏。
        "internalBytes": info.internal,
        "externalBytes": info.external,
        "compressedBytes": info.compressed,
        "reusableBytes": info.reusable,
        "purgeableVolatileResidentBytes": info.purgeable_volatile_resident,
    }))
}

#[cfg(not(target_os = "macos"))]
fn process_memory() -> Option<Value> {
    None
}

fn uptime_ms() -> i64 {
    STARTED_AT.elapsed().as_millis() as i64
}

fn file_size(path: &Path) -> i64 {
    std::fs::metadata(path)
        .map(|meta| meta.len() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    /// task_info FFI 的结构布局/常量漂移会静默返回 0 或垃圾值——本机 macOS 26 验证过
    /// TASK_VM_INFO=22 与 task_vm_info 布局；macOS 升级若漂移，此断言先失败。
    #[test]
    fn process_memory_reports_positive_footprint_on_macos() {
        if !cfg!(target_os = "macos") {
            return;
        }
        let memory = super::process_memory().expect("task_info 在 macOS 上应成功");
        let footprint = memory["physFootprintBytes"]
            .as_u64()
            .expect("physFootprintBytes 应为整数");
        assert!(footprint > 0, "phys_footprint 应为正值,实际 {footprint}");
    }

    /// collect_metrics 在隔离数据目录下应返回完整字段(数据/日志/uptime/口径三类不依赖内存 FFI)。
    #[test]
    fn collect_metrics_shape_is_stable() {
        // CLIPFORGE_DATA_DIR 是进程级全局：与 lib.rs hard_delete / ocr 域测试同锁串行。
        let _guard = crate::hard_delete_image_cleanup_tests::TEST_DATA_DIR_LOCK
            .lock()
            .expect("test data dir lock");
        let dir = std::env::temp_dir().join(format!("clipforge-diag-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("CLIPFORGE_DATA_DIR", &dir);
        let metrics = super::collect_metrics();
        for key in ["uptimeMs", "memory", "data", "log", "debugLogsEnabled", "memoryScope"] {
            assert!(metrics.get(key).is_some(), "指标缺少字段 {key}");
        }
        assert_eq!(metrics["memoryScope"], "main-process-only");
        assert!(metrics["data"]["clipCount"].is_i64());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// 重 IO 指标缓存：图片目录递归、clips 计数、日志扫描在 1s 轮询下会反复 stat 上万文件、
/// 反复开关 SQLite 连接，既拖慢面板又把被测进程的内存抬高。按数据目录缓存 30s，
/// 按需刷新；无后台线程、无定时器，关闭诊断 tab 后零开销。
struct SlowMetrics {
    key: std::path::PathBuf,
    at: Instant,
    value: Value,
}

static SLOW_METRICS: Mutex<Option<SlowMetrics>> = Mutex::new(None);

fn slow_metrics(db_path: Option<&Path>, images_dir: Option<&Path>, log_file: Option<&Path>) -> Value {
    // key 用数据库路径：测试与 dev 沙箱切换 CLIPFORGE_DATA_DIR 时互不串扰。
    let key = db_path.map(|path| path.to_path_buf()).unwrap_or_default();
    if let Ok(guard) = SLOW_METRICS.lock() {
        if let Some(ref cached) = *guard {
            if cached.key == key && cached.at.elapsed() < Duration::from_secs(30) {
                return cached.value.clone();
            }
        }
    }

    let value = json!({
        "imagesBytes": images_dir.map(dir_size_bytes).unwrap_or(0),
        "clipCount": db_path
            .and_then(|_| crate::open_clip_db().ok())
            .map(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM clips WHERE deleted_at IS NULL",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
            })
            .unwrap_or(0),
        "log": log_file.map(log_health).unwrap_or(json!({
            "lastEntryAgeMs": -1,
            "bytes": 0,
        })),
    });

    if let Ok(mut guard) = SLOW_METRICS.lock() {
        *guard = Some(SlowMetrics {
            key,
            at: Instant::now(),
            value: value.clone(),
        });
    }
    value
}

fn dir_size_bytes(path: &Path) -> i64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            // entry.metadata() 一次 stat 同时给类型和大小，避免 path.is_dir() 的二次 stat。
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if meta.is_dir() {
                total += dir_size_bytes(&entry.path());
            } else {
                total += meta.len() as i64;
            }
        }
    }
    total
}

/// 日志健康度：最后一行 jsonl 的 tsMs 距今年的毫秒数。
/// 只读尾部 4KB（而非全文件逐行），避免 1s 轮询把 20k 行日志全量扫一遍；
/// 尾部起点可能截断首行，超过 4KB 时跳过第一行。
fn log_health(path: &Path) -> Value {
    use std::io::{Read, Seek, SeekFrom};
    let mut last_ts = 0i64;
    if let Ok(mut file) = std::fs::File::open(path) {
        let size = file.metadata().map(|meta| meta.len() as i64).unwrap_or(0);
        let tail_len = size.min(4096);
        let skip_first = size > 4096;
        let mut tail = Vec::new();
        if tail_len > 0
            && file.seek(SeekFrom::End(-tail_len)).is_ok()
            && file.take(tail_len as u64).read_to_end(&mut tail).is_ok()
        {
            let text = String::from_utf8_lossy(&tail);
            for (index, line) in text.lines().enumerate() {
                if skip_first && index == 0 {
                    continue;
                }
                if let Some(start) = line.find("\"tsMs\":") {
                    let rest = &line[start + 7..];
                    let digits: String = rest
                        .trim_start()
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    if let Ok(value) = digits.parse::<i64>() {
                        last_ts = value;
                    }
                }
            }
        }
    }
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let age_ms = if last_ts > 0 { now_ms - last_ts } else { -1 };
    json!({
        "lastEntryAgeMs": age_ms,
        "bytes": file_size(path),
    })
}

/// 采集一帧诊断指标（按需，无后台线程）。
/// memoryScope 固定为 main-process-only：调用方必须把该数值当作「主进程趋势」，
/// 应用全量内存请走 scripts/memory-baseline.mjs 的 coalition 归集。
pub fn collect_metrics() -> Value {
    let db_path = crate::database_path().ok();
    let images_dir = crate::image_storage_path().ok();
    let log_file = crate::log_path().ok();
    let settings_file = crate::settings_path().ok();
    let slow = slow_metrics(db_path.as_deref(), images_dir.as_deref(), log_file.as_deref());

    json!({
        "uptimeMs": uptime_ms(),
        "memoryScope": "main-process-only",
        "memory": process_memory(),
        "data": {
            "dbBytes": db_path.as_deref().map(file_size).unwrap_or(0),
            "imagesBytes": slow["imagesBytes"].clone(),
            "settingsBytes": settings_file.as_deref().map(file_size).unwrap_or(0),
            "clipCount": slow["clipCount"].clone(),
        },
        "log": slow["log"].clone(),
        "debugLogsEnabled": crate::debug_logs_enabled_cached(),
    })
}

/// 启动/按需环境快照（S3 切片从 lib.rs 平移）。
pub(crate) fn log_environment_snapshot(module: &str) {
    let settings_path_text = crate::settings_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let database_path_text = crate::database_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let log_path_text = crate::log_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let exe = std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let bundle_path = crate::current_app_bundle_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let accessibility = crate::check_accessibility_permission_platform()
        .map(|payload| payload.status)
        .unwrap_or_else(|_| "unknown".to_string());
    let diagnostics = crate::get_accessibility_diagnostics_platform().ok();
    let (panel_width, panel_height) = crate::resolve_panel_dims();
    let snapshot = json!({
        "event": "environment_snapshot",
        "appVersion": crate::APP_VERSION,
        "bundleIdentifier": crate::APP_BUNDLE_IDENTIFIER,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "uname": crate::command_output_optional("uname", &["-a"]),
        "macos": crate::command_output_optional("sw_vers", &[]),
        "webkit": crate::webkit_environment_snapshot(),
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
        "mcpTools": crate::mcp::mcp_tool_names(),
        "panel": {
            "width": panel_width,
            "height": panel_height,
            "positionStrategy": crate::settings_service::read_user_settings()
                .ok()
                .and_then(|settings| settings.settings.get("positionStrategy").and_then(Value::as_str).map(ToString::to_string))
                .unwrap_or_else(|| "followCursor".to_string())
        }
    });
    crate::log_to_file("info", module, &snapshot.to_string());
}
