//! 监听可靠性单元测试（RS-51）：复现闭环的量化证据。
//! 覆盖验收标准 7.1：A4（启动 10 次 detected 增量 0）、B1（同内容只采一次）、
//! C3（capture 失败不提交指纹、下轮重试）、P0 3.5（事件序号单调递增）。
//! 抑制窗口 U3 的修复前红证/修复后绿证见 suppress.rs 与 tasks.md 5.1。
use super::*;

/// 记录式采集出口：可编程「前 N 次失败」，记录每次 capture 尝试与 emit。
struct RecordingSink {
    fail_first: usize,
    capture_attempts: Vec<String>,
    captured_texts: Vec<String>,
    emitted: Vec<String>,
}

impl RecordingSink {
    fn new() -> Self {
        Self {
            fail_first: 0,
            capture_attempts: Vec::new(),
            captured_texts: Vec::new(),
            emitted: Vec::new(),
        }
    }

    fn fail_first(mut self, n: usize) -> Self {
        self.fail_first = n;
        self
    }
}

impl CaptureSink for RecordingSink {
    fn capture(
        &mut self,
        payload: super::super::payload::StandardClipboardPayload,
        _now: i64,
    ) -> Result<CapturedChange, String> {
        let text = match &payload {
            super::super::payload::StandardClipboardPayload::Text(t) => t.text.clone(),
            _ => "<non-text>".to_string(),
        };
        self.capture_attempts.push(text.clone());
        if self.capture_attempts.len() <= self.fail_first {
            return Err("simulated capture failure".to_string());
        }
        self.captured_texts.push(text.clone());
        Ok(CapturedChange {
            status: "created".to_string(),
            id: format!("clip_{}", text),
            preview: text,
        })
    }

    fn emit_changed(&mut self, preview: String) {
        self.emitted.push(preview);
    }
}

fn text_payload(text: &str) -> super::super::payload::StandardClipboardPayload {
    super::super::payload::StandardClipboardPayload::Text(super::super::payload::TextPayload {
        text: text.to_string(),
        html: None,
        rtf: None,
    })
}

fn fingerprint_of(text: &str) -> String {
    crate::clipboard_payload_fingerprint(&text_payload(text))
}

/// 串行锁：dedup/suppress 是进程级全局，并行测试会互相改写指纹/窗口状态。
fn lock_state() -> std::sync::MutexGuard<'static, ()> {
    super::super::dedup::TEST_STATE_LOCK
        .lock()
        // 锁中毒不阻断后续测试：状态本来就会在下一个测试开头 reset
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A4 / 5.3 门禁：模拟 10 次进程启动（每次重置进程级去重状态并 priming 当前
/// 内容），剪贴板内容不变 → detected（capture/emit）增量必须为 0。
/// 旧实现：空指纹 + 启动即采集 = 每次启动强制 detected（dev 46 次 started 佐证）。
#[test]
fn ten_startups_with_unchanged_content_yield_zero_detected() {
    let _guard = lock_state();
    let mut total_captures = 0;
    let mut total_emits = 0;
    for _ in 0..10 {
        super::super::dedup::reset_for_tests();
        // 启动静默 priming（与 supervise_watcher 内 prime_fingerprint 同语义）
        super::super::dedup::remember_fingerprint(&fingerprint_of("same-content"));
        let mut monitor = ClipboardMonitor::new(RecordingSink::new());
        monitor.process_payload(text_payload("same-content"));
        let sink = monitor.into_sink();
        total_captures += sink.captured_texts.len();
        total_emits += sink.emitted.len();
    }
    assert_eq!(total_captures, 0, "10 次启动 detected 增量必须为 0");
    assert_eq!(total_emits, 0, "10 次启动 clipboard-changed 增量必须为 0");
}

/// B1 / detected↔recorded 一一对应：X→Y→Y→X 三次内容变化，capture 恰好 2 次
/// （Y 一次 created、X 回切一次 promote），重复的 Y 不再采。
#[test]
fn content_changes_map_one_to_one_to_captures() {
    let _guard = lock_state();
    super::super::dedup::remember_fingerprint(&fingerprint_of("X"));
    let mut monitor = ClipboardMonitor::new(RecordingSink::new());
    monitor.process_payload(text_payload("Y"));
    monitor.process_payload(text_payload("Y"));
    monitor.process_payload(text_payload("X"));
    let sink = monitor.into_sink();
    assert_eq!(
        sink.captured_texts,
        vec!["Y".to_string(), "X".to_string()],
        "detected 与 recorded 一一对应，重复内容不重复采"
    );
    assert_eq!(sink.emitted.len(), 2);
}

/// C3 / A 类：capture 失败后指纹不提交，下一轮轮询对同一内容自然重试；
/// 旧实现指纹在采集前提交 → 一次失败 = 该内容本进程生命周期内永久漏采。
#[test]
fn capture_failure_keeps_fingerprint_for_retry() {
    let _guard = lock_state();
    super::super::dedup::remember_fingerprint(&fingerprint_of("old"));
    let mut monitor = ClipboardMonitor::new(RecordingSink::new().fail_first(1));
    monitor.process_payload(text_payload("new"));
    // 失败后共享指纹仍是旧值（未提交）
    assert_eq!(
        super::super::dedup::last_fingerprint(),
        fingerprint_of("old"),
        "capture 失败不得提交指纹"
    );
    monitor.process_payload(text_payload("new"));
    let sink = monitor.into_sink();
    assert_eq!(
        sink.capture_attempts,
        vec!["new".to_string(), "new".to_string()],
        "失败后下一轮必须重试同一内容"
    );
    assert_eq!(sink.captured_texts.len(), 1);
    assert_eq!(
        super::super::dedup::last_fingerprint(),
        fingerprint_of("new"),
        "成功后才提交指纹"
    );
}

/// P0 3.5：clipboard-changed 事件序号严格单调递增（旧值是毫秒时间戳，
/// 同毫秒内多事件无法区分先后，前端无法去重）。
#[test]
fn change_event_seq_is_strictly_monotonic() {
    let seqs: Vec<i64> = (0..5)
        .map(|_| CHANGE_SEQ.fetch_add(1, Ordering::Relaxed) + 1)
        .collect();
    let mut sorted = seqs.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(seqs, sorted, "序号必须严格递增且不重复");
}

impl<S: CaptureSink> ClipboardMonitor<S> {
    /// 测试辅助：取回 sink 检查调用记录。
    fn into_sink(self) -> S {
        self.sink
    }
}
