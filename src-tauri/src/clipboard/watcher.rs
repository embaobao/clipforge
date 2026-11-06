//! 剪贴板监听：监督循环（看门狗）+ 轮询去重 + 采集出口抽象。
//!
//! RS-51 修复要点（对应 design.md 第 6 节 P1）：
//! - S1：`start_watch()` 返回后按指数退避重启并记录退出原因，监听不再永久静默；
//! - C4：启动改为静默 priming（只写共享指纹，不采集不 emit），消除「每次启动
//!   强制 detected 一次」（dev 日志 46 次 watcher started 佐证）；
//! - C3：指纹在 capture 成功后才提交，失败/设置过滤不提交，下次轮询自然重试；
//! - S5：去重指纹收敛到 clipboard::dedup 共享状态，与 open_panel 补采、
//!   manual capture 两条路径统一；
//! - P0：detected 双指纹日志、read error 恢复日志、退出/重连日志、
//!   clipboard-changed 事件带单调递增序号（change_count 语义变更）。
use clipboard_rs::{ClipboardHandler, ClipboardWatcher, ClipboardWatcherContext};
use std::sync::atomic::{AtomicI64, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Runtime};

/// clipboard-changed 事件单调递增序号（P0 3.5）。旧值是毫秒时间戳，非递增序号，
/// 前端无法据此去重乱序/重复事件；序号从 1 开始，0 保留给前端初始状态。
static CHANGE_SEQ: AtomicI64 = AtomicI64::new(0);

pub fn init<R>(app_handle: tauri::AppHandle<R>)
where
    R: Runtime,
{
    // 双实例隔离开关：dev/测试实例设置 CLIPFORGE_DISABLE_CAPTURE=1 时跳过剪贴板监听，
    // 避免与正式实例同时采集造成重复入库（2026-09-10 双实例互相触发污染剪贴板历史）。
    if std::env::var("CLIPFORGE_DISABLE_CAPTURE").as_deref() == Ok("1") {
        crate::log_to_file(
            "warn",
            "clipboard-monitor",
            "capture disabled: CLIPFORGE_DISABLE_CAPTURE=1 (secondary instance)",
        );
        return;
    }

    start_log_maintenance_thread();

    let spawn_result = thread::Builder::new()
        .name("clipforge-clipboard-watcher".to_string())
        .spawn(move || supervise_watcher(app_handle));

    if let Err(error) = spawn_result {
        crate::log_to_file(
            "error",
            "clipboard-monitor",
            &format!("spawn watcher thread failed: {}", error),
        );
    }
}

/// 监督循环（S1 看门狗）：`start_watch()` 阻塞返回即监听停止，旧实现此后不再
/// 重启——一旦返回监听永久静默且无日志可查。这里按指数退避重连并记录退出
/// 原因（uptime / 连续快退次数），健康运行（uptime ≥1s）后退避重置。
fn supervise_watcher<R>(app_handle: tauri::AppHandle<R>)
where
    R: Runtime,
{
    let mut backoff_secs: u64 = 1;
    let mut consecutive_quick_exits: u32 = 0;
    loop {
        prime_fingerprint();

        match build_watcher_context::<AppCaptureSink<R>>() {
            Ok(mut watcher) => {
                let started = Instant::now();
                crate::log_to_file(
                    "info",
                    "clipboard-monitor",
                    &format!(
                        "watcher started, mode={}, reconnect_backoff={}s",
                        watcher_mode(),
                        backoff_secs
                    ),
                );
                let monitor = ClipboardMonitor::new(AppCaptureSink::new(app_handle.clone()));
                watcher.add_handler(monitor);
                watcher.start_watch();
                let uptime = started.elapsed();
                let quick_exit = uptime < Duration::from_secs(1);
                consecutive_quick_exits = if quick_exit {
                    consecutive_quick_exits.saturating_add(1)
                } else {
                    0
                };
                if !quick_exit {
                    backoff_secs = 1;
                }
                let level = if consecutive_quick_exits >= 5 {
                    "error"
                } else {
                    "warn"
                };
                crate::log_to_file(
                    level,
                    "clipboard-monitor",
                    &format!(
                        "watcher exited, uptime_ms={}, consecutive_quick_exits={}, reconnect_in={}s",
                        uptime.as_millis(),
                        consecutive_quick_exits,
                        backoff_secs
                    ),
                );
            }
            Err(error) => {
                crate::log_to_file(
                    "error",
                    "clipboard-monitor",
                    &format!(
                        "watcher init failed: {}, reconnect_in={}s",
                        error, backoff_secs
                    ),
                );
            }
        }

        thread::sleep(Duration::from_secs(backoff_secs));
        backoff_secs = (backoff_secs * 2).min(60);
    }
}

