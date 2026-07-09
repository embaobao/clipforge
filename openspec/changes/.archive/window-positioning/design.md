# 设计：窗口定位升级

## 交互设计

用户感知变化：
- 托盘点击后，面板出现在托盘图标下方居中位置
- 快捷键唤起后，面板跟随鼠标光标弹出（不超出屏幕边界）
- 面板记住上次关闭的位置，下次在相同位置弹出
- 多显示器切换后，面板自动映射到新显示器

定位策略配置：
- 设置中提供定位策略选择：跟随光标/居中屏幕/记住位置/托盘下方
- 默认策略：快捷键唤起用 FollowCursor，托盘点击用 TrayCenter

## 技术设计

### 1. 引入 tauri-plugin-positioner

**Cargo.toml**：
```toml
[dependencies]
tauri-plugin-positioner = "2.0"

[features]
tray-icon = ["tauri/tray-icon", "tauri-plugin-positioner/tray-icon"]
```

**main.rs 注册**：
```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            // 托盘事件处理
            let tray = app.tray_by_id("main").unwrap();
            tray.on_tray_icon_event(|app, event| {
                tauri_plugin_positioner::on_tray_event(app.handle(), &event);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 2. 定位策略枚举与配置

**定义枚举**：
```rust
// src-tauri/src/position/mod.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PanelPositionStrategy {
    #[serde(rename = "trayCenter")]
    TrayCenter,       // 托盘图标下方居中

    #[serde(rename = "followCursor")]
    FollowCursor,     // 跟随鼠标光标

    #[serde(rename = "center")]
    Center,           // 居中当前显示器

    #[serde(rename = "lastPosition")]
    LastPosition,     // 恢复上次位置（归一化坐标）

    #[serde(rename = "focusInput")]
    FocusInput,       // 跟随当前焦点输入框
}

