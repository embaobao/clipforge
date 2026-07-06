# 设计：数字快捷键粘贴

## 交互设计

快捷键绑定：
- **⌘+1~9**：粘贴第 1~9 条可见条目
- **⌘+0**：粘贴第 10 条可见条目
- **Enter**：将选中项写入剪贴板
- **⌥+Enter**：写入剪贴板 + 模拟 ⌘V（粘贴到目标应用）
- **ArrowUp/ArrowDown**：移动选中项
- **Escape**：关闭面板

视觉标记：
- 列表项右侧显示快捷键标记（如 `⌘1`、`⌘2`）
- 选中项高亮显示

用户流程：
1. 快捷键唤起面板
2. ArrowUp/ArrowDown 选择条目（可选）
3. ⌘+数字 直接粘贴（最快）
4. 或 Enter + ⌥+Enter 粘贴选中项

## 技术设计

### 1. 前端键盘监听

```tsx
// src/components/QuickPastePanel.tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function QuickPastePanel() {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [items, setItems] = useState<ClipboardItem[]>([]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // ⌘+数字（macOS）
            if (e.metaKey && e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                pasteItem(index);
                e.preventDefault();
                return;
            }

            // ⌘+0（第 10 条）
            if (e.metaKey && e.key === '0') {
                pasteItem(9);
                e.preventDefault();
                return;
            }

            // Ctrl+数字（Windows/Linux）
            if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
                const index = parseInt(e.key) - 1;
                pasteItem(index);
                e.preventDefault();
                return;
            }

            // ArrowUp/ArrowDown
            if (e.key === 'ArrowUp') {
                setSelectedIndex(Math.max(0, selectedIndex - 1));
                e.preventDefault();
            }
            if (e.key === 'ArrowDown') {
                setSelectedIndex(Math.min(items.length - 1, selectedIndex + 1));
                e.preventDefault();
            }

            // Enter：写入剪贴板
            if (e.key === 'Enter' && !e.altKey) {
                copyItem(selectedIndex);
                e.preventDefault();
            }

            // ⌥+Enter：写入剪贴板 + 模拟粘贴
            if (e.key === 'Enter' && e.altKey) {
                pasteItem(selectedIndex);
                e.preventDefault();
            }

            // Escape：关闭面板
            if (e.key === 'Escape') {
                invoke('hide_quick_panel');
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIndex, items]);

    async function pasteItem(index: number) {
        if (index < 0 || index >= items.length) return;

        const item = items[index];

        // 写入剪贴板 + 模拟粘贴
        await invoke('paste_clipboard_item', { id: item.id });

        // 关闭面板
        await invoke('hide_quick_panel');
    }

    async function copyItem(index: number) {
        if (index < 0 || index >= items.length) return;

        const item = items[index];

        // 仅写入剪贴板
        await invoke('copy_clipboard_item', { id: item.id });
    }

    return (
        <div className="quick-paste-panel">
            {items.slice(0, 10).map((item, index) => (
                <div
                    key={item.id}
                    className={`item ${index === selectedIndex ? 'selected' : ''}`}
                    onClick={() => setSelectedIndex(index)}
                >
                    <span className="content">{item.summary}</span>
                    <span className="shortcut">⌘{index + 1}</span>
                </div>
            ))}
        </div>
    );
}
```

### 2. Rust 端粘贴命令

```rust
// src-tauri/src/commands/paste.rs

/// 写入剪贴板 + 模拟粘贴
#[tauri::command]
pub async fn paste_clipboard_item(id: String, app: AppHandle) -> Result<(), String> {
    use crate::clipboard::guard::WRITEBACK_GUARD;

    // 标记写回防护
    WRITEBACK_GUARD.suppress();

    // 1. 写入剪贴板
    write_to_clipboard(&id, &app)?;

    // 2. 隐藏面板（避免面板吞掉 ⌘V）
    #[cfg(target_os = "macos")]
    {
        let panel = NSPanel::get(&app, "quick-panel")
            .map_err(|e| format!("Get NSPanel failed: {}", e))?;
        panel.hide();
        panel.resign_key();
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app.get_webview_window("quick-panel")
            .ok_or("Quick panel not found")?;
        window.hide()?;
    }

    // 3. 延迟后模拟粘贴
    tokio::time::sleep(Duration::from_millis(50)).await;
    simulate_paste(&app)?;

    // 4. 释放写回防护
    tokio::time::sleep(Duration::from_millis(100)).await;
    WRITEBACK_GUARD.release();

    Ok(())
}

/// 仅写入剪贴板（不模拟粘贴）
#[tauri::command]
pub async fn copy_clipboard_item(id: String, app: AppHandle) -> Result<(), String> {
    write_to_clipboard(&id, &app)?;

    // 状态提示：已复制到剪贴板
    app.emit("clipboard://copied", id)?;

    Ok(())
}

/// 写入剪贴板实现
fn write_to_clipboard(id: &str, app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    // 从数据库读取内容
    let item = get_item_by_id(id)?;

    match item.kind {
        "text" => {
            app.clipboard().write_text(item.content)
                .map_err(|e| format!("Write text failed: {}", e))?;
        }
        "image" => {
            let image_path = get_image_path(&item.content_hash);
            let image_data = std::fs::read(&image_path)
                .map_err(|e| format!("Read image failed: {}", e))?;
            app.clipboard().write_image(image_data)
                .map_err(|e| format!("Write image failed: {}", e))?;
        }
        "files" => {
            let paths: Vec<String> = serde_json::from_str(&item.content)
                .map_err(|e| format!("Parse files failed: {}", e))?;
            app.clipboard().write_files(paths)
                .map_err(|e| format!("Write files failed: {}", e))?;
        }
        _ => {}
    }

    Ok(())
}

/// 模拟粘贴（⌘V）
fn simulate_paste(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventFlags, CGKeyCode};

        // 检查 Accessibility 权限
        check_accessibility_permission()?;

        // 构造 ⌘V 事件
        let cmd_flag = CGEventFlags::CGEventFlagCommand;
        let v_keycode = CGKeyCode(9);  // V 键 keycode

        let key_down = CGEvent::new_keyboard_event(None, v_keycode, true)
            .map_err(|e| format!("Create key down event failed: {}", e))?;
        key_down.set_flags(cmd_flag);

        let key_up = CGEvent::new_keyboard_event(None, v_keycode, false)
            .map_err(|e| format!("Create key up event failed: {}", e))?;
        key_up.set_flags(cmd_flag);

        // 投递事件
        key_down.post(CGEventTapLocation::CGSessionEventTap);
        key_up.post(CGEventTapLocation::CGSessionEventTap);
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 SendInput 或 AutoHotkey 脚本
        simulate_paste_windows()?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 xdotool 或 wtype
        simulate_paste_linux()?;
    }

    Ok(())
}
```