/// 启动静默 priming（C4/A4）：把当前剪贴板内容指纹写入共享去重状态，
/// 不采集、不 emit。旧实现空指纹 + 启动即采集 = 每次启动强制 detected。
/// 「把当前内容收进历史」由前端 startup 路径的 capture_current_clipboard
/// command 负责（该路径会回写共享指纹，与这里不冲突）。
fn prime_fingerprint() {
    match super::read_clipboard_payload() {
        Ok(Some(raw_payload)) => {
            let fingerprint = crate::clipboard_payload_fingerprint(&raw_payload);
            super::dedup::remember_fingerprint(&fingerprint);
            crate::log_to_file(
                "info",
                "clipboard-monitor",
                &format!("startup primed, hash={}", &fingerprint[..8]),
            );
        }
        Ok(None) => {}
        Err(error) => {
            // prime 失败保持空指纹：首次轮询会把当前内容当变化兜底采集一次。
            crate::log_to_file(
                "warn",
                "clipboard-monitor",
                &format!("startup prime read failed: {}", error),
            );
        }
    }
}

/// 单次采集的结果摘要：入库状态（created/promoted）、条目 id 与预览文本。
pub(crate) struct CapturedChange {
    pub status: String,
    pub id: String,
    pub preview: String,
}

/// 采集动作出口：真实实现走入库 + emit；测试用记录器验证提交时序
/// （成功才提交指纹、priming 不采集、序号单调）。
pub(crate) trait CaptureSink {
    fn capture(
        &mut self,
        payload: super::payload::StandardClipboardPayload,
        now: i64,
    ) -> Result<CapturedChange, String>;
    fn emit_changed(&mut self, preview: String);
}

/// 真实采集出口：capture_clip_payload 入库 + clipboard-changed 事件（带单调序号）。
struct AppCaptureSink<R: Runtime> {
    app_handle: tauri::AppHandle<R>,
}

impl<R: Runtime> AppCaptureSink<R> {
    fn new(app_handle: tauri::AppHandle<R>) -> Self {
        Self { app_handle }
    }
}

impl<R: Runtime> CaptureSink for AppCaptureSink<R> {
    fn capture(
        &mut self,
        payload: super::payload::StandardClipboardPayload,
        now: i64,
    ) -> Result<CapturedChange, String> {
        let captured =
            crate::capture_clip_payload(payload, Some("Clipboard".to_string()), now)?;
        Ok(CapturedChange {
            status: captured.status,
            id: captured.item.id,
            preview: captured.item.plain_text,
        })
    }

    fn emit_changed(&mut self, preview: String) {
        let seq = CHANGE_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
        let payload_json = crate::ClipboardChangePayload {
            change_count: seq,
            has_change: true,
            preview: Some(preview.chars().take(40).collect()),
            preview_len: Some(preview.chars().count() as i64),
        };
        if let Err(error) = self.app_handle.emit("clipboard-changed", payload_json) {
            crate::log_to_file(
                "warn",
                "clipboard-monitor",
                &format!("emit clipboard-changed failed: {}", error),
            );
        }
    }
}

struct ClipboardMonitor<S: CaptureSink> {
    sink: S,
    consecutive_errors: u64,
    last_log_time: Instant,
    /// 上一条「设置过滤跳过」日志的指纹：不提交指纹会导致同一内容每轮重试，
    /// 用它把确定性跳过的日志压缩到指纹变化时才打一条。
    last_skip_log_fingerprint: String,
}

impl<S: CaptureSink> ClipboardMonitor<S> {
    fn new(sink: S) -> Self {
        Self {
            sink,
            consecutive_errors: 0,
            last_log_time: Instant::now(),
            last_skip_log_fingerprint: String::new(),
        }
    }

    fn process_current_clipboard(&mut self) {
        if crate::is_listen_paused() {
            return;
        }
        if crate::should_skip_writeback() {
            // 抑制窗口内不采集；窗口结束靠下一轮 120ms 轮询自然读到当前内容。
            return;
        }

        match super::read_clipboard_payload() {
            Ok(Some(raw_payload)) => {
                if self.consecutive_errors > 0 {
                    // P0 3.4：read error 恢复日志（旧实现无恢复证据可查）。
                    crate::log_to_file(
                        "info",
                        "clipboard-monitor",
                        &format!(
                            "read error recovered after {} errors",
                            self.consecutive_errors
                        ),
                    );
                    self.consecutive_errors = 0;
                }
                self.process_payload(raw_payload);
            }
            Ok(None) => {}
            Err(error) => {
                self.consecutive_errors += 1;
                if self.consecutive_errors <= 3 || self.consecutive_errors % 100 == 0 {
                    let elapsed = self.last_log_time.elapsed().as_secs();
                    if elapsed > 60 || self.consecutive_errors <= 3 {
                        crate::log_to_file(
                            "warn",
                            "clipboard-monitor",
                            &format!("read error ({}): {}", self.consecutive_errors, error),
                        );
                        self.last_log_time = Instant::now();
                    }
                }
            }
        }
    }

