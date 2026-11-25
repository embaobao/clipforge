# 架构说明

> 事实来源：当前源码与 [AGENT_MAP.md](./AGENT_MAP.md)（由 CodeGraph 生成并校验）。早期文档中的 `ClipboardService` / `WindowService` / `LogService` 类式 API 与 10 条 MCP 工具是历史规划，已不存在；本文按当前实现重写。

## 1. 进程与入口

| 入口 | 作用 | 代码 |
|---|---|---|
| 主应用 `clipforge` | Tauri 主进程，面板 / 设置 / 引导窗口，全局快捷键与托盘 | `src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json` |
| MCP sidecar `clipforge --mcp` | stdio JSON-RPC，供外部 Agent 调用 41 条工具 | `src-tauri/src/mcp/` |
| Web 开发入口 | 浏览器 mock 桥，不是生产入口 | `src/services/tauri-web-mock.ts` |

前端是 React + TypeScript + Vite；Tauri command 通过 `src/services/clipboard.ts` 等封装 invoke。业务数据仍由 Rust command 和 SQLite 驱动，Zustand 只承载跨组件 UI 状态。

| Surface | HTML 入口 | 前端根 | 主要目录 |
|---|---|---|---|
| 快速面板（主交互） | `index.html` | `src/main.tsx` → `src/App.tsx` | `src/clipboard/` |
| 详情工作区 | `index.html`（内部路由） | `src/routes/workspace-router.tsx` | `src/workspace/` |
| 设置 | `settings.html` | `src/settings-main.tsx` → `src/settings.tsx` | `src/settings/` |
| 引导 | `onboarding.html` | `src/onboarding-main.tsx` → `src/onboarding/` |

## 2. Rust 域模块

当前实现是「thin command 壳 + 按域拆分的 Rust 模块」，不是类式 Service Layer。

| 域 | 入口 / 核心文件 | 职责 |
|---|---|---|
| command 注册 | `src-tauri/src/lib.rs` | setup、`generate_handler!`、窗口 / 面板 / 托盘 / 日志胶水；超长豁免文件，用 `pnpm locate <命令名>` 定位 |
| 剪贴板引擎 | `src-tauri/src/clipboard/` | `watcher.rs` 采集监听；`capture_worker.rs` 有界队列与工作线程；`ingest.rs` 入库；`read.rs` / `write.rs` 读取与写回；`storage.rs` 清理与回收站；`detect.rs` 与 `payload.rs` 检测/载荷；`search_index.rs` 汉字逐字 FTS 与 v3 升级重建；`tag_cleanup.rs` 话题标签校验 |
| 设置服务 | `src-tauri/src/settings_service/` | 统一设置协议、原子写、写锁、redaction、快捷键与托盘同步、MCP 分发 |
| Agent / pi SDK | `src-tauri/src/agent/` | provider 探测 / 健康检查 / 模型清单、run 状态机、事件流、上下文与 prompt 组装 |
| MCP 运行时 | `src-tauri/src/mcp/` | `specs.rs` 定义 41 工具，`dispatch*.rs` 分发，`context.rs` 上下文快照，`envelope.rs` 响应封装 |
| OCR | `src-tauri/src/ocr/` | 系统 Vision 内置引擎 + 端点探测 / 提取 / 缓存 |
| 上下文采集 | `src-tauri/src/context_collectors.rs`、`context_collector_runtime.rs`、`context_collector_system.rs`、`application_context.rs` | Agent 上下文收集、前台应用信息聚合 |

`src-tauri/src/lib.rs` 仍是超长豁免文件；拆分计划见 `openspec/changes/codebase-modularity-refactor/`。新增模块时要同步更新 `docs/BUSINESS_INDEX.md` 与 `docs/AGENT_MAP.md`。

## 3. MCP 边界

- 工具规格：`src-tauri/src/mcp/specs.rs`，41 条固定工具；新增或删除工具必须同步更新 dispatch 与 golden 测试。
- 分发：`mcp/dispatch.rs` 及按域拆出的 `dispatch_write.rs`、`dispatch_merge.rs`、`dispatch_agent_editor.rs`。
- 响应信封：成功结果含 `traceId`、`businessChain`、`permissionDecision`；失败结果含 `error.data.hint`（见 `mcp/envelope.rs`）。
- 能力边界：只读工具不需要逐次确认；写库按工具声明要求授权；内容写回与危险操作保持逐次确认。
- 与 Tauri command 共用 Rust 域能力，但不共用 UI 状态；宿主自有工具不计入前端 L2 同源重复实现计数。