### 3. Accessibility 权限检查（macOS）

```rust
#[cfg(target_os = "macos")]
fn check_accessibility_permission() -> Result<(), String> {
    use accessibility::{AXIsProcessTrusted, AXIsProcessTrustedWithOptions};

    let trusted = AXIsProcessTrusted();

    if !trusted {
        // 提示用户授权
        let options = AXIsProcessTrustedWithOptions();

        if !options {
            return Err("需要辅助功能权限才能模拟粘贴。请在系统偏好设置 > 安全性与隐私 > 辅助功能中授权 ClipForge。".to_string());
        }
    }

    Ok(())
}
```

### 4. 前端快捷键标记显示

```tsx
// src/components/QuickItem.tsx
export function QuickItem({ item, index }: { item: ClipboardItem; index: number }) {
    const shortcutLabel = index < 10 ? `⌘${index + 1}` : '';

    return (
        <div className="quick-item">
            <span className="summary">{item.summary}</span>
            {shortcutLabel && (
                <span className="shortcut-badge">{shortcutLabel}</span>
            )}
        </div>
    );
}
```

```css
/* src/styles/QuickPastePanel.css */
.quick-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 12px;
    cursor: pointer;
}

.quick-item.selected {
    background: rgba(0, 0, 0, 0.1);
}

.shortcut-badge {
    font-size: 12px;
    color: #888;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.05);
}
```

### 5. Windows/Linux 模拟粘贴

```rust
#[cfg(target_os = "windows")]
fn simulate_paste_windows() -> Result<(), String> {
    use winapi::um::winuser::{SendInput, INPUT, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V};

    // Ctrl+V
    let mut inputs: [INPUT; 4] = unsafe { std::mem::zeroed() };

    // Ctrl down
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].u.ki.wVk = VK_CONTROL;

    // V down
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].u.ki.wVk = VK_V;

    // V up
    inputs[2].type = INPUT_KEYBOARD;
    inputs[2].u.ki.wVk = VK_V;
    inputs[2].u.ki.dwFlags = KEYEVENTF_KEYUP;

    // Ctrl up
    inputs[3].type = INPUT_KEYBOARD;
    inputs[3].u.ki.wVk = VK_CONTROL;
    inputs[3].u.ki.dwFlags = KEYEVENTF_KEYUP;

    SendInput(4, &inputs[0], std::mem::size_of::<INPUT>());

    Ok(())
}

#[cfg(target_os = "linux")]
fn simulate_paste_linux() -> Result<(), String> {
    // 使用 xdotool 或 wtype
    std::process::Command::new("xdotool")
        .args(["key", "--clearmodifiers", "Ctrl+V"])
        .status()
        .map_err(|e| format!("xdotool failed: {}", e))?;

    Ok(())
}
```

### 6. 原生全局快捷键注册（可选）

```rust
// 如果需要系统级快捷键（如 Ctrl+V 唤起面板）
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

app.global_shortcut().register("ctrl+v", |app, shortcut, state| {
    if state == ShortcutState::Pressed {
        show_quick_panel(app).unwrap();
    }
})?;

// 数字快捷键（面板内）
app.global_shortcut().register("ctrl+1", |app, shortcut, state| {
    if state == ShortcutState::Pressed && is_panel_visible(app) {
        paste_item_by_index(app, 0).unwrap();
    }
})?;
```

## 边界

- 模拟粘贴需要 Accessibility 权限（macOS）
- Windows/Linux 模拟粘贴依赖外部工具（xdotool/SendInput）
- 数字快捷键只在面板可见时生效
- 最多支持前 10 条可见条目的数字快捷键

## 验证要求

- ⌘+1~0 直接粘贴对应条目
- ⌥+Enter 粘贴 + 模拟 ⌘V
- ArrowUp/ArrowDown 导航
- Enter 仅写入剪贴板
- 快捷键标记显示正确
- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `pnpm tauri dev` 验证实际行为