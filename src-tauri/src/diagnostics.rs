//! 调试模式诊断模块：内存/数据/健康指标采集 + 诊断包导出。
//! 对应提案 [debug-mode-performance-observability](../../openspec/changes/debug-mode-performance-observability/proposal.md)。
//!
//! 设计约束：
//! - **零后台开销**：不做常驻采样线程，指标由 `diagnostics_get_metrics` 命令按需采集
//!   （设置页调试区打开时前端 1s 轮询）；没人看时一个线程都没有。
//! - **不碰热路径**：只读已有 DB/文件/日志，不向剪贴板采集/写回链路加任何埋点。
//! - **沙箱隔离**：所有路径经 `settings_path()` 派生，`CLIPFORGE_DATA_DIR` 对沙箱 dev
//!   自动生效，调试不污染稳定版数据。
//! - 内存取 macOS `task_info(TASK_VM_INFO)` 的 phys_footprint（Tauri v2 的 WKWebView
//!   与主进程同进程，无需跨 pid 归集）；结构布局经 C 探针在本机 macOS 26 验证。

use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

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

    /// collect_metrics 在隔离数据目录下应返回完整字段(数据/日志/uptime 三类不依赖内存 FFI)。
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
        for key in ["uptimeMs", "memory", "data", "log", "debugLogsEnabled"] {
            assert!(metrics.get(key).is_some(), "指标缺少字段 {key}");
        }
        assert!(metrics["data"]["clipCount"].is_i64());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

fn dir_size_bytes(path: &Path) -> i64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += dir_size_bytes(&path);
            } else {
                total += file_size(&path);
            }
        }
    }
    total
}

/// 日志健康度：最后一行 jsonl 的 tsMs 距今年的毫秒数。
/// 同时反映监听线程活性——轮询线程每轮有日志时该值应 ≤ 采集间隔 + 余量。
fn log_health(path: &Path) -> Value {
    use std::io::{BufRead, BufReader};
    let mut last_ts = 0i64;
    if let Ok(file) = std::fs::File::open(path) {
        let reader = BufReader::new(file);
        for line in reader.lines().flatten() {
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
pub fn collect_metrics() -> Value {
    let db_path = crate::database_path().ok();
    let images_dir = crate::image_storage_path().ok();
    let log_file = crate::log_path().ok();
    let settings_file = crate::settings_path().ok();

    let clip_count = db_path
        .as_deref()
        .and_then(|_| crate::open_clip_db().ok())
        .map(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM clips WHERE deleted_at IS NULL",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
        })
        .unwrap_or(0);

    json!({
        "uptimeMs": uptime_ms(),
        "memory": process_memory(),
        "data": {
            "dbBytes": db_path.as_deref().map(file_size).unwrap_or(0),
            "imagesBytes": images_dir.as_deref().map(dir_size_bytes).unwrap_or(0),
            "settingsBytes": settings_file.as_deref().map(file_size).unwrap_or(0),
            "clipCount": clip_count,
        },
        "log": log_file.as_deref().map(log_health),
        "debugLogsEnabled": crate::debug_logs_enabled_cached(),
    })
}
