# 设计：文件（文件夹）上下文的 DSH 对话集成

## 1. 入口与右键菜单（基于既有，改动小）

既有 `ClipContextMenu.tsx` 已为 `payloadKind === "file"` 提供「复制路径」（`filesAsPaths`）与「AI 分析」（DSH）。本提案改动：

- **「复制地址」验收**：确认 `filesAsPaths` 写入纯 POSIX 路径字符串（如 `/Users/x/foo.txt`），非 `file://` URL、非文件对象；不符则修正。可选追加「复制为 file:// URL」变体。
- **「在此文件开始对话」入口**：对 `payloadKind === "file"` 条目，把现有「AI 分析」在文件场景强化为「文件作用域对话」——点击 `setActiveSurface("dsh")` + 预填 `fileContext`（路径/是否目录）；首次进入自动触发一次文件感知分析。复用既有 `dsh` surface，不新增 surface。

## 2. 文件内容注入（核心缺口）

现状：`analyzeClipboardWithDsh` 传 `item.content`（路径文本）给 DSH → 模型分析路径字符串。

改为文件感知（宿主侧只读）：

- 新增 Rust command `read_file_for_analysis(path, max_bytes)`：判存在 / 非目录 / 文本可解码 / 未超限；返回 `{ path, size, ext, isText, snippet? }`；超限/二进制/目录返回降级原因。
- `analyzeClipboardWithDsh`（或 Phase 6 后的 `dshChat` 文件上下文）对文件条目：先 `getFilePathsFromClip` 取路径 → 调 `read_file_for_analysis` → 构造任务：「分析此文件：<path>\n<snippet|元数据>」。
- **隐私默认**：仅发路径 + 元数据（大小/类型/前 N 行）；全文需用户显式授权（`fullContent: true`），对齐 `ai-model-plugin-productization`。
- 文件读取工具挂到 DSH 守护进程侧（常驻服务新增 `file_read`/`file_meta` 只读工具，或在 `dsh_chat` 转发前由 Rust 完成读取与任务构造；鉴于 headless 只读红线，由**宿主 Rust 侧读取后注入任务文本**，DSH 不碰文件系统）。

## 3. 文件夹处理

- 新增 Rust command `list_directory(path, limit)`：返回顶层子项 `{ name, isDir, size, ext }`（限 200），只读。
- 目录条目「在此文件夹开始对话」：调 `list_directory` → 构造「列出子项/按类型聚合/重点文件抽样」任务。v1 不递归深读；子文件深入分析走「在列表里对该子文件单独开始对话」。

## 4. 多轮「对话」（由常驻守护进程原生支持）

`deepseek-harness-embedding` Phase 6 把一次性 sidecar 演进为**常驻 DSH host 服务**，会话态由 DSH 按 `conversationId` 持有。因此：

- 本提案**不再实现「v1 无状态多轮（重发历史）」**，去掉原 v1/v2 拆分。
- `DshPanel` 持 `conversationId`；追问直接 `dshChat({ conversationId, messages, fileContext })`，守护进程复用同一 agent session 返回后续轮，原生多轮。
- 写回/历史复用既有 `recordDshHistory` / `getDshHistory`（展示层缓存）。
- 代价归零：不再每轮重发历史全文，长对话无额外 token 开销（由守护进程会话态解决）。

## 5. 降级与隐私契约

- 文件缺失 / 读取失败 / 超限 / 二进制 → 降级「仅元数据」；仍无 node/key/超时 → 守护进程 degraded 路径，基础剪贴板不受影响。
- 隐私：默认不发全文；授权开关跟随设置页能力，不静默发送。
- 写回（标签/分组）仍走 preview/confirm（WritebackGuard）。

## 6. 参考项目印证

`anywhere-labs/deepseek-harness-desktop` 把桌面壳做成 DSH 插件、组合进同一运行时；我们延续「宿主薄桥接 + 插件」，把「桌面窗口」换成「悬浮剪贴板 + 文件上下文」。差异（刻意）：headless 只读、不启 Web UI/Host 的 Web 界面，AI 入口是悬浮面板——与 `deepseek-harness-embedding` 一致。常驻守护进程转向直接采用其 Host-Service Separation。

## 7. 系统级文件管理器右键（指向独立提案）

在 Finder / 资源管理器内直接出「复制地址」「在此文件开始对话」菜单，需 Finder Sync Extension（macOS）/ Shell 扩展（Windows）等重原生工作 → **不在本提案**，见 [`dsh-system-context-menu`](./dsh-system-context-menu/proposal.md)。本提案只覆盖应用内右键（`ClipContextMenu`），系统级入口由该提案扩展并复用本提案能力。
