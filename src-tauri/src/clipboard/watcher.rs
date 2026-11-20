use clipboard_rs::{ClipboardHandler, ClipboardWatcher, ClipboardWatcherContext};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Runtime};

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
        .spawn(move || {
            let started_at = Instant::now();
            let mut monitor = ClipboardMonitor::new(app_handle);
            // 启动阶段的首次读板：显式标记，避免把「启动即采集」误读成用户复制事件。
            crate::log_to_file(
                "info",
                "clipboard-monitor",
                "priming: reading clipboard before watcher start",
            );
            monitor.process_current_clipboard();

            let mut watcher = match build_watcher_context::<R>() {
                Ok(watcher) => watcher,
                Err(error) => {
                    crate::log_to_file(
                        "error",
                        "clipboard-monitor",
                        &format!("watcher init failed: {}", error),
                    );
                    return;
                }
            };

            let priming_detected = monitor.detected_seq;
            let priming_state_changes = monitor.observe.state_seq;
            crate::log_to_file(
                "info",
                "clipboard-monitor",
                &format!(
                    "watcher started, mode={}, priming_detected={}, state_changes={}",
                    watcher_mode(),
                    priming_detected,
                    priming_state_changes
                ),
            );
            watcher.add_handler(monitor);
            watcher.start_watch();
            // start_watch() 返回即监听线程结束。记录运行时长与退出事实，
            // 让「监听是否静默退出」可直接从日志判定；重连属 P1 修复，本轮不改行为。
            crate::log_to_file(
                "warn",
                "clipboard-monitor",
                &format!(
                    "watcher stopped, reason=start_watch_returned, uptime_secs={}",
                    started_at.elapsed().as_secs()
                ),
            );
        });

    if let Err(error) = spawn_result {
        crate::log_to_file(
            "error",
            "clipboard-monitor",
            &format!("spawn watcher thread failed: {}", error),
        );
    }
}

/// 日志用的短指纹：不足 8 字符或非 ASCII 边界时原样返回，避免切片 panic。
/// 指纹本身是十六进制字符串，这里只做防御性截断，不参与任何去重判定。
fn short_hash(hash: &str) -> &str {
    hash.get(..8).unwrap_or(hash)
}

/// 监听可观测性状态（clipboard-listener-reliability P0）。
///
/// 只负责把「为什么这一轮没有记录」变成日志里可查的事实，不改变采集、去重、
/// 抑制或写回的任何行为。120ms 轮询下重复原因会刷爆日志，因此：
/// - 状态切换（暂停 / 写回抑制 / 正常）走边沿触发，带单调递增序号；
/// - 内容未变、空指纹、无 payload 等常态跳过走 30 秒窗口聚合，记录被抑制条数。
#[derive(Debug)]
struct ObserveState {
    last_state: &'static str,
    state_seq: u64,
    last_skip_reason: &'static str,
    skip_window_started: Instant,
    skip_suppressed: u64,
}

impl ObserveState {
    fn new() -> Self {
        Self {
            last_state: "",
            state_seq: 0,
            last_skip_reason: "",
            skip_window_started: Instant::now(),
            skip_suppressed: 0,
        }
    }

    /// 记录监听状态边沿。只有状态真正切换才落日志，用于区分「监听挂了」与「内容没变」。
    fn observe_state(&mut self, state: &'static str) {
        if self.last_state == state {
            return;
        }
        let previous = if self.last_state.is_empty() {
            "init"
        } else {
            self.last_state
        };
        self.state_seq += 1;
        crate::log_to_file(
            "info",
            "clipboard-monitor",
            &format!(
                "monitor state: {} -> {}, seq={}",
                previous, state, self.state_seq
            ),
        );
        self.last_state = state;
    }

    /// 记录一次「本轮跳过采集」的原因，同原因 30 秒内只聚合不逐条落盘。
    fn observe_skip(&mut self, reason: &'static str, detail: &str) {
        let reason_changed = self.last_skip_reason != reason;
        if !reason_changed && self.skip_window_started.elapsed() < Duration::from_secs(30) {
            self.skip_suppressed += 1;
            return;
        }
        crate::log_to_file(
            "info",
            "clipboard-monitor",
            &format!(
                "skip: reason={}, {}, suppressed={}",
                reason, detail, self.skip_suppressed
            ),
        );
        self.last_skip_reason = reason;
        self.skip_window_started = Instant::now();
        self.skip_suppressed = 0;
    }
}

struct ClipboardMonitor<R: Runtime> {
    app_handle: tauri::AppHandle<R>,
    last_fingerprint: String,
    consecutive_errors: u64,
    last_log_time: Instant,
    observe: ObserveState,
    detected_seq: u64,
}

