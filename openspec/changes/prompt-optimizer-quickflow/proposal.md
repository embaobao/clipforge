# 提案：提示词优化快捷工具——复制→快捷键→自动优化整理（prompt-optimizer-quickflow）

> 上游：RS-53（P0，急需）；路线图与优先级见 RS-52（ClipForge 产品升级路线图 v2）。本提案**不等插件化底座**（RS-54），依托现有 agent/pi 域与全局快捷键体系快速交付；接口形态对齐后续「动作类扩展点」（面板组件/粘贴动作扩展点的第一个实例雏形）。

## 状态

**新建 · 待盟哥确认**。提案阶段不改产品代码；确认后按「一 issue 一 PR」进入实施（TDD 先红测）。`docs/PROPOSAL_ROADMAP.md` 的 active 表登记与 `docs/BUSINESS_INDEX.md` 行同步列入实施期任务（ROADMAP 当前在 TASK-8 工作树有未提交改动，提案分支不触碰，避免冲突）。

## Why

盟哥明确的核心痛点与最高优先级：优化一段提示词要「复制 → 唤面板 → 找到条目 → 进详情 → 打开插件菜单 → 点优化 → 确认 diff → 写回」八步。优化器本体已经存在——`src/agent/pi/prompt-optimizer.ts` 有单次 AI 重写（5-slot 元提示、4000 字截断、provider 运行时解析），`src/workspace/components/PromptOptimizerBar.tsx` 已把它接进详情页插件区——缺的不是引擎，是**一步到位的入口**：复制提示词后，一个全局快捷键唤起 → 自动优化 → diff 确认 → 回写剪贴板/存片段。

AGENTS.md 定位约束同时成立：「快速剪贴板工具优先」「全局快捷键是 Clipy 等价能力的一部分」。本提案是快捷键 + 剪贴板回写这条热路径上的 AI 动作，不是 AI 工作台化：不新增 AI 配置面板，复用既有 provider 设置。

## What Changes

1. **全局快捷键唤起优化视图**：新增独立设置键 `promptOptimizerShortcut`（默认 `CommandOrControl+Shift+P`，可清空关闭），注册进既有 `settings_service` 快捷键同步链；唤起形态 = 主窗口（`main`）切到「提示词优化」内部路由视图（TanStack Router 新路由），复用既有 show 链路与 ≤180ms 性能基线，不新建窗口。
2. **自动取材与自动优化**：视图打开即取最新剪贴板文本条目为原文，自动触发一次优化（编排为纯函数模块，便于红测）；剪贴板无可用文本时进入空态引导。
3. **结果 diff 确认**：复用详情页既有 `draft-diff` 组件形态做原文/优化稿对比；无差异时明确提示，不产生写动作。
4. **一键回写 / 保存片段**：回写复用 `copyText` 既有链（`capture_clip_record` 显式入库 → `write_clipboard_item` 写剪贴板，Rust 侧 `suppress_writeback_for(450ms)` 抑制回采 → 前端 `lastSeenClipboard` 兜底）——即 RS-51 修复的写回抑制机制原样复用，不新增写通道；保存片段 = 显式入库后 `update_clip_record` 置 `bucket=snippet`。
5. **优化通道「本地优先、云端兜底」**：新增可选设置键 `promptOptimizerProviderId`（指向 `agentProviders` 中某个 provider 配置，可指向 baseUrl 为本机兼容端点的快速小模型）；未配置时回退默认 agent provider（`agent_resolve_pi_provider` 运行时解析）。设置页 Agent 分区只加一个选择控件，不做新配置面板。
6. **动作类扩展点接口预留**：编排层以「输入源 → 动作 → 结果 → 出口动作」四段形态组织并显式导出类型，命名对齐 RS-52 规划的五类扩展点中的「粘贴动作/面板组件」；本期不落地插件注册表。

## 现状证据（已由代码证实，非推测）

