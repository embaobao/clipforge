# 设计：SQLite 持久化迁移

## 交互设计

用户无感知迁移：
- 现有 localStorage 数据自动迁移到 SQLite
- 首次启动时后台迁移，显示进度条
- 迁移完成后删除 localStorage 数据
- 后续所有读写走 SQLite

搜索体验升级：
- 搜索输入实时响应（FTS5 索引）
- 支持中英文混合搜索
- 支持 tag:keyword 语法（后续）

列表分页：
- 默认加载 20 条
- 滚动触底加载更多
- 返回 total + has_more 精确判断

## 技术设计

### 1. 数据库初始化

**连接池创建**：
```rust
// src-tauri/src/db/init.rs
use sqlx::sqlite::{SqlitePoolOptions, SqliteConnectOptions};
use std::path::PathBuf;

pub async fn init_db() -> Result<SqlitePool, sqlx::Error> {
    let db_path = get_db_path();

    // 确保目录存在
    std::fs::create_dir_all(db_path.parent().unwrap())?;

    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // 运行迁移
    run_migrations(&pool).await?;

    Ok(pool)
}

fn get_db_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap()
        .join("ClipForge")
        .join("clipforge.db")
}
```

### 2. 数据库迁移

**迁移脚本**（sqlx migrate）：
```sql
-- migrations/001_init.sql
CREATE TABLE clipboard_items (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL,
    summary TEXT,
    search_text TEXT,
    source_app TEXT,
    source_app_path TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE VIRTUAL TABLE clipboard_items_fts USING fts5(
    search_text,
    content='clipboard_items',
    content_rowid='rowid'
);

CREATE INDEX idx_created_at ON clipboard_items(created_at DESC);
CREATE INDEX idx_updated_at ON clipboard_items(updated_at DESC);
CREATE INDEX idx_content_hash ON clipboard_items(content_hash);
CREATE INDEX idx_kind ON clipboard_items(kind);
CREATE INDEX idx_is_pinned ON clipboard_items(is_pinned);
CREATE INDEX idx_is_favorite ON clipboard_items(is_favorite);
CREATE INDEX idx_is_deleted ON clipboard_items(is_deleted);

-- migrations/002_snippets.sql
CREATE TABLE snippets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    folder_id TEXT,
    is_favorite INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE INDEX idx_snippets_folder ON snippets(folder_id);
CREATE INDEX idx_snippets_favorite ON snippets(is_favorite);

-- migrations/003_folders.sql
CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE INDEX idx_folders_parent ON folders(parent_id);
```

### 3. FTS5 搜索触发器

**自动同步 FTS 索引**：
```sql
-- 插入时同步到 FTS
CREATE TRIGGER clipboard_items_ai AFTER INSERT ON clipboard_items BEGIN
    INSERT INTO clipboard_items_fts (rowid, search_text)
    VALUES (new.rowid, new.search_text);
END;

-- 更新时同步到 FTS
CREATE TRIGGER clipboard_items_au AFTER UPDATE ON clipboard_items BEGIN
    UPDATE clipboard_items_fts
    SET search_text = new.search_text
    WHERE rowid = new.rowid;
END;

-- 删除时从 FTS 移除
CREATE TRIGGER clipboard_items_ad AFTER DELETE ON clipboard_items BEGIN
    INSERT INTO clipboard_items_fts (clipboard_items_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
END;
```

### 4. CRUD 操作

**插入/更新（含去重）**：
```rust
// src-tauri/src/repository/items.rs
use sqlx::{SqlitePool, query_as};

pub struct ClipboardItem {
    pub id: String,
    pub content_hash: String,
    pub kind: String,
    pub content: String,
    pub summary: Option<String>,
    pub search_text: Option<String>,
    pub source_app: Option<String>,
    pub is_pinned: bool,
    pub is_favorite: bool,
    pub use_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn upsert_item(
    pool: &SqlitePool,
    content_hash: &str,
    kind: &str,
    content: &str,
    summary: &str,
    search_text: &str,
    source_app: Option<&str>,
) -> Result<UpsertResult, sqlx::Error> {
    // 查询是否存在
    let existing: Option<ClipboardItem> = sqlx::query_as(
        "SELECT * FROM clipboard_items WHERE content_hash = ? AND is_deleted = 0"
    )
    .bind(content_hash)
    .fetch_optional(pool)
    .await?;

    match existing {
        Some(item) => {
            // 更新计数和时间
            sqlx::query(
                "UPDATE clipboard_items SET use_count = use_count + 1, updated_at = ? WHERE id = ?"
            )
            .bind(chrono::Utc::now().to_rfc3339())
            .bind(&item.id)
            .execute(pool)
            .await?;

            Ok(UpsertResult::Updated {
                id: item.id,
                use_count: item.use_count + 1,
            })
        }
        None => {
            // 插入新记录
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            sqlx::query(
                "INSERT INTO clipboard_items (id, content_hash, kind, content, summary, search_text, source_app, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&id)
            .bind(content_hash)
            .bind(kind)
            .bind(content)
            .bind(summary)
            .bind(search_text)
            .bind(source_app)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await?;

            Ok(UpsertResult::Inserted { id })
        }
    }
}

pub enum UpsertResult {
    Inserted { id: String },
    Updated { id: String, use_count: i64 },
}
```

