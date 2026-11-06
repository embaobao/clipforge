# Delta: 插件化底座阶段 1——监听状态机 + typed 事件总线 + 服务注册表雏形（plugin-foundation）

> 纯 `ADDED Requirements`（本仓 `openspec/specs/` 无对应基线；沿用 clipboard-listener-reliability 的 delta 策略，避免 MODIFIED/REMOVED 归档合并静默丢失）。
> 本 delta 描述实施后的目标行为；不改 DB schema、不改指纹算法、不引入 cordis 依赖到宿主内核域。

## ADDED Requirements

### Requirement: 监听状态机六态与单一判定入口

剪贴板监听状态 SHALL 显式化为六态状态机（Disabled / Priming / Listening / Suppressed（带截止窗口）/ Paused / Reconnecting），由统一事实派生，状态判定 SHALL 只经单一入口 `can_capture()`：watcher 轮询、manual capture、open_panel 补采、暂停命令内部判定全部走该入口，SHALL NOT 在这些路径上绕过状态机直接拼读暂停/抑制标志。判定入口 SHALL 按调用方分档：后台轮询六态全判；手动采集与面板补采只判暂停/抑制（watcher 不在运行或环境禁用时手动采集 SHALL 保持可用，与既有行为一致）。既有错误码 `CLIPBOARD_LISTEN_PAUSED` 与 `CLIPBOARD_WRITEBACK_SUPPRESSED` 语义 SHALL 保持不变，SHALL NOT 为本需求新增错误码。

#### Scenario: 暂停时手动采集被拒

- **WHEN** 监听处于 Paused，用户触发手动采集（manual capture / startup 采集）
- **THEN** 采集被拒并返回 `CLIPBOARD_LISTEN_PAUSED` 错误码，与 RS-51 修复后的既有行为一致

#### Scenario: 判定入口等价

- **WHEN** 对 paused × suppressed 全部组合以手动路径判定
- **THEN** `can_capture(Manual)` 的允许/拒绝结论与旧「is_listen_paused + should_skip_writeback」拼判逐一等价（4 例等价矩阵）；后台路径对 watcher 存活/环境禁用为声明性覆盖（watcher 不运行即无后台采集）

### Requirement: 状态迁移可观测

每次状态迁移 SHALL 打一条带迁移序号的结构化日志（from / to / reason / 时钟），连续快退的退避自环 SHALL 也记录；每次迁移 SHALL 向前端 emit `listen-state-changed` 事件（载荷含 from / to / reason / transitionSeq / 总线 seq）；无迁移的事实变化 SHALL NOT 产生状态事件。整条状态流 SHALL 可在日志中连成因果链（「当时为什么没采」可答）。

#### Scenario: 抑制窗口迁移链

- **WHEN** 一次写回开启 700ms 抑制窗口，随后时钟越过截止
- **THEN** 日志按序出现 `Listening → Suppressed`（reason=suppress-open）与 `Suppressed → Listening`（reason=suppress-expired）两条迁移，且各伴随一次 `listen-state-changed` 事件

#### Scenario: 暂停优先于抑制

- **WHEN** 抑制窗口未到期时用户暂停监听，随后恢复监听
- **THEN** 暂停即迁移到 Paused；恢复时若窗口已到期则 `Paused → Listening`，未到期则 `Paused → Suppressed`；暂停期间窗口到期不产生额外迁移事件

### Requirement: watcher 退出与重连状态可见

watcher 退出 SHALL 使状态迁移到 Reconnecting（带当前退避时长），重连重启 SHALL 经 Priming 回到 Listening，连续快退的退避翻倍 SHALL 在迁移链中可见；环境变量禁用 SHALL 是唯一终态 Disabled 且不产生采集。

#### Scenario: 监听线程退出

- **WHEN** 测试钩子使 watcher 线程退出
- **THEN** 状态迁移到 Reconnecting 并在日志与 `listen-state-changed` 中可查，退避重启后回到 Listening，全程无人工干预

### Requirement: typed 事件总线统一序号

域事件（`clipboard-changed`、`listen-paused-changed`、`listen-state-changed`、`agent_agui_event`、`agent_ui_message`）SHALL 收敛为编译期注册表（名字 / 类别 / 保留字段），经统一发射口发出；总线序号 SHALL 跨事件类型严格单调递增，并以 additive 字段（seq / kind / emittedAtMs）注入每类事件载荷顶层；既有字段 SHALL 保持向后兼容（`clipboard-changed` 的 `changeCount` 取总线序号，前端去重闸门语义不变）；`clipforge://*` 窗口控制事件 SHALL NOT 并入域事件注册表。

