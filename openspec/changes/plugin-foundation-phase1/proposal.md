# 提案：插件化底座阶段 1——内核域服务化（plugin-foundation-phase1）

> 状态：**草案，待盟哥确认后实施（RS-54，2026-11-06）**。本阶段只交付提案，不改产品代码；确认后按「一 issue 一 PR」实施。
> 触发：RS-52 路线图 P1a；架构调研（DSH / Cordis / cordis-rs 评估、「Rust 宿主内核域服务化 + 统一 Service Registry + 可选 Node sidecar」三层决策）见 RS-51 讨论串 2026-11-06 结论。
> 基线：`rs-51-clipboard-listener-reliability` 分支（PR #1）——本提案是其直接后继，实施排在 PR #1 合并之后。

## Why

RS-51 已修复监听可靠性（判定已收敛、指纹共享、退避重连、事件带序号），但三个结构性问题没有解决：

1. **状态散在五处，没有统一的家**：暂停 = `lib.rs` `LISTEN_PAUSED` bool（lib.rs:8309）；抑制窗口 = `clipboard/suppress.rs` 截止时间戳；去重指纹 = `clipboard/dedup.rs`；重连退避 = `watcher.rs` `supervise_watcher` 私有变量（watcher.rs:59-60）；环境禁用 = 启动读一次 `CLIPFORGE_DISABLE_CAPTURE`（watcher.rs:28）。前端与日志都无法回答「监听现在到底处于什么状态、为什么没采」。
2. **事件各发各的**：`clipboard-changed`（watcher.rs，带序号）、`listen-paused-changed`（lib.rs:8333，无序号）、`agent_agui_event` / `agent_ui_message`（agent/events.rs:158-159，无序号）——名字是散落的字符串字面量，只有 clipboard-changed 有单调序号；前端无法跨事件类型去重排序。agent 两个事件当前在 `src/` 前端**零消费**（全仓 grep 无监听点），收敛时顺带建立可发现的注册表。
3. **五大功能没有公共载体**：自动 tag（RS-55）、OCR（RS-56）、Agent 悬浮窗（RS-57）、TODO（RS-58）全都需要「内容处理器 / 面板组件 / MCP 工具」类挂点；接口不先定稿，四个子提案就会各自发明（RS-52 依赖图已把本提案定为它们的契约源）。

对齐 Cordis 模型（Context / Plugin / Fiber / Service / Event，注册皆可逆效应），但**宿主内核域不依赖 pre-freeze 的 cordis-rs**——cordis-rs 已被 `agent-plugin-runtime` 精确 pin（`cordis-rs = "=0.11.1"`）且红线限定在 `plugin_runtime` 模块内做 JS 沙箱；本提案的监听状态机 / 事件总线 / 服务注册表是宿主内核域的同步小内核（几百行 Rust），词汇对齐、实现自持，后续可整体替换实现而不动插件层。

## What（建议范围）

### 1. 监听状态机（clipboard/listen_state.rs）

六态 `Disabled / Priming / Listening / Suppressed(带截止窗口) / Paused / Reconnecting`：

- **单一判定入口** `can_capture()`（按调用方分档）：watcher 轮询（watcher.rs:231-237）、manual capture（lib.rs:1263-1274）、open_panel 补采（lib.rs:7986）、暂停命令全部走它，替代现在三处各自 `is_listen_paused() + should_skip_writeback()` 拼判；后台轮询六态全判，手动路径只判暂停/抑制——「watcher 不在跑时手动采集仍可用」的现状行为保持不变；
- **迁移即日志**：每次状态迁移打一条带序号的 `listen state: seq=…, from=…, to=…, reason=…`，整条状态流在日志里连成链；
- **`listen-state-changed` 事件**：面板可显示「监听中 / 已暂停 / 抑制窗口内 / 重连中」；
- **统一时钟注入**（`Clock` trait + `ManualClock`）：抑制截止、退避、迁移判定全走同一时钟源，测试从秒级真跑变毫秒级推演（现 `realtime_overlap_stays_suppressed_until_max_deadline` 真睡 800ms+）。

### 2. typed 事件总线（src-tauri/src/events.rs）

五个域事件收敛为带类型与序号的注册表：`clipboard-changed`、`listen-paused-changed`、`listen-state-changed`（新增）、`agent_agui_event`、`agent_ui_message`。总线级单调序号 `seq` + `kind` 以 **additive 字段**注入每类事件载荷（现有前端监听零改动；`changeCount` 保留为 bus seq 的别名，语义向后兼容 RS-51 闸门）。`clipforge://*` 窗口控制事件（show/hide quick-panel、panel-focus-guard、accessibility-first-prompt）**不并入**——它们是窗口 IPC，不是域事件。

### 3. 服务注册表雏形（src-tauri/src/service_registry.rs）——按盟哥反馈升级：更通用 / 好用 / Agent 可迭代 / 测试集成方便

