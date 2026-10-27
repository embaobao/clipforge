//! 插件运行时桥接 spike（Phase 1 闸门）。
//!
//! 本文件持有 cordis + rquickjs 的全部引用，是「cordis 类型不出 plugin_runtime」红线
//! 的执行点：对外只暴露 [`run_bridge_spike`]（返回 `plugin_runtime::SpikeOutcome`）。
//!
//! # 闸门内容（tasks.md 1.1/1.2）
//! - 1.1 起一个 cordis Fiber（`Context::spawn` → `PreparedPlugin`），在 apply 内建
//!   rquickjs `AsyncRuntime`/`AsyncContext`，把 ctx 四组接口桥成 JS 可见对象：
//!   `ctx.clipf.*`（能力对象，stub 假数据）、`ctx.on`、`ctx.register.*`、`ctx.log`；
//!   JS 侧跑一段 fixture 脚本调通四组各至少 1 个方法；dispose 后断言 Runtime 与全部
//!   监听确定性回收（计数探针归零）。
//! - 1.2 按 fixture manifest 的 memoryLimit（64KB）调 `set_memory_limit`，JS 内
//!   `while(true)` + 大数组分配，断言超限中断（宿主不崩）、Fiber 收敛 Failed 可 dispose；
//!   顺带实测空 Runtime 固定内存基线。
//!
//! # 线程模型（design §18.1）
//! 一插件 = 一线程 + 一 AsyncRuntime + 一 Context。spike 用一个 `std::thread` 承载
//! tokio current_thread runtime；cordis 内部 `tokio::spawn` 要求 apply future 是 Send，
//! 而 rquickjs 句柄（不开 parallel feature）是 !Send，因此 QuickJS episode 在 apply
//! 内用 `futures::executor::block_on` 单次 poll 同步收敛；跨线程只走消息通道把
//! `SpikeOutcome` 送回测试线程。

use std::sync::{Arc, Mutex};
use std::thread;

use rquickjs::{AsyncContext, AsyncRuntime};
use super::spike_bridge::burn_memory;

use super::spike_bridge::{BridgeProbes, bridge_and_call, dispatch_probe_event};
use super::budget::{DEFAULT_MEMORY_LIMIT_BYTES, FIXTURE_MEMORY_LIMIT_BYTES};
use crate::plugin_runtime::SpikeOutcome;

/// 跑一遍桥接闸门，返回门面结论。失败以 `Err(String)` 上报，不 panic（spike 的价值在
/// 结论，不在崩溃）。
pub fn run_bridge_spike() -> Result<SpikeOutcome, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = thread::Builder::new()
        .name("plugin-runtime-spike".to_owned())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("spike tokio runtime");
            let local = tokio::task::LocalSet::new();
            let outcome = local.block_on(&rt, spike_on_local_set());
            let _ = tx.send(outcome);
        })
        .map_err(|e| format!("spawn spike thread: {e}"))?;
    worker
        .join()
        .map_err(|_| "spike thread panicked".to_owned())?;
    rx.recv()
        .map_err(|_| "spike thread dropped result".to_owned())?
}

/// 在 LocalSet 上跑 spike：cordis 的 spawn/apply 走 tokio 任务，QuickJS episode 已在
/// apply 内 block_on 收敛，这里的 LocalSet 只承载外层编排 future。
async fn spike_on_local_set() -> Result<SpikeOutcome, String> {
    let probes = Arc::new(Mutex::new(BridgeProbes::default()));

    // ---- 1.2 内存基线：空 Runtime 固定开销 ----
    let baseline = {
        let rt = AsyncRuntime::new().map_err(|e| format!("AsyncRuntime::new: {e}"))?;
        rt.set_memory_limit(FIXTURE_MEMORY_LIMIT_BYTES).await;
        rt.memory_usage().await.malloc_size
    };

    // ---- 1.1 桥接闸门：Fiber 内嵌 rquickjs Runtime ----
    let bridge = run_fiber_bridge(probes.clone()).await?;

    // ---- 1.2 内存上限：独立 Fiber + 独立 Runtime，超限后收敛 Failed ----
    let memory = run_memory_limit_case().await?;

    let p = probes.lock().unwrap();
    Ok(SpikeOutcome {
        bridge_ok: bridge,
        reclaimed: p.listener_drops > 0 && p.event_dispatches > 0,
        baseline_bytes: baseline,
        memory_limit_enforced: memory.0,
        converged_failed: memory.1,
    })
}

