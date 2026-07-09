# 提案：文件与图片剪贴板支持

## 背景

当前 ClipForge 的剪贴板能力仅覆盖纯文本：

- 读取：`read_platform_clipboard()` 依赖 `pbpaste` / `powershell Get-Clipboard` / `wl-paste` / `xclip` / `xsel` 等 shell 命令，只能取到文本表示。
- 写入：`write_platform_clipboard()` 同样只能写回文本。
- 采集：`capture_clip_record_internal()` 将剪贴板内容视为字符串，去重哈希也是 `content_hash(&payload_kind, content.as_bytes())`。
- 数据模型：`ClipItemPayload` 只有 `content`、`payload_kind` 两个字段承载内容，没有图片文件路径、文件列表、缩略图、宽高、文件类型等字段。
- 监听：`poll_clipboard_change()` 只通过 `changeCount` / 文本 hash 判断是否变化，无法感知图片/文件复制事件。

这导致用户复制图片、复制文件、复制富文本（HTML/RTF）时，ClipForge 完全无法记录或回写。

## 目标

让 ClipForge 支持剪贴板中的完整内容类型，优先级：

1. **图片**：读取 PNG/TIFF/DIB 等来源，落盘为 PNG，列表展示缩略图，粘贴时写回图片。
2. **文件路径列表**：读取多个文件/目录路径，落库存储，粘贴时写回文件剪贴板或纯文本路径列表。
3. **富文本**：读取 HTML / RTF 源表示，纯文本作为检索文本，粘贴时保留原格式。
4. **类型偏好配置**：允许用户在「文本优先 / 图片优先 / 文件优先」之间调整采集顺序与开关。

## 非目标

- 不实现文件内容内嵌预览（如 Office 文档、PDF 内容预览）。
- 不实现跨设备同步。
- 不实现 OCR（后续独立提案）。
- 不实现图片编辑（旋转、裁剪）。
- 不替换现有 SQLite / rusqlite 方案为 sqlx（保持当前持久化层）。

## 用户价值

- 复制截图、图片、文件后 ClipForge 能记录历史。
- 设计师、开发者可以回溯之前复制的图片/文件路径。
- 粘贴时保留原格式（如从浏览器复制的带样式文本）。

## 技术调研结论

### 参考实现：EcoPaste

EcoPaste 使用 [`clipboard-rs`](https://github.com/ayangweb/clipboard-rs) 作为底层剪贴板库，已完成 macOS / Windows 双平台实现，结构清晰：

- `clipboard/payload.rs`：定义 `ClipboardPayload::Text | Image | Files` 三类载荷。
- `clipboard/read.rs`：`ClipboardReader` 基于 `ClipboardContext` 读取多格式，图片优先直取 PNG 原始字节（零解码），否则回退到库解码重编码为 PNG。
- `clipboard/write.rs`：`write_to_clipboard()` 按 `kind` 写回 text / html / rtf / image / files，并用 `WritebackGuard` 抑制回环。
- `clipboard/ingest.rs`：`build_item_with_settings()` 把 `ClipboardPayload` 转换为 `ClipboardItem`，包含子类型识别（url/email/color/path）、敏感内容过滤、图片落盘。
- `clipboard/storage.rs`：`ImageStore` 按 blake3 hash 分片存储原图与缩略图，缩略图延迟生成。
- `clipboard/watcher.rs`：用 `ClipboardWatcherContext` 做 OS 级监听，macOS 轮询 changeCount 120ms，Windows 事件驱动。
- `db/models.rs`：`ClipboardItem` 包含 `kind`、`sub_kind`、`width`、`height`、`size`、`file_types`、`search_text` 等字段。

### 关键技术选择

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 继续用 shell 命令 + AppleScript | 无新依赖 | 图片/文件支持差，跨平台代码碎片化 | 不推荐 |
| 引入 `clipboard-rs` | 跨平台、支持 text/html/rtf/image/files、社区验证 | 增加依赖 | **采用** |
| 自写平台绑定（NSPasteboard / Win32 OLE） | 完全可控 | 工作量大、跨平台维护成本高 | 暂不考虑 |

**选择 `clipboard-rs`**：EcoPaste 已验证其稳定性，且提供可配置的监听间隔 fork，能直接替换 ClipForge 当前的 shell 命令轮询方案。

### 与当前代码的关系

- 保留现有 `tauri-nspanel` 窗口、`global-shortcut`、SQLite schema 迁移、FTS5 搜索等机制。
- 将 `lib.rs` 中的剪贴板相关函数拆出到 `src/clipboard/` 模块。
- 将 `read_clipboard_text` / `write_clipboard_text` / `paste_clipboard_text` 升级为支持全类型的命令。
