# 提案：pi sdk 作为 ClipForge Agent 能力基础

> 所属波次:见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。

## 优先级

P1。盟哥 2026-09-11 拍板：pi sdk 确立为 ClipForge 的 Agent 能力基础，旧 AI 侧车（DeepSeek Harness）全链废弃删除。本提案接管原旧 AI 侧车系提案的产品意图（条目分析/智能标签/AI 助手），以 pi 的可编程 SDK 重新实现。

## 背景

- 旧 AI 侧车实验链（deepseek-harness-embedding 等）验证了「AI 分析剪贴板条目」的产品价值，但 Node sidecar + Cordis 插件系统的基座过重，且与 ClipForge 的 Tauri/TS 主栈割裂（2026-09-02 起整体后置）。
- 运行时基座候选评估结论（2026-09-11 盟哥拍板）：选定 **pi**（github.com/earendil-works/pi）——TypeScript AI agent toolkit，提供统一 LLM API、会话管理、工具调用与可编程 SDK（类似 Claude Code Agent SDK 的嵌入形态），npm 包 `@mariozechner/pi-coding-agent`，与 ClipForge 技术栈同构，可嵌入前端或独立 sidecar，无需 Cordis/Node 双运行时。

## 目标

1. **引入 pi sdk**：`@mariozechner/pi-coding-agent`（或其 SDK 子包）进入 ClipForge 依赖，封装为 `src/agent/pi/` 适配层。
2. **Agent 能力基础四件事**：统一 LLM provider 配置（对接 `settings.agentProviders`）、Agent 会话管理、工具调用框架（首retch个工具：读取剪贴板条目/历史）、流式输出。
3. **产品功能点**（替代旧 AI 侧车能力）：条目 AI 分析与摘要、智能标签建议、（后续）AI 助手对话面板。
4. **旧 AI 侧车全量删除**：删除旧 AI 面板前端全链（面板组件、独立入口、分析服务层、相关入口/类型）；Rust 守护进程模块与命令、tauri 配置窗口；相关设置项与探针。

## 非目标

- 不做本地模型推理托管（LLM 调用走 provider API）。
- 不在第一版实现对话式 AI 助手面板（先用结构化分析能力，面板随 pi 集成稳定后再评估形态）。
- 不迁移旧 AI 侧车的 Cordis 插件/skill 资产（能力由 pi 工具机制重新实现）。
- 不删除旧 AI 侧车相关的历史提案文档（归档保留决策记录）。

## 集成方式（初稿，Phase 0 细化）

- `src/agent/pi/` 适配层：会话创建、provider 配置映射、工具注册（clipboard.read / clipboard.search）。
- LLM provider 复用设置页已有的 agentProviders 配置结构与 API Key 管理。
- 前端消费：详情页「AI 分析」入口与右键菜单保持现有交互不变，底层从旧 AI 侧车切换到 pi。

## 产品能力落位(2026-10-13 对账:pi 能力在哪被看见)

| 层 | 产品体现 | 状态 |
|---|---|---|
| L1 嵌入式分析 | 详情页 PiAnalysisBar(插件区 menu 形态):一键分析 → 摘要 + 标签建议 chip(点击即主列表检索)+ 一键应用标签(合并去重走 `update_clip_record`)+ 最近 3 条历史(localStorage 上限 20);无 provider 时禁用提示 | ✅ 已可见 |
| L2 工具化助手 | `createClipForgeAgent` + `clipboard_search`/`clipboard_read_latest` 工具 + `piStream` 骨架在位,**零 UI 接线,产品上不可见**;承载面形态见下节 | 🟡 待评估 |
| L3 MCP 外部接口 | `run_mcp_stdio` + `clipf.*` 工具族,外部 Agent/宿主可调用(非产品 UI) | ✅ 已可见 |

### 助手承载面形态评估(L2 唯一缺口)

结论先行:**不需要也不应该嵌入 pi-web**。pi-web 是 pi coding agent(终端编码 agent)的本地会话工作台,管理 pi CLI 的项目代码会话文件/provider 登录;ClipForge 的 pi 集成是库级(import SDK 自建 agent),会话域是剪贴板条目,两者不共享数据模型。pi-web 仅作交互参考(会话列表、工具调用卡片渲染、成本展示)。

形态候选(M1 关波后裁决,总纲 W3 预留项):

| 形态 | 适配场景 | 代价/风险 |
|---|---|---|
| A 详情页展开区/侧栏 | 单条目追问(翻译/解释) | 空间受限,跨条目检索任务放不下 |
| B 独立助手面板窗口(快捷键唤起) | 跨条目任务(「帮我找刚才复制的报价」),`clipboard_search` 工具直接服务 | 新窗口生命周期/焦点/热键预算;对齐 AGENTS.md「主交互独立窗口」原则 |
| C 不做 UI,L2 仅经 L3 MCP 暴露 | 外部宿主消费 | 产品内零感知,pi 投入可见价值低 |

推荐:B 为主、A 为辅。裁决判据:①工具调用交互(clipboard_search 结果卡片)在详情页内放不放得下;②独立窗口的焦点/快捷键冲突(全局热键预算已紧);③盟哥实际使用意愿。

## 风险与对策

- **pi sdk API 稳定性**：Phase 0 锁定版本与最小依赖面，适配层隔离。
- **API Key 管理**：复用 settings 的 redaction 与 keyRef 机制，不落盘前端。
- **删除旧 AI 侧车的回归风险**：删除手术分批进行（前端/Rust/配置），每批全套验证 + grep 无残留；`CLIPFORGE_DISABLE_CAPTURE` 冒烟规范照旧。
- **依赖 scope 迁移**：旧 scope `@mariozechner/*` 已 5 个月未发版，疑似冻结；pi 主仓已迁到 `@earendil-works/*` 1.1.0。迁移工作独立为 backlog 任务，不归入本提案归档范围，避免延迟收官。

## 成功标准

- 旧 AI 侧车代码与配置零残留，全套验证绿。
- pi sdk 依赖引入，详情页 AI 分析功能以 pi 为底层恢复可用（同交互）。
- 原三个旧 AI 侧车提案归档，本提案 tasks 全部完成或明确后置。

## 依赖关系

- 替代：deepseek-harness-embedding（产品意图承接方）。
- 解除：旧 AI 侧车「文件上下文对话」「右键系统菜单」两提案的排期冻结（其场景待 pi 落地后重新评估，或并入本提案后续 Phase）。
- 关联：codebase-modularity-refactor（旧 AI 侧车删除会同步缩减 lib.rs 体量）。
- 后续：pi sdk 依赖迁移至 `@earendil-works/*` 1.1.0，见 `backlog/tasks/task-4 - pi-sdk-依赖迁移至-earendil-works-1.1.0.md`。
