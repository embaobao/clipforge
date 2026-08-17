# 提案：DeepSeek Harness 以「常驻守护进程 + 悬浮对话」内嵌为 AI 运行时底座

## 背景

ClipForge 主线聚焦 **AI 快速分析** 与 **剪贴板管理**。此前在 `mastra-agent-runtime-evaluation`、`local-model-quick-integration`、`vercel-ai-sdk-integration`、`ai-model-plugin-productization` 中分别探讨了自建/Mastra/Vercel AI SDK/本地模型等方向。

2026-08-13 DeepSeek 发布并开源 **DeepSeek Harness（dsh）v0.1 开发者预览**（MIT 协议），定位为「一切皆插件」的 Agent 运行时。决策（盟哥 2026-08-16 拍板）：**Mastra 等 AI 框架先不引入、后置**；采用 DSH 作为壳子内嵌的 AI 底座。

参考项目 `anywhere-labs/deepseek-harness-desktop`（Electron 封装官方 DSH，外壳自身即 DSH 插件）印证了「插件式集成是官方意图用法」与「固定版本原样运行」。本提案 v1（Phase 0–5，已落地）采用 **一次性 sidecar** 跑 headless 分析；**2026-08-17 后续方向** 转向参考项目的 **Host-Service Separation（宿主–服务分离）**：Rust 在应用生命周期内常驻管理一个 DSH 守护进程，悬浮 UI 通过 HTTP/WS 对话，从而获得**常驻会话、快速唤起、与剪贴板面板打通**的能力。

## 参考项目核心设计哲学（已研究）

`anywhere-labs/deepseek-harness-desktop` 的 4 个扩展维度，本提案逐一对齐：

1. **宿主–服务分离（Host-Service Separation）**：桌面壳（Electron/Tauri）作为 Host，后台常驻拉起并管理私有 `dsh` 进程（默认 `127.0.0.1:3080`），窗口关闭退化为「隐藏到托盘」，托盘菜单控制自启/重启/停止/日志。→ 我们对应为 Rust `dsh-daemon` 模块常驻管理 sidecar（替代每次分析冷启）。
2. **基于 Profile 的层（Overlay）与 Patch 配置隔离**：引入 Profile 概念，启动时把桌面端专属 Patch/插件叠加到 DSH 上游默认 Bundle 之上，不污染全局配置。→ 我们对应为 `clipforge` profile（`dsh/profiles/clipforge/`）+ `cordis.patch.yml` 用户层。
3. **环境 Shim 与零污染**：内置/自动下载无污染 Node 运行时，生成私有 `dsh`/`pnpm`/`node` Shim，局部注入 PATH。→ 我们对应为 Tauri sidecar 打包 Node（externalBin）+ `resources/dsh-server/**`，经 `VITE_DSH_NODE_PATH` / `VITE_DSH_SIDECAR_PATH` 注入。
4. **双模式 UI 扩展**：兼容模式直接嵌 DSH Web UI；高级模式插原生 Frame/毛玻璃/侧边栏。→ 我们取「高级模式」子集：**不渲染 DSH 自身 Web UI**，改为自研悬浮 DSH 面板作为对话客户端（契合 AGENTS.md「不做复杂 AI 配置面板」）。

与参考项目的刻意差异：他们跑**完整 DSH（含 Web UI / Host 服务）**；我们只跑 **headless 只读分析 host（localhost API，不暴露 Web UI）**，更轻；他们用 Electron，我们用 **Tauri v2**（Node 以 sidecar 随包分发）。

## 集成原则