#### Scenario: 跨类型单调

- **WHEN** 交替发射不同类别的域事件
- **THEN** 每个事件的 `seq` 严格大于前一个（跨类型全局单调），前端可用同一序号对多类事件排序去重

#### Scenario: 既有监听不破坏

- **WHEN** 前端按现有逻辑监听 `clipboard-changed` 并用 `changeCount` 去重（RS-51 事件闸门）
- **THEN** 50 并发事件风暴下刷新次数 ≤2 的既有测试保持通过，无需改动前端逻辑

### Requirement: 统一时钟注入

监听状态域（抑制截止判定、状态迁移重算、判定入口、状态事件时间戳）SHALL 经可注入时钟读取时间；测试 SHALL 能以手动时钟推演时间推进；抑制窗口重叠测试 SHALL NOT 依赖真实 sleep，迁移后该测试套运行时间 SHALL 低于 100ms。

#### Scenario: 毫秒级推演抑制窗口

- **WHEN** 测试用手动时钟把 450ms 与 700ms 两个重叠抑制窗口推演到 800ms
- **THEN** 判定结论为「保护持续到 700ms 截止」（与 RS-51 真跑版断言语义一致），且测试全程无真实 sleep

### Requirement: 服务注册表雏形与可逆注册

宿主 SHALL 提供统一服务注册表：扩展点类别 SHALL 为开放注册的元数据（首批五类：采集源 / 内容处理器 / 粘贴动作 / 面板组件 / MCP 工具），新增类别只注册一条类别定义、注册表核心零改动；词汇与 `agent-plugin-runtime` 提案的注册类型 / 命名空间（`openspec/changes/agent-plugin-runtime/docs/EXTENSION_MODEL.md`）对齐，SHALL NOT 另起第二套扩展点词汇。服务定义 SHALL 为一处声明式注册（id / 类别 / 描述 / capabilities 能力面），注册入口 SHALL 先校验（非法 id、未注册类别 SHALL 被拒且不进表）；注册 SHALL 可逆：句柄释放即注销并从快照消失；消费方 SHALL 只读快照。宿主 SHALL 提供 `introspect()` 能力面快照与 additive command `list_services`（类别 + 服务 + capabilities），作为 Agent 与设置页消费能力面的单一事实源。MCP 工具类 SHALL 以只读清单形式挂接现有 41 条宿主 specs，SHALL NOT 改动 mcp 路由、golden 计数与 dispatch；插件动态工具口 SHALL NOT 消耗 agent-extension-seams 同源计数。监听状态机 / 事件总线 / 服务注册表 SHALL NOT 依赖 cordis（红线）。

#### Scenario: 内置采集源注册与注销

- **WHEN** 应用启动且监听未被环境变量禁用
- **THEN** 内置剪贴板采集源出现在注册表快照中（capabilities 完整保留）并留注册日志；环境禁用时不注册，状态为 Disabled

#### Scenario: 注册可逆

- **WHEN** 一个服务注册后释放其句柄
- **THEN** 该服务从快照中消失，后续消费方查询不到它

#### Scenario: 非法定义被拒

- **WHEN** 以未注册的类别或重复/非法 id 注册服务
- **THEN** 注册返回错误且快照不变，不出现半死状态

#### Scenario: Agent 能力面查询

- **WHEN** 前端或 Agent 调用 `list_services`
- **THEN** 返回完整能力面 JSON（类别清单 + 各服务 id/描述/capabilities），与注册表快照一致，无需读取第二份清单

### Requirement: lib.rs 采集域拆分边界

采集 / 暂停 / 抑制 / 事件相关代码 SHALL 迁入 `clipboard/` 模块与 `events.rs`，`lib.rs` 行数只减不增；window / log / tray / 搜索 / 设置 / agent / mcp / OCR 域 SHALL NOT 被拆分或迁移（「不拆」清单），清单内文件仅允许 proposal.md Impact 声明的最小调用点改动（如 `agent/events.rs` 的 emit 行、`use-clipboard-list.ts` 的类型注释）；新增与被触碰的非豁免文件 SHALL ≤500 行；新增模块 SHALL 同步 `docs/BUSINESS_INDEX.md`。

#### Scenario: 拆分不越界

- **WHEN** 实施完成并复查 `git diff --name-only`
- **THEN** 「不拆」清单文件零被拆分触碰，改动文件集合 ⊆ proposal.md Impact 清单；`verify-file-size` 无 fail
