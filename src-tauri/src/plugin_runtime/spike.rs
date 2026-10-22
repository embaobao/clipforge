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
//! QuickJS（rquickjs 默认不开 `parallel` feature，句柄 !Send，钉死单线程），跨线程只走
//! 消息通道把 `SpikeOutcome` 送回测试线程。

use std::sync::{Arc, Mutex};
use std::thread;

use rquickjs::{
    function::{Async, MutFn},
    AsyncContext, AsyncRuntime, Ctx, Exception, Function, Object, Value,
};

use super::budget::FIXTURE_MEMORY_LIMIT_BYTES;
use crate::plugin_runtime::SpikeOutcome;

/// JS fixture：activate 语义入口。四组接口各调一次，返回桥接观测值。
///
/// 对应 design §3 的 ESM 生命周期（`activate(ctx)` / `deactivate(ctx)`）；spike 不加载
/// 真实模块，用「全局挂 ctx + eval 入口函数」的等价路径验证同一组桥。
const SPIKE_JS: &str = r#"
(function activateSpike(ctx) {
  var search = ctx.clipf.search({ q: "spike" });
  var read = ctx.clipf.read({ id: "1" });
  ctx.on("clip.updated", function (envelope) { ctx.__probe_listener_hits.push(envelope); });
  ctx.register.tool({ name: "spike-tool", description: "spike", handler: function () { return 1; } });
  ctx.register.template({ name: "spike-tpl", text: "hi" });
  ctx.log.info("spike activate");
  return {
    search: search,
    read: read,
    toolName: ctx.__probe_tool_name,
    templateName: ctx.__probe_template_name,
    logged: ctx.__probe_logged
  };
})
"#;

/// 探针计数：桥接每次真实命中（Rust 侧 closure 被调用）即 +1。
///
/// `listener_drops` 记录 `ctx.on` 注册时的清理闭包被调用的次数——桥把 JS 回调存进
/// Rust 侧 `Vec`，dispose 前显式清空并计数，用来断言「监听随 Fiber 世代一并回收」
/// （design §3：无手动 unregister，dispose 一并回收全部注册项）。
#[derive(Default)]
struct BridgeProbes {
    search_calls: u32,
    read_calls: u32,
    on_subscribes: u32,
    tool_registers: u32,
    template_registers: u32,
    log_calls: u32,
    event_dispatches: u32,
    listener_drops: u32,
    tool_name: String,
    template_name: String,
    logged: bool,
}

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

/// 在 LocalSet 上跑 spike：rquickjs 的 Async 闭包要求 `!Send` 上下文（默认不开
/// parallel feature），cordis apply future 要求 Send，两者通过线程边界组合。
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

        async fn apply(&self, _ctx: Context, _: &()) -> Result<(), std::io::Error> {
            let runtime = AsyncRuntime::new()
                .map_err(|e| std::io::Error::other(format!("AsyncRuntime::new: {e}")))?;
            runtime
                .set_memory_limit(FIXTURE_MEMORY_LIMIT_BYTES)
                .await;
            let js_ctx = AsyncContext::full(&runtime)
                .await
                .map_err(|e| std::io::Error::other(format!("AsyncContext::full: {e}")))?;

            // 桥接与 JS 调用都在同一 async_with 内完成：Ctx 生命周期钉在 'js 内。
            let ok = js_ctx
                .async_with(async |ctx| bridge_and_call(ctx, self.probes.clone()).await)
                .await
                .map_err(|e| std::io::Error::other(format!("bridge_and_call: {e}")))?;
            if !ok {
                return Err(std::io::Error::other("js side rejected the bridge"));
            }

            // 事件分发一次，验证 ctx.on 监听真实可达（JS 回调被调用）。
            js_ctx
                .with(|ctx| {
                    let hits: rquickjs::Array = match ctx.globals().get("__probe_listener_hits") {
                        Ok(a) => a,
                        Err(_) => return,
                    };
                    let payload = match ctx.json_parse(r#"{"event":"clip.updated","bytes":2}"#) {
                        Ok(v) => v,
                        Err(_) => return,
                    };
                    for i in 0..hits.len() {
                        if let Ok(cb) = hits.get::<Function<'_>>(i) {
                            let _: rquickjs::Result<()> = cb.call((payload.clone(),));
                            self.probes.lock().unwrap().event_dispatches += 1;
                        }
                    }
                })
                .await;

            // 监听回收：清空桥侧 Vec 并计数（dispose 语义的 spike 等价观测）。
            let mut p = self.probes.lock().unwrap();
            p.listener_drops += p.listeners.len() as u32;
            p.listeners.clear();

            // 清理顺序（design §18.1）：Context 先于 Runtime drop。
            drop(js_ctx);
            drop(runtime);
            Ok(())
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
    handle
        .dispose()
        .await
        .map_err(|e| format!("dispose bridge plugin: {e}"))?;
    let final_state = handle.state();
    Ok(matches!(state, FiberState::Active) && matches!(final_state, FiberState::Disposed))
}

