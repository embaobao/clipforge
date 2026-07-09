# 提案：数字快捷键粘贴

## 背景

当前 ClipForge 只支持点击复制和 Enter 复制，效率较低。用户需要：
- 快速粘贴前几条历史（高频场景）
- 键盘优先操作（不依赖鼠标）
- 类似 Clipy/Maccy 的数字快捷键体验

参考项目调研结论：
- **Maccy** 支持 ⌘+1~0 直接粘贴前 10 条，⌥+Enter 粘贴并模拟 ⌘V
- **Power Paste** 支持 Win+数字系统级快捷粘贴，按住快捷键循环切换
- **EcoPaste** 支持 Enter 粘贴 + 可选模拟粘贴

## 目标

- 实现 **数字快捷键粘贴**：⌘+1~0 直接粘贴前 10 条可见条目
- 实现 **Enter 粘贴**：Enter 将选中项写入剪贴板
- 实现 **⌥+Enter 模拟粘贴**：⌥+Enter 写入剪贴板 + 模拟 ⌘V
- 实现方向键导航：ArrowUp/ArrowDown 移动选中项
- 显示快捷键标记：列表项旁显示数字键位（如 `⌘1`）

## 非目标

- 不实现按住快捷键循环切换（后续提案考虑）
- 不实现目标感知粘贴（需要 Accessibility 权限，后续提案）
- 不实现系统级快捷键（如 Win+数字，需要底层钩子）

## 用户价值

- 用户按 ⌘+1 即可粘贴第一条历史，无需点击
- 键盘用户可以完全用键盘操作，不依赖鼠标
- 高频粘贴效率大幅提升

## 技术调研结论

### Maccy 数字快捷键实现

```swift
// Maccy KeyChord.swift
func perform() {
    // ⌘+数字：直接粘贴对应索引的条目
    if let index = Int(key.character), index >= 1, index <= 9 {
        pasteItem(at: index - 1)
    }
    // ⌘+0：粘贴第 10 条
    if key.character == "0" {
        pasteItem(at: 9)
    }
}

// ⌥+Enter：粘贴 + 模拟 ⌘V
func paste() {
    Accessibility.check()  // 检查辅助功能权限

    // 构造 ⌘V 事件
    let cmdFlag = CGEventFlags(rawValue: KeyChord.pasteKeyModifiers.rawValue)
    let vCode = Sauce.shared.keyCode(for: KeyChord.pasteKey)

    let keyDown = CGEvent(keyboardEventSource: source, virtualKey: vCode, keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: source, virtualKey: vCode, keyDown: false)
    keyDown?.flags = cmdFlag
    keyUp?.flags = cmdFlag
    keyDown?.post(tap: .cgSessionEventTap)
    keyUp?.post(tap: .cgSessionEventTap)
}
```

### Power Paste 按住快捷键循环切换

```rust
// Power Paste 的创新交互
// 按住快捷键 → 面板弹出 → 继续按键循环切换候选项 → 松手即粘贴

static IS_HOLDING_SHORTCUT: AtomicBool = AtomicBool::new(false);

// 按下快捷键
fn on_shortcut_press() {
    IS_HOLDING_SHORTCUT.store(true, Ordering::SeqCst);
    show_panel();
    current_index = 0;
}

// 继续按键（在按住状态下）
fn on_number_key_press(num: u8) {
    if IS_HOLDING_SHORTCUT.load(Ordering::SeqCst) {
        current_index = num;
        highlight_item(current_index);
    }
}

// 松开快捷键
fn on_shortcut_release() {
    IS_HOLDING_SHORTCUT.store(false, Ordering::SeqCst);
    paste_item(current_index);
    hide_panel();
}
```

### ClipForge 方案选择

**第一阶段实现**：
- ⌘+1~0：直接粘贴对应条目（简单有效）
- Enter：写入剪贴板
- ⌥+Enter：写入剪贴板 + 模拟 ⌘V（需要 Accessibility 权限）

**后续阶段实现**：
- 按住快捷键循环切换（Power Paste 交互）
- 目标感知粘贴（记录焦点窗口）
- 系统级快捷键（Win+数字）