**FTS5 搜索**：
```rust
pub async fn search_items(
    pool: &SqlitePool,
    query: &str,
    kind: Option<&str>,
    is_favorite: Option<bool>,
    limit: i64,
    offset: i64,
) -> Result<SearchResult, sqlx::Error> {
    // 构建 FTS5 查询
    let fts_query = format!("\"{}\"", query);  // 精确匹配

    let mut sql = String::from(
        "SELECT ci.* FROM clipboard_items ci
         JOIN clipboard_items_fts fts ON ci.rowid = fts.rowid
         WHERE clipboard_items_fts MATCH ? AND ci.is_deleted = 0"
    );

    if let Some(k) = kind {
        sql.push_str(&format!(" AND ci.kind = '{}'", k));
    }
    if let Some(true) = is_favorite {
        sql.push_str(" AND ci.is_favorite = 1");
    }

    sql.push_str(" ORDER BY ci.is_pinned DESC, ci.created_at DESC LIMIT ? OFFSET ?");

    let items: Vec<ClipboardItem> = sqlx::query_as(&sql)
        .bind(&fts_query)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

    // 查询总数
    let total: i64 = sqlx::query_as(
        "SELECT COUNT(*) as count FROM clipboard_items WHERE is_deleted = 0"
    )
    .fetch_one(pool)
    .await?
    .count;

    Ok(SearchResult {
        items,
        total,
        has_more: offset + limit < total,
    })
}
```

**分页查询**：
```rust
pub async fn list_items(
    pool: &SqlitePool,
    kind: Option<&str>,
    is_favorite: Option<bool>,
    is_pinned: Option<bool>,
    limit: i64,
    offset: i64,
) -> Result<ListResult, sqlx::Error> {
    let mut sql = String::from(
        "SELECT * FROM clipboard_items WHERE is_deleted = 0"
    );

    if let Some(k) = kind {
        sql.push_str(&format!(" AND kind = '{}'", k));
    }
    if let Some(true) = is_favorite {
        sql.push_str(" AND is_favorite = 1");
    }
    if let Some(true) = is_pinned {
        sql.push_str(" AND is_pinned = 1");
    }

    sql.push_str(" ORDER BY is_pinned DESC, created_at DESC LIMIT ? OFFSET ?");

    let items: Vec<ClipboardItem> = sqlx::query_as(&sql)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM clipboard_items WHERE is_deleted = 0"
    )
    .fetch_one(pool)
    .await?;

    Ok(ListResult {
        items,
        total: total.0,
        has_more: offset + limit < total.0,
    })
}
```

### 5. localStorage 迁移

**迁移脚本**：
```rust
// src-tauri/src/migration/localstorage.rs
use serde_json::Value;
use sqlx::SqlitePool;

pub async fn migrate_from_localstorage(
    pool: &SqlitePool,
    localstorage_json: &str,
) -> Result<MigrationResult, String> {
    let data: Value = serde_json::from_str(localstorage_json)
        .map_err(|e| format!("Parse localStorage failed: {}", e))?;

    let items = data["clips"].as_array()
        .ok_or("No clips array in localStorage")?;

    let mut migrated = 0;
    let mut skipped = 0;

    for item in items {
        let content = item["content"].as_str().unwrap_or("");
        if content.is_empty() {
            skipped += 1;
            continue;
        }

        let content_hash = compute_hash(&ClipboardKind::Text, content.as_bytes());

        // 使用 upsert 避免重复
        match upsert_item(pool, &content_hash, "text", content, content, content, None).await {
            Ok(_) => migrated += 1,
            Err(_) => skipped += 1,
        }
    }

    Ok(MigrationResult { migrated, skipped })
}
```

**前端调用迁移**：
```typescript
// src/services/migration.ts
import { invoke } from '@tauri-apps/api/core';

export async function migrateLocalStorage(): Promise<MigrationResult> {
    // 从 localStorage 读取现有数据
    const clipsJson = localStorage.getItem('clips') || '[]';
    const snippetsJson = localStorage.getItem('snippets') || '[]';
    const foldersJson = localStorage.getItem('folders') || '[]';

    const result = await invoke('migrate_from_localstorage', {
        clipsJson,
        snippetsJson,
        foldersJson,
    });

    // 迁移成功后清除 localStorage
    localStorage.removeItem('clips');
    localStorage.removeItem('snippets');
    localStorage.removeItem('folders');

    return result;
}
```

### 6. 图片存储路径

```rust
// src-tauri/src/storage/images.rs
pub fn get_image_path(content_hash: &str) -> PathBuf {
    dirs::data_local_dir()
        .unwrap()
        .join("ClipForge")
        .join("images")
        .join(format!("{}.png", content_hash))
}
```

### 7. 前端数据层重构

**ClipboardRepository 前端适配**：
```typescript
// src/services/clipboardRepository.ts
import { invoke } from '@tauri-apps/api/core';

export class ClipboardRepository {
    async search(query: string, options: SearchOptions): Promise<SearchResult> {
        return invoke('search_items', {
            query,
            kind: options.kind,
            isFavorite: options.isFavorite,
            limit: options.limit || 20,
            offset: options.offset || 0,
        });
    }

    async list(options: ListOptions): Promise<ListResult> {
        return invoke('list_items', {
            kind: options.kind,
            isFavorite: options.isFavorite,
            limit: options.limit || 20,
            offset: options.offset || 0,
        });
    }

    async delete(id: string): Promise<void> {
        return invoke('soft_delete_item', { id });
    }

    async toggleFavorite(id: string): Promise<void> {
        return invoke('toggle_favorite', { id });
    }

    async togglePin(id: string): Promise<void> {
        return invoke('toggle_pin', { id });
    }
}
```

## 边界

- 只迁移文本类型数据，图片后续随剪贴板监听升级一起处理
- 迁移是单向的，不会从 SQLite 回写到 localStorage
- FTS5 中文分词后续优化，当前使用 unicode61 默认分词
- 数据库路径遵循各平台应用数据目录规范

## 验证要求

- 首次启动自动迁移 localStorage 数据
- 迁移后列表显示正常
- 搜索响应毫秒级
- 分页加载正常，滚动触底加载更多
- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `pnpm tauri dev` 验证实际行为