impl<R> ClipboardMonitor<R>
where
    R: Runtime,
{
    fn new(app_handle: tauri::AppHandle<R>) -> Self {
        Self {
            app_handle,
            last_fingerprint: String::new(),
            consecutive_errors: 0,
            last_log_time: Instant::now(),
            observe: ObserveState::new(),
            detected_seq: 0,
        }
    }

    fn process_current_clipboard(&mut self) {
        // 可观测性：把暂停 / 写回抑制 / 正常三种状态做成带序号的边沿日志，
        // 这样「静默期」能直接区分是被抑制还是监听没触发，不改动原有早退逻辑。
        if crate::is_listen_paused() {
            self.observe.observe_state("paused");
            return;
        }
        if crate::should_skip_writeback() {
            self.observe.observe_state("writeback-suppressed");
            return;
        }
        self.observe.observe_state("active");

        match super::read_clipboard_payload() {
            Ok(Some(raw_payload)) => {
                // read 恢复证据：consecutive_errors 只用于日志节流，清零不触碰采集行为。
                if self.consecutive_errors > 0 {
                    crate::log_to_file(
                        "info",
                        "clipboard-monitor",
                        &format!(
                            "read error recovered after {} consecutive failures",
                            self.consecutive_errors
                        ),
                    );
                    self.consecutive_errors = 0;
                    self.last_log_time = Instant::now();
                }
                let raw_fingerprint = crate::clipboard_payload_fingerprint(&raw_payload);
                if raw_fingerprint == self.last_fingerprint {
                    self.observe.observe_skip(
                        "unchanged",
                        &format!("raw={}", short_hash(&raw_fingerprint)),
                    );
                    return;
                }
                self.last_fingerprint = raw_fingerprint.clone();

                let payload = match crate::apply_capture_settings(raw_payload) {
                    Ok(Some(payload)) => payload,
                    Ok(None) => {
                        crate::log_to_file(
                            "info",
                            "clipboard-monitor",
                            &format!(
                                "capture skipped by settings, hash={}",
                                &raw_fingerprint[..8]
                            ),
                        );
                        return;
                    }
                    Err(error) => {
                        crate::log_to_file(
                            "warn",
                            "clipboard-monitor",
                            &format!(
                                "capture skipped by settings error, hash={}, reason={}",
                                &raw_fingerprint[..8],
                                error
                            ),
                        );
                        return;
                    }
                };

                let fingerprint = crate::clipboard_payload_fingerprint(&payload);
                if fingerprint.is_empty() {
                    self.observe.observe_skip(
                        "empty-fingerprint",
                        &format!("raw={}", short_hash(&raw_fingerprint)),
                    );
                    return;
                }

                let now = crate::now_millis().unwrap_or(0);
                self.detected_seq += 1;
                // 同时打 raw / processed 指纹，让「设置改写 payload 导致指纹漂移」可被直接证伪或证实。
                crate::log_to_file(
                    "info",
                    "clipboard-monitor",
                    &format!(
                        "detected change, seq={}, raw={}, processed={}, identical={}, ts={}",
                        self.detected_seq,
                        short_hash(&raw_fingerprint),
                        short_hash(&fingerprint),
                        raw_fingerprint == fingerprint,
                        now
                    ),
                );

                match crate::capture_clip_payload(payload, Some("Clipboard".to_string()), now) {
                    Ok(payload) => {
                        crate::log_to_file(
                            "debug",
                            "clipboard-monitor",
                            &format!(
                                "recorded: status={}, id={}",
                                payload.status, payload.item.id
                            ),
                        );
                        let payload_json = crate::ClipboardChangePayload {
                            change_count: now,
                            has_change: true,
                            preview: Some(payload.item.plain_text.chars().take(40).collect()),
                            preview_len: Some(payload.item.plain_text.chars().count() as i64),
                        };
                        if let Err(error) = self.app_handle.emit("clipboard-changed", payload_json)
                        {
                            crate::log_to_file(
                                "warn",
                                "clipboard-monitor",
                                &format!("emit clipboard-changed failed: {}", error),
                            );
                        }
                    }
                    Err(error) => {
                        // 指纹在 capture 之前已提交且失败不回滚（P1 待修缺陷）。
                        // 这里只把「指纹被保留」写进证据，不改动任何回滚行为。
                        crate::log_to_file(
                            "error",
                            "clipboard-monitor",
                            &format!(
                                "capture failed: seq={}, processed={}, error={}, fingerprint_kept=true",
                                self.detected_seq,
                                short_hash(&fingerprint),
                                error
                            ),
                        );
                    }
                }
            }
            Ok(None) => {
                self.observe.observe_skip("no-payload", "read returned empty");
            }
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
}

impl<R> ClipboardHandler for ClipboardMonitor<R>
where
    R: Runtime,
{
    fn on_clipboard_change(&mut self) {
        self.process_current_clipboard();
    }
}

fn build_watcher_context<R>() -> Result<ClipboardWatcherContext<ClipboardMonitor<R>>, String>
where
    R: Runtime,
{
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
