# Delta:提示词快捷优化（prompt-optimizer）

## ADDED Requirements

### Requirement: 全局快捷键唤起优化视图

系统 SHALL 提供独立于主面板快捷键的全局快捷键（设置键 `promptOptimizerShortcut`，默认 `CommandOrControl+Shift+P`，空值 SHALL 关闭该快捷键）；触发后 SHALL 经既有主窗口唤起链路显示主窗口并切换到提示词优化视图，唤起→可见延迟 SHALL NOT 突破既有 ≤180ms 基线。快捷键注册失败 SHALL 仅记录 warning 并保留托盘/菜单入口，SHALL NOT 导致崩溃。

#### Scenario: 复制后快捷唤起

- **WHEN** 用户在任意应用复制一段提示词后按下 `promptOptimizerShortcut`
- **THEN** 主窗口唤起并进入优化视图，剪贴板最新文本条目作为原文自动进入优化流程

#### Scenario: 剪贴板无可用文本

- **WHEN** 快捷键触发时剪贴板最新内容为空或非文本
- **THEN** 视图进入空态并引导用户先复制文本，不发起优化请求

#### Scenario: 快捷键被占用或与主键同值

- **WHEN** 新快捷键注册失败，或配置值与主面板快捷键 normalize 后同值
- **THEN** 注册链去重保主键/仅记 warning，托盘与菜单入口仍可打开优化视图，应用不崩溃

### Requirement: 自动优化与通道本地优先

视图打开 SHALL 自动以最新剪贴板文本为原文触发一次优化，引擎 SHALL 复用既有单次重写实现（5-slot 元提示、4000 字截断）。优化通道解析顺序 SHALL 为：`promptOptimizerProviderId` 指定的 provider 配置（失效时回退并提示）→ 默认 agent provider（`agent_resolve_pi_provider` 运行时解析）；配置为本地兼容端点的 provider 即构成本地快速通道，默认 provider 为云端兜底。provider 完全缺位时 SHALL 进入禁用引导态，SHALL NOT 发起请求。

#### Scenario: 指定本地通道

- **WHEN** `promptOptimizerProviderId` 指向 baseUrl 为本机兼容端点的 provider 且可达
- **THEN** 优化请求走该本地通道，结果区标注实际使用的通道

#### Scenario: 本地通道不可达

- **WHEN** 指定的本地通道探测失败
- **THEN** 回退默认 provider 完成优化并在结果区标注「本地通道不可达，已用默认通道」，不静默长等待

#### Scenario: 未配置任何 provider

- **WHEN** 用户未配置 agent provider
- **THEN** 优化动作禁用并引导前往设置页，不发起请求、不报晦涩错误

### Requirement: 结果差异对比与无差异处理

优化结果 SHALL 以原文/优化稿对比（diff）形式展示，经用户确认后才产生任何写动作；优化稿与原文实质相同时 SHALL 判定为无差异并明确提示，SHALL NOT 提供写出口。

#### Scenario: diff 确认

- **WHEN** 优化完成且结果与原文有差异
- **THEN** 展示差异对比与「回写剪贴板」「保存为片段」出口，用户确认前不发生任何写入

#### Scenario: 无差异

- **WHEN** 优化稿 trim 后与原文相同
- **THEN** 提示原文已是结构化形态，不出现写出口，不产生入库或剪贴板写入

#### Scenario: 优化失败可重试

- **WHEN** 优化请求抛错或超时（本地 10s / 云端 30s 前端侧超时）
- **THEN** 展示可定位的错误信息与重试入口，视图不进入不可恢复状态

### Requirement: 回写剪贴板复用写回抑制链

回写剪贴板 SHALL 复用既有 `copyText` 写链：`capture_clip_record` 显式入库 → `write_clipboard_item` 写系统剪贴板（Rust 侧 `suppress_writeback_for` 抑制窗口内 watcher 不采集）→ 失败降级浏览器剪贴板 API 并提示。优化流程 SHALL NOT 旁路该链直接写剪贴板或新增第二套抑制逻辑；回写完成后系统剪贴板 SHALL 等于优化稿，历史列表 SHALL NOT 出现重复条目。

#### Scenario: 回写后无回环采集

- **WHEN** 用户确认回写剪贴板
- **THEN** 剪贴板内容为优化稿，优化稿作为新条目（source=`prompt-optimizer`）入库一次，watcher 不在抑制窗口内重复采集，列表无重复

#### Scenario: 原文条目保留

- **WHEN** 回写完成
- **THEN** 用户刚复制的原文条目保持不变且可回溯，优化稿为独立新条目

#### Scenario: 写链失败

- **WHEN** `write_clipboard_item` 失败
- **THEN** 沿既有降级路径（`navigator.clipboard.writeText` + 状态提示），错误可见不吞

### Requirement: 保存为片段

「保存为片段」出口 SHALL 将优化稿经显式入库后置 `bucket=snippet`（既有 `update_clip_record` 通道），SHALL NOT 新增表、迁移或第二套片段存储。

#### Scenario: 保存为片段

- **WHEN** 用户在 diff 确认后选择「保存为片段」
- **THEN** 优化稿以 snippet bucket 入库，可在片段视图检索到，原文条目不受影响

### Requirement: 触发与并发护栏

优化编排 SHALL 单飞（in-flight 去重）：快捷键连按、重复唤起、重试期间重复触发 SHALL 合并为一次；优化期间原文 SHALL 锁定触发时的快照，剪贴板后续变化不刷新当前视图，退出重进才重新取材。视图内 Esc SHALL 返回列表路由而非隐藏主窗口面板。

#### Scenario: 连按快捷键

- **WHEN** 优化进行中用户再次按下快捷键
- **THEN** 仅聚焦当前视图，不重复发起优化请求

#### Scenario: 优化期间剪贴板变化

- **WHEN** 用户在 diff 阅读期间复制了新内容
- **THEN** 当前视图原文与结果保持快照不变，退出后再次唤起才采用新内容

### Requirement: 性能与门禁预算

快捷键→窗口可见 SHALL 沿用并保持 `pnpm test:perf-panel` 的 ≤180ms 基线；可见→请求发出 SHALL ≤100ms；请求→结果展示的软目标为本地通道 p50 ≤3s、云端 p50 ≤8s（实机实测记录，不做 CI 硬门禁）。交付门禁 SHALL 全绿：`pnpm test:unit`、`cd src-tauri && cargo check`、`pnpm build:web`、`pnpm check:i18n`、`pnpm locate --check-index`；新增文件 ≤500 行且公共能力带中文注释。

#### Scenario: 唤起性能基线

- **WHEN** 在沙箱实例复跑 `pnpm test:perf-panel -- --sandbox`
- **THEN** 唤起→可见仍 ≤180ms，既有探针结论不回退

#### Scenario: 门禁全绿

- **WHEN** 实施完成后执行全部交付门禁
- **THEN** 全部通过；实机与人工未验证项（含锁屏导致的探针超时）在交付说明中如实记录，不代勾
