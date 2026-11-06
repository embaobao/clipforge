# Design: plugin-foundation-phase1（插件化底座阶段 1）

> 词汇对齐 Cordis（Context / Plugin / Fiber / Service / Event），实现自持同步小内核；不依赖 cordis-rs。
> 代码基线：`rs-51-clipboard-listener-reliability` 分支（PR #1），行号以该分支为准。

## 1. 目标与非目标

目标：① 监听状态显式化为六态状态机（单一判定入口、迁移即日志、状态事件）；② 域事件收敛为带类型与序号的注册表；③ 五类扩展点契约草案 + 统一 Service Registry 接口定义（雏形）；④ lib.rs 只拆采集/状态域；⑤ TDD 全程红→绿。

非目标：插件沙箱 / manifest / 安装分发（agent-plugin-runtime Phase 2+）、Node sidecar、MCP 工具迁移、window/log/tray 拆分、前端状态可视化、五类功能实现（RS-55~58）。

## 2. 现状盘点（基线代码事实）

### 2.1 监听状态散点（五处，互不知晓）

| 状态 | 位置 | 形态 |
|---|---|---|
| 暂停 | `lib.rs:8309` `LISTEN_PAUSED: AtomicBool` | bool，无历史 |
| 抑制窗口 | `clipboard/suppress.rs` `SUPPRESS_DEADLINE_MS / SUPPRESS_SEQ / SUPPRESS_ACTIVE_LAST` | 截止时间戳 + 序号（RS-51 已时间化） |
| 去重指纹 | `clipboard/dedup.rs` `LAST_FINGERPRINT` | 纯数据 |
| 重连退避 | `clipboard/watcher.rs:59-60` `supervise_watcher` 局部 `backoff_secs / consecutive_quick_exits` | 线程私有，外部不可见「正在重连」 |
| 环境禁用 | `clipboard/watcher.rs:28` `CLIPFORGE_DISABLE_CAPTURE` | 启动读一次，终态 |

### 2.2 判定入口（三处拼判，语义一致但重复）

- watcher 轮询：`watcher.rs:231-237` `process_current_clipboard` 依次 `is_listen_paused()` / `should_skip_writeback()` return；
- manual/startup 采集：`lib.rs:1263-1274` `capture_current_clipboard` 两个检查各返回错误码 `CLIPBOARD_LISTEN_PAUSED` / `CLIPBOARD_WRITEBACK_SUPPRESSED`；
- open_panel 补采：`lib.rs:7986` `if !is_listen_paused() && !should_skip_writeback()`。

### 2.3 事件散点

| 事件 | 发射点 | 序号 |
|---|---|---|
| `clipboard-changed` | `watcher.rs:20` `CHANGE_SEQ` + `AppCaptureSink` | 有（RS-51 P0 3.5） |
| `listen-paused-changed` | `lib.rs:8333` | 无 |
| `agent_agui_event` / `agent_ui_message` | `agent/events.rs:158-159` `emit_agent_agui_event` | 无 |
| `clipforge://*`（show/hide-quick-panel、panel-focus-guard、accessibility-first-prompt） | `lib.rs:7506/8107/8153/8279/4240` | —（窗口 IPC，不属域事件） |

前端消费：`src/clipboard/use-clipboard-list.ts:348` 监听 clipboard-changed，`clipboard-event-gate.ts` 按 `changeCount` 去重；agent 两事件前端零消费（全仓 grep 无 `listen(` 命中）。

## 3. 监听状态机（clipboard/listen_state.rs）

### 3.1 模型：事实 + 纯派生函数 + 单一迁移出口

不搞带 guard 的命令式状态机（六态×多事实组合的 guard 会爆炸）。采用「事实 → 派生」：

