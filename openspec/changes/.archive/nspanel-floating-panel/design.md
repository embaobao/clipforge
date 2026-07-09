# 设计：NSPanel 悬浮面板

## 交互设计

用户感知变化：
- 全屏应用（Safari、Finder、Notes）上方可以显示快捷面板
- 快捷面板不抢焦点，用户可以继续在原应用输入
- 点击快捷面板搜索框后，面板获得焦点可以输入搜索词
- 失焦后面板不自动隐藏，由快捷键二次触发或延迟隐藏

窗口分离：
- **快捷面板（NSPanel）**：360×560 默认尺寸，轻量、悬浮、快速唤起
- **管理窗口（WebviewWindow）**：完整功能、设置、详情

## 技术设计

### 1. 引入 tauri-nspanel

**Cargo.toml**：
```toml
[target.'cfg(target_os = "macos")'.dependencies]
tauri-nspanel = { git = "https://github.com/your-fork/tauri-nspanel" }  # 或使用官方版本
objc2-app-kit = "0.2"

[features]
macos-private-api = ["tauri/macos-private-api"]
```

**main.rs 注册**：
```rust
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // 创建 NSPanel 快捷面板
                create_quick_panel(app)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 2. NSPanel 创建与配置

```rust
// src-tauri/src/panel/mod.rs
#[cfg(target_os = "macos")]
use tauri_nspanel::{
    NSPanel, PanelLevel, PanelStyleMask, PanelCollectionBehavior, PanelConfig
};

#[cfg(target_os = "macos")]
pub fn create_quick_panel(app: &AppHandle) -> Result<(), String> {
    // NSPanel 配置
    let config = PanelConfig {
        label: "quick-panel",
        title: "ClipForge Quick",
        url: "quick-panel.html",  // 专用页面
        width: 360,
        height: 560,
        style_mask: PanelStyleMask::nonactivatingPanel()
            | PanelStyleMask::resizable()
            | PanelStyleMask::closable()
            | PanelStyleMask::fullSizeContentView()
            | PanelStyleMask::borderless(),
        decorations: Decorations::Transparent,
    };

    let panel = NSPanel::new(app, config)
        .map_err(|e| format!("Create NSPanel failed: {}", e))?;

    // 设置浮动层级
    panel.set_level(PanelLevel::Floating);

    // 设置 CollectionBehavior
    panel.set_collection_behavior(
        PanelCollectionBehavior::canJoinAllSpaces
            | PanelCollectionBehavior::fullScreenAuxiliary
            | PanelCollectionBehavior::stationary
    );

    // 失焦不自动隐藏
    panel.set_hides_on_deactivate(false);

    // 允许成为 key window（接收键盘焦点）
    panel.set_can_become_key(true);

    // 透明背景（圆角裁切）
    panel.set_background_color(Color::CLEAR);

    // 初始隐藏
    panel.hide();

    Ok(())
}
```

### 3. 显示/隐藏 NSPanel

```rust
// src-tauri/src/panel/commands.rs
#[cfg(target_os = "macos")]
use tauri_nspanel::NSPanel;

#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn show_quick_panel(app: AppHandle) -> Result<(), String> {
    let panel = NSPanel::get(&app, "quick-panel")
        .map_err(|e| format!("Get NSPanel failed: {}", e))?;

    // 定位面板（调用窗口定位模块）
    position_panel(&panel, &app)?;

    // 显示面板
    panel.show();

    // 异步 focus（不立即抢焦点）
    panel.make_key_and_order_front();

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn hide_quick_panel(app: AppHandle) -> Result<(), String> {
    let panel = NSPanel::get(&app, "quick-panel")
        .map_err(|e| format!("Get NSPanel failed: {}", e))?;

    panel.hide();

    Ok(())
}

