# 设计：文件与图片剪贴板支持

## 交互设计

### 列表展示

- 文本条目：保持现有展示逻辑（内容摘要 + 类型图标）。
- 图片条目：列表左侧显示 48×48 缩略图，右侧显示尺寸（如 `1920×1080`）与文件大小（如 `1.2 MB`）。
- 文件条目：
  - 单文件：显示文件图标 + 文件名 + 路径。
  - 多文件：显示堆叠图标 +「3 个文件」+ 前两个文件名。
  - 文件已删除：图标置灰，文件名加删除线。
- 富文本条目：在文本摘要前加「HTML」「RTF」小标签，粘贴时默认保留格式。

### 详情页

- 图片：展示原图，支持「复制图片」「在文件夹中显示」「删除」。
- 文件：展示文件列表，支持「在文件夹中显示」「粘贴为路径」「删除」。
- 文本：保持现有 Markdown / 代码 / 链接预览。

### 粘贴行为

- 普通粘贴：按原类型写回系统剪贴板（图片写图片，文件写文件，HTML 写 HTML + 纯文本 fallback）。
- 纯文本粘贴（如 `Cmd+Shift+V` / 右键「粘贴为纯文本」）：
  - 图片：将图片保存为临时文件后写入文件剪贴板？不，保持简单：图片不支持纯文本粘贴。
  - 文件：将路径列表当纯文本写回。
  - HTML/RTF：只写纯文本内容。

### 设置项

新增「采集设置」分组：

- 启用/禁用文本、图片、文件采集。
- 采集顺序（拖拽）：文本 / 图片 / 文件 / HTML / RTF。
- 图片大小上限（MB）。
- 文本大小上限（MB）。
- 是否采集敏感内容（API Key 等）。

## 技术设计

### 1. 依赖变更

`src-tauri/Cargo.toml` 新增：

```toml
[dependencies]
clipboard-rs = { git = "https://github.com/ayangweb/clipboard-rs", branch = "feat/configurable-watch-interval" }
blake3 = "1"
```

`image = { ..., features = ["png"] }` 已存在，可直接用于缩略图生成。

### 2. Rust 模块拆分

新增目录结构：

```
src-tauri/src/
  clipboard/
    mod.rs        # 模块入口、公共错误、子类型识别导出
    payload.rs    # ClipboardPayload / TextPayload / ImagePayload
    read.rs       # ClipboardReader
    write.rs      # write_to_clipboard
    ingest.rs     # payload -> ClipItem
    storage.rs    # ImageStore（原图 + 缩略图落盘）
    guard.rs      # WritebackGuard（写回抑制回环）
    watcher.rs    # OS 级监听（替代当前 poll_clipboard_change）
    detect.rs     # URL / Email / Color / Path 子类型识别
```

### 3. 数据模型扩展

扩展现有 `ClipItemPayload`（camelCase JSON）：

```rust
pub struct ClipItemPayload {
    pub id: String,
    pub content: String,              // 文本：原文；图片：<hash>.png；文件：换行分隔的路径列表
    pub content_hash: String,         // 去重指纹
    pub created_at: i64,
    pub updated_at: i64,
    pub last_seen_at: i64,
    pub last_copied_at: Option<i64>,
    pub source: String,
    pub kind: String,                 // text | image | files
    pub sub_kind: Option<String>,     // html | rtf | url | email | color | path
    pub bucket: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub copy_count: i64,
    pub analysis: ClipAnalysisPayload,
    pub payload_kind: String,
    pub source_app: Option<SourceAppPayload>,
    // 新增字段
    pub search_text: Option<String>,  // 用于 FTS 的纯文本/文件名
    pub width: Option<i64>,           // 图片宽
    pub height: Option<i64>,          // 图片高
    pub size: Option<i64>,            // 图片字节数 / 文本字节数
    pub file_types: Option<String>,   // "d,f,f" 文件类型标记
    pub thumbnail_path: Option<String>, // 缩略图绝对路径
}
```

数据库 `clips` 表迁移：

```sql
ALTER TABLE clips ADD COLUMN content_hash TEXT;
ALTER TABLE clips ADD COLUMN search_text TEXT;
ALTER TABLE clips ADD COLUMN sub_kind TEXT;
ALTER TABLE clips ADD COLUMN width INTEGER;
ALTER TABLE clips ADD COLUMN height INTEGER;
ALTER TABLE clips ADD COLUMN size INTEGER;
ALTER TABLE clips ADD COLUMN file_types TEXT;
ALTER TABLE clips ADD COLUMN image_file TEXT;        -- 图片文件名 <hash>.png
ALTER TABLE clips ADD COLUMN is_sensitive INTEGER DEFAULT 0;
```

为存量数据回填 `content_hash`：

```sql
UPDATE clips SET content_hash = id WHERE content_hash IS NULL;
```

FTS 表同步 `search_text`：

```sql
-- 触发器已在 sqlite-persistence 提案中定义，这里只需要确保 search_text 字段被正确填充
```

### 4. 图片存储

参考 EcoPaste 的 `ImageStore`：

```rust
pub struct ImageStore { images_root: PathBuf }

pub struct StoredImage {
    pub file_name: String,    // <blake3>.png
    pub width: i64,
    pub height: i64,
    pub size: i64,
}

impl ImageStore {
    pub fn new(app: &AppHandle) -> Result<Self>;
    pub fn store(&self, image: &ImagePayload) -> Result<StoredImage>;
    pub fn origin_path(&self, file_name: &str) -> PathBuf;
    pub fn ensure_thumbnail(&self, file_name: &str) -> Result<PathBuf>;
    pub fn remove(&self, file_name: &str) -> Result<()>;
}
```