```rust
/// 监听域的全部事实（各原属模块仍持有数据，状态机只读派生）
pub(crate) struct ListenFacts {
    pub disabled: bool,               // CLIPFORGE_DISABLE_CAPTURE=1
    pub priming_done: bool,           // 启动静默指纹已写（dedup 有基线）
    pub paused: bool,                 // 原 LISTEN_PAUSED
    pub suppress_deadline_ms: i64,    // 原 suppress.rs 截止（0=无窗口）
    pub watcher_alive: bool,          // supervise_watcher 循环内=start_watch 阻塞中
    pub backoff_secs: u64,            // 当前退避（Reconnecting 事实）
}

pub(crate) enum ListenPhase { Disabled, Priming, Listening, Suppressed { deadline_ms: i64 },
                              Paused, Reconnecting { backoff_secs: u64 } }

/// 纯函数：给定事实与时钟，推导当前相位。优先级从高到低：
/// Disabled > Paused（用户意图） > Reconnecting（无 watcher 一切免谈） > Priming > Suppressed > Listening
pub(crate) fn derive_phase(facts: &ListenFacts, now_ms: i64) -> ListenPhase;
```

要点：

- **Paused 高于 Suppressed**：暂停期间窗口到期不产生迁移事件；恢复时重算——窗口仍在则 `Paused → Suppressed`，否则 `Paused → Listening`。这与现状语义一致（暂停时抑制日志本就不打），但链路可追溯。
- **Suppressed 截止为被动判定**（沿用 suppress.rs 模式）：无定时线程；窗口结束沿由下一次 `recompute()`（轮询 / 判定 / 事件发射时）补迁移与结束日志。
- **watcher 重启回到 Priming**：`supervise_watcher` 每轮循环先 `prime_fingerprint()`（watcher.rs:62），迁移链 `Reconnecting → Priming → Listening`，与现状行为一致、链路显式化。
- **Disabled 是唯一终态**：init 时环境禁用即进，后续不迁移（现状 watcher.rs:28 直接 return）。

### 3.2 迁移表（设计全集，测试按此矩阵写）

| # | from | to | 触发（事实变化） | 日志 reason |
|---|---|---|---|---|
| T1 | — | Disabled | init 时 `CLIPFORGE_DISABLE_CAPTURE=1` | `env-disabled` |
| T2 | — | Priming | init 启动（未禁用） | `startup` |
| T3 | Priming | Listening | priming 完成（dedup 有基线 + watcher 存活） | `primed` |
| T4 | Listening | Suppressed | 写回/粘贴开启抑制窗口 | `suppress-open` |
| T5 | Suppressed | Listening | 时钟越过截止（下次 recompute 补） | `suppress-expired` |
| T6 | Listening | Paused | 暂停命令 | `pause` |
| T7 | Paused | Listening | 恢复且无窗口 | `resume` |
| T8 | Paused | Suppressed | 恢复但窗口未到期 | `resume-suppressed` |
| T9 | Listening/Suppressed | Reconnecting | watcher 退出（start_watch 返回 / init 失败） | `watcher-exit` |
| T10 | Reconnecting | Priming | 退避到点重启（先 prime） | `reconnect` |
| T11 | Reconnecting | Reconnecting | 连续快退（<1s），退避翻倍（自环也记） | `quick-exit` |
| T12 | Suppressed/Reconnecting | Paused | 暂停命令（用户意图最高） | `pause` |
| T13 | Priming | Suppressed | priming 期间写回/粘贴开窗（事实先于 T3） | `suppress-open` |
| T14 | Priming | Paused | priming 期间暂停命令（用户意图最高） | `pause` |

补充组合语义（测试必须覆盖）：T9 在 Suppressed 中发生 → 窗口事实保留，重连成功后若仍在窗口内则经 T3 后进 `Suppressed`（Priming→Suppressed 即 T13 同形）；T12 在 Suppressed 中暂停 → 恢复走 T8；T13/T14 后 priming 完成的事实不再单独迁移（相位已由高优先级占据）。已知边界：Reconnecting 退避睡眠期（1→60s）内无轮询/判定/emit 触发 `recompute()`，`suppress-expired` 的补记最多延迟一个退避周期——派生正确性不受影响（过期后判定结论一致），日志时点以补记为准。

### 3.3 单一判定入口（按调用方分档）

