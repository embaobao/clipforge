use clipboard_rs::{ClipboardHandler, ClipboardWatcher, ClipboardWatcherContext};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Runtime};

pub fn init<R>(app_handle: tauri::AppHandle<R>)
where
    R: Runtime,
{
    start_log_maintenance_thread();

    let spawn_result = thread::Builder::new()
        .name("clipforge-clipboard-watcher".to_string())
        .spawn(move || {
            let mut monitor = ClipboardMonitor::new(app_handle);
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

            crate::log_to_file(
                "info",
                "clipboard-monitor",
                &format!("watcher started, mode={}", watcher_mode()),
            );
            watcher.add_handler(monitor);
            watcher.start_watch();
            crate::log_to_file("info", "clipboard-monitor", "watcher stopped");
        });

    if let Err(error) = spawn_result {
        crate::log_to_file(
            "error",
            "clipboard-monitor",
            &format!("spawn watcher thread failed: {}", error),
        );
    }
}

struct ClipboardMonitor<R: Runtime> {
    app_handle: tauri::AppHandle<R>,
    last_fingerprint: String,
    consecutive_errors: u64,
    last_log_time: Instant,
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
        }
    }

    fn process_current_clipboard(&mut self) {
        if crate::is_listen_paused() {
            return;
        }
        if crate::should_skip_writeback() {
            return;
        }

        match super::read_clipboard_payload() {
            Ok(Some(raw_payload)) => {
                let raw_fingerprint = crate::clipboard_payload_fingerprint(&raw_payload);
                if raw_fingerprint == self.last_fingerprint {
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
                    return;
                }

                let now = crate::now_millis().unwrap_or(0);
                crate::log_to_file(
                    "info",
                    "clipboard-monitor",
                    &format!("detected change, hash={}, ts={}", &fingerprint[..8], now),
                );
                self.consecutive_errors = 0;

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
                        crate::log_to_file(
                            "error",
                            "clipboard-monitor",
                            &format!("capture failed: {}", error),
                        );
                    }
                }
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