1. **直接引用、锁精确版本、随版更新**：`@deepseek-ai/dsh` 锁精确版本（如 `0.1.0-rc.6`，不用 `^` 浮动），`pnpm update` 跟随上游并回归；不 vendor、不 fork、不在 Rust 内重造 agent / prompt / 输出解析。
2. **通过它的插件扩展**：剪贴板/文件分析能力做成 DSH 的 Cordis 插件 + Skill，挂在 DSH 运行时之上；结构化输出由 DSH tool 的 `output.schema` 强制校验。
3. **宿主只做薄桥接 + 进程生命周期管理**：Rust/Tauri 负责常驻拉起 Node sidecar、健康检查、日志重定向、重启与退出清理；分析与结构化产出全部交给 DSH。
4. **常驻守护进程（Host-Service Separation，2026-08-17 新增）**：DSH 不再是「每次分析 spawn 一个一次性进程」，而是应用生命周期内的**常驻 host 服务**（localhost-only）；悬浮 UI 以 HTTP/WS 客户端对话，会话态由 DSH 持有 → 天然支持多轮「常驻会话」与「快速唤起」。

## 目标

- 把 DSH 作为 ClipForge 的 AI 运行时底座，承载「快速分析」（摘要/分类/抽取/自动标签/建议分组）与「管理」（AI 操作历史 + trajectory 审计）。
- **常驻守护进程**：应用启动即在后台拉起 DSH host 服务（localhost-only），提供健康检查/重启/日志/退出清理；不每次分析冷启。
- **悬浮对话式 UI**：`src/dsh/dsh-panel.tsx`（`PanelSurface = "dsh"`）作为对话客户端，支持多轮、流式、四类结果展示与写回。
- **快速唤起**：复用既有全局快捷键 + 托盘（`main-tray` 已存在）+ 快捷面板（`show_quick_panel` 已存在），新增直达 DSH surface 的唤起路径；回到 clipboard surface 仍是默认。
- **与剪贴板面板打通**：选中剪贴板条目可一键注入 DSH 对话上下文；DSH 结果可写回标签/分组到该条目。
- 安全红线：分析 profile 禁用 filesystem-write / shell；localhost-only，拒绝 `--host 0.0.0.0`。
- 隐私：默认只发 summary/metadata，授权才发全文；降级不破坏剪贴板主流程。

## 与现有提案的关系（归并）

- `mastra-agent-runtime-evaluation` → **no / 后置，归档**。
- `local-model-quick-integration` → **superseded**，DSH 模型无关。
- `vercel-ai-sdk-integration` → **superseded**，provider 配置 UI 由设置页承载。
- `ai-model-plugin-productization` → **保留**为标品化 / 四类结果 / 隐私 spec，运行时为本提案 DSH。
- `external-hook-plugin-runtime` → 不动（剪贴板上下文采集）。
- `dsh-file-context-conversation` → 本提案之上的「文件上下文」用户场景（文件内容注入 + 在此文件开始对话 + 系统级右键，见其提案）。
- `dsh-system-context-menu` → 系统级文件管理器右键（Finder Sync / Shell 扩展），独立于悬浮 UI 的原生扩展，见其提案。

## 非目标

- 不渲染 DSH 自身 Web UI；AI 入口是悬浮 DSH 面板（原 `ClipboardAgentPanel` 已删除，DSH 是当前唯一 AI 入口）。
- 不在 Rust 维护 DSH 的 prompt / 输出解析（结构化由 DSH tool schema 强制）。
- 不 vendor / fork DSH 源码。
- 不在 v1 引入 DSH 的 shell / file 编辑能力到用户机器（只读分析 profile）；写回（标签/分组）经 preview/confirm。
- 系统级文件管理器右键不在本提案范围内（见 `dsh-system-context-menu`）。

## 现状与转向说明

- **v1（Phase 0–5，已落地 ✅）**：一次性 sidecar 链路——`dsh.rs::analyze_clipboard` 每次 `node sidecar.mjs "<task>"` 拉起、读 `DSH_RESULT::<json>`、退出；`dsh-analysis.ts` 消费；`dsh-panel.tsx` 为单轮分析 UI。`cargo check` + `pnpm build:web` 通过。
- **转向（本提案新增 Phase 6–7）**：把一次性 sidecar 演进为**常驻 host 服务** + **对话客户端**，复用参考项目 Host-Service Separation。一次性 `analyze_clipboard` 保留为降级/离线兜底，待守护进程稳定后可选移除。
