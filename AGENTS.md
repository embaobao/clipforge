# ClipForge 开发规范

## 项目定位

ClipForge 是一个跨平台剪贴板工具，第一目标是完整替代 Clipy 的核心能力；只有在剪贴板工具体验闭环后，才继续扩展搜索、归档、语义检索和 MCP 连接。

默认产品方向：

- ClipForge 首先必须是快速剪贴板工具，不是平台、不是 AI 工作台；界面、文案和默认入口都要围绕快捷唤起、历史、片段、文件夹、搜索、复制和删除这些高频动作。
- 主交互使用独立窗口，不把复杂输入框、搜索结果和多级列表塞进系统菜单。
- 系统托盘、全局快捷键和快速菜单是 Clipy 等价能力的一部分，优先级高于 AI/MCP。
- 搜索结果直接展示在主列表，不进入文件夹或二级面板。
- 剪贴板采集、复制回写、归档、删除、批量删除是基础能力，必须保持低延迟和可恢复。
- 片段、文件夹和快捷菜单必须服务于快速粘贴，不要做成复杂知识库或控制台。
- 后续 AI 接入只提供标准 MCP 工具调用能力，不做复杂配置面板，不把 AI 设置暴露成当前主体验。
- 后续语义检索使用本地索引优先，MCP 通过明确工具接口暴露能力。
- 视觉风格默认采用跨平台中性工具风格：克制、轻量、清晰层级、shadcn/ui 式语义 token 和 pi.dev 式黑白对比；不要绑定某一个平台的专属视觉语言。

## 技术栈

- 桌面壳：Tauri v2
- 原生能力：Rust command
- 前端：React + TypeScript + Vite
- UI：Tailwind CSS v3 + shadcn/ui 语义 token + lucide-react 图标；全局 token 与工具类集中在 `src/index.css`
- 持久化：SQLite（`rusqlite` bundled，WAL + FTS5）；小型向量索引（语义检索）为后续规划

## 常用命令

前置：Node.js 22+、pnpm 11+、Rust stable、各 OS 的 Tauri 平台依赖。

```bash
pnpm install           # 安装依赖

# 开发
pnpm tauri dev         # 完整桌面壳（先起 vite 再编译 Rust）
pnpm dev               # 仅前端（vite，http://localhost:1420，strictPort）
pnpm dev:sandbox       # 日常调试入口：数据目录隔离 + 自动开面板，见「验证要求」

# 定位
pnpm locate <关键词>    # 符号级搜索：路径/导出符号/Tauri 命令名/中文注释，多关键词 OR

# 校验（按域速查见 docs/BUSINESS_INDEX.md「验证速查」）
pnpm build:web         # tsc && vite build：类型检查 + 前端打包
pnpm test:unit         # 全量门禁：纯 TS 模块单测 + surface/边界/MCP dispatch/文件行数校验 + 索引防腐
pnpm test:interaction  # 主面板交互回归
pnpm check:i18n        # 文案 key 完整性 + 硬编码扫描
cd src-tauri && cargo check
cd src-tauri && cargo fmt --check
cd src-tauri && cargo test   # Rust 各域模块内有 #[cfg(test)] 单测

# 产物
pnpm tauri build       # 生产构建
pnpm build             # = scripts/build-mac-release.sh，macOS 发布管线（tauri build + DMG 打包）
```

## 开发规则

- 所有提案、设计说明、任务拆解默认使用中文。
- `AGENTS.md` 是唯一 Agent 文档（规则与操作参考都在此维护），`CLAUDE.md` 只放一句 `@AGENTS.md` 引用，不维护第二套内容。
- 开发前优先查看 `openspec/changes/*` 下的当前提案和任务。
- 新功能优先保持跨平台，不要先写死 macOS 专用路径；确实需要平台分支时必须隔离在 Rust 原生层。
- 用户界面必须是可用的剪贴板工具界面，不做营销落地页，不做平台首页。
- 搜索、输入、复制、删除等基础操作要优先保证焦点稳定、按钮可点击、列表不跳动。
- 样式优化应优先保持现有信息结构和控件尺寸稳定；除非需求明确，不要借视觉优化重排核心工作流。
- 不引入重型运行时，除非有明确性能和维护收益。
- 查符号/调用关系/改动影响面优先用 CodeGraph（`.codegraph/` 已建索引，`codegraph_*` MCP 工具或 `codegraph explore` CLI）；`src-tauri/src/lib.rs` 很大，`codegraph_callers`/`codegraph_impact` 优于全文阅读。
- 新增 MCP/L3 工具与 pi 侧 L2 工具属同源重复实现：每新增一处必须在 [agent-extension-seams 提案 tasks](openspec/changes/agent-extension-seams/tasks.md) 登记计数；累计达第 3 处即触发该 dormant 提案实施（工具同源注册表），不得继续手写两份。