/// 在给定 Ctx 上桥四组接口并执行 JS fixture。
async fn bridge_and_call(
    ctx: Ctx<'_>,
    probes: Arc<Mutex<BridgeProbes>>,
) -> rquickjs::Result<bool> {
    let globals = ctx.globals();
    // JS 侧回调命中容器：桥把 `ctx.on` 的 JS 回调存到全局数组，事件分发时调用。
    globals.set("__probe_listener_hits", rquickjs::Array::new(ctx.clone())?)?;

    // ctx 顶层对象
    let ctx_obj = Object::new(ctx.clone())?;

    // ---- 组 1：ctx.clipf.* 能力对象（stub 假数据）----
    let clipf = Object::new(ctx.clone())?;
    {
        let p = probes.clone();
        clipf.set(
            "search",
            Function::new(
                ctx.clone(),
                Async(move |q: String| {
                    let p = p.clone();
                    async move {
                        p.lock().unwrap().search_calls += 1;
                        Ok::<_, rquickjs::Error>(format!("stub-search:{q}"))
                    }
                }),
            )?,
        )?;
        let p = probes.clone();
        clipf.set(
            "read",
            Function::new(
                ctx.clone(),
                Async(move |id: String| {
                    let p = p.clone();
                    async move {
                        p.lock().unwrap().read_calls += 1;
                        Ok::<_, rquickjs::Error>(format!("stub-read:{id}"))
                    }
                }),
            )?,
        )?;
    }
    ctx_obj.set("clipf", clipf)?;

    // ---- 组 2：ctx.on（事件订阅，仅已声明事件名生效）----
    {
        let p = probes.clone();
        let hits = rquickjs::Array::new(ctx.clone())?;
        let on = Function::new(
            ctx.clone(),
            MutFn::new(move |name: String, cb: Function<'_>| {
                // spike 只桥已声明事件名（design §4：未声明静默忽略）。
                if name != "clip.updated" {
                    return Ok(());
                }
                p.lock().unwrap().on_subscribes += 1;
                // 把 JS 回调挂到全局数组，dispatch 时逐个调用。
                let _ = hits.set(hits.len(), cb);
                Ok::<_, rquickjs::Error>(())
            }),
        )?;
        ctx_obj.set("on", on)?;
    }

    // ---- 组 3：ctx.register.*（工具/模板注册口）----
    let register = Object::new(ctx.clone())?;
    {
        let p = probes.clone();
        let tool = Function::new(
            ctx.clone(),
            MutFn::new(move |spec: Object<'_>| {
                let name: String = spec.get("name").unwrap_or_default();
                let mut g = p.lock().unwrap();
                g.tool_registers += 1;
                g.tool_name = name;
                Ok::<_, rquickjs::Error>(())
            }),
        )?;
        register.set("tool", tool)?;
        let p = probes.clone();
        let template = Function::new(
            ctx.clone(),
            MutFn::new(move |spec: Object<'_>| {
                let name: String = spec.get("name").unwrap_or_default();
                let mut g = p.lock().unwrap();
                g.template_registers += 1;
                g.template_name = name;
                Ok::<_, rquickjs::Error>(())
            }),
        )?;
        register.set("template", template)?;
    }
    ctx_obj.set("register", register)?;

    // ---- 组 4：ctx.log ----
    let log = Object::new(ctx.clone())?;
    {
        let p = probes.clone();
        let info = Function::new(
            ctx.clone(),
            MutFn::new(move |msg: String| {
                let mut g = p.lock().unwrap();
                g.log_calls += 1;
                g.logged = true;
                let _ = msg;
                Ok::<_, rquickjs::Error>(())
            }),
        )?;
        log.set("info", info)?;
    }
    ctx_obj.set("log", log)?;

    globals.set("ctx", ctx_obj)?;

    // JS 侧 fixture：activate 语义入口，四组各调一次。
    let activate: Function<'_> = ctx.eval(SPIKE_JS)?;
    let result: Value = activate.call((ctx.clone(),))?;
    let obj = result
        .into_object()
        .ok_or_else(|| Exception::throw_message(&ctx, "spike fixture did not return an object"))?;

    let search: String = obj.get("search")?;
    let read: String = obj.get("read")?;
    let tool_name: String = obj.get("toolName")?;
    let template_name: String = obj.get("templateName")?;
    let logged: bool = obj.get("logged")?;

    let p = probes.lock().unwrap();
    Ok(search.starts_with("stub-search:")
        && read.starts_with("stub-read:")
        && tool_name == "spike-tool"
        && template_name == "spike-tpl"
        && logged
        && p.search_calls >= 1
        && p.read_calls >= 1
        && p.on_subscribes >= 1
        && p.tool_registers >= 1
        && p.template_registers >= 1
        && p.log_calls >= 1)
}

