# 设计：剪贴板监听升级

## 交互设计

用户无感知变化：
- 复制同一内容多次，列表中只显示一条，右侧显示使用次数
- 复制图片后，面板中显示缩略图预览
- 复制文件后，面板中显示文件名和图标
- 应用自身粘贴操作不再产生重复记录

状态提示：
- 采集新内容时，状态栏显示"已记录：文本/图片/文件"
- 重复内容时，状态栏显示"已存在，计数 +1"

## 技术设计

### 1. WritebackGuard 写回防护

**全局状态管理**：
```rust
// src-tauri/src/clipboard/guard.rs
use std::sync::atomic::{AtomicBool, Ordering};

pub struct WritebackGuard {
    suppress: AtomicBool,
}

impl WritebackGuard {
    pub fn new() -> Self {
        Self {
            suppress: AtomicBool::new(false),
        }
    }

    /// 粘贴前调用，标记抑制采集
    pub fn suppress(&self) {
        self.suppress.store(true, Ordering::SeqCst);
    }

    /// 粘贴后调用，清除抑制标记
    pub fn release(&self) {
        self.suppress.store(false, Ordering::SeqCst);
    }

    /// 采集时调用，检测是否应该跳过
    pub fn should_skip(&self) -> bool {
        self.suppress.load(Ordering::SeqCst)
    }
}

lazy_static! {
    pub static ref WRITEBACK_GUARD: WritebackGuard = WritebackGuard::new();
}
```

**使用方式**：
```rust
// 粘贴命令
#[tauri::command]
pub async fn paste_clipboard_item(id: String, app: AppHandle) -> Result<(), String> {
    WRITEBACK_GUARD.suppress();  // 标记抑制

    // 写入剪贴板
    write_to_clipboard(&id, &app)?;

    // 模拟粘贴（可选）
    simulate_paste()?;

    // 延迟释放（确保采集线程已检测到抑制）
    tokio::time::sleep(Duration::from_millis(100)).await;
    WRITEBACK_GUARD.release();

    Ok(())
}

// 采集线程
fn on_clipboard_change(content: ClipboardContent) {
    if WRITEBACK_GUARD.should_skip() {
        log::debug!("Skipping writeback detection");
        return;
    }

    // 正常采集逻辑
    process_clipboard_content(content);
}
```

### 2. blake3 哈希去重

**哈希计算**：
```rust
// src-tauri/src/clipboard/hash.rs
use blake3::Hasher;

pub fn compute_hash(kind: &ClipboardKind, content: &[u8]) -> String {
    let mut hasher = Hasher::new();
    hasher.update(kind.as_bytes());  // 类型前缀
    hasher.update(content);
    hasher.finalize().to_hex().to_string()
}

pub enum ClipboardKind {
    Text,
    Image,
    Files,
    Html,
}

impl ClipboardKind {
    fn as_bytes(&self) -> &[u8] {
        match self {
            ClipboardKind::Text => b"text:",
            ClipboardKind::Image => b"image:",
            ClipboardKind::Files => b"files:",
            ClipboardKind::Html => b"html:",
        }
    }
}
```

**去重逻辑**：
```rust
// src-tauri/src/repository/items.rs
pub async fn upsert_item(
    db: &SqlitePool,
    content_hash: &str,
    kind: &str,
    content: &[u8],
    summary: &str,
) -> Result<UpsertResult, sqlx::Error> {
    // 先查询是否存在
    let existing = sqlx::query_as::<_, ClipboardItem>(
        "SELECT * FROM clipboard_items WHERE content_hash = ?"
    )
    .bind(content_hash)
    .fetch_optional(db)
    .await?;

    match existing {
        Some(item) => {
            // 已存在：更新计数和时间
            sqlx::query(
                "UPDATE clipboard_items SET use_count = use_count + 1, updated_at = ? WHERE id = ?"
            )
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(item.id)
            .execute(db)
            .await?;

            Ok(UpsertResult::Updated { id: item.id, use_count: item.use_count + 1 })
        }
        None => {
            // 不存在：插入新记录
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO clipboard_items (id, content_hash, kind, content, summary, use_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
            )
            .bind(&id)
            .bind(content_hash)
            .bind(kind)
            .bind(content)
            .bind(summary)
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(db)
            .await?;

            Ok(UpsertResult::Inserted { id })
        }
    }
}
```

### 3. Payload 解析与降级链

**数据模型**：
```rust
// src-tauri/src/clipboard/payload.rs
pub enum ClipboardPayload {
    Mixed {
        text: String,
        html: Option<String>,
        image: Option<Vec<u8>>,
    },
    RichText {
        rtf: String,
        text: String,
    },
    Html {
        html: String,
        text: String,
    },
    Text {
        content: String,
    },
    Image {
        data: Vec<u8>,
        format: ImageFormat,  // PNG/JPEG/GIF/WebP
    },
    Files {
        paths: Vec<String>,
    },
    Empty,
}

impl ClipboardPayload {
    /// 降级到最可用的格式
    pub fn fallback(&self) -> ClipboardPayload {
        match self {
            ClipboardPayload::Mixed { text, html, image } => {
                // 优先 HTML，其次图片，最后纯文本
                if html.is_some() {
                    ClipboardPayload::Html {
                        html: html.clone().unwrap(),
                        text: text.clone(),
                    }
                } else if image.is_some() {
                    ClipboardPayload::Image {
                        data: image.clone().unwrap(),
                        format: ImageFormat::Png,
                    }
                } else {
                    ClipboardPayload::Text { content: text.clone() }
                }
            }
            ClipboardPayload::RichText { text, .. } => {
                ClipboardPayload::Text { content: text.clone() }
            }
            ClipboardPayload::Html { html, text } => {
                // HTML 不可用时降级到文本
                if html.is_empty() {
                    ClipboardPayload::Text { content: text.clone() }
                } else {
                    self.clone()
                }
            }
            _ => self.clone(),
        }
    }
}
```

