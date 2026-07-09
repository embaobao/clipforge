# 提案：SQLite 持久化迁移

## 背景

当前 ClipForge 使用 localStorage 持久化剪贴板历史，存在以下问题：
1. **容量限制**：localStorage 约 5MB 限制，无法存储大量历史
2. **无全文搜索**：只能内存过滤，无法高效搜索
3. **无事务一致性**：批量操作无法保证原子性
4. **无法存储二进制**：图片、文件无法直接存储

参考项目调研结论：
- **EcoPaste** 使用 sqlx + WAL + FTS5，是成熟的 SQLite 方案
- **Power Paste** 使用 rusqlite bundled 模式，简化部署
- **TieZ** 同样使用 rusqlite，但 FTS5 + tag:语法搜索更灵活

## 目标

- 从 localStorage 迁移到 SQLite 持久化
- 使用 **sqlx** 驱动（编译期 SQL 检查、async）
- 启用 **WAL 日志模式** + Normal 同步 + 外键约束
- 启用 **FTS5 全文搜索**：支持中英文混合搜索
- 图片存磁盘文件系统，数据库存路径引用
- 分页查询（默认 20 条/页），返回 total + has_more

## 非目标

- 不引入 ORM 框架（直接使用 sqlx query）
- 不实现加密存储（后续提案考虑）
- 不实现远程同步（后续提案考虑）

## 用户价值

- 用户可存储数万条历史记录，不再受 5MB 限制
- 搜索速度从内存过滤升级到 FTS5 索引，毫秒级响应
- 图片、文件历史可持久保存

## 技术调研结论

### sqlx vs rusqlite

| 维度 | sqlx | rusqlite |
|------|------|----------|
| 编译期检查 | ✅ SQL 验证 | ❌ |
| Async | ✅ 原生 async | ❌ 需包装 |
| 性能 | 优秀 | 优秀 |
| 维护活跃度 | 高 | 高 |

**选择 sqlx**：编译期 SQL 检查避免运行时错误，async 更适合 Tauri 命令。

### WAL 模式配置

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

### FTS5 中文支持

SQLite FTS5 默认 tokenizer 是 unicode61，支持中文但按字符分词。更精确的分词需要：
- 方案 1：jieba-rs 分词器 + simple tokenizer
- 方案 2：unicode61 + ngram (trigram)

**选择 unicode61 + 自定义分词辅助**：简单方案先上线，后续优化。

### 数据库路径

macOS: `~/Library/Application Support/ClipForge/clipforge.db`
Windows: `%LOCALAPPDATA%/ClipForge/clipforge.db`
Linux: `~/.local/share/ClipForge/clipforge.db`

### EcoPaste 的数据模型参考

```sql
CREATE TABLE clipboard_items (
    id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    content TEXT,
    summary TEXT,
    search_text TEXT,
    source_app TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE clipboard_items_fts USING fts5(
    search_text,
    content=clipboard_items,
    content_rowid=rowid
);

CREATE INDEX idx_created_at ON clipboard_items(created_at DESC);
CREATE INDEX idx_content_hash ON clipboard_items(content_hash);
CREATE INDEX idx_kind ON clipboard_items(kind);
CREATE INDEX idx_is_pinned ON clipboard_items(is_pinned);
CREATE INDEX idx_is_favorite ON clipboard_items(is_favorite);
```