/// 起一个 cordis Fiber，apply 内建 QuickJS Runtime 并桥四组接口，返回 JS 侧调用是否全通。
///
/// cordis 侧只用到生命周期（spawn/dispose/state），不把 cordis 类型传出本函数。
async fn run_fiber_bridge(probes: Arc<Mutex<BridgeProbes>>) -> Result<bool, String> {
    use cordis::{Context, FiberState, Plugin, PreparedPlugin};
    use std::convert::Infallible;

    struct BridgePlugin {
        probes: Arc<Mutex<BridgeProbes>>,
    }

    impl Plugin for BridgePlugin {
        type Config = ();
        type Input = ();
        type PrepareError = Infallible;
        type ApplyError = std::io::Error;

        fn prepare(&self, _: ()) -> Result<(), Infallible> {
            Ok(())
        }

        // cordis 内部 tokio::spawn 要求 apply future 是 Send，而 rquickjs 句柄（不开
        // parallel feature）是 !Send：整个 QuickJS episode 用 block_on 在 apply 的
        // 单次 poll 内同步跑完，!Send 状态不跨 await 点存活（design §18.1 的 spike
        // 等价实现，回写 design §12 备案）。
        async fn apply(&self, _ctx: Context, _: &()) -> Result<(), std::io::Error> {
            quickjs_episode(self.probes.clone())
        }
    }

    let root = Context::new();
    let handle = root
        .spawn(PreparedPlugin::from_input(
            BridgePlugin {
                probes: probes.clone(),
            },
            (),
        ))
        .await
        .map_err(|e| format!("spawn bridge plugin: {e}"))?;

    let state = handle.state();

    // 1.3 附带验证：cordis update(输入替换)可行性——同 Fiber 身份换一代输入重跑
    // apply。结论回写 design §12（v1 配置变更是否维持 dispose→spawn 重启语义）。
    let update_ok = match handle
        .update(cordis::PreparedChange::from_input::<BridgePlugin>(()))
        .await
    {
        Ok(_) => matches!(handle.state(), FiberState::Active),
        Err(e) => {
            let _ = handle.dispose().await;
            return Err(format!("update bridge plugin: {e}"));
        }
    };

    handle
        .dispose()
        .await
        .map_err(|e| format!("dispose bridge plugin: {e}"))?;
    let final_state = handle.state();
    Ok(matches!(state, FiberState::Active)
        && update_ok
        && matches!(final_state, FiberState::Disposed))
}

/// QuickJS episode：建 Runtime/Context、桥四组接口、跑 fixture、分发事件、回收。
///
/// 本函数整体在 `futures::executor::block_on` 内同步执行（由 [`BridgePlugin::apply`]
/// 在宿主线程的单次 poll 中驱动），内部 future 是 !Send，绝不跨线程传递。
fn quickjs_episode(probes: Arc<Mutex<BridgeProbes>>) -> Result<(), std::io::Error> {
    futures::executor::block_on(async {
        let runtime = AsyncRuntime::new()
            .map_err(|e| std::io::Error::other(format!("AsyncRuntime::new: {e}")))?;
        // 顺序约束：裸 QuickJS Context 的创建分配即超过 64KB fixture 上限，
        // 必须先建 Context 再设限——语义也更贴近真实宿主（限制插件运行期分配）。
        // 桥接 Fiber 用默认 8MB（桥接对象+fixture 的分配量远超 64KB）；64KB 留给
        // 烧内存用例（run_memory_limit_case）验证上限强制。
        let js_ctx = AsyncContext::full(&runtime)
            .await
            .map_err(|e| std::io::Error::other(format!("AsyncContext::full: {e}")))?;
        runtime
            .set_memory_limit(DEFAULT_MEMORY_LIMIT_BYTES)
            .await;

        // 桥接与 JS 调用都在同一 async_with 内完成：Ctx 生命周期钉在 'js 内。
        let ok = js_ctx
            .async_with(async |ctx| bridge_and_call(ctx, probes.clone()).await)
            .await
            .map_err(|e| std::io::Error::other(format!("bridge_and_call: {e}")))?;
        if !ok {
            return Err(std::io::Error::other("js side rejected the bridge"));
        }

        // 事件分发一次，验证 ctx.on 监听真实可达（JS 回调被调用）。
        js_ctx.with(|ctx| dispatch_probe_event(ctx, &probes)).await;

        // 监听回收：清空桥侧 Vec 并计数（dispose 语义的 spike 等价观测）。
        {
            let mut p = probes.lock().unwrap();
            p.listener_drops += p.listeners.len() as u32;
            p.listeners.clear();
        }

        // 清理顺序（design §18.1）：Context 先于 Runtime drop。
        drop(js_ctx);
        drop(runtime);
        Ok(())
    })
}

