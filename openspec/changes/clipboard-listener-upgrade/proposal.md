# 提案：剪贴板监听升级

## 背景

当前 ClipForge 的剪贴板监听基于 Tauri 插件，存在以下问题：
1. **无写回防护**：自身粘贴操作会触发采集，导致同一内容重复入库
2. **无哈希去重**：只能做字符串比较，无法处理图片等二进制内容
3. **内容类型单一**：仅支持文本，不支持图片、文件路径、HTML 富文本
4. **轮询间隔不可控**：无法像 EcoPaste 那样将 macOS 轮询调到 120ms

参考项目调研结论：
- **EcoPaste** 使用 WritebackGuard + blake3 哈希，解决了回环和去重问题
- **Power Paste** 的 Payload 降级链保证了剪贴板内容解析的健壮性
- **Maccy** 通过 `.fromMaccy` 标记防止自身触发的循环检测

## 目标

- 实现 **WritebackGuard 写回防护**：自身粘贴操作标记 suppress，采集时检测 should_skip 防止回环
- 实现 **blake3 内容哈希去重**：`content_hash = blake3(kind:content)`，重复内容只累加计数不新增行
- 扩展采集类型：图片（PNG/JPEG）、文件路径、HTML 富文本
- 实现 **Payload 降级链**：Mixed → RichText → Html → Text → Empty，逐级降级保证可用性
- macOS 轮询间隔可配置（默认 200ms，可调至 100ms）

## 非目标

- 不引入 clipboard-rs fork（维护成本高），使用现有 Tauri 插件 + 自研防护层
- 不支持视频、音频等非主流剪贴板类型
- 不实现云端同步去重（仅本地去重）

## 用户价值

- 用户复制同一内容多次，列表中只保留一条记录，计数递增
- 用户复制图片、文件后能正确采集并在面板中预览
- 应用自身的粘贴操作不会污染历史记录

## 技术调研结论

### WritebackGuard 方案（参考 EcoPaste）

```rust
// 全局原子状态
static WRITEBACK_SUPPRESS: AtomicBool = AtomicBool::new(false);

// 粘贴前设置 suppress
pub fn suppress_writeback() {
    WRITEBACK_SUPPRESS.store(true, Ordering::SeqCst);
}

// 粘贴后清除 suppress
pub fn clear_writeback_suppress() {
    WRITEBACK_SUPPRESS.store(false, Ordering::SeqCst);
}

// 采集时检测 should_skip
pub fn should_skip_writeback() -> bool {
    WRITEBACK_SUPPRESS.load(Ordering::SeqCst)
}
```

### blake3 哈希去重

```rust
use blake3::Hasher;

pub fn compute_content_hash(kind: &str, content: &[u8]) -> String {
    let mut hasher = Hasher::new();
    hasher.update(kind.as_bytes());
    hasher.update(content);
    hasher.finalize().to_hex().to_string()
}
```

### Payload 降级链（参考 Power Paste）

```
Mixed (图文混合) → RichText → Html → Text → Empty
                    ↓
              优先选择最丰富格式
              降级到可处理格式
```

### macOS 轮询优化

当前 Tauri 插件使用 clipboard-rs，默认 500ms。可通过自定义监听线程实现更短间隔：
- 使用 `objc2-app-kit` 直接访问 NSPasteboard
- Timer 轮询 `changeCount`（参考 Maccy）
- 默认 200ms，可配置到 100ms

### 各项目方案对比

| 项目 | 防护机制 | 去重机制 | 支持类型 |
|------|----------|----------|----------|
| Maccy | `.fromMaccy` 标记 | changeCount 检测 | Text/RTF/HTML/Image/Files |
| EcoPaste | WritebackGuard | blake3 哈希 | Text/HTML/RTF/Image/Files |
| Power Paste | 无 | SHA256 | Text/HTML/Image/Mixed |

**ClipForge 选择**：WritebackGuard + blake3 + Payload 降级链，覆盖 Text/Image/Files/HTML 四种类型。