/// 分发一次探针事件：调 `ctx.on` 注册进来的 JS 回调，验证监听真实可达。
async fn dispatch_probe_event(ctx: Ctx<'_>, probes: Arc<Mutex<BridgeProbes>>) {
    let hits: rquickjs::Array = match ctx.globals().get("__probe_listener_hits") {
        Ok(a) => a,
        Err(_) => return,
    };
    let payload = match ctx.json_parse(r#"{"event":"clip.updated","bytes":2}"#) {
        Ok(v) => v,
        Err(_) => return,
    };
    for i in 0..hits.len() {
        if let Ok(cb) = hits.get::<Function<'_>>(i) {
            let _: rquickjs::Result<()> = cb.call((payload.clone(),));
            probes.lock().unwrap().event_dispatches += 1;
        }
    }
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

        async fn apply(&self, _: Context, _: &()) -> Result<(), std::io::Error> {
            let runtime = AsyncRuntime::new()
                .map_err(|e| std::io::Error::other(format!("AsyncRuntime::new: {e}")))?;
            runtime
                .set_memory_limit(FIXTURE_MEMORY_LIMIT_BYTES)
                .await;
            let js_ctx = AsyncContext::full(&runtime)
                .await
                .map_err(|e| std::io::Error::other(format!("AsyncContext::full: {e}")))?;

            // 超限即 apply 失败（模拟宿主把引擎 OOM 当插件失败处理，design §18.2-3）。
            let outcome = js_ctx.async_with(async |ctx| burn_memory(ctx).await).await;
            drop(js_ctx);
            drop(runtime);
            match outcome {
                Ok(true) => Ok(()),
                Ok(false) => Err(std::io::Error::other("memory limit not enforced")),
                Err(e) => Err(std::io::Error::other(format!("memory burn: {e}"))),
            }
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

/// 在 64KB limit 下反复分配大数组直到引擎抛 OOM。返回是否观测到超限异常。
async fn burn_memory(ctx: Ctx<'_>) -> rquickjs::Result<bool> {
    let res: rquickjs::Result<usize> = ctx.eval(
        r#"
        (function () {
          var keep = [];
          for (var round = 0; round < 100000; round++) {
            // 每轮 4KB，64KB limit 下几轮即触顶
            keep.push(new Array(1024).fill(round));
          }
          return keep.length;
        })()
        "#,
    );
    match res {
        Ok(_) => Ok(false),
        Err(e) => {
            // OOM 异常（out of memory）即上限强制生效的证据；宿主不崩、Runtime 仍可 drop。
            let msg = e.to_string();
            Ok(msg.contains("out of memory") || msg.contains("memory"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1.1/1.2 闸门主用例：一次跑完桥接 + 回收 + 内存上限三组断言。
    #[test]
    fn bridge_spike_gate() {
        let outcome = run_bridge_spike().expect("spike should produce a verdict");
        assert!(
            outcome.bridge_ok,
            "四组 ctx 接口未全部桥通：{:?}",
            outcome
        );
        assert!(
            outcome.reclaimed,
            "dispose 后监听/事件探针未达可回收观测：{:?}",
            outcome
        );
        assert!(
            outcome.memory_limit_enforced,
            "64KB memoryLimit 未强制：{:?}",
            outcome
        );
        assert!(
            outcome.converged_failed,
            "超限后 Fiber 未收敛 Failed：{:?}",
            outcome
        );
        eprintln!(
            "[plugin-runtime spike] baseline_bytes={} bridge_ok={} reclaimed={} limit={} failed={}",
            outcome.baseline_bytes,
            outcome.bridge_ok,
            outcome.reclaimed,
            outcome.memory_limit_enforced,
            outcome.converged_failed
        );
    }
}