## 4. 数据层

- SQLite：`WAL` + `synchronous=NORMAL`，FTS5；schema `user_version = 3`。
- 剪贴板库升级到 v3 时重建全文索引：汉字按单字切分，查询侧同规则并给末词加前缀匹配；English 保持 unicode61 分片。
- `clips` 表是主数据；软删除进回收站，超数量上限移入回收站而不是硬删；定期清理只硬删过期回收站。
- 标签：合法 `#话题` 才自动入库；类型标签默认不写标签列，按 `kind` 过滤；存量垃圾标签在 v3 升级时移除并记入 `metadata.tags_retired`。
- 采集去重按 `content_hash`；命中软删除条目走 promote（复活并重新入全文索引）。

## 5. 前端交互与热路径

- 主列表使用虚拟滚动；搜索 / 类型 / 收藏过滤直接作用于主列表。
- 搜索请求走 `src/clipboard/clip-search.ts` 构建，Rust 侧 `search_clip_records` 按 `last_seen_at DESC` 返回；`@` 命令、`#` 标签与关键词联想在 `src/search-query.ts`、`src/clipboard/keyword-suggestions.ts`。
- 关键词索引按最近历史惰性构建；拼音开关来自设置。下拉键盘处理在 `src/clipboard/use-panel-keyboard.ts`，输入法组字期间不弹出候选。
- 面板打开前同步预采集，避免首帧旧列表；采集工作线程有界队列满时回退内联并记录限频告警。
- 失焦 60ms 后检查 `PANEL_PINNED`，未固定才走原生淡出隐藏；淡出入口有幂等守卫与代际号，防止快捷键与失焦互相抢占。
- `pnpm test:perf-panel` 的 show/hide 端到端阈值是 180ms；该探针依赖 CGEvent 全局热键，锁屏时必然超时。

## 6. 面板定位

所有定位计算统一在全局逻辑点空间（主屏左上原点），避免 Retina / 混合 DPI 偏移：

- 光标：macOS 用 `CGEvent.location()` 取逻辑坐标。
- 选屏：`monitor_for_logical_point` 用工作区逻辑边界命中，不以 `current_monitor()` 回退（面板隐藏时会指向上次所在屏）。
- `open_panel` 同步定位后显示；显示后不再用焦点框位置异步覆盖定位（见 `focus-prefetch-idle-removal` 提案）。
- 焦点框位置只在粘贴目标快照 `snapshot_paste_target_bounds` 中按需读取，写独立 `PASTE_TARGET_BOUNDS_CACHE`；`focused_input_bounds` 命令仅为兼容面保留。
- `positionStrategy` 设置项不参与当前后端策略选择；`FocusInput` 分支保留仅为枚举兼容。

## 7. 控制面与预算

- 控制面：设置窗口、Agent provider 配置、MCP 设置工具、schema / revision / redaction / provider check / model list。
- 热路径：全局快捷键、面板显隐与定位、采集监听、虚拟列表滚动与选中、复制 / 粘贴写回、当前面板搜索过滤。
- 热路径禁止同步等待 schema、MCP、provider check 或 models。
- 主面板交互预算：show/hide 端到端 ≤180ms；首屏列表不做阻塞式上下文采集，扩展上下文走后台线程。

## 8. 配置与日志

- 用户配置写入系统用户目录的 JSON5；设置合并对缺键逐项回落默认值，写入有 revision 与原子替换。
- 日志写入本地文件并自动清理；用 `pnpm locate` 查日志相关 command 与滚动策略。
- 设置页展示配置与数据库路径；所有用户可改项通过字段目录与运行时规格收敛。

## 9. 技术栈

- 桌面壳：Tauri v2。
- 原生能力：Rust command；macOS 面板用 `tauri-nspanel`，其他平台用 WebviewWindow。
- 前端：React + TypeScript + Vite。
- UI：Tailwind CSS v3 + shadcn/ui 语义 token + lucide-react；全局 token 唯一来源 `src/index.css`。
- 持久化：SQLite（rusqlite）+ WAL + FTS5。
- 检索：当前为本地字面检索与关键词联想；语义检索 / 向量索引尚未实现，方案决策见 Plannotator Inbox。
