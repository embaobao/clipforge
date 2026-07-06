# 任务：剪贴板监听升级

## Phase 1：写回防护

- [ ] 实现 WritebackGuard 全局原子状态
- [ ] 在 paste_clipboard_item 命令中加入 suppress/release 调用
- [ ] 采集线程检测 should_skip 并跳过
- [ ] 单元测试验证防护逻辑

## Phase 2：哈希去重

- [ ] 引入 blake3 crate 依赖
- [ ] 实现 compute_content_hash 函数
- [ ] 修改 upsert_item 逻辑：先查 hash，存在则更新计数，不存在则插入
- [ ] 数据库迁移：添加 content_hash 字段和索引
- [ ] 前端显示 use_count 计数

## Phase 3：扩展内容类型

- [ ] 定义 ClipboardPayload 枚举（Mixed/RichText/Html/Text/Image/Files）
- [ ] macOS：实现 NSPasteboard 多类型读取
- [ ] Windows：实现 Win32 API 多类型读取（参考 Power Paste）
- [ ] 实现 Payload 降级链 fallback 方法
- [ ] 图片：存储到磁盘，数据库存路径
- [ ] 文件：存储路径列表，前端获取文件图标

## Phase 4：macOS 轮询优化

- [ ] 实现自定义监听线程（替代 Tauri 插件）
- [ ] 使用 NSPasteboard.changeCount 检测变化
- [ ] 配置项：poll_interval_ms（默认 200，可调 100）
- [ ] 独立线程运行，不阻塞主线程
- [ ] 事件通过 Tauri async runtime 发送到前端

## Phase 5：前端适配

- [ ] 监听 clipboard://updated 事件
- [ ] 图片类型显示缩略图预览
- [ ] 文件类型显示文件名和图标
- [ ] HTML 类型使用 DOMPurify 渲染预览
- [ ] 状态栏显示采集提示

## Phase 6：验证

- [ ] 测试：重复复制同一文本，验证去重和计数递增
- [ ] 测试：复制图片，验证采集和预览
- [ ] 测试：复制文件，验证采集和图标显示
- [ ] 测试：应用内粘贴，验证无重复入库
- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证实际行为

## 依赖变更

### Cargo.toml

```toml
[dependencies]
blake3 = "1.5"
sha2 = "0.10"  # 图片文件命名
objc2-app-kit = { version = "0.2", optional = true }

[target.'cfg(target_os = "macos")'.dependencies]
objc2-app-kit = "0.2"
```

### 数据库迁移

```sql
-- 添加 content_hash 字段
ALTER TABLE clipboard_items ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_content_hash ON clipboard_items(content_hash);

-- 添加 kind 字段（内容类型）
ALTER TABLE clipboard_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';

-- 添加 use_count 字段（使用计数）
ALTER TABLE clipboard_items ADD COLUMN use_count INTEGER NOT NULL DEFAULT 1;
```