| # | 事实 | 证据 |
| --- | --- | --- |
| A1 | 优化引擎已存在：单次 `piComplete`，5-slot 元提示，4000 字截断，空输入/空返回抛错 | `src/agent/pi/prompt-optimizer.ts`（`optimizePromptWithPi` / `buildPromptOptimizerSuggestion`） |
| A2 | 现有入口在详情页插件区，链路深（面板→条目→详情→插件菜单→按钮） | `src/workspace/components/PromptOptimizerBar.tsx`；`detail-plugin-zone.tsx` 插件队列 |
| A3 | provider 运行时解析已闭环，支持 baseUrl 覆盖（本机兼容端点可行；OCR 已有 `127.0.0.1:8491` 本地端点先例） | `src/agent/pi/analysis.ts` `resolveDefaultPiProvider` → `agent_resolve_pi_provider`；`provider-config.ts` `resolvePiModel`；`settings-model.ts:286` |
| A4 | 回写防回环链已修复且成型：显式入库 + `write_clipboard_item`（450ms 抑制）+ `lastSeenClipboard` 兜底 + `navigator.clipboard.writeText` 降级 | `src/clipboard/use-clip-writeback.ts:467-497`（`copyText`）；`src-tauri/src/lib.rs:793/834`（`suppress_writeback_for`）、`lib.rs:5295-5305`、`clipboard/watcher.rs:84`（`should_skip_writeback`） |
| A5 | 全局快捷键注册收敛在 settings_service：主键（默认 `Control+V`）+ legacy `CommandOrControl+Shift+V` + fallback 去重注册；沙箱只注册主键、失败仅 warning 不崩溃 | `src-tauri/src/settings_service/commands.rs:24-26/340-400` |
| A6 | 主窗口已有内部路由体系（list/detail/aggregate），新增路由有现成机制 | `src/routes/workspace-router.tsx` |
| A7 | 详情页 diff 确认交互（草稿态→diff→写回）已有组件，可复用形态 | `src/workspace/components/detail/draft-diff.tsx`、`detail-state.ts` |
| A8 | snippet 为 clips 的 bucket 值，`update_clip_record` 支持改 bucket；搜索已有 snippet bucket | `src-tauri/src/lib.rs:650-661`（`UpdateClipInput.bucket`）、`src/clipboard/clip-model.ts:10` |

## 目标

- 复制提示词后，一个全局快捷键完成「唤起 → 自动优化 → diff 确认 → 回写剪贴板/存片段」，全程不离开键盘主导的快路径。
- 唤起→窗口可见 ≤180ms（沿用 `pnpm test:perf-panel` 基线）；可见→出结果：本地通道目标 p50 ≤3s、云端通道目标 p50 ≤8s（实机实测记录，模型相关不做 CI 硬门禁）。
- 回写后系统剪贴板 = 优化稿，历史列表不出现重复条目（RS-51 抑制机制复用，自动化断言覆盖）。
- 新快捷键默认值不与现有注册键（`Control+V`、`CommandOrControl+Shift+V`）冲突；注册失败降级为托盘/菜单入口，不崩溃。
- `pnpm test:unit`、`cd src-tauri && cargo check`、`pnpm build:web` 全绿；新增文件 ≤500 行、公共能力中文注释、文案走 i18n。

## 非目标

- **不做独立悬浮小窗**：Trae 式完整悬浮窗属 RS-57（Agent 悬浮窗插件化，面板组件扩展点实例）；本提案选主窗口路由形态，为其预留接口形态但不新建窗口/HTML 入口。
- **不做插件化底座/注册表落地**（RS-54 范围）：只做模块边界与类型命名的形态对齐。
- **不做流式输出**：`piComplete` 非流式单次调用，优化中展示运行态即可；流式属后续增强。
- **不改元提示语义**：`PROMPT_OPTIMIZER_META_PROMPT` 的 5-slot 结构保留；如需微调仅限参数化（如长度倍数），不重写。
- **不做批量优化、优化历史记录、模板库**：单条即时优化闭环优先。
- **不新增 MCP / L3 或 pi 侧 L2 工具**（不触发 AGENTS.md 同源实现计数登记）。

## Capabilities

### Added Capabilities

- `prompt-optimizer`：提示词优化快捷流的唤起、自动优化、diff 确认、回写防回环、片段保存、通道选择与性能预算契约。

### Modified Capabilities