#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn toggle_quick_panel(app: AppHandle) -> Result<(), String> {
    let panel = NSPanel::get(&app, "quick-panel")
        .map_err(|e| format!("Get NSPanel failed: {}", e))?;

    if panel.is_visible() {
        panel.hide();
    } else {
        position_panel(&panel, &app)?;
        panel.show();
        panel.make_key_and_order_front();
    }

    Ok(())
}
```

### 4. NSPanel 定位集成

```rust
#[cfg(target_os = "macos")]
pub fn position_panel(panel: &NSPanel, app: &AppHandle) -> Result<(), String> {
    use crate::position::{PanelPositionStrategy, position_follow_cursor, position_center};

    let settings = load_window_settings()?;
    let panel_size = PhysicalSize { width: 360, height: 560 };

    match settings.position_strategy {
        PanelPositionStrategy::FollowCursor => {
            // 获取光标位置
            let cursor = get_cursor_position(app)?;
            let monitor = get_current_monitor(app)?;

            // 边界检查后设置位置
            let position = calculate_position_with_bounds(cursor, monitor, panel_size)?;
            panel.set_position(position);
        }
        PanelPositionStrategy::Center => {
            let monitor = get_current_monitor(app)?;
            let position = calculate_center_position(monitor, panel_size)?;
            panel.set_position(position);
        }
        PanelPositionStrategy::TrayCenter => {
            // 使用 tauri-plugin-positioner
            use tauri_plugin_positioner::{Position, WindowExt};
            // NSPanel 也支持 WindowExt trait
            panel.move_window(Position::TrayCenter)?;
        }
        PanelPositionStrategy::LastPosition => {
            restore_normalized_position_panel(panel, app, panel_size, &settings)?;
        }
        PanelPositionStrategy::FocusInput => {
            let input_pos = get_focused_input_bounds(app)?;
            if let Some(pos) = input_pos {
                panel.set_position(pos);
            } else {
                position_follow_cursor_panel(panel, app, panel_size)?;
            }
        }
    }

    Ok(())
}
```

### 5. NSPanel 专用页面

**创建 quick-panel.html**：
```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>ClipForge Quick</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .quick-panel {
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            overflow: hidden;
        }
        /* 圆角裁切 */
        html {
            background: transparent;
            -webkit-backdrop-filter: blur(20px);
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/quick-panel.tsx"></script>
</body>
</html>
```

**前端路由分离**：
```tsx
// src/quick-panel.tsx
import React from 'react';
import QuickPastePanel from './components/QuickPastePanel';

export default function QuickPanelApp() {
    return (
        <div className="quick-panel">
            <QuickPastePanel />
        </div>
    );
}
```

### 6. NSPanel 焦点管理

```rust
// 点击搜索框时获得焦点
#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn focus_quick_panel(app: AppHandle) -> Result<(), String> {
    let panel = NSPanel::get(&app, "quick-panel")
        .map_err(|e| format!("Get NSPanel failed: {}", e))?;

    panel.make_key();  // 成为 key window，可以接收键盘输入

    Ok(())
}

// 粘贴完成后释放焦点
#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn release_focus(app: AppHandle) -> Result<(), String> {
    let panel = NSPanel::get(&app, "quick-panel")
        .map_err(|e| format!("Get NSPanel failed: {}", e))?;

    // 释放焦点，恢复到上一个应用
    panel.resign_key();

    // 可选：隐藏面板
    panel.hide();

    Ok(())
}
```

### 7. Windows/Linux WebviewWindow 方案

```rust
#[cfg(not(target_os = "macos"))]
pub fn create_quick_panel(app: &AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    let window = WebviewWindowBuilder::new(
        app,
        "quick-panel",
        tauri::WebviewUrl::App("quick-panel.html".into())
    )
    .title("ClipForge Quick")
    .inner_size(360.0, 560.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible(false)  // 初始隐藏
    .build()
    .map_err(|e| format!("Create window failed: {}", e))?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn show_quick_panel(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("quick-panel")
        .ok_or("Quick panel window not found")?;

    // 定位（使用窗口定位模块）
    position_window(&window, &app)?;

    window.show()
        .map_err(|e| format!("Show window failed: {}", e))?;

    window.set_focus()
        .map_err(|e| format!("Set focus failed: {}", e))?;

    Ok(())
}
```

### 8. 窗口分离架构

```
ClipForge 窗口架构：
┌─────────────────────────────────────┐
│  quick-panel (NSPanel/WebviewWindow) │  ← 快捷面板，轻量、悬浮
│  - 搜索框                            │
│  - 快速列表（前 10 条）              │
│  - 数字快捷键                        │
│  - 快速粘贴                          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  main (WebviewWindow)                │  ← 管理窗口，完整功能
│  - 导航栏                            │
│  - 历史/片段/文件夹                  │
│  - 详情面板                          │
│  - 设置                              │
└─────────────────────────────────────┘
```

### 9. 前端事件监听

```typescript
// src/quick-panel.tsx
import { listen } from '@tauri-apps/api/event';

// 监听面板显示事件
listen('quick-panel://show', () => {
    // 重置状态
    searchQuery.value = '';
    loadQuickItems();
});

// 监听面板隐藏事件
listen('quick-panel://hide', () => {
    // 清理状态
});

// 粘贴完成后通知 Rust
async function onPasteComplete() {
    await invoke('release_focus');
}
```

### 10. 失焦延迟隐藏

```rust
// 失焦事件监听（macOS）
#[cfg(target_os = "macos")]
pub fn setup_focus_tracking(app: &AppHandle) -> Result<(), String> {
    let panel = NSPanel::get(app, "quick-panel")?;

    // 监听失焦事件
    panel.on_resign_key(|panel, app| {
        // 延迟隐藏（避免立即隐藏影响用户体验）
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(3)).await;

            // 如果没有重新获得焦点，则隐藏
            if !panel.is_key() {
                panel.hide();
            }
        });
    });

    Ok(())
}
```

## 边界

- NSPanel 仅 macOS 支持，Windows/Linux 使用 WebviewWindow
- quick-panel.html 是独立页面，不共享 main.html 的复杂组件
- 管理窗口（main）仍是 WebviewWindow，不使用 NSPanel
- 失焦延迟隐藏时间默认 3 秒，可在设置中配置

## 验证要求

- Safari 全屏模式下快捷键唤起面板正常显示
- 面板不抢焦点，用户可以继续在原应用输入
- 点击搜索框后面板获得焦点可以输入
- 失焦后面板不立即隐藏，延迟 3 秒后隐藏
- Windows/Linux 端面板 always_on_top 正常
- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `pnpm tauri dev` 验证实际行为