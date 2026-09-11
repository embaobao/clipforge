# 提案：pi sdk 作为 ClipForge Agent 能力基础

## 优先级

P1。盟哥 2026-09-11 拍板：pi sdk 确立为 ClipForge 的 Agent 能力基础，DSH（DeepSeek Harness）全链废弃删除。本提案接管原 DSH 系提案的产品意图（条目分析/智能标签/AI 助手），以 pi 的可编程 SDK 重新实现。

## 背景

- DSH 实验链（deepseek-harness-embedding 等）验证了「AI 分析剪贴板条目」的产品价值，但 Node sidecar + Cordis 插件系统的基座过重，且与 ClipForge 的 Tauri/TS 主栈割裂（2026-09-02 起整体后置）。
- 运行时基座候选评估结论（2026-09-11 盟哥拍板）：选定 **pi**（github.com/earendil-works/pi）——TypeScript AI agent toolkit，提供统一 LLM API、会话管理、工具调用与可编程 SDK（类似 Claude Code Agent SDK 的嵌入形态），npm 包 `@mariozechner/pi-coding-agent`，与 ClipForge 技术栈同构，可嵌入前端或独立 sidecar，无需 Cordis/Node 双运行时。

## 目标

1. **引入 pi sdk**：`@mariozechner/pi-coding-agent`（或其 SDK 子包）进入 ClipForge 依赖，封装为 `src/agent/pi/` 适配层。
2. **Agent 能力基础四件事**：统一 LLM provider 配置（对接 `settings.agentProviders`）、Agent 会话管理、工具调用框架（首retch个工具：读取剪贴板条目/历史）、流式输出。
3. **产品功能点**（替代 DSH 能力）：条目 AI 分析与摘要、智能标签建议、（后续）AI 助手对话面板。
4. **DSH 全量删除**：前端 `src/dsh/`、`dsh-main.tsx`、`agent/dsh-analysis.ts`、相关入口/类型；Rust `dsh.rs` 守护进程与命令、tauri 配置窗口；DSH 设置项与探针。

## 非目标

- 不做本地模型推理托管（LLM 调用走 provider API）。
- 不在第一版实现对话式 AI 助手面板（先用结构化分析能力，面板随 pi 集成稳定后再评估形态）。
- 不迁移 DSH 的 Cordis 插件/skill 资产（能力由 pi 工具机制重新实现）。
- 不删除 `dsh` 相关的历史提案文档（归档保留决策记录）。

## 集成方式（初稿，Phase 0 细化）

- `src/agent/pi/` 适配层：会话创建、provider 配置映射、工具注册（clipboard.read / clipboard.search）。
- LLM provider 复用设置页已有的 agentProviders 配置结构与 API Key 管理。
- 前端消费：详情页「AI 分析」入口与右键菜单保持现有交互不变，底层从 DSH 切换到 pi。

## 风险与对策

- **pi sdk API 稳定性**：Phase 0 锁定版本与最小依赖面，适配层隔离。
- **API Key 管理**：复用 settings 的 redaction 与 keyRef 机制，不落盘前端。
- **删除 DSH 的回归风险**：删除手术分批进行（前端/Rust/配置），每批全套验证 + grep 无残留；`CLIPFORGE_DISABLE_CAPTURE` 冒烟规范照旧。

## 成功标准

- DSH 代码与配置零残留，全套验证绿。
- pi sdk 依赖引入，详情页 AI 分析功能以 pi 为底层恢复可用（同交互）。
- 原三个 DSH 提案归档，本提案 tasks 全部完成或明确后置。

## 依赖关系

- 替代：deepseek-harness-embedding（产品意图承接方）。
- 解除：dsh-file-context-conversation、dsh-system-context-menu 的排期冻结（其场景待 pi 落地后重新评估，或并入本提案后续 Phase）。
- 关联：codebase-modularity-refactor（DSH 删除会同步缩减 lib.rs 体量）。
