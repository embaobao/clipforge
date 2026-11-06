//! 跨采集路径共享的去重指纹（RS-51 P1 4.7，对应缺陷 S5/C4）。
//!
//! watcher 轮询、open_panel 显示前补采、manual capture 三条路径此前各持独立
//! （或为空）的指纹状态：dev 日志取证显示「每次 promoted 前后紧跟 manual
//! capture 与 watcher started」——同一内容被两条路径各 promote/emit 一次。
//! 收敛为进程级单一状态后：
//! - 三条路径对同一内容只采一次（重复 promote/emit 消除）；
//! - watcher 监督循环重启创建新 monitor 实例时，不再因空指纹强制 detected 一次
//!   （dev 日志 46 次 watcher started ≈ 46 次强制 detected）。
use std::sync::Mutex;

/// 最近一次成功采集（或启动 priming）的 raw 指纹。空串 = 尚无基线。
static LAST_FINGERPRINT: Mutex<String> = Mutex::new(String::new());

/// 读取当前共享指纹。
pub(crate) fn last_fingerprint() -> String {
    LAST_FINGERPRINT
        .lock()
        .map(|fp| fp.clone())
        .unwrap_or_default()
}

/// 提交共享指纹。仅允许在「采集成功后」或「启动 priming」两处调用
///（缺陷 C3：失败提前提交会让该内容在进程生命周期内永久漏采）。
pub(crate) fn remember_fingerprint(fingerprint: &str) {
    if let Ok(mut slot) = LAST_FINGERPRINT.lock() {
        *slot = fingerprint.to_string();
    }
}

/// 重置共享指纹（仅测试用：进程级全局，跨测试必须复位）。
#[cfg(test)]
pub(crate) fn reset_for_tests() {
    if let Ok(mut slot) = LAST_FINGERPRINT.lock() {
        slot.clear();
    }
}

/// 测试串行锁：dedup 与 suppress 都是进程级全局，并行测试必须持同一把锁串行
///（对齐 lib.rs hard_delete_image_cleanup_tests 的 TEST_DATA_DIR_LOCK 模式）。
#[cfg(test)]
pub(crate) static TEST_STATE_LOCK: Mutex<()> = Mutex::new(());
