# 任务：文件（文件夹）上下文的 DSH 对话集成

> ⛔ **已废弃（2026-09-11 盟哥拍板）**：pi sdk（github.com/earendil-works/pi）确立为 ClipForge
> Agent 能力基础，DSH 全链废弃删除。本提案不再推进；删除进度与能力替代见
> [pi-sdk-agent-foundation](../pi-sdk-agent-foundation/proposal.md)。归档待 DSH 代码删除完成后执行。


> 状态（2026-08-17 立项）：基于既有 DSH 集成与文件采集能力，补「文件上下文」场景。能力雏形已存在，以增量改动为主。
> 多轮对话改由 `deepseek-harness-embedding` Phase 6 常驻守护进程原生支持（去掉原 v1 无状态/v2 常驻拆分）。

## Phase 1：复制地址验收 ✅（既有项收口）

- [x] 核查 `ClipContextMenu.tsx`「复制路径」（`filesAsPaths`）已存在且 `payloadKind === "file"` 才可用。
- [ ] 验收 `filesAsPaths` 实际写入纯 POSIX 路径字符串（非 `file://` URL、非文件对象）；不符则修正。
- [ ] （可选）追加「复制为 file:// URL」变体菜单项。

## Phase 2：文件内容读取（宿主侧，只读）🟡

- [ ] 新增 Rust command `read_file_for_analysis(path, max_bytes)`：判存在 / 非目录 / 文本可解码 / 未超限；返回 `{ path, size, ext, isText, snippet? }`；超限/二进制/目录返回降级原因。
- [ ] 新增 Rust command `list_directory(path, limit)`：返回顶层子项 `{ name, isDir, size, ext }`（限 200），只读。
- [ ] 单元测试覆盖：缺失文件、目录、超大文件、二进制、UTF-8/GBK 解码。

## Phase 3：文件感知的 DSH 分析 🟡

- [ ] `DshAnalyzeInput` 增加 `filePaths?: string[]` 与 `fullContent?: boolean`；Rust 侧在调 sidecar/守护进程前完成文件读取与任务构造（宿主侧读取，DSH 不碰文件系统，守 headless 只读红线）。
- [ ] `analyzeClipboardWithDsh`（App.tsx:79）对文件条目：`getFilePathsFromClip` → 调读取命令 → 构造「分析此文件：<path>\n<snippet|元数据>」任务。
- [ ] 隐私默认仅元数据；`fullContent` 需用户授权才读全文。
- [ ] `dsh-analysis.ts` / Phase 6 后的 `dsh-client.ts` 透传 `filePaths` / `fullContent` / `fileContext`。

## Phase 4：「在此文件开始对话」入口 🟡

- [ ] 文件条目右键「AI 分析」在文件场景强化为「在此文件开始对话」：点击 `setActiveSurface("dsh")` + 预填 `fileContext`（路径/是否目录）。
- [ ] `DshPanel` 接收 `fileContext`，标题/占位提示显示文件作用域；首次进入自动触发一次文件感知分析。
- [ ] 复用既有 `selectedClip` 写回链路（标签/分组）。

## Phase 5：文件夹分析 🟡

- [ ] 目录条目「在此文件夹开始对话」：调 `list_directory` → 构造「列出子项/按类型聚合/重点文件抽样」任务。
- [ ] 子项可在列表内单独「开始对话」（复用 Phase 3–4）。

## Phase 6：多轮对话（由常驻守护进程原生支持）🟡

- [ ] `DshPanel` 持 `conversationId`；追问经 `dshChat({ conversationId, messages, fileContext })`，守护进程复用同一 agent session 返回后续轮（不再「重发历史」模拟多轮）。
- [ ] `conversationId` 用于分组展示；结果/历史复用 `recordDshHistory` / `getDshHistory`。
- [ ] （前置依赖）`deepseek-harness-embedding` Phase 6 常驻守护进程必须先落地。

## Phase 7：i18n 与门禁 🟡

- [ ] i18n：新增/核对 `main.context.startFileConversation`、`main.dsh.fileContext*` 等键（中/英）。
- [ ] 既有 `verify-surface-boundaries.mjs` / `verify-runtime-boundaries.mjs` 不回归；如新增稳定 DOM marker（如 `data-dev-probe="ctx-start-file-chat"`）则补断言。
- [ ] `pnpm build:web` + `cargo check` 通过。

## Phase 8：系统级文件管理器右键（指向独立提案）⚪

- [ ] 不在本提案实现；入口在 Finder/资源管理器内的菜单需 Finder Sync Extension / Shell 扩展 → 见 [`dsh-system-context-menu`](./dsh-system-context-menu/proposal.md)。本提案仅确保应用内能力可被该系统入口复用。

## 关键技术坑（落地必读）

1. **宿主侧读取，不交给 DSH**：headless 只读红线禁止 DSH 执行文件操作；文件内容必须由 Rust/前端读取后注入任务文本，DSH 只「看」不「碰」。
2. **编码与二进制判定**：macOS 文件可能 GBK/UTF-8/二进制混杂；读取前用魔数/可解码性判定，二进制直接降级为元数据。
3. **大小上限**：单文件读取硬性限 `max_bytes`（建议 64KB 可配）；文件夹只列顶层、不递归深读。
4. **隐私默认**：未授权 `fullContent` 只发路径+元数据；全文授权开关跟随设置页，不静默发送。
5. **macOS 沙盒路径访问**：打包后需确认 entitlements 含文件访问权限，否则读取失败走降级。
6. **多轮归零**：常驻守护进程持会话态后，本提案不再重发历史，长对话无额外 token 开销。
