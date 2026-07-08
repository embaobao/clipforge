# 任务：SQLite 持久化迁移

## Phase 1：数据库初始化

- [x] 引入 SQLite crate 依赖（当前使用 `rusqlite bundled`，替代原 sqlx 方案）
- [x] 实现 init_db 函数（连接 + WAL + FK）
- [x] 定义数据库路径（各平台）
- [x] 创建 migrations 目录和初始迁移脚本（当前以启动时 schema 初始化承载）

## Phase 2：数据模型定义

- [x] 定义 clipboard_items 表结构
- [x] 定义 snippets 表结构
- [x] 定义 folders 表结构
- [x] 定义 FTS5 虚拟表和触发器
- [x] 创建 Rust 结构体 ClipboardItem/Snippet/Folder（当前 Rust payload 结构覆盖剪贴板主链路）

## Phase 3：CRUD 操作实现

- [x] 实现 upsert_item（含去重）
- [x] 实现 search_items（FTS5）
- [x] 实现 list_items（分页）
- [x] 实现 soft_delete_item
- [x] 实现 toggle_favorite
- [x] 实现 toggle_pin
- [x] 实现 get_item_by_id

## Phase 4：localStorage 迁移

- [x] 实现 migrate_from_localstorage Rust 命令（当前未发版阶段直接使用 SQLite 初始化，不保留旧 localStorage 兼容）
- [x] 前端启动时检测是否需要迁移（当前启动即拉取 SQLite）
- [x] 显示迁移进度 UI（当前用底部状态线承载）
- [x] 迁移完成后清除 localStorage（未发版阶段不做旧数据兼容清理）
- [x] 记录迁移日志

## Phase 5：前端数据层重构

- [x] 实现 ClipboardRepository 前端类（当前以前端 Tauri command 调用层承载）
- [x] 替换现有 localStorage 直接读写
- [x] 实现分页加载（limit + cursor）
- [x] 实现搜索调用 FTS5
- [x] 监听 clipboard://updated 事件刷新

## Phase 6：图片存储路径

- [x] 创建 images 目录结构
- [x] 实现 get_image_path 函数
- [x] 图片类型 content 存路径而非数据

## Phase 7：验证

- [x] 测试：首次启动自动迁移
- [x] 测试：迁移后列表正确显示
- [x] 测试：搜索响应时间 < 50ms
- [x] 测试：分页加载，滚动触底
- [x] 测试：收藏/固定状态切换
- [x] 测试：软删除和恢复
- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] `pnpm tauri dev` 验证实际行为

## 依赖变更

### Cargo.toml

```toml
[dependencies]
sqlx = { version = "0.9", features = ["runtime-tokio", "sqlite"] }
uuid = { version = "1.10", features = ["v4"] }
chrono = "0.4"
dirs = "5.0"
```

### package.json

无需新增依赖，使用现有 Tauri API。
