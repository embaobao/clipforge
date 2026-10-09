# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 主规则：先读 AGENTS.md

本项目的唯一规则源是 [`AGENTS.md`](AGENTS.md)，进入项目前必须先读它（含 Backlog.md 工作流：会话开始先跑 `backlog instructions overview`）。`CLAUDE.md` 不维护第二套规则，下列内容只是**操作参考**（命令、架构导航、文件坐标），产品约束与开发规范（500 行门禁、中文注释义务、样式契约等）一律以 `AGENTS.md` 为准，不要在此重复或改写。

一句话定位：ClipForge 是一个跨平台**快速剪贴板工具**（Tauri v2 + React 19 + TypeScript + Tailwind v3/shadcn + SQLite），第一目标是完整替代 Clipy 的核心体验；AI/Agent 能力只作为显式工具接入（pi 运行时 + MCP），它**不是** AI 平台或知识库。

## 常用命令

前置：Node.js 22+、pnpm 11+、Rust stable、各 OS 的 Tauri 平台依赖。

```bash
pnpm install           # 安装依赖

# 开发
pnpm tauri dev         # 完整桌面壳（先起 vite 再编译 Rust）
pnpm dev               # 仅前端（vite，http://localhost:1420，strictPort）
pnpm dev:sandbox       # 日常调试入口（AGENTS.md 指定）：CLIPFORGE_DATA_DIR 独立数据目录
                       # + CLIPFORGE_DEV_OPEN=panel 自动开面板，不与稳定版共享数据

# 校验（CI 在 macOS 上跑 pnpm build + cargo check + cargo fmt --check）
pnpm build:web         # tsc && vite build：类型检查 + 前端打包，改前端必跑
pnpm test:unit         # 全量门禁：纯 TS 模块单测 + surface/边界/MCP dispatch/文件行数校验 + 索引防腐
pnpm test:interaction  # 主面板交互回归
pnpm check:i18n        # 文案 key 完整性 + 硬编码扫描，改文案必跑
pnpm locate <关键词>    # 符号级搜索：路径/导出符号/Tauri 命令名/中文注释，多关键词 OR
cd src-tauri && cargo check
cd src-tauri && cargo fmt --check
cd src-tauri && cargo test   # Rust 各域模块内有 #[cfg(test)] 单测

# 产物
pnpm tauri build       # 生产构建
pnpm build             # = scripts/build-mac-release.sh，macOS 发布管线（tauri build + DMG 打包）
```

改了哪个域要跑哪些校验，见 `docs/BUSINESS_INDEX.md` 的「验证速查」。涉及原生能力（剪贴板、快捷键、窗口定位、MCP）必须 `pnpm tauri dev`（或 dev:sandbox）实跑一次；本机无法完成的部分在交付说明里写明未验证项。

## 架构导航

### 多 Surface 前端（业务地图先查 `docs/BUSINESS_INDEX.md`）

5 个 HTML 入口（`vite.config.ts`）、3 个 Tauri 窗口（`main` / `settings` / `onboarding`，窗口属性唯一来源 `tauri.conf.json`）：

| Surface | 入口 | 主要目录 |
|---|---|---|
| 快速面板（主交互） | `index.html` → `src/main.tsx` → `src/App.tsx` | `src/clipboard/`（hooks + components） |
| 详情工作区 | `main` 窗口内部路由（`src/routes/workspace-router.tsx` + Zustand `src/stores/`） | `src/workspace/` |
| 设置 | `settings.html` → `src/settings-main.tsx` → `src/settings.tsx` | `src/settings/`（字段目录 + sections） |
| 引导 | `onboarding.html` → `src/onboarding-main.tsx` | `src/onboarding/` |
| dev 工具 | `preview.html`（悬浮窗验证器）、`dev-paste-target.html`（粘贴目标） | 交互测试与本地调试用 |

- 组件按域拆分进行中（见 `openspec/changes/codebase-modularity-refactor/`）；单文件 ≤500 行门禁由 `scripts/verify-file-size.mjs` 执行，豁免清单 `scripts/file-size-exemptions.json` 只减不增，`App.tsx`/`settings.tsx`/`lib.rs` 是当前豁免的超长文件。
- 样式只有 Tailwind v3 语义类 + shadcn/ui（`src/components/ui/`），语义 token 唯一来源 `src/index.css`，不新建组件级 CSS；视觉契约见 `docs/DESIGN_SYSTEM.md`。
- 文案收口 `src/i18n/`（zh-CN / en-US），不硬编码界面字符串。
- 无 Tauri 环境的浏览器开发走 `src/services/tauri-web-mock.ts` mock（各入口首行副作用导入）。

### Rust 侧：lib.rs 门面 + 域模块

`src-tauri/src/lib.rs`（超长豁免单文件）保留剪贴板/面板命令、托盘、窗口管理，以及 `run()` 末尾的 `tauri::generate_handler![...]` 统一注册；各域已下沉为模块，新能力写进对应模块、不要续接 lib.rs：