无。只消费既有 `settings-service`、`settings-registry`、`detail-editor`、`panel-list-performance` 能力接口，不改其 spec。

## Impact

- 前端新增：`src/prompt-optimizer/`（域目录：优化视图组件、编排纯函数、hook）；`src/routes/workspace-router.tsx` 加一条路由。
- 前端改动：`src/clipboard/use-panel-keyboard.ts`（如需窗口内 Esc 语义对接）、`src/i18n/locales/*.json` 新 key。
- Rust 改动：`src-tauri/src/settings_service/commands.rs`（`registered_global_shortcuts` 纳入 `promptOptimizerShortcut` + handler 发 `prompt-optimizer-quickflow` 事件）；settings schema（`settings-model.ts` / `settings_service` 校验）加两个键。
- 设置页：`src/settings/sections/`（Agent 分区加「提示词优化通道」选择控件 + 快捷键录入复用既有 shortcut 控件）。
- 验证：新增编排纯函数单测 + 静态断言（回写走 `copyText` 链、快捷键不与主键同值）；实施期同步 `docs/BUSINESS_INDEX.md`、`docs/PROPOSAL_ROADMAP.md`。
- 数据：零 schema 变更，零迁移。

## 验证策略

| 层 | 手段 | 判据 |
| --- | --- | --- |
| 单元（红测先行） | `pnpm test:unit` 新增 `src/prompt-optimizer/` 编排纯函数测试 | 取材→优化→diff→回写的状态机全分支：空剪贴板、provider 缺位、优化失败、无差异、回写失败降级 |
| 静态断言 | `pnpm test:unit` 挂新断言脚本 | 回写只走 `copyText`/`capture_clip_record`+`write_clipboard_item` 链（不旁路裸写）；快捷键默认值 ≠ 现有注册键；新 i18n key 双语齐备 |
| 编译门禁 | `pnpm build:web`、`cd src-tauri && cargo check`、`pnpm check:i18n`、`pnpm locate --check-index` | 全绿 |
| Rust 抑制 | 既有 watcher 抑制测试 + 新增命令侧断言 | 抑制窗口内不采集；回写后无重复条目 |
| 自动探针 | `pnpm test:perf-panel -- --sandbox` | 唤起→可见 ≤180ms 不回退（优化视图是主窗口路由，共享该基线） |
| 实机（`pnpm dev:sandbox`，需机器解锁） | 端到端走查 + 延迟实测记录 | 本地/云端通道 p50 达标或如实记录偏差；快捷键冲突实测 |
| 人工 | 盟哥走查 | 交互流畅性、diff 可读性、错误反馈可理解性 |

## 风险与对策

- **默认快捷键与用户习惯冲突**（`CommandOrControl+Shift+P` 在部分应用有局部含义）：键可改可清空；注册失败沿用沙箱先例只 warning + 托盘入口兜底；交付说明写明实测结论。
- **本地通道不可达拖慢出结果**：通道解析带可达性探测（复用 `agent_check_provider`），本地端点失败即回退默认 provider 并在视图内标注实际通道；不做静默长等待。
- **优化结果与原文相同**：判定无差异，提示「原文已是结构化形态」，不产生入库/回写动作。
- **连按快捷键/并发触发**：编排层单飞（in-flight 去重），重复唤起只聚焦已有视图并刷新取材。
- **与 RS-51 抑制的协同回归**：回写只复用 `copyText` 链，红测断言不旁路；若后续抑制窗口调整（450ms→其他值），本流程零改动跟随。
- **与 TASK-8 在途改动冲突**：本提案分支只动 `openspec/changes/prompt-optimizer-quickflow/`；ROADMAP/BUSINESS_INDEX 同步延后到实施 PR（其未提交改动先落地）。

## 成功标准

- 盟哥在实机用快捷键完成一次真实提示词优化并回写，全程 ≤3 次键击（快捷键 + 确认）。
- 全部门禁与新增红测绿；实机延迟实测与未验证项如实记录在交付说明。
- RS-57（悬浮窗）与 RS-54（底座）可基于本提案的编排模块与类型形态直接扩展，无需重写优化链。