旧三处拼判只看 paused × suppressed 两个事实——watcher 存活与环境禁用**从未**拦过 manual capture / open_panel 补采（watcher 退出或双实例 dev 期间手动采集照样可用）。状态机化不能悄悄收紧这个行为，因此判定入口带路径分档：

```rust
pub(crate) enum CapturePath { Background /* watcher 轮询 */, Manual /* manual capture + open_panel 补采 */ }
pub(crate) enum CaptureGate { Allowed, Denied { reason: CaptureDenyReason } }
pub(crate) enum CaptureDenyReason { Disabled, Paused, Suppressed { deadline_ms: i64 }, NotReady }

/// 四类调用方唯一判定入口（watcher 轮询 / manual capture / open_panel 补采 / 暂停命令内部）
pub(crate) fn can_capture(path: CapturePath, now_ms: i64) -> CaptureGate;
```

- **Background**（watcher `process_current_clipboard`）：六态全判，`Denied` 直接 return（保留 read-error 恢复逻辑位置）。Disabled/NotReady 在该路径本就无采集机会（watcher 没在跑），无行为变化。
- **Manual**（`capture_current_clipboard`、open_panel 补采）：只判 Paused / Suppressed——与旧拼判**严格等价**；`Denied` 映射既有错误码（Paused → `CLIPBOARD_LISTEN_PAUSED`；Suppressed → `CLIPBOARD_WRITEBACK_SUPPRESSED`），**不新增错误码、不拦 watcher 死亡/环境禁用下的手动采集**（现状可用，保持可用）。
- 行为等价性测试：`Manual` 路径 paused × suppressed 全 4 例与旧拼判逐一等价；`Background` 路径对 alive/disabled 两维为声明性覆盖（watcher 不跑 = 无采集，天然一致）。

### 3.4 迁移日志与状态事件

- 迁移日志（统一入口打）：`listen state: seq={迁移序号}, from={旧}, to={新}, reason={上表}, now_ms={时钟}`，context=`clipboard-listen-state`；自环（T11）也记，退避可见。
- 事件 `listen-state-changed` 载荷（additive、camelCase）：`{ seq(总线序号), kind, transitionSeq, from, to, reason, atMs }`。`transitionSeq` 是状态机自己的单调迁移计数（区别于事件总线序号）。
- `ListenPausedPayload` 增 `seq` 字段（additive），`listen-paused-changed` 语义不变。

### 3.5 与 suppress.rs / dedup.rs 的关系（最小改动）

- `suppress.rs` **保留**：继续持有截止窗口事实与窗口级序号，但对外补一个事实读取口（deadline/seq）供 `ListenFacts` 派生；窗口开启/结束沿调用状态机 `recompute()` 产生迁移。不合并进 listen_state.rs（避免单文件超 500 行，且 RS-51 的 3 项窗口测试原位保留）。
- `dedup.rs` 不动（纯数据）。`priming_done` 由「dedup 有基线」派生，不新增重复状态。
- `LISTEN_PAUSED` 迁入 listen_state.rs（作为 `ListenFacts.paused` 的存储），lib.rs 的 static 删除；`set_listen_paused` 统一入口逻辑（日志 + 事件）随迁。

## 4. 时钟注入

```rust
pub(crate) trait Clock: Send + Sync { fn now_ms(&self) -> i64; }
pub(crate) struct SystemClock;                    // 包装现有 now_millis()
#[cfg(test)] pub(crate) struct ManualClock(...);  // 测试推演：set/advance
```

- 作用域**只在监听状态域**：抑制截止判定、迁移 recompute、`can_capture`、状态事件时间戳。`now_millis()` 全局函数不动（其余 40+ 调用点零风险）。
- 进程级注入点：`listen_state::init(SystemClock)`；测试用 `install_test_clock(ManualClock)` + 既有 `TEST_STATE_LOCK` 串行纪律（对齐 dedup/suppress 测试）。
- 量化目标：`realtime_overlap_stays_suppressed_until_max_deadline`（真跑 ~800ms）迁为 ManualClock 推演版本，断言语义不变（450+700 重叠保持到 max deadline），套件耗时 <100ms。