- `clipboard/`：采集引擎（`watcher.rs` 轮询监听 → `ingest.rs` 入库 → read/write/storage/detect/payload）
- `settings_service/`：`settings_service_*` 统一协议，设置窗口与 MCP 复用的唯一服务入口（原子写 + 敏感字段 redaction/keyRef 回填）
- `agent/`：pi 运行时（provider 解析/健康检查/run 状态机/事件流；API key 只写不回显）
- `mcp/`：`--mcp` stdio JSON-RPC 运行时（`mod.rs::run_mcp_stdio` 门面 + `specs.rs` 工具规格表 + `dispatch*.rs` 路由）
- `context_collectors*` / `application_context`：Agent 上下文采集与聚合

前端用 `invoke("命令名", args)` 调用，payload 字段经 `#[serde(rename_all = "camelCase")]` 转 camelCase，TS 契约类型在 `src/services/contracts/`。

### 关键运行机制（改 Rust 前必懂）

- **后台剪贴板监听线程**：`setup_app()` spawn 的独立线程轮询系统剪贴板，变更即入库并通过 `emit("clipboard-changed", ...)` 通知前端。采集不依赖 WebView 是否可见，不要退回「只在面板可见时采集」。
- **写回抑制**：`write_clipboard_text` / `paste_clipboard_text` 会 `suppress_writeback_for()` 设短窗口（450–700ms），让监听线程跳过自己写回的内容，避免回环。任何新写剪贴板的代码都要考虑这一点。
- **面板定位策略**：`PanelPositionStrategy` 枚举（默认 `FollowCursor`），每种策略有回退链；macOS 用 `tauri-nspanel` 浮动 panel + 辅助功能读焦点输入框位置，焦点位置有后台预热线程（`start_focus_prefetch_thread`）缓存。
- **MCP 是子进程而非线程内**：`start_mcp_server` 用 `current_exe() + --mcp` spawn 自己，`src-tauri/src/main.rs` 检测到 `--mcp` 就走 `run_mcp_stdio()`（实现在 `mcp/mod.rs`）。
- **数据层**：SQLite（`rusqlite` bundled，WAL + FTS5），schema 在 `lib.rs` 的 `init_schema()`，迁移用 `ensure_column()` 做「缺失就 ADD COLUMN」的轻量演进。平台分支一律用 `#[cfg(target_os = ...)]` 隔离在 Rust 层。

## 工作流约定

- **提案/设计/任务拆解默认中文**（AGENTS.md）。动工前先看 `openspec/changes/*` 里相关的提案和 task。
- **定位业务先查 `docs/BUSINESS_INDEX.md`**（窗口/Surface → 业务域 → 入口文件），符号级用 `pnpm locate`；新增/移动/重命名模块、Surface、Tauri command 必须同步更新该索引（已挂入门禁）。
- **跨平台优先**：新功能先保证不写死 macOS 专用路径；确需平台分支时隔离在 Rust `#[cfg]` 层，前端不感知平台差异。
- 本项目已配置 CodeGraph MCP（`.codegraph/`）。查符号/调用关系/改动影响面优先用 `codegraph_*` 工具；`lib.rs` 单文件很大，用 `codegraph_callers`/`codegraph_impact` 比全文阅读高效得多。
- 项目级规则写进 `AGENTS.md`，不要写到 CLAUDE.md；跨会话记忆用全局 memory 目录。

## 关键文件坐标

| 关注点 | 位置 |
|---|---|
| 项目唯一规则源 | `AGENTS.md` |
| 业务地图（Surface → 域 → 入口 + 验证速查） | `docs/BUSINESS_INDEX.md` |
| 前端快速面板 | `src/App.tsx` + `src/clipboard/` |
| 详情工作区 | `src/routes/workspace-router.tsx` + `src/workspace/` |
| 前端设置窗 | `src/settings.tsx` + `src/settings/` |
| 前端引导窗 | `src/onboarding/` |
| Agent/pi 前端 | `src/agent/pi/` |
| 前端契约类型 | `src/services/contracts.ts` + `src/services/contracts/` |
| i18n 文案 | `src/i18n/locales/` |
| Rust 门面（命令注册/托盘/窗口） | `src-tauri/src/lib.rs` |
| Rust 域模块 | `src-tauri/src/{clipboard,settings_service,agent,mcp}/` |
| Rust 入口 / MCP 分发 | `src-tauri/src/main.rs` |
| Tauri 配置 / 窗口定义 | `src-tauri/tauri.conf.json` |
| SQLite schema + 迁移 | `lib.rs::init_schema()` / `ensure_column()` |
| 门禁脚本 | `scripts/`（豁免清单 `scripts/file-size-exemptions.json`） |
| 提案与任务 | `openspec/changes/*/` |
| 架构 / 设计系统 / 契约文档 | `docs/ARCHITECTURE.md`、`docs/DESIGN_SYSTEM.md`、`docs/SERVICE_CONTRACTS.md` |