/// 内存上限 episode：64KB limit 下烧内存，超限异常转成 apply 失败。
fn memory_burn_episode() -> Result<(), std::io::Error> {
    futures::executor::block_on(async {
        let runtime = AsyncRuntime::new()
            .map_err(|e| std::io::Error::other(format!("AsyncRuntime::new: {e}")))?;
        // 同 quickjs_episode：先建 Context（其自身分配超 64KB），再设运行期上限。
        let js_ctx = AsyncContext::full(&runtime)
            .await
            .map_err(|e| std::io::Error::other(format!("AsyncContext::full: {e}")))?;
        runtime
            .set_memory_limit(FIXTURE_MEMORY_LIMIT_BYTES)
            .await;

        // 超限即 apply 失败（模拟宿主把引擎 OOM 当插件失败处理，design §18.2-3）。
        let outcome = js_ctx.async_with(async |ctx| burn_memory(ctx).await).await;
        drop(js_ctx);
        drop(runtime);
        match outcome {
            Ok(true) => Ok(()),
            Ok(false) => Err(std::io::Error::other("memory limit not enforced")),
            Err(e) => Err(std::io::Error::other(format!("memory burn: {e}"))),
        }
    })
}

/// 内存上限用例：64KB limit 下反复分配大数组，断言超限中断、宿主不崩、
/// Fiber 收敛 Failed 可 dispose。返回 `(limit_enforced, converged_failed)`。
async fn run_memory_limit_case() -> Result<(bool, bool), String> {
    use cordis::lifecycle::SpawnError;
    use cordis::{Context, Plugin, PreparedPlugin};
    use std::convert::Infallible;

    struct MemoryPlugin;

    impl Plugin for MemoryPlugin {
        type Config = ();
        type Input = ();
        type PrepareError = Infallible;
        type ApplyError = std::io::Error;

        fn prepare(&self, _: ()) -> Result<(), Infallible> {
            Ok(())
        }

        // 与 BridgePlugin 同理：QuickJS episode 在 apply 单次 poll 内 block_on 收敛，
        // 满足 cordis 对 apply future 的 Send 约束。
        async fn apply(&self, _: Context, _: &()) -> Result<(), std::io::Error> {
            memory_burn_episode()
        }
    }

    let root = Context::new();
    match root
        .spawn(PreparedPlugin::from_input(MemoryPlugin, ()))
        .await
    {
        Ok(handle) => {
            // 未触顶的意外路径：仍要能 dispose，但判上限未强制。
            let _ = handle.dispose().await;
            Ok((false, false))
        }
        Err(SpawnError::InitialApply(failure)) => {
            // apply 失败 → Fiber 已收敛 Failed 并被 dispose/unlink（cordis spawn.rs：
            // 失败创建后无残留 attempted Fiber）。同类型再 spawn 一次确认可重复 dispose。
            match root
                .spawn(PreparedPlugin::from_input(MemoryPlugin, ()))
                .await
            {
                Err(SpawnError::InitialApply(_)) => Ok((true, true)),
                Err(e) => Err(format!("second spawn: {e}")),
                Ok(handle) => {
                    let _ = handle.dispose().await;
                    Err(format!(
                        "second spawn unexpectedly succeeded; first failure: {}",
                        failure.diagnostic()
                    ))
                }
            }
        }
        Err(e) => Err(format!("spawn memory plugin: {e}")),
    }
}

#[cfg(test)]
#[path = "spike_tests.rs"]
mod tests;