目录布局：

```
<app_data>/resources/clipboard-images/
  origin/<hash[..2]>/<hash>.png
  thumbnails/<hash[..2]>/<hash>.png
```

### 5. 读取流程

```rust
// clipboard/read.rs
pub struct ClipboardReader { ctx: ClipboardContext }

impl ClipboardReader {
    pub fn new() -> Result<Self>;
    pub fn read_with_capture(&self, capture: &CaptureSettings) -> Result<Option<ClipboardPayload>>;
}
```

`CaptureSettings` 来自用户设置：

```rust
pub struct CaptureSettings {
    pub text: bool,
    pub html: bool,
    pub rtf: bool,
    pub image: bool,
    pub files: bool,
    pub order: Vec<CaptureKind>,      // 采集优先级
    pub max_text_bytes: Option<u64>,
    pub max_image_bytes: Option<u64>,
}
```

读取优先级按 `order` 顺序，第一个命中且非空的类型获胜。

### 6. 采集/入库流程

```rust
// clipboard/ingest.rs
pub fn build_item(
    store: &ImageStore,
    payload: &ClipboardPayload,
    capture: &CaptureSettings,
) -> Result<Option<ClipItem>>;
```

关键规则：

- 文本：`content` 存源表示（HTML/RTF/plain），`search_text` 存纯文本用于 FTS。
- 图片：`content` 存 `<hash>.png`，`content_hash = blake3(Image, file_name)`，图片字节哈希决定文件名 → 去重对字节敏感。
- 文件：`content` 存换行分隔的绝对路径，`search_text` 存文件名列表用于 FTS。
- 子类型识别：url / email / color / path（纯文本场景）。
- 大小限制：超过限制直接丢弃，避免数据库/磁盘被大文件撑爆。

### 7. 写回/粘贴流程

```rust
// clipboard/write.rs
pub fn write_to_clipboard(
    store: &ImageStore,
    guard: &WritebackGuard,
    item: &ClipItem,
    plain: bool,
) -> Result<()>;
```

- `plain = false`：按原 `kind` 写回。
- `plain = true`：强制纯文本（仅文本/文件有意义）。
- 写回前调用 `guard.suppress(content_hash)`，避免监听线程把同内容再次入库。

### 8. 监听升级

替换当前 `poll_clipboard_change` 方案：

```rust
// clipboard/watcher.rs
pub fn init_clipboard_watcher(app: &AppHandle) -> Result<()>;
```

- 使用 `ClipboardWatcherContext::start_watch()`。
- macOS 120ms 轮询 changeCount；Windows 事件驱动。
- 监听线程内构造 `ClipboardContext`，读取到 payload 后投递到 Tauri 异步运行时入库。
- 支持暂停/恢复监听。

### 9. 前端适配

#### 类型定义扩展

```typescript
// src/services/contracts.ts
export interface ClipItem {
  // ... 现有字段
  contentHash: string;
  searchText?: string;
  subKind?: "html" | "rtf" | "url" | "email" | "color" | "path";
  width?: number;
  height?: number;
  size?: number;
  fileTypes?: string;
  thumbnailPath?: string;
  imageFile?: string;
}
```

#### 新增命令封装

```typescript
// src/services/clipboard.ts
export async function readClipboard(): Promise<CaptureResult | null>;
export async function writeClipboard(id: string, plain?: boolean): Promise<void>;
export async function pasteClipboard(id: string, plain?: boolean): Promise<void>;
export async function getImagePath(fileName: string, thumbnail?: boolean): Promise<string>;
```

#### 列表项组件

- `TextClipRow`：现有文本行。
- `ImageClipRow`：缩略图 + 尺寸 + 大小。
- `FilesClipRow`：文件图标 + 文件名/数量。

### 10. 安全与边界

- **路径穿越**：`get_image_path` / `get_file_icon_path` 校验文件名只能是 `<hex>.png`，拒绝含 `/`、`.`、`..` 的输入。
- **写回回环**：`WritebackGuard` 记录最近写入的 `content_hash`，监听线程读取到同 hash 时跳过。
- **敏感内容**：检测 `sk-`、`ghp-`、`AKIA` 等前缀，按用户设置选择丢弃或标记为敏感。
- **大文件**：图片/文本大小上限可配置，默认图片 10MB、文本 1MB。

## 边界

- 文件路径条目只记录复制时的路径，不跟随文件重命名/移动同步更新。
- 图片写回时要求原图文件仍存在；若被手动删除，回写失败并提示。
- HTML/RTF 的 `search_text` 依赖 OS 同时提供的纯文本表示，若 OS 未提供则降级为内容本身（可能含标签）。
- Linux 平台依赖 `clipboard-rs` 的 Wayland/X11 支持，需验证文件复制行为。

## 验证要求

- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `cargo test` 中新增读取/写入单元测试通过（标记 `#[ignore]`，需桌面会话）
- `pnpm tauri dev` 验证：
  - 复制文本、图片、文件均能被捕获并显示在列表
  - 图片条目显示缩略图
  - 文件条目显示文件名/数量
  - 选中图片/文件条目后能正常粘贴回目标应用
  - 写回后不会触发重复入库（回环抑制）
  - 删除图片/文件条目后对应磁盘文件被清理
