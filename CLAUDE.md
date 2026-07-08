# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 主规则：先读 AGENTS.md

本项目的唯一规则源是 [`AGENTS.md`](AGENTS.md)。进入项目前必须先读它。`CLAUDE.md` 不维护第二套规则，下列内容只是**操作参考**（命令、架构导航、文件坐标），产品约束与开发规则一律以 `AGENTS.md` 为准，不要在此重复或改写。

一句话定位：ClipForge 是一个跨平台**快速剪贴板工具**（Tauri v2 + React 19 + TypeScript + SQLite），第一目标是完整替代 Clipy 的核心体验，后续才扩展搜索增强、本地语义检索和标准 MCP 工具接口。它**不是** AI 平台或知识库。

## 常用命令

前置：Node.js 22+、pnpm 11+、Rust stable、各 OS 的 Tauri 平台依赖。

```bash
pnpm install          # 安装前端依赖

# 开发
pnpm dev              # 仅前端（Vite，http://localhost:1420，strictPort）
pnpm tauri dev        # 完整桌面壳：会先跑 `pnpm dev` 再编译 Rust，日常开发用这个

# 校验（PR 前必跑，见 AGENTS.md「验证要求」）
pnpm build            # = tsc && vite build（类型检查 + 前端打包）
cd src-tauri && cargo check
cd src-tauri && cargo fmt --check

# 产物
pnpm tauri build      # 生产构建（会先跑 `pnpm build`）
```

**没有测试框架**：`package.json` 无 `test` 脚本，Rust 侧也没有 `#[test]` 用例。「单测」目前只能靠 `cargo check` / `pnpm build` 的编译期校验和手动 `pnpm tauri dev`。若任务要求验证原生能力（剪贴板、快捷键、窗口定位、MCP），必须启动 `pnpm tauri dev` 实际跑一次；本机无法完成的部分要在交付说明里写明未验证项。

代码格式化：Rust 用 `cargo fmt`；前端无独立 lint/format 脚本，靠 `tsc` 严格模式（`tsconfig.json` 开了 `strict` + `noUnusedLocals` + `noUnusedParameters`）。

## 架构导航

### 四层模型（目标架构见 `docs/ARCHITECTURE.md`）

`docs/ARCHITECTURE.md` 描述的是**目标态**：前端交互层 → Tauri IPC 层 → Service 层 → 数据/平台层。注意当前实现尚未把 Service 层抽成独立模块，落地情况以代码为准：

- **前端层**：`src/`。两个独立入口：`index.html`→`src/main.tsx`→`src/App.tsx`（快速面板），`settings.html`→`src/settings-main.tsx`→`src/settings.tsx`（设置窗）。`src/App.tsx` 目前是 ~2,800 行的单体组件；`src/routes/`、`src/stores/`、`src/workspace/` 是**进行中**的重构（TanStack Router + Zustand），新旧结构并存，改动前先确认目标文件属于哪条线。
- **Tauri IPC 层 + Service 层**：全部塞在 **`src-tauri/src/lib.rs`（单文件 ~3,400 行）**。所有 `#[tauri::command]` 函数在文件末尾的 `run()` 里通过 `tauri::generate_handler![...]` 统一注册。前端用 `@tauri-apps/api` 的 `invoke("命令名", args)` 调用，命令名与 payload 字段统一用 `#[serde(rename_all = "camelCase")]` 转成 camelCase，TS 侧对应 `src/services/contracts.ts`。
- **数据/平台层**：SQLite（`rusqlite` bundled，WAL + FTS5），schema 在 `lib.rs` 的 `init_schema()` 里，迁移用 `ensure_column()` 做「缺失就 ADD COLUMN」的轻量演进。平台分支一律用 `#[cfg(target_os = ...)]` 隔离在 Rust 层（剪贴板读写、粘贴模拟、辅助功能、NSPanel）。

### 关键运行机制（改 Rust 前必懂）

