# 任务：数字快捷键粘贴

## Phase 1：前端键盘监听

- [ ] QuickPastePanel 组件添加键盘事件监听
- [ ] 实现 ⌘+1~9 / Ctrl+1~9 处理
- [ ] 实现 ⌘+0 / Ctrl+0 处理
- [ ] 实现 ArrowUp/ArrowDown 导航
- [ ] 实现 Enter 处理
- [ ] 实现 ⌥+Enter / Alt+Enter 处理
- [ ] 实现 Escape 关闭面板

## Phase 2：Rust 粘贴命令

- [ ] 实现 paste_clipboard_item 命令（写入 + 模拟）
- [ ] 实现 copy_clipboard_item 命令（仅写入）
- [ ] 实现 write_to_clipboard 函数（支持多种类型）
- [ ] 集成 WritebackGuard 写回防护

## Phase 3：模拟粘贴（macOS）

- [ ] 引入 core-graphics crate
- [ ] 实现 simulate_paste 函数（CGEvent ⌘V）
- [ ] 实现 check_accessibility_permission 检查
- [ ] 权限提示 UI

## Phase 4：模拟粘贴（Windows/Linux）

- [ ] Windows：实现 simulate_paste_windows（SendInput）
- [ ] Linux：实现 simulate_paste_linux（xdotool）
- [ ] 测试各平台模拟粘贴

## Phase 5：快捷键标记显示

- [ ] QuickItem 组件添加 shortcut-badge
- [ ] 显示 ⌘1~⌘0 标记
- [ ] 样式：小号字体 + 圆角背景

## Phase 6：选中项高亮

- [ ] 实现 selectedIndex 状态管理
- [ ] ArrowUp/ArrowDown 更新 selectedIndex
- [ ] 选中项样式：背景高亮

## Phase 7：面板隐藏集成

- [ ] 粘贴完成后隐藏面板
- [ ] 粘贴前释放焦点（macOS）
- [ ] 粘贴后恢复上一个应用焦点

## Phase 8：验证

- [ ] 测试：⌘+1~0 直接粘贴
- [ ] 测试：⌥+Enter 模拟粘贴
- [ ] 测试：ArrowUp/ArrowDown 导航
- [ ] 测试：Enter 仅复制
- [ ] 测试：快捷键标记显示
- [ ] 测试：Accessibility 权限提示（macOS）
- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证实际行为

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