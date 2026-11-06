//! 写回抑制窗口：截止时间戳 + 代际序号（RS-51 P1 4.2，对应缺陷 U3/U4）。
//!
//! 旧实现是「全局 bool + 每次调用 spawn 一个 sleep 线程」，两个已证缺陷：
//! 1. 450ms（write_clipboard_item）与 700ms（paste_clipboard_item）重叠时，
//!    先到期的线程无条件 `store(false)`，提前解除后开的窗口 → 自己刚写回的
//!    内容被 watcher 当新内容采回（回环）。修复前复现：
//!    `t=550ms 断言失败`（见 tasks.md 5.1 / PR 描述）。
//! 2. 每次调用累积一个线程，无代际概念，窗口归属不可查。
//!
//! 新实现：只记录「截止时间戳（epoch 毫秒）取 max + 单调序号」，过期为被动
//! 判定（now < deadline），无线程、无清零、不可提前解除。
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;

/// 抑制截止时间戳（epoch 毫秒）。0 表示从未开启。
static SUPPRESS_DEADLINE_MS: AtomicI64 = AtomicI64::new(0);
/// 抑制窗口单调序号：仅用于日志归属（P0 3.2「抑制窗口起止带序号」）。
static SUPPRESS_SEQ: AtomicI64 = AtomicI64::new(0);
/// 上次判定时窗口是否生效：在真实解除时刻被动补一条结束日志（无定时线程可打）。
static SUPPRESS_ACTIVE_LAST: AtomicBool = AtomicBool::new(false);

fn suppress_log(level: &str, message: &str) {
    crate::log_to_file(level, "clipboard-suppress", message);
}

/// 开启一个写回抑制窗口（对外入口，保留旧函数签名，调用点零改动）。
pub(crate) fn suppress_writeback_for(duration: Duration) {
    let now = crate::now_millis().unwrap_or(0);
    let seq = SUPPRESS_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    suppress_writeback_until(now + duration.as_millis() as i64, seq, now);
}

/// 以显式时间开启窗口（测试与内部复用）：截止时间只延长不缩短，
/// 后开的短窗口不能提前解除先开的长窗口。
pub(crate) fn suppress_writeback_until(deadline_ms: i64, seq: i64, now_ms: i64) {
    let mut current = SUPPRESS_DEADLINE_MS.load(Ordering::SeqCst);
    while current < deadline_ms {
        match SUPPRESS_DEADLINE_MS.compare_exchange_weak(
            current,
            deadline_ms,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => break,
            Err(actual) => current = actual,
        }
    }
    suppress_log(
        "info",
        &format!(
            "writeback suppress start: seq={}, now_ms={}, deadline_ms={}",
            seq, now_ms, deadline_ms
        ),
    );
}

/// 当前是否处于抑制窗口内（watcher / 补采 / manual capture 统一判定入口）。
pub(crate) fn should_skip_writeback() -> bool {
    is_writeback_suppressed_at(crate::now_millis().unwrap_or(0))
}

/// 以显式时间判定抑制状态（测试复用）：在窗口真实过期后的首次判定补结束日志。
pub(crate) fn is_writeback_suppressed_at(now_ms: i64) -> bool {
    let active = now_ms < SUPPRESS_DEADLINE_MS.load(Ordering::SeqCst);
    if active {
        SUPPRESS_ACTIVE_LAST.store(true, Ordering::SeqCst);
    } else if SUPPRESS_ACTIVE_LAST.swap(false, Ordering::SeqCst) {
        let seq = SUPPRESS_SEQ.load(Ordering::SeqCst);
        suppress_log(
            "info",
            &format!(
                "writeback suppress end: seq={}, now_ms={}, deadline_ms={}",
                seq,
                now_ms,
                SUPPRESS_DEADLINE_MS.load(Ordering::SeqCst)
            ),
        );
    }
    active
}

/// 重置窗口状态（仅测试用：进程级全局，跨测试必须复位）。
#[cfg(test)]
pub(crate) fn reset_for_tests() {
    SUPPRESS_DEADLINE_MS.store(0, Ordering::SeqCst);
    SUPPRESS_SEQ.store(0, Ordering::SeqCst);
    SUPPRESS_ACTIVE_LAST.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lock_state() -> std::sync::MutexGuard<'static, ()> {
        super::super::dedup::TEST_STATE_LOCK
            .lock()
            .expect("reliability test state lock")
    }

    /// A3/U3 重叠抑制：450ms 与 700ms 窗口同刻开启，截止时间取 max，
    /// 不允许先到期的短窗口提前解除长窗口（旧机制在 t=550ms 已解除，复现红证见 PR）。
    #[test]
    fn overlapping_windows_keep_later_deadline() {
        let _guard = lock_state();
        reset_for_tests();
        suppress_writeback_until(1_000, 1, 0);
        suppress_writeback_until(700, 2, 0);
        assert!(is_writeback_suppressed_at(699));
        assert!(is_writeback_suppressed_at(700), "截止时间取 max=1000，700 仍在抑制");
        assert!(is_writeback_suppressed_at(999), "长窗口生效期内不得被短窗口解除");
        assert!(!is_writeback_suppressed_at(1_000));
    }

    /// 后开的短窗口不得缩短已生效的长窗口（compare_exchange 只延长）。
    #[test]
    fn later_short_window_cannot_shorten_active_one() {
        let _guard = lock_state();
        reset_for_tests();
        suppress_writeback_until(2_000, 1, 0);
        suppress_writeback_until(1_000, 2, 500);
        assert!(is_writeback_suppressed_at(1_999));
        assert!(!is_writeback_suppressed_at(2_000));
    }

    /// 真实时间链路（与修复前复现同一场景）：450ms+700ms 重叠，
    /// t≈550ms 必须仍在抑制（旧实现在此处失败，证据见 tasks.md 5.1）。
    #[test]
    fn realtime_overlap_stays_suppressed_until_max_deadline() {
        let _guard = lock_state();
        reset_for_tests();
        suppress_writeback_for(Duration::from_millis(450));
        suppress_writeback_for(Duration::from_millis(700));
        std::thread::sleep(Duration::from_millis(550));
        assert!(
            should_skip_writeback(),
            "t=550ms B 窗口(700ms) 仍在生效期，抑制不应被 A(450ms) 提前解除"
        );
        std::thread::sleep(Duration::from_millis(250));
        assert!(!should_skip_writeback(), "t=800ms 全部窗口到期，抑制应解除");
    }
}