**解析逻辑**（macOS）：
```rust
// src-tauri/src/clipboard/reader/macos.rs
use objc2_app_kit::{NSPasteboard, NSPasteboardType};

pub fn read_from_pasteboard(pasteboard: &NSPasteboard) -> ClipboardPayload {
    let types = pasteboard.types();

    // 检查是否是 Mixed 类型（同时有文本和图片）
    let has_text = types.contains(&NSPasteboardType::String);
    let has_html = types.contains(&NSPasteboardType::HTML);
    let has_image = types.contains(&NSPasteboardType::PNG)
        || types.contains(&NSPasteboardType::TIFF);
    let has_files = types.contains(&NSPasteboardType::FileURL);

    if has_files {
        // 文件类型优先
        let urls = pasteboard.read_objects_for_class(&NSPasteboardType::FileURL);
        let paths = urls.iter().map(|u| u.path()).collect();
        return ClipboardPayload::Files { paths };
    }

    if has_text && has_image {
        // Mixed 类型
        let text = pasteboard.string_for_type(&NSPasteboardType::String);
        let html = if has_html {
            Some(pasteboard.string_for_type(&NSPasteboardType::HTML))
        } else {
            None
        };
        let image = read_image_data(pasteboard);
        return ClipboardPayload::Mixed { text, html, image };
    }

    if has_image {
        // 纯图片
        let data = read_image_data(pasteboard);
        let format = detect_image_format(pasteboard);
        return ClipboardPayload::Image { data, format };
    }

    if has_html {
        // HTML 富文本
        let html = pasteboard.string_for_type(&NSPasteboardType::HTML);
        let text = pasteboard.string_for_type(&NSPasteboardType::String);
        return ClipboardPayload::Html { html, text };
    }

    if has_text {
        // 纯文本
        let text = pasteboard.string_for_type(&NSPasteboardType::String);
        return ClipboardPayload::Text { content: text };
    }

    ClipboardPayload::Empty
}
```

### 4. macOS 轮询优化

**自定义监听线程**：
```rust
// src-tauri/src/clipboard/watcher.rs
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::time::interval;

static LAST_CHANGE_COUNT: AtomicU64 = AtomicU64::new(0);

pub async fn start_clipboard_watcher(
    app: AppHandle,
    poll_interval_ms: u64,
) {
    let mut timer = interval(Duration::from_millis(poll_interval_ms));

    loop {
        timer.tick().await;

        // 获取当前 changeCount
        let current_count = get_change_count();

        // 检测变化
        if current_count != LAST_CHANGE_COUNT.load(Ordering::SeqCst) {
            LAST_CHANGE_COUNT.store(current_count, Ordering::SeqCst);

            // 读取内容
            let payload = read_from_pasteboard();

            // 处理变化（含去重和写回防护）
            on_clipboard_change(payload, &app);
        }
    }
}

#[cfg(target_os = "macos")]
fn get_change_count() -> u64 {
    use objc2_app_kit::NSPasteboard;
    let pasteboard = unsafe { NSPasteboard::generalPasteboard() };
    pasteboard.changeCount() as u64
}
```

### 5. 图片存储策略

**磁盘存储 + 数据库引用**：
```rust
// src-tauri/src/storage/images.rs
use std::path::PathBuf;
use sha2::{Sha256, Digest};

pub fn save_image_to_disk(data: &[u8]) -> Result<PathBuf, std::io::Error> {
    // 计算哈希作为文件名
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = hasher.finalize();
    let filename = format!("{:x}.png", hash);

    // 存储路径：~/Library/Application Support/ClipForge/images/
    let app_support = dirs::data_local_dir()
        .unwrap()
        .join("ClipForge")
        .join("images");
    std::fs::create_dir_all(&app_support)?;

    let path = app_support.join(&filename);

    // 避免重复写入
    if !path.exists() {
        std::fs::write(&path, data)?;
    }

    Ok(path)
}
```

### 6. 前端状态同步

**事件驱动刷新**：
```rust
// 发送事件
app.emit("clipboard://updated", ClipboardUpdateEvent {
    id: item.id.clone(),
    kind: item.kind.clone(),
    summary: item.summary.clone(),
    is_new: is_new,
    use_count: item.use_count,
}).await?;
```

```typescript
// 前端监听
import { listen } from '@tauri-apps/api/event';

listen('clipboard://updated', (event) => {
    const payload = event.payload as ClipboardUpdateEvent;
    if (payload.is_new) {
        clipsStore.addItem(payload);
    } else {
        clipsStore.updateCount(payload.id, payload.use_count);
    }
});
```

## 边界

- macOS 优先实现原生监听，Windows 使用 Tauri 插件 + 自研防护
- 图片存储在本地磁盘，数据库存路径引用
- HTML 类型只存储源码，前端使用 DOMPurify 安全渲染
- 文件类型只存储路径，前端实时检测文件是否存在

## 验证要求

- 复制同一文本 5 次，列表中只显示 1 条，计数为 5
- 复制图片后，面板显示缩略图
- 应用内粘贴操作不产生新记录
- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `pnpm tauri dev` 验证实际行为