- **更通用**：扩展点类别是开放注册的元数据（`KindDef`），不是闭合枚举——首批五类（采集源 / 内容处理器 / 粘贴动作 / 面板组件 / MCP 工具）之外，新增类别只注册一条 KindDef，注册表核心零改动；词汇与 `agent-extension-seams` 工具同源注册表、`agent-plugin-runtime`「四类注册类型 + 信任四档」（`openspec/changes/agent-plugin-runtime/docs/EXTENSION_MODEL.md`）对齐（对应关系见 design §6.2，不另起第二套词）。
- **好用**：服务一处声明式注册（id / 类别 / 描述 / `capabilities` 能力面），注册即校验（非法 id、未注册类别当场报错），句柄 Drop 即注销（Cordis「可逆注册」宿主侧等价物）。
- **Agent 可迭代**：新增 additive command `list_services` 返回完整能力面快照（类别 + 服务 + capabilities），作为能力面**单一事实源**——RS-55/56/57 实例提案、设置页清单、`powerpack.scaffold` 的「当前能力清单」都从它取数，Agent 生成→查能力面→校验→迭代的环不再各自拼清单。
- **测试集成方便**：`validate` 契约校验 + 四步契约测试模板（拒非法 → 注册成功 → introspect 可见 → 注销消失），新扩展点实例套模板即得契约回归；与插件安装前 dry-run 校验同一口径。
- 阶段 1 落两个 dogfood（内置剪贴板采集源、内建粘贴动作只读清单）；41 条 MCP specs 只挂只读清单不迁移、插件动态口 `plugin.<包名>.<工具名>` 不动；五类完整执行 trait 留给实例提案（KindDef 契约字段即正式契约的落位）。

### 4. lib.rs 域拆分范围（只拆采集/状态域）

仅采集 / 抑制 / 暂停 / 事件相关函数迁入 `clipboard/` 模块与 `events.rs`（清单与「不拆」清单见 design §7）；`lib.rs` 当前 9605 行，本阶段目标净减 ≥100 行（含声明/引用增行净口径），不搞一次性全量拆分（window/log/tray 是 `codebase-modularity-refactor` Phase 6（收尾阶段）的债）。

### 5. TDD 计划与量化门禁

先红测后实现：状态机全迁移路径矩阵测试（含 RS-51 已有 7 项可靠性测试保持全绿——回归底线）、事件序号跨类型单调、时钟注入后抑制窗口测试去真 sleep（~800ms → <100ms 推演）。门禁全绿才交付：`cargo check` / `cargo test --lib` / `pnpm test:unit` / `pnpm build` / `openspec validate --strict`。

## Impact

- 新增：`src-tauri/src/clipboard/listen_state.rs`（状态机 + 判定入口 + 时钟）、`src-tauri/src/events.rs`（typed 事件总线 + 注册表）、`src-tauri/src/service_registry.rs`（服务注册表雏形）及对应测试文件；全部 ≤500 行、公共能力中文注释。
- 改动：`lib.rs`（迁移暂停/采集/事件段，hunk 隔离）、`clipboard/{watcher,suppress,mod}.rs`（判定改走状态机）、`agent/events.rs`（emit 改走总线）、前端 `use-clipboard-list.ts` / `clipboard-event-gate.ts`（类型同步，逻辑零改）、`docs/BUSINESS_INDEX.md`（新增模块行）。
- 不改：DB schema、`content_hash` / 指纹算法、设置默认值、41 条 MCP specs、`plugin_runtime/` 模块、五类功能本身的实现（RS-55~58 各自提案）。

## 不做（明确边界，防范围蔓延）

- 不引入 cordis-rs / tokio 到宿主内核域（监听状态机 / 事件总线 / 注册表同步实现；红线：这三个文件不得 import cordis）。
- 不做 Node sidecar、不做插件沙箱、不做 manifest/安装/分发（`agent-plugin-runtime` Phase 2+ 的范围）。
- 不迁移 41 条 MCP 工具到注册表、不动 `plugin.<包名>.<工具名>` 动态口（seams Phase A 与 plugin-runtime Phase 2 的范围；本提案只定合并接口）。
- 不拆 lib.rs 的 window/log/tray/搜索/设置域（modularity Phase 6）；不做前端状态可视化徽标（状态事件跑一阵子按排查真实需求再做，RS-51 讨论串已裁）。
- 不改 RS-51 已修复的指纹提交时序 / priming / 去重语义（其 7 项测试是回归底线）。

## 验证标准（详见 design §10）

- 状态机：六态全迁移路径（含暂停×抑制重叠、抑制中 watcher 退出等组合）各有 ≥1 测试且全绿；四类调用方（watcher / manual / open_panel / 暂停命令）全部经 `can_capture()` 判定。
- 事件：bus `seq` 跨事件类型严格单调；载荷 additive 字段不破坏现有监听（RS-51 前端闸门测试保持通过）。
- 时钟：抑制窗口测试迁移后总耗时 <100ms（原真 sleep ~800ms）。
- 回归：`cargo test --lib` ≥ RS-51 基线（56 passed / 1 ignored）且 0 failed；`pnpm test:unit`、`cargo check`、`pnpm build`、`openspec validate plugin-foundation-phase1 --strict` 全绿；`verify-file-size` fail=0；BUSINESS_INDEX 更新且 `pnpm locate --check-index` 通过。