- **后台剪贴板监听线程**：`setup_app()` 里 spawn 的独立线程每 100ms 轮询系统剪贴板，变更即入库（`capture_clip_record_internal`），并通过 `app_handle.emit("clipboard-changed", ...)` 通知前端。**采集不依赖 WebView 是否可见**——这是与早期「前端监听」方案的关键差异，重构时不要退回到「只在面板可见时采集」。
- **写回抑制**：`write_clipboard_text` / `paste_clipboard_text` 会 `suppress_writeback_for()` 设一个短窗口（~450–700ms），让监听线程跳过这次「我们自己写进去」的内容，避免回环。任何新写剪贴板的代码都要考虑这一点。
- **面板定位策略**：`PanelPositionStrategy` 枚举（trayCenter / followCursor / center / windowCenter / lastPosition / focusInput），默认 `FollowCursor`。每种策略有回退链；macOS 用 `tauri-nspanel` 的浮动 panel + 辅助功能读焦点输入框位置，读不到就退回屏幕右侧。焦点位置有后台预热线程（`start_focus_prefetch_thread`）缓存。
- **MCP 是子进程而非线程内**：`start_mcp_server` 用 `current_exe() + --mcp` spawn 自己，`src-tauri/src/main.rs` 检测到 `--mcp` 就走 `run_mcp_stdio()`（在 `lib.rs` 后半段）。架构文档写的「进程内常驻」与现状略有出入，以 `main.rs` 为准。
- **两个窗口**：`main`（快速面板，无边框透明、置顶、所有工作区可见）和 `settings`（普通带边框窗口，按需创建，见 `open_settings_window`）。窗口配置在 `tauri.conf.json`。

### 服务契约（TS）

`src/services/contracts.ts` 定义了 `ClipboardRepository` / `SearchIndex` / `SyncAdapter` / `ExternalToolBridge` 等接口和 `clipboard.capture|search|copy|update|delete|export|import` 工具集。这是**面向未来**（同步、导入导出、MCP）的稳定接口契约，详情见 `docs/SERVICE_CONTRACTS.md`。当前 Rust 命令尚非严格按此契约组织，新增能力时优先对齐这里的类型。

## 工作流约定

- **提案/设计/任务拆解默认中文**（AGENTS.md）。所有 `openspec/changes/<提案名>/` 下是 `proposal.md` + `design.md` + `tasks.md` 三件套，是各功能的设计源头；动工前先看 `openspec/changes/*` 里相关的提案和 task。
- **跨平台优先**：新功能先保证不写死 macOS 专用路径；确需平台分支时隔离在 Rust `#[cfg]` 层，前端不感知平台差异。
- 本项目已配置 CodeGraph MCP（`.codegraph/`）。查符号/调用关系/改动影响面优先用 `codegraph_*` 工具而非 grep（见 `.cursor/rules/codegraph.mdc`）。注意 `lib.rs` 单文件很大，用 `codegraph_callers`/`codegraph_impact` 比全文阅读高效得多。
- 本机内存里有跨会话记忆目录（见全局 CLAUDE.md 的 Memory 说明）；项目级规则请写进 `AGENTS.md`，不要写到 CLAUDE.md。

## 关键文件坐标

| 关注点 | 位置 |
|---|---|
| 项目唯一规则源 | `AGENTS.md` |
| 前端快速面板 | `src/App.tsx`（+ `src/App.css`） |
| 前端设置窗 | `src/settings.tsx`（+ `src/settings.css`） |
| 前端契约类型 | `src/services/contracts.ts` |
| Rust 全部命令 + 监听 + IPC | `src-tauri/src/lib.rs` |
| Rust 入口 / MCP 分发 | `src-tauri/src/main.rs` |
| Tauri 配置 / 窗口定义 | `src-tauri/tauri.conf.json` |
| SQLite schema + 迁移 | `lib.rs::init_schema()` / `ensure_column()` |
| 提案与任务 | `openspec/changes/*/` |
| 架构 / 契约文档 | `docs/ARCHITECTURE.md`、`docs/SERVICE_CONTRACTS.md` |
