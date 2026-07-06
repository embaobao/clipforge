# 任务：SQLite 持久化迁移

## Phase 1：数据库初始化

- [ ] 引入 sqlx crate 依赖
- [ ] 实现 init_db 函数（连接池 + WAL + FK）
- [ ] 定义数据库路径（各平台）
- [ ] 创建 migrations 目录和初始迁移脚本

## Phase 2：数据模型定义

- [ ] 定义 clipboard_items 表结构
- [ ] 定义 snippets 表结构
- [ ] 定义 folders 表结构
- [ ] 定义 FTS5 虚拟表和触发器
- [ ] 创建 Rust 结构体 ClipboardItem/Snippet/Folder

## Phase 3：CRUD 操作实现

- [ ] 实现 upsert_item（含去重）
- [ ] 实现 search_items（FTS5）
- [ ] 实现 list_items（分页）
- [ ] 实现 soft_delete_item
- [ ] 实现 toggle_favorite
- [ ] 实现 toggle_pin
- [ ] 实现 get_item_by_id

## Phase 4：localStorage 迁移

- [ ] 实现 migrate_from_localstorage Rust 命令
- [ ] 前端启动时检测是否需要迁移
- [ ] 显示迁移进度 UI
- [ ] 迁移完成后清除 localStorage
- [ ] 记录迁移日志

## Phase 5：前端数据层重构

- [ ] 实现 ClipboardRepository 前端类
- [ ] 替换现有 localStorage 直接读写
- [ ] 实现分页加载（limit + offset）
- [ ] 实现搜索调用 FTS5
- [ ] 监听 clipboard://updated 事件刷新

## Phase 6：图片存储路径

- [ ] 创建 images 目录结构
- [ ] 实现 get_image_path 函数
- [ ] 图片类型 content 存路径而非数据

## Phase 7：验证

- [ ] 测试：首次启动自动迁移
- [ ] 测试：迁移后列表正确显示
- [ ] 测试：搜索响应时间 < 50ms
- [ ] 测试：分页加载，滚动触底
- [ ] 测试：收藏/固定状态切换
- [ ] 测试：软删除和恢复
- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证实际行为

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