# 任务：数字快捷键粘贴

## Phase 1：前端键盘监听

- [x] QuickPastePanel 组件添加键盘事件监听
- [x] 实现 ⌘+1~9 / Ctrl+1~9 处理
- [x] 实现 ⌘+0 / Ctrl+0 处理
- [x] 实现 ArrowUp/ArrowDown 导航
- [x] 实现 Enter 处理
- [x] 实现 ⌥+Enter / Alt+Enter 处理
- [x] 实现 Escape 关闭面板

## Phase 2：Rust 粘贴命令

- [x] 实现 paste_clipboard_item 命令（写入 + 模拟）
- [x] 实现 copy_clipboard_item 命令（仅写入）
- [x] 实现 write_to_clipboard 函数（支持多种类型）
- [x] 集成 WritebackGuard 写回防护

## Phase 3：模拟粘贴（macOS）

- [x] 引入 core-graphics crate
- [x] 实现 simulate_paste 函数（CGEvent ⌘V）
- [x] 实现 check_accessibility_permission 检查
- [x] 权限提示 UI

## Phase 4：模拟粘贴（Windows/Linux）

- [x] Windows：实现 simulate_paste_windows（SendInput）
- [x] Linux：实现 simulate_paste_linux（xdotool）
- [x] 测试各平台模拟粘贴

## Phase 5：快捷键标记显示

- [x] QuickItem 组件添加 shortcut-badge
- [x] 显示 ⌘1~⌘0 标记
- [x] 样式：小号字体 + 圆角背景

## Phase 6：选中项高亮

- [x] 实现 selectedIndex 状态管理
- [x] ArrowUp/ArrowDown 更新 selectedIndex
- [x] 选中项样式：背景高亮

## Phase 7：面板隐藏集成

- [x] 粘贴完成后隐藏面板
- [x] 粘贴前释放焦点（macOS）
- [x] 粘贴后恢复上一个应用焦点

## Phase 8：验证

- [x] 测试：⌘+1~0 直接粘贴
- [x] 测试：⌥+Enter 模拟粘贴
- [x] 测试：ArrowUp/ArrowDown 导航
- [x] 测试：Enter 仅复制
- [x] 测试：快捷键标记显示
- [x] 测试：Accessibility 权限提示（macOS）
- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] `pnpm tauri dev` 验证实际行为

## 依赖变更

### Cargo.toml

```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-graphics = "0.24"

[target.'cfg(target_os = "windows")'.dependencies]
winapi = { version = "0.3", features = ["winuser"] }
```

### package.json

无需新增依赖。

## 技术参考

### Maccy KeyChord.swift

关键函数：
- `perform()`：处理键盘事件
- `paste()`：模拟 ⌘V
- `Accessibility.check()`：权限检查

### Power Paste 快捷键

关键机制：
- 按住快捷键循环切换
- 数字键直接粘贴
- 写回防护