## 验证要求

每次功能开发至少执行：

```bash
pnpm build:web
cd src-tauri && cargo check
cd src-tauri && cargo fmt --check
```

改文案跑 `pnpm check:i18n`，改主面板交互跑 `pnpm test:interaction`；按域校验速查见 [docs/BUSINESS_INDEX.md](docs/BUSINESS_INDEX.md)。CI（GitHub Actions，macOS）执行 `pnpm build` + `cargo check` + `cargo fmt --check` + `pnpm test:unit` + `pnpm check:i18n`。

涉及 Tauri 原生能力时，还应启动：

```bash
pnpm tauri dev
```

日常调试一律使用 `pnpm dev:sandbox`（CLIPFORGE_DATA_DIR 数据目录隔离 + CLIPFORGE_DEV_OPEN=panel 自动开面板）：沙箱实例的设置/数据库/日志/图片缓存全部写到独立目录，不与 `/Applications/ClipForge.app` 稳定版共享数据；稳定版常驻并持有全局快捷键，沙箱的快捷键注册失败只记 warning 不崩溃，面板经 dev-open 入口打开。稳定版只由 `pnpm tauri build` 后显式部署更新，开发构建不触碰它。

如果因为本机依赖、权限或系统安全策略无法完成，必须在交付说明中明确写出未验证项。

## 开发规范（可维护性）

为保证代码可维护、可协作、可长期演进，新增和重构代码必须遵守以下规范。门禁脚本见 [scripts/verify-file-size.mjs](scripts/verify-file-size.mjs)，豁免清单见 [scripts/file-size-exemptions.json](scripts/file-size-exemptions.json)，详见提案 [codebase-modularity-refactor](openspec/changes/codebase-modularity-refactor/proposal.md)。

### 单文件不超过 500 行

- 新增源文件、被本次改动触碰的文件，必须 ≤ 500 行（含注释）。
- 现存超长主文件（`src/App.tsx`、`src/settings.tsx`、`src-tauri/src/lib.rs`，以 `scripts/file-size-exemptions.json` 为准）列入豁免清单，按域分阶段拆分，不要求一次性达标；豁免清单只减不增，新增豁免必须在对应提案说明理由。
- 超过 500 行不是「拆成多文件」的唯一理由；当一个文件承担多个不相关职责时，即使未超限也应按域拆分。

### 必须有中文注释

- 公共能力必须有中文文档注释：Rust `#[tauri::command]`、public struct/enum/fn、TS exported interface/type、React 组件 props、MCP 工具、复杂业务逻辑（写回抑制、面板定位、settings 合并、原子写、provider 解析）。
- 注释说明「做什么、为什么、边界」，与提案/设计文档中文一致。
- 不强制行内注释；明显的小工具、CSS、纯样式常量可省略。

### 组件化与按域拆分

- 前端按 surface 拆目录：`src/settings/`、`src/agent/`、`src/clipboard/`。
- 组件职责单一，props 类型显式导出，状态提升到最近共同父级或 Zustand（仅跨组件 UI 状态）。
- 业务数据仍由 Tauri command 驱动，不把业务状态塞进全局 store。

### 样式按功能拆分（Tailwind v3，2026-09 全面迁移后）

- 全局样式只有 `src/index.css`（语义 token + 少量工具类）；旧 `App.css`/`settings.css`/`theme/tokens.css`/`*.module.css` 等已删除，禁止恢复。
- 新组件样式一律用 Tailwind 语义类（`bg-background`/`text-muted-foreground` 等，映射 hsl(var(--token))），不再新建组件级 CSS 文件。
- 全局 token 在 `index.css` 的 `:root` 定义，组件只消费不重定义；视觉契约见 `docs/DESIGN_SYSTEM.md`。
- 界面按域拆组件文件（如 `src/workspace/components/`、`src/onboarding/components/`），样式随组件用 Tailwind 类表达。