## 5. typed 事件总线（src-tauri/src/events.rs）

### 5.1 注册表

```rust
/// 域事件注册表：名字、类别、载荷类型标识、保留字段（防 additive 注入冲突）
pub(crate) struct EventSpec { pub name: &'static str, pub kind: DomainEventKind,
                              pub reserved: &'static [&'static str] }
pub(crate) enum DomainEventKind { ClipboardChanged, ListenPausedChanged,
                                  ListenStateChanged, AgentAgUiEvent, AgentUiMessage }
pub(crate) const EVENT_REGISTRY: &[EventSpec];   // 五条，编译期常量表
static EVENT_BUS_SEQ: AtomicI64;                 // 总线级单调序号
```

### 5.2 统一发射与 additive 信封

`emit_domain_event(app, kind, payload: Serialize)`：payload 序列化为 `serde_json::Value` 后注入 `seq` / `kind` / `emittedAtMs` 三个顶层键（保留字段在 `EventSpec.reserved` 声明，注册表测试断言无冲突），再 `app.emit(spec.name, value)`；失败落日志。频率评估：五类事件都是「变化才发」（clipboard-changed 仅真实采集、agent 事件仅 run 期间），每事件一次 Value 构造可忽略。

向后兼容（关键决策）：

- `clipboard-changed`：现有字段 `changeCount / hasChange / preview / previewLen` 全保留，`changeCount` 的取值改为**总线序号**（仍严格单调，RS-51 闸门 `seq <= lastSeq` 语义不变）；新增 `seq / kind / emittedAtMs`。前端零改动，类型注释同步。
- `listen-paused-changed` / agent 两事件：additive 加 `seq / kind / emittedAtMs`，现有字段与构造点不变（构造点改调 `emit_domain_event`）。
- 总线序号**跨事件类型单调**：交替发不同类别时 `seq` 仍全局递增——前端可用同一把 seq 给多类事件排序去重（这是「注册表」的核心收益，测试断言）。

### 5.3 不并入清单

`clipforge://*` 窗口控制事件、`accessibility-first-prompt`：窗口 IPC，生命周期属窗口域，不进域事件注册表（写进 spec 防后续随手并入）。

## 6. 服务注册表雏形（src-tauri/src/service_registry.rs）

### 6.1 接口（按盟哥 2026-11-06 反馈升级：更通用 / 好用 / Agent 可迭代 / 测试集成方便）

```rust
/// 扩展点类别 = 开放注册的元数据，不是闭合枚举：新增类别只注册一条 KindDef，
/// 注册表核心零改动（「更通用」的落点）。五类是首批内置 KindDef。
pub(crate) struct ServiceKindDef { pub id: &'static str, pub label_zh: &'static str,
                                   pub contract: &'static str /* 契约说明，内省输出用 */ }
pub mod kinds { /* 内置常量：capture-source / content-processor / paste-action /
                   panel-component / mcp-tool（id 与 6.2 词汇表一一对应） */ }

/// 服务定义：声明式一处填全——id（命名空间见 6.2）、类别、人读描述、
/// capabilities（声明式能力面，agent-plugin-runtime manifest `capabilities` 同词汇，
/// 供 Agent 查询与后续插件授权对齐）。
pub(crate) struct ServiceDef { pub id: String, pub kind: &'static str,
                               pub description: String, pub capabilities: serde_json::Value }

/// 注册可逆（Cordis 语义的宿主侧等价物）：句柄 Drop 即注销，注销即从快照消失。
/// 注册入口做契约校验（validate 同源），非法定义直接 Err，不进表（「好用」：一处声明、
/// 错误当场报，不留半死状态）。
pub(crate) struct ServiceHandle { /* Drop 时反注册 */ }
impl ServiceRegistry {
    pub fn declare_kind(&self, kind: ServiceKindDef);              // 开放类别注册
    pub fn validate(&self, def: &ServiceDef) -> Result<(), ContractError>; // id 命名空间/唯一/kind 已注册/capabilities 可解析
    pub fn register(&self, def: ServiceDef) -> Result<ServiceHandle, ContractError>; // 校验后入表
    pub fn list(&self, kind: Option<&str>) -> Vec<ServiceSnapshot>;       // 快照只读（kind=None 全量）
    pub fn introspect(&self) -> RegistryReport;   // {kinds[], services[]}，Agent 可读的完整能力面
}
```