impl Default for PanelPositionStrategy {
    fn default() -> Self {
        PanelPositionStrategy::FollowCursor
    }
}
```

**配置存储**：
```rust
// src-tauri/src/settings/mod.rs
pub struct WindowSettings {
    pub position_strategy: PanelPositionStrategy,
    pub last_position: Option<NormalizedPosition>,
    pub panel_width: u32,
    pub panel_height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedPosition {
    pub x: f64,  // 0.0 ~ 1.0，相对于显示器宽度的比例
    pub y: f64,  // 0.0 ~ 1.0，相对于显示器高度的比例
    pub monitor_id: Option<String>,  // 上次所在显示器 ID
}
```

### 3. FollowCursor 定位实现

**获取光标位置**：
```rust
// src-tauri/src/position/cursor.rs
use tauri::{Manager, WebviewWindow};

pub fn get_cursor_position(app: &AppHandle) -> Result<PhysicalPosition<i32>, String> {
    // 使用 Tauri Cursor API
    let cursor = app.cursor_position()
        .map_err(|e| format!("Get cursor position failed: {}", e))?;

    Ok(PhysicalPosition {
        x: cursor.x as i32,
        y: cursor.y as i32,
    })
}

pub fn get_current_monitor(app: &AppHandle, window: &WebviewWindow) -> Result<Monitor, String> {
    let cursor_pos = get_cursor_position(app)?;

    // 遍历所有显示器，找到光标所在的显示器
    let monitors = app.available_monitors()
        .map_err(|e| format!("Get monitors failed: {}", e))?;

    for monitor in monitors {
        let position = monitor.position();
        let size = monitor.size();

        if cursor_pos.x >= position.x
            && cursor_pos.x < position.x + size.width
            && cursor_pos.y >= position.y
            && cursor_pos.y < position.y + size.height
        {
            return Ok(monitor);
        }
    }

    // 默认返回主显示器
    app.primary_monitor()
        .map_err(|e| format!("Get primary monitor failed: {}", e))
}
```

**定位窗口到光标位置**：
```rust
// src-tauri/src/position/position.rs
pub fn position_follow_cursor(
    window: &WebviewWindow,
    app: &AppHandle,
    panel_size: PhysicalSize<u32>,
) -> Result<(), String> {
    let cursor = get_cursor_position(app)?;
    let monitor = get_current_monitor(app, window)?;

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();

    // 计算窗口位置（左上角对齐光标）
    let mut x = cursor.x;
    let mut y = cursor.y;

    // 确保不超出显示器右边界
    if x + panel_size.width as i32 > monitor_pos.x + monitor_size.width as i32 {
        x = monitor_pos.x + monitor_size.width as i32 - panel_size.width as i32;
    }

    // 确保不超出显示器下边界
    if y + panel_size.height as i32 > monitor_pos.y + monitor_size.height as i32 {
        y = monitor_pos.y + monitor_size.height as i32 - panel_size.height as i32;
    }

    // 确保不超出显示器左边界
    if x < monitor_pos.x {
        x = monitor_pos.x;
    }

    // 确保不超出显示器上边界
    if y < monitor_pos.y {
        y = monitor_pos.y;
    }

    window.set_position(PhysicalPosition { x, y })
        .map_err(|e| format!("Set position failed: {}", e))?;

    Ok(())
}
```

### 4. Center 定位实现

```rust
pub fn position_center(
    window: &WebviewWindow,
    app: &AppHandle,
    panel_size: PhysicalSize<u32>,
) -> Result<(), String> {
    let monitor = get_current_monitor(app, window)?;

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();

    // 居中到当前显示器
    let x = monitor_pos.x + (monitor_size.width as i32 - panel_size.width as i32) / 2;
    let y = monitor_pos.y + (monitor_size.height as i32 - panel_size.height as i32) / 2;

    window.set_position(PhysicalPosition { x, y })
        .map_err(|e| format!("Set position failed: {}", e))?;

    Ok(())
}
```

### 5. LastPosition 归一化坐标

**保存位置（归一化）**：
```rust
pub fn save_normalized_position(
    window: &WebviewWindow,
    app: &AppHandle,
    settings: &mut WindowSettings,
) -> Result<(), String> {
    let position = window.outer_position()
        .map_err(|e| format!("Get window position failed: {}", e))?;

    let monitor = get_current_monitor(app, window)?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();

    // 归一化坐标（相对于显示器）
    let normalized_x = (position.x - monitor_pos.x) as f64 / monitor_size.width as f64;
    let normalized_y = (position.y - monitor_pos.y) as f64 / monitor_size.height as f64;

    settings.last_position = Some(NormalizedPosition {
        x: normalized_x.clamp(0.0, 1.0),
        y: normalized_y.clamp(0.0, 1.0),
        monitor_id: Some(get_monitor_id(&monitor)),
    });

    // 保存到 settings.json
    save_window_settings(settings)?;

    Ok(())
}

fn get_monitor_id(monitor: &Monitor) -> String {
    // 使用显示器名称或索引作为 ID
    monitor.name().unwrap_or("primary")
}
```

**恢复位置（归一化）**：
```rust
pub fn restore_normalized_position(
    window: &WebviewWindow,
    app: &AppHandle,
    panel_size: PhysicalSize<u32>,
    settings: &WindowSettings,
) -> Result<(), String> {
    let last_pos = settings.last_position.as_ref()
        .ok_or("No last position saved")?;

    // 获取目标显示器
    let target_monitor = if let Some(id) = &last_pos.monitor_id {
        find_monitor_by_id(app, id)?
    } else {
        get_current_monitor(app, window)?
    };

    let monitor_pos = target_monitor.position();
    let monitor_size = target_monitor.size();

    // 从归一化坐标转换为实际坐标
    let x = monitor_pos.x + (last_pos.x * monitor_size.width as f64) as i32;
    let y = monitor_pos.y + (last_pos.y * monitor_size.height as f64) as i32;

    // 边界检查
    let final_x = x.clamp(
        monitor_pos.x,
        monitor_pos.x + monitor_size.width as i32 - panel_size.width as i32,
    );
    let final_y = y.clamp(
        monitor_pos.y,
        monitor_pos.y + monitor_size.height as i32 - panel_size.height as i32,
    );

    window.set_position(PhysicalPosition { x: final_x, y: final_y })
        .map_err(|e| format!("Set position failed: {}", e))?;

    Ok(())
}
```

### 6. TrayCenter 定位（使用 positioner）

```rust
use tauri_plugin_positioner::{Position, WindowExt};

pub fn position_tray_center(window: &WebviewWindow) -> Result<(), String> {
    window.move_window(Position::TrayCenter)
        .map_err(|e| format!("Move window to tray failed: {}", e))?;

    Ok(())
}
```

### 7. FocusInput 定位（macOS Accessibility）

```rust
#[cfg(target_os = "macos")]
pub fn get_focused_input_bounds(app: &AppHandle) -> Result<Option<PhysicalPosition<i32>>, String> {
    use accessibility::{AXUIElement, AXUIElementAttributes};

    // 获取当前焦点应用
    let focused_app = get_frontmost_application()?;

    // 获取焦点元素
    let focused_element = focused_app
        .attribute(AXUIElementAttributes::FocusedUIElement)?;

    // 检查是否是文本输入控件
    if is_text_input_element(&focused_element) {
        // 获取控件边界
        let bounds = focused_element
            .attribute(AXUIElementAttributes::Frame)?;

        // 返回输入框中心位置
        let center_x = bounds.x + bounds.width / 2;
        let center_y = bounds.y + bounds.height / 2;

        return Ok(Some(PhysicalPosition {
            x: center_x as i32,
            y: center_y as i32,
        }));
    }

    Ok(None)
}
```

### 8. 多显示器位置映射

```rust
pub fn remap_position_to_monitor(
    old_monitor: &Monitor,
    new_monitor: &Monitor,
    position: PhysicalPosition<i32>,
) -> PhysicalPosition<i32> {
    let old_pos = old_monitor.position();
    let old_size = old_monitor.size();
    let new_pos = new_monitor.position();
    let new_size = new_monitor.size();

    // 计算相对旧显示器的比例位置
    let relative_x = (position.x - old_pos.x) as f64 / old_size.width as f64;
    let relative_y = (position.y - old_pos.y) as f64 / old_size.height as f64;

    // 映射到新显示器
    let new_x = new_pos.x + (relative_x * new_size.width as f64) as i32;
    let new_y = new_pos.y + (relative_y * new_size.height as f64) as i32;

    PhysicalPosition { x: new_x, y: new_y }
}
```

### 9. 定位命令封装

```rust
#[tauri::command]
pub async fn show_panel_with_position(
    app: AppHandle,
    strategy: Option<PanelPositionStrategy>,
) -> Result<(), String> {
    let window = app.get_webview_window("main")
        .ok_or("Main window not found")?;

    let settings = load_window_settings()?;
    let panel_size = window.outer_size()
        .map_err(|e| format!("Get window size failed: {}", e))?;

    let actual_strategy = strategy.unwrap_or(settings.position_strategy);

    match actual_strategy {
        PanelPositionStrategy::TrayCenter => {
            position_tray_center(&window)?;
        }
        PanelPositionStrategy::FollowCursor => {
            position_follow_cursor(&window, &app, panel_size)?;
        }
        PanelPositionStrategy::Center => {
            position_center(&window, &app, panel_size)?;
        }
        PanelPositionStrategy::LastPosition => {
            restore_normalized_position(&window, &app, panel_size, &settings)?;
        }
        PanelPositionStrategy::FocusInput => {
            #[cfg(target_os = "macos")]
            {
                let input_pos = get_focused_input_bounds(&app)?;
                if let Some(pos) = input_pos {
                    window.set_position(pos)
                        .map_err(|e| format!("Set position failed: {}", e))?;
                } else {
                    // fallback 到 FollowCursor
                    position_follow_cursor(&window, &app, panel_size)?;
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                position_follow_cursor(&window, &app, panel_size)?;
            }
        }
    }

    window.show()
        .map_err(|e| format!("Show window failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn hide_panel_and_save_position(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main")
        .ok_or("Main window not found")?;

    let mut settings = load_window_settings()?;

    // 保存归一化位置
    if settings.position_strategy == PanelPositionStrategy::LastPosition {
        let panel_size = window.outer_size()
            .map_err(|e| format!("Get window size failed: {}", e))?;
        save_normalized_position(&window, &app, &mut settings)?;
    }

    window.hide()
        .map_err(|e| format!("Hide window failed: {}", e))?;

    Ok(())
}
```

### 10. 托盘点击定位

```rust
// 托盘事件处理
app.tray().on_tray_icon_event(|app, event| {
    on_tray_event(app.handle(), &event);  // 更新托盘位置状态

    if event == TrayIconEvent::Click {
        // 托盘点击使用 TrayCenter 策略
        let window = app.get_webview_window("main").unwrap();
        position_tray_center(&window).unwrap();
        window.show().unwrap();
    }
});
```

### 11. 快捷键定位

```rust
// 快捷键唤起
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

app.global_shortcut().register("ctrl+v", |app, shortcut| {
    // 快捷键唤起使用 FollowCursor 或用户配置的策略
    let settings = load_window_settings().unwrap();
    show_panel_with_position(app, settings.position_strategy).unwrap();
})?;
```

## 边界

- FocusInput 定位仅 macOS 支持（Windows 需要其他 API）
- 托盘定位依赖 TrayIconEvent，首次启动时托盘位置未初始化会 fallback 到 Center
- 归一化坐标存储在 settings.json，不存数据库
- 多显示器映射只在显示器切换时触发，不实时监听

## 验证要求

- 托盘点击后面板显示在托盘图标下方居中
- 快捷键唤起后面板跟随鼠标光标弹出，不超出屏幕
- 面板记住上次关闭的位置，下次在相同位置弹出
- 多显示器环境下面板始终在光标所在的显示器
- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `pnpm tauri dev` 验证实际行为