### 业务索引与快速定位

- 开发或排查前先查 [docs/BUSINESS_INDEX.md](docs/BUSINESS_INDEX.md)：「窗口/Surface → 业务域 → 入口文件」映射，以及验证速查和常见排查入口。
- 符号级定位用 `pnpm locate <关键词>`（`scripts/locate.mjs`，零依赖）：扫文件路径、TS/Rust 导出符号、`#[tauri::command]` 命令名、中文注释；支持多关键词 OR（如 `pnpm locate 写回 writeback`）。无命中时先换词再查索引表。
- 索引维护义务：新增/移动/重命名模块、Surface、Tauri command、校验脚本时，必须同步更新 `docs/BUSINESS_INDEX.md` 对应行；索引以「域」为行，不逐文件罗列，一个域多文件时入口写最常改的文件、其余写目录。
- 索引防腐：`pnpm locate --check-index` 校验索引反引号内引用的路径真实存在，已挂入 `pnpm test:unit` 末尾，索引引用失效会导致门禁失败。
- 上文「必须有中文注释」规范是 locate 的数据源：新公共能力文件头缺一句中文文档注释，定位能力即对该文件失效。

## 架构导航

业务地图（窗口/Surface → 业务域 → 入口文件）唯一维护在 [docs/BUSINESS_INDEX.md](docs/BUSINESS_INDEX.md)，本节只给大图。详细文档：`docs/ARCHITECTURE.md`（目标态架构）、`docs/DESIGN_SYSTEM.md`（视觉契约）、`docs/SERVICE_CONTRACTS.md`（服务契约）。

### 多 Surface 前端

5 个 HTML 入口（`vite.config.ts`）、3 个 Tauri 窗口（`main` / `settings` / `onboarding`，窗口属性唯一来源 `src-tauri/tauri.conf.json`）：

| Surface | 入口 | 主要目录 |
|---|---|---|
| 快速面板（主交互） | `index.html` → `src/main.tsx` → `src/App.tsx` | `src/clipboard/`（hooks + components） |
| 详情工作区 | `main` 窗口内部路由（`src/routes/workspace-router.tsx` + Zustand `src/stores/`） | `src/workspace/` |
| 设置 | `settings.html` → `src/settings-main.tsx` → `src/settings.tsx` | `src/settings/`（字段目录 + sections） |
| 引导 | `onboarding.html` → `src/onboarding-main.tsx` | `src/onboarding/` |
| dev 工具 | `preview.html`（悬浮窗验证器）、`dev-paste-target.html`（粘贴目标） | 交互测试与本地调试用 |

- 组件按域拆分进行中，进度见提案 [codebase-modularity-refactor](openspec/changes/codebase-modularity-refactor/tasks.md)。
- 文案收口 `src/i18n/`（zh-CN / en-US），不硬编码界面字符串；无 Tauri 环境的浏览器开发走 `src/services/tauri-web-mock.ts` mock（各入口首行副作用导入）。

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
- **写回抑制**：`write_clipboard_item` / `paste_clipboard_item` 会 `suppress_writeback_for()` 设短窗口（450ms / 700ms），让监听线程跳过自己写回的内容，避免回环。任何新写剪贴板的代码都要考虑这一点。
- **面板定位策略**：`PanelPositionStrategy` 枚举（默认 `FollowCursor`），每种策略有回退链；macOS 用 `tauri-nspanel` 浮动 panel + 辅助功能读焦点输入框位置，焦点位置有后台预热线程（`start_focus_prefetch_thread`）缓存。
- **MCP 是子进程而非线程内**：`start_mcp_server` 用 `current_exe() + --mcp` spawn 自己，`src-tauri/src/main.rs` 检测到 `--mcp` 就走 `run_mcp_stdio()`（实现在 `mcp/mod.rs`）。
- **数据层**：SQLite schema 与迁移都在 `lib.rs` 的 `init_schema()`：基于 `PRAGMA user_version` 的版本化迁移（当前 v2，旧版本库 DROP 重建核心表）。平台分支一律用 `#[cfg(target_os = ...)]` 隔离在 Rust 层，前端不感知平台差异。

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.52.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