- **Agent 可迭代的接入口**：新增 additive Tauri command `list_services`（返回 `introspect()` 的 JSON 快照）。它成为能力面的**单一事实源**：RS-55/56/57 实例提案、设置页清单、以及 agent-plugin-runtime 的 `powerpack.scaffold`（返回「当前能力/事件清单」，Agent 生成插件前先查能力面）都从这一个快照取数——Agent 的「生成 → 查能力面 → 校验 → 迭代」环不再各自拼清单。
- **测试集成方便**：`service_registry::contract` 契约测试模板——四步固定断言（`validate` 拒非法 → `register` 成功 → `introspect` 可见且 capabilities 保留 → 句柄 Drop 后消失）。任何新扩展点实例（含 dogfood 两例）套同一模板即得契约回归；Agent 生成的插件在安装前的 dry-run 校验（plugin-runtime `powerpack.validate` 环节）复用同一 `validate` 语义，宿主与插件一个校验口径。
- 阶段 1 仍不为五类各定义完整执行 trait（只有 dogfood 两处有行为；其余是**契约草案**——KindDef 契约说明 + 与 seams/plugin-runtime 的签名对齐记录）。这是刻意的：trait 先于消费者定型会变成第二套猜测（RS-52 父 issue 已定「RS-54 契约定稿后逐个 promote RS-55/56/57 出提案」，实例提案落地时补各自 trait 的执行面；KindDef.contract 字段就是给实例提案填正式契约的位置）。

### 6.2 词汇对齐（不另起第二套词；引用 `openspec/changes/agent-plugin-runtime/docs/EXTENSION_MODEL.md`）

| 内置 kind（首批 KindDef） | 既有词汇 / 命名空间 | 阶段 1 状态 |
|---|---|---|
| CaptureSource 采集源 | 新增宿主域词汇（信任档=内建受信） | dogfood：内置剪贴板轮询采集源注册 |
| ContentProcessor 内容处理器 | RS-55 tag / RS-56 OCR 的挂点（L3 智能标签层） | 仅契约（kind + 注释） |
| PasteAction 粘贴动作 | 内建内容动作（`src/plugin-actions.ts` 的 `builtin` 档动作清单；其 MCP 暴露口是 `clipboard.plugin.list/call` 两条工具，`mcp/specs.rs:246-251`） | dogfood：内建动作清单只读注册 |
| PanelComponent 面板组件 | agent-plugin-runtime UI 插槽（quick-panel-button / agent-tab） | 仅契约 |
| McpTool MCP 工具 | seams 工具同源注册表（`tool_specs()/dispatch()`）+ `plugin.<包名>.<工具名>` 动态口 | 仅契约 + adapter 签名记录 |

**与 seams 的合并接口**（接口定义层面合并，实施分步）：seams Phase A 的每域 `tool_specs() -> Vec<McpToolSpec>` + `dispatch(name, args) -> Result<Value, String>` 即 `mcp-tool` kind 的第一个正式执行面；本提案在 service_registry.rs 记录 adapter 函数签名 `fn mcp_tool_service(specs: &[McpToolSpec]) -> ServiceDef`（41 条宿主 specs 以**只读清单**挂到注册表，capabilities 携带来源标记 `host-specs`，`introspect()` 与 Agent 查询可见），**不改** `mcp/mod.rs` 路由、golden 计数与 dispatch。插件动态口（plugin-runtime Phase 2 registry）未来以同形 ServiceDef 接入，不消耗 seams 同源计数（seams proposal.md:22 边界原文遵守）。

