//! spike 桥接实现（从 spike.rs 按 500 行门禁切出）：JS fixture、四组接口桥、事件分发。
//! 语义与内联时期一致；spike.rs 只留编排（Fiber 生命周期 + episode 收敛）。

use std::sync::{Arc, Mutex};

use rquickjs::{function::MutFn, Ctx, Exception, Function, Object, Value};


/// 探针计数：桥接每次真实命中（Rust 侧 closure 被调用）即 +1。
///
/// `listener_drops` 记录 `ctx.on` 注册时的清理闭包被调用的次数——桥把 JS 回调存进
/// Rust 侧 `Vec`，dispose 前显式清空并计数，用来断言「监听随 Fiber 世代一并回收」
/// （design §3：无手动 unregister，dispose 一并回收全部注册项）。
#[derive(Default)]
pub(super) struct BridgeProbes {
    pub(super) search_calls: u32,
    pub(super) read_calls: u32,
    pub(super) on_subscribes: u32,
    pub(super) tool_registers: u32,
    pub(super) template_registers: u32,
    pub(super) log_calls: u32,
    pub(super) event_dispatches: u32,
    pub(super) listener_drops: u32,
    /// `ctx.on` 注册的事件名清单：dispose 等价观测时清空并计数（design §3）。
    pub(super) listeners: Vec<String>,
    pub(super) tool_name: String,
    pub(super) template_name: String,
    pub(super) logged: bool,
}

/// JS fixture：activate 语义入口。四组接口各调一次，返回桥接观测值。
///
/// 对应 design §3 的 ESM 生命周期（`activate(ctx)` / `deactivate(ctx)`）；spike 不加载
/// 真实模块，用「全局挂 ctx + eval 入口函数」的等价路径验证同一组桥。
const SPIKE_JS: &str = r#"
(function activateSpike(ctx) {
  var search = ctx.clipf.search({ q: "spike" });
  var read = ctx.clipf.read({ id: "1" });
  ctx.on("clip.updated", function (envelope) { __probe_listener_hits.push(envelope); });
  var toolName = ctx.register.tool({ name: "spike-tool", description: "spike", handler: function () { return 1; } });
  var templateName = ctx.register.template({ name: "spike-tpl", text: "hi" });
  var logged = ctx.log.info("spike activate");
  return {
    search: search,
    read: read,
    toolName: toolName,
    templateName: templateName,
    logged: logged
  };
})
"#;

/// 在给定 Ctx 上桥四组接口并执行 JS fixture。
pub(super) async fn bridge_and_call(
    ctx: Ctx<'_>,
    probes: Arc<Mutex<BridgeProbes>>,
) -> rquickjs::Result<bool> {
    let globals = ctx.globals();
    // JS 侧回调命中容器：桥把 `ctx.on` 的 JS 回调存到全局数组，事件分发时调用。
    globals.set("__probe_listener_hits", rquickjs::Array::new(ctx.clone())?)?;

    // ctx 顶层对象
    let ctx_obj = Object::new(ctx.clone())?;

    // ---- 组 1：ctx.clipf.* 能力对象（stub 假数据）----
    // 同步闭包即可：stub 返回字符串本身（Async 存根会返回 Promise，fixture 拿不到
    // 字符串结果）；参数收 Object 再取字段，对齐 design §4 的「spec 对象入参」形状。
    let clipf = Object::new(ctx.clone())?;
    {
        let p = probes.clone();
        clipf.set(
            "search",
            Function::new(
                ctx.clone(),
                MutFn::new(move |spec: Object<'_>| {
                    let q: String = spec.get("q").unwrap_or_default();
                    let mut g = p.lock().unwrap();
                    g.search_calls += 1;
                    Ok::<_, rquickjs::Error>(format!("stub-search:{q}"))
                }),
            )?,
        )?;
        let p = probes.clone();
        clipf.set(
            "read",
            Function::new(
                ctx.clone(),
                MutFn::new(move |spec: Object<'_>| {
                    let id: String = spec.get("id").unwrap_or_default();
                    let mut g = p.lock().unwrap();
                    g.read_calls += 1;
                    Ok::<_, rquickjs::Error>(format!("stub-read:{id}"))
                }),
            )?,
        )?;
    }
    ctx_obj.set("clipf", clipf)?;

    // ---- 组 2：ctx.on（事件订阅，仅已声明事件名生效）----
    // MutFn/闭包要求 'static，不能捕获 'js 的 Array：JS 回调容器的维护放到 JS shim
    // （push 进 __probe_listener_hits），Rust 侧只留订阅计数钩子（捕获 'static Arc）。
    {
        let p = probes.clone();
        let on_subscribe = Function::new(
            ctx.clone(),
            MutFn::new(move |name: String| {
                let mut g = p.lock().unwrap();
                g.on_subscribes += 1;
                g.listeners.push(name);
                Ok::<_, rquickjs::Error>(())
            }),
        )?;
        globals.set("__probe_on_subscribe", on_subscribe)?;
        let on: Function<'_> = ctx.eval(
            r#"(function (name, cb) {
                 if (name !== "clip.updated") { return; }
                 __probe_on_subscribe(name);
                 __probe_listener_hits.push(cb);
               })"#,
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
                g.tool_name = name.clone();
                // 回传注册名，fixture 借返回值验证桥接往返。
                Ok::<_, rquickjs::Error>(name)
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
                g.template_name = name.clone();
                Ok::<_, rquickjs::Error>(name)
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
                Ok::<_, rquickjs::Error>(true)
            }),
        )?;
        log.set("info", info)?;
    }
    ctx_obj.set("log", log)?;

    globals.set("ctx", ctx_obj)?;

    // JS 侧 fixture：activate 语义入口，四组各调一次。Ctx 本体不是 JS 值，
    // 传回桥接好的 ctx 对象（globals 里那份）。
    let activate: Function<'_> = ctx.eval(SPIKE_JS)?;
    let ctx_arg: Object = globals.get("ctx")?;
    let result: Value = activate.call((ctx_arg,))?;
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
pub(super) fn dispatch_probe_event(ctx: Ctx<'_>, probes: &Arc<Mutex<BridgeProbes>>) {
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

/// 在 64KB limit 下反复分配大数组直到引擎抛 OOM。返回是否观测到超限异常。
pub(super) async fn burn_memory(ctx: Ctx<'_>) -> rquickjs::Result<bool> {
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
