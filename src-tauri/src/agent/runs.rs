//! Agent run 存储层（从 run.rs 拆出，modularity Phase 4）：AGENT_RUNS 表与私有锁，poisoned→
//! AGENT_RUNS_LOCK_POISONED 错误 + 进程级 AGENT_RUNS_DEGRADED 降级不重建（模式同
//! settings_service/write.rs）；cleanup_agent_children 进程收尾杀子进程并标记取消。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use super::{is_active_agent_status, set_agent_run_status, AgentRunState, AgentRunStatus};
use crate::now_millis;

pub(super) static AGENT_RUNS: std::sync::LazyLock<Mutex<HashMap<String, AgentRunState>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
static AGENT_RUNS_DEGRADED: AtomicBool = AtomicBool::new(false);

pub(super) fn mark_agent_runs_degraded() {
    AGENT_RUNS_DEGRADED.store(true, Ordering::Release);
}

fn is_agent_runs_degraded() -> bool {
    AGENT_RUNS_DEGRADED.load(Ordering::Acquire)
}

/// 进程级降级：run 锁 poisoned 后本进程内读写全走降级错误、不重建锁（防半写入状态二次消费）。
pub(super) fn acquire_agent_runs_lock(
) -> Result<MutexGuard<'static, HashMap<String, AgentRunState>>, String> {
    let guard = AGENT_RUNS.lock().map_err(|error| {
        mark_agent_runs_degraded();
        format!("AGENT_RUNS_LOCK_POISONED: {error}")
    })?;
    if is_agent_runs_degraded() {
        return Err(
            "AGENT_RUNS_DEGRADED: agent run store lock was poisoned earlier in this process"
                .to_string(),
        );
    }
    Ok(guard)
}

pub(crate) fn cleanup_agent_children() {
    let Ok(mut runs) = AGENT_RUNS.lock() else {
        mark_agent_runs_degraded();
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