### 6.3 dogfood（证明注册表活着的最小集；两例都跑 §6.1 契约测试模板）

1. 内置采集源：`clipboard::watcher::init` 成功路径注册 `capture.clipboard.poll`（Disabled 则不注册——「不注册=能力不存在」与 manifest 能力沙箱语义同构）；capabilities 声明轮询周期与支持格式；注册/注销打日志。
2. 内建粘贴动作：启动时把 `src/plugin-actions.ts` 既有动作清单以只读 ServiceDef 集（`paste-action`）注册，供 `introspect()` 与后续设置页/工具清单消费（消解 `settings/mcp-tool-catalog.ts` 式第三份镜像漂移的先例教训：清单从注册表快照生成，不再手抄）。

## 7. lib.rs 域拆分范围

### 7.1 迁入清单（lib.rs → 目标模块）

| 符号（lib.rs 现址） | 去向 |
|---|---|
| `LISTEN_PAUSED` / `is_listen_paused` / `set_listen_paused` / `ListenPausedPayload` / `get_clipboard_listen_paused` / `set_clipboard_listen_paused`（8300-8360 一带） | `clipboard/listen_state.rs`（command 保留 `#[tauri::command]`，`generate_handler` 改引用模块路径；modularity Phase 3 settings_service/commands.rs 先例） |
| `capture_current_clipboard`（1257-1300） | `clipboard/`（新文件或 listen_state.rs，行数定） |
| open_panel 补采段（7986-8006） | 提取 `clipboard::capture_before_panel_open()`，open_panel 调用（open_panel 主体不迁） |
| `ClipboardChangePayload`（555-565）与 emit 构造 | `events.rs`（watcher.rs 改 import） |
| suppress 调用点（798/839 写回与粘贴路径） | 调用点不动，`suppress_writeback_for` 签名不变（内部转事实+recompute） |

### 7.2 「不拆」清单（防范围蔓延，测试不触碰）

window/log/tray（含 `open_panel` 主体、quick-panel emit、`panel-focus-guard`）、搜索与查询 commands（`search_clip_records` / `load_clip`）、settings 全域、`agent/` 与 `mcp/` 已拆域（agent/events.rs 只改 emit 调用行）、OCR / diagnostics / context_collectors、写回与粘贴主链路 commands（仅抑制调用语义经状态机不变）。modularity Phase 6（window/log/tray）不因本提案提前或延后。

### 7.3 与 TASK-8 并行（硬约束执行方式）

独立 worktree + 新分支；只 stage 7.1 清单文件；`lib.rs` 按 hunk 隔离提交（只含迁移 hunks，绝不夹带 TASK-8 未提交改动）；提交前 `git diff --stat` 复核。基线声明：本提案实施 PR 基于 PR #1 合并后的 main，PR 描述注明本地 main 领先 origin 的提交数事实（沿用 RS-51 PR 惯例）。

## 8. 与在途提案的边界

| 提案 | 关系 |
|---|---|
| clipboard-listener-reliability（RS-51，PR #1） | 直接前置：其 7 项可靠性测试是回归底线；suppress.rs/dedup.rs 原位保留为事实提供方 |
| agent-extension-seams（已触发实施） | McpTool 扩展点 = 其同源注册表接口的宿主侧泛化；adapter 只读清单不碰其 specs/golden/计数；seams Phase A 实施时以本注册表接口为汇合点 |
| agent-plugin-runtime（Phase 1 已过闸） | 上位愿景：其 Phase 2 registry / 四类注册类型（工具/事件/UI/提示词模板）是**插件侧**注册表；本提案是**宿主侧**统一注册表，五类 kind 承接其注册类型的宿主落点；事件信封（其 design §6）与本总线对齐时以 additive 字段演进 |
| codebase-modularity-refactor | 只拆采集/状态域（7.1），其 Phase 6（收尾阶段）的 window/log/tray 拆分债不动；豁免清单只减不增（lib.rs 仍在豁免内，track 不变） |
| RS-53 提示词优化（并行 P0） | 不依赖本提案（依托现有 agent/pi 域）；文件面不重叠（其改 `src/agent/pi/`，本提案改 `src-tauri` 采集域 + `use-clipboard-list.ts`） |