    fn process_payload(&mut self, raw_payload: super::payload::StandardClipboardPayload) {
        let raw_fingerprint = crate::clipboard_payload_fingerprint(&raw_payload);
        // C2 短路：重复复制相同内容不置顶/不 emit 是既有裁决
        // （clipboard-data-integrity 缺口 2），本提案不改。
        if raw_fingerprint == super::dedup::last_fingerprint() {
            return;
        }

        // 设置过滤（Ok(None)）与过滤出错都不提交指纹：设置改回后可重新采集。
        // 代价是同一内容每 120ms 重试一次，日志经 last_skip_log_fingerprint 节流。
        let payload = match crate::apply_capture_settings(raw_payload) {
            Ok(Some(payload)) => payload,
            Ok(None) => {
                self.log_skip_throttled(&raw_fingerprint, "capture skipped by settings");
                return;
            }
            Err(error) => {
                self.log_skip_throttled(
                    &raw_fingerprint,
                    &format!("capture skipped by settings error, reason={}", error),
                );
                return;
            }
        };

        let fingerprint = crate::clipboard_payload_fingerprint(&payload);
        if fingerprint.is_empty() {
            return;
        }

        let now = crate::now_millis().unwrap_or(0);
        // P0 3.3：detected 同时打 raw 与 processed 指纹，可直接验证「原始/处理后漂移」
        // 是否发生（取证时 311/311 全等，本日志让该结论可持续复核）。
        crate::log_to_file(
            "info",
            "clipboard-monitor",
            &format!(
                "detected change, raw_hash={}, hash={}, ts={}",
                &raw_fingerprint[..8],
                &fingerprint[..8],
                now
            ),
        );

        match self.sink.capture(payload, now) {
            Ok(change) => {
                // C3：采集成功才提交指纹；失败保持旧值，下一轮轮询自然重试，
                // 不再出现「一次失败 → 该内容本进程生命周期内永久漏采」。
                super::dedup::remember_fingerprint(&raw_fingerprint);
                crate::log_to_file(
                    "debug",
                    "clipboard-monitor",
                    &format!("recorded: status={}, id={}", change.status, change.id),
                );
                self.sink.emit_changed(change.preview);
            }
            Err(error) => {
                crate::log_to_file(
                    "error",
                    "clipboard-monitor",
                    &format!(
                        "capture failed: {}, hash={}, fingerprint uncommitted for retry",
                        error,
                        &raw_fingerprint[..8]
                    ),
                );
            }
        }
    }

    /// 设置过滤跳过日志节流：同一指纹只打一条（指纹不提交 → 每轮重试）。
    fn log_skip_throttled(&mut self, fingerprint: &str, reason: &str) {
        if self.last_skip_log_fingerprint == fingerprint {
            return;
        }
        self.last_skip_log_fingerprint = fingerprint.to_string();
        crate::log_to_file(
            "info",
            "clipboard-monitor",
            &format!("{}, hash={}", reason, &fingerprint[..8]),
        );
    }
}

impl<S: CaptureSink> ClipboardHandler for ClipboardMonitor<S> {
    fn on_clipboard_change(&mut self) {
        self.process_current_clipboard();
    }
}

fn build_watcher_context<S: CaptureSink + 'static>(
) -> Result<ClipboardWatcherContext<ClipboardMonitor<S>>, String> {
    #[cfg(target_os = "macos")]
    {
        return ClipboardWatcherContext::new_with_interval(Duration::from_millis(120))
            .map_err(|error| error.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        return ClipboardWatcherContext::new().map_err(|error| error.to_string());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        ClipboardWatcherContext::new_with_interval(Duration::from_millis(120))
            .map_err(|error| error.to_string())
    }
}

fn watcher_mode() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos-poll-120ms"
    }

    #[cfg(target_os = "windows")]
    {
        "windows-event-driven"
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "unix-poll-120ms"
    }
}

fn start_log_maintenance_thread() {
    let spawn_result = thread::Builder::new()
        .name("clipforge-log-maintenance".to_string())
        .spawn(move || {
            let mut last_cleanup_run = Instant::now();
            loop {
                thread::sleep(Duration::from_secs(60));
                let cfg = crate::read_log_cleanup_settings();
                if cfg.auto_cleanup
                    && last_cleanup_run.elapsed()
                        >= Duration::from_secs(cfg.interval_min.saturating_mul(60))
                {
                    crate::cleanup_logs_if_needed();
                    last_cleanup_run = Instant::now();
                }
            }
        });

    if let Err(error) = spawn_result {
        crate::log_to_file(
            "warn",
            "clipboard-monitor",
            &format!("spawn log maintenance failed: {}", error),
        );
    }
}

#[cfg(test)]
#[path = "watcher_tests.rs"]
mod tests;