## 9. TDD 计划（先红测后实现）

红测清单（实现前落库，全部先失败）：

1. **状态机迁移矩阵**（listen_state_tests.rs）：§3.2 表 T1-T14 每条 ≥1 用例 + 组合语义（Suppressed 中 watcher 退出→重连回窗口、Suppressed 中暂停→恢复走 T8、暂停期间窗口到期无迁移事件、Priming 期间开窗/暂停走 T13/T14）。
2. **判定入口等价**：Manual 路径 paused × suppressed 全 4 例与旧拼判严格等价；Background 路径对 alive/disabled 为声明性覆盖（watcher 不跑=无采集）。
3. **迁移日志与事件**：每次迁移一条 `listen state` 日志（seq 单调）+ 一次 `listen-state-changed` emit；无迁移的事实变化不 emit。
4. **总线序号单调**：交替 emit 五类事件断言 `seq` 全局严格递增；`changeCount == seq`；保留字段冲突检测（注册表自检测试）。
5. **时钟推演**：ManualClock 复现 450+700 重叠到 max deadline（迁移自 `realtime_overlap_stays_suppressed_until_max_deadline`，断言语义不变）；退避翻倍（T11）纯推演。
6. **注册表契约模板**：四步断言（validate 拒非法 → register 成功 → introspect 可见且 capabilities 保留 → 句柄 Drop 消失）；五类内置 KindDef 清单稳定；新增类别零核心改动；`list_services` 快照与 introspect 一致；MCP 只读 adapter 的 `list(mcp-tool)` 数 = 41。
7. **回归底线**：RS-51 7 项可靠性测试（`ten_startups…` / `overlapping_windows…` / `capture_failure_keeps…` / `content_changes_map…` / 前端风暴闸门等）全绿——允许迁移文件位置与 import，**不允许删改断言语义**；`cargo test --lib` 总数不低于基线 56。

## 10. 量化门禁

| 门禁 | 判据 |
|---|---|
| cargo test --lib | ≥56 passed / 0 failed（基线 56/1 ignored） |
| 抑制窗口测试套耗时 | <100ms（原真 sleep ~800ms；`cargo test --lib -- --nocapture` 时间戳取证） |
| lib.rs 行数 | 只减不增，净减 ≥100 行（含模块声明与 handler 引用增行的净口径；§7.1 迁移量估算 ~130 行） |
| verify-file-size | fail=0；新增文件全部 ≤500 行（含注释与测试） |
| 事件兼容 | `pnpm test:unit`（含 verify-clipboard-listener.mjs 50 事件风暴 ≤2 刷新）全绿 |
| 索引与文档 | BUSINESS_INDEX 新增三模块行；`pnpm locate --check-index` 通过 |
| 提案门禁 | `openspec validate plugin-foundation-phase1 --strict` |
| 工程 | `cargo check` 0 error；`pnpm build` 通过 |

## 11. 风险与缓解

- **状态机重构引入回归**：纯派生函数 + Manual 路径 4 例严格等价 + Background 声明性覆盖 + RS-51 测试底线；行为差异即时暴露。
- **lib.rs 与 TASK-8 冲突**：worktree + hunk 隔离 + 提交前 diff 复核（§7.3）；实施排 PR #1 合并后，冲突面进一步缩小。
- **cordis 依赖蔓延**：spec 冻结「listen_state/events/service_registry 不得 import cordis」，测试期用 grep 断言（可挂 test:unit）。
- **事件信封 additive 注入冲突**：`EventSpec.reserved` 注册表自检测试。
- **seams Phase A 未实施导致 adapter 悬空**：adapter 只是只读清单 + 签名记录，零行为耦合；seams 落地时按其最终签名对齐（一处改动）。
- **ManualClock 进程级注入的测试串行**：沿用 `TEST_STATE_LOCK` 纪律（dedup/suppress 同模式），测试文档注明。
