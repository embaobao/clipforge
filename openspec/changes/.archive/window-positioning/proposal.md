# 提案：窗口定位升级

## 背景

当前 ClipForge 使用 AppleScript 异步获取输入框位置，存在以下问题：
1. **同步调用阻塞主线程**：导致面板唤起卡顿
2. **异步调用不稳定**：时序问题导致位置不准确
3. **无托盘定位支持**：托盘点击无法正确定位面板
4. **无多显示器适配**：窗口可能出现在屏幕外
5. **无位置记忆**：每次都重新计算，无法记住用户偏好
6. **无防抖机制**：快速多次唤起导致定位抖动
7. **无回退策略**：单一策略失败时无法恢复

参考项目调研结论：
- **Maccy** 提供 5 种定位策略：cursor/statusItem/window/center/lastPosition，lastPosition 用归一化坐标存储
- **EcoPaste** 提供 3 种策略：FollowCursor/Center/Remember，含越界 fallback
- **tauri-plugin-positioner** 提供托盘定位能力：TrayLeft/TrayCenter 等 6 种位置
- **TieZ** 提供多显示器位置映射：`remap_fixed_window_position` 在多显示器间按比例映射

## 目标

- 引入 **tauri-plugin-positioner**：解决托盘点击弹出场景（TrayCenter）
- 自研 **FollowCursor 定位**：跟随鼠标光标弹出（参考 EcoPaste）
- 实现 **归一化坐标 Remember**：记住上次位置，跨分辨率/多显示器适配（参考 Maccy）
- 实现 **多显示器适配**：窗口位置在显示器切换时自动重映射（参考 TieZ）
- 实现 **多层回退机制**：每种策略失败时自动回退到备选策略
- 实现 **异步定位**：跨进程定位信息通过后台线程获取，不阻塞主线程
- 实现 **防抖机制**：快速多次唤起只执行一次定位，避免抖动
- 消除 AppleScript 卡顿：使用 Tauri 原生 API 获取光标位置

## 非目标

- 不支持窗口内元素定位（如按钮旁边弹出）
- 不支持动画过渡定位（瞬移式定位）
- 不实现贴边收纳（后续提案考虑）

## 用户价值

- 托盘点击后面板正确显示在托盘图标下方
- 快捷键唤起后面板跟随鼠标光标弹出，不会出现在屏幕外
- 多显示器环境下面板始终在正确的显示器上
- 面板记住上次关闭的位置，下次在相同位置弹出
- **面板唤起丝滑无卡顿**：异步定位 + 防抖机制
- **定位始终可靠**：多层回退机制确保总有可用策略

## 技术调研结论

### 定位策略组合方案

ClipForge 需要组合使用多种定位方案：

| 场景 | 定位策略 | 实现方式 |
|------|----------|----------|
| 托盘点击 | TrayCenter | tauri-plugin-positioner |
| 快捷键唤起 | FollowCursor | 自研（获取光标位置） |
| 记住位置 | LastPosition | 自研（归一化坐标） |
| 输入框定位 | FocusInput | 自研（Accessibility API） |
| 屏幕居中 | Center | 自研（当前显示器中心） |
| 窗口居中 | WindowCenter | 自研（前台窗口中心） |

### tauri-plugin-positioner 托盘定位

```rust
use tauri_plugin_positioner::{Position, WindowExt};

// 托盘点击事件
app.tray().on_tray_icon_event(|app, event| {
    on_tray_event(app.handle(), &event);
    if event == TrayIconEvent::Click {
        let window = app.get_webview_window("main").unwrap();
        window.move_window(Position::TrayCenter).unwrap();
        window.show().unwrap();
    }
});
```

### FollowCursor 光标跟随（参考 EcoPaste）

```rust
// EcoPaste 的 position.rs
pub fn position_window(window, position) -> Result<()> {
    let (monitor, cursor) = monitor_from_cursor(window)?;
    match position {
        WindowPosition::FollowCursor => {
            let x = cursor.x;
            let y = cursor.y;
            let monitor_bounds = monitor.position();
            let monitor_size = monitor.size();

            if x + window_size.width > monitor_bounds.x + monitor_size.width {
                x = monitor_bounds.x + monitor_size.width - window_size.width;
            }
            if y + window_size.height > monitor_bounds.y + monitor_size.height {
                y = monitor_bounds.y + monitor_size.height - window_size.height;
            }

            window.set_position(Position::Physical(PhysicalPosition { x, y }));
        }
        WindowPosition::Center => {
            let x = monitor_bounds.x + (monitor_size.width - window_size.width) / 2;
            let y = monitor_bounds.y + (monitor_size.height - window_size.height) / 2;
            window.set_position(Position::Physical(PhysicalPosition { x, y }));
        }
        WindowPosition::Remember => {}
    }
}
```

### 归一化坐标存储（参考 Maccy）

```swift
// Maccy 的 PopupPosition.swift - lastPosition 存储
let anchorX = frame.minX + width / 2 - screenFrame.minX
let anchorY = frame.maxY - screenFrame.minY
Defaults[.windowPosition] = NSPoint(
    x: anchorX / screenFrame.width,
    y: anchorY / screenFrame.height
)

// 恢复时从归一化坐标转换为实际坐标
let x = Defaults[.windowPosition].x * screenFrame.width + screenFrame.minX - width / 2
let y = Defaults[.windowPosition].y * screenFrame.height + screenFrame.minY
```

### 多显示器位置映射（参考 TieZ）

```rust
// TieZ 的 remap_fixed_window_position
fn remap_fixed_window_position(
    old_monitor: &Monitor,
    new_monitor: &Monitor,
    window_position: Position,
) -> Position {
    let relative_x = (window_position.x - old_monitor.x) / old_monitor.width;
    let relative_y = (window_position.y - old_monitor.y) / old_monitor.height;
    let new_x = new_monitor.x + relative_x * new_monitor.width;
    let new_y = new_monitor.y + relative_y * new_monitor.height;
    Position::Physical(PhysicalPosition { x: new_x, y: new_y })
}
```

### 定位策略枚举

```rust
pub enum PanelPositionStrategy {
    TrayCenter,       // 托盘图标下方居中
    FollowCursor,     // 跟随鼠标光标（EcoPaste 方案）
    Center,           // 居中当前显示器
    WindowCenter,     // 居中前台窗口（Maccy 方案）
    LastPosition,     // 恢复上次位置（归一化坐标）
    FocusInput,       // 跟随当前焦点输入框
}
```

### 多层回退机制

每种策略失败时自动回退到备选策略：

| 策略 | 回退链路 |
|------|----------|
| TrayCenter | TrayCenter → Center → FollowCursor |
| FollowCursor | FollowCursor → Center → TrayCenter |
| Center | Center → FollowCursor → TrayCenter |
| WindowCenter | WindowCenter → Center → FollowCursor |
| LastPosition | LastPosition → Center → FollowCursor |
| FocusInput | FocusInput → Center → TrayCenter |

### 异步定位与防抖机制

```rust
static POSITION_DEBOUNCE: OnceLock<Arc<Mutex<Option<Instant>>>> = OnceLock::new();

fn debounce_position(window, strategy, width, height) {
    let now = Instant::now();
    let mut last_call = POSITION_DEBOUNCE.get_or_init(|| Arc::new(Mutex::new(None))).lock().unwrap();
    
    if let Some(last) = *last_call {
        if now.duration_since(last) < Duration::from_millis(50) {
            return;
        }
    }
    *last_call = Some(now);
    
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(10));
        if let Some((x, y)) = apply_position_strategy(window, strategy, width, height) {
            let _ = window.set_position(LogicalPosition::new(x, y));
        }
    });
}
```

## 实施路线图

### P1：核心定位能力

| 任务 | 依赖 | 优先级 | 状态 |
|------|------|--------|------|
| 引入 tauri-plugin-positioner | Cargo.toml | 高 | 已完成 |
| 实现定位策略枚举与配置存储 | serde | 高 | 已完成 |
| 实现 FollowCursor 定位 | Tauri Cursor API | 高 | 已完成 |
| 实现 Center 定位 | Tauri Monitor API | 高 | 已完成 |
| 实现 TrayCenter 定位 | tauri-plugin-positioner | 高 | 已完成 |
| 实现 LastPosition 归一化坐标 | settings.json5 | 高 | 已完成 |
| 实现 WindowCenter 定位 | AppleScript (macOS) | 高 | 已完成 |
| 实现多层回退机制 | 以上所有 | 高 | 已完成 |
| 重构 open_panel 统一入口 | 以上所有 | 高 | 已完成 |

### P2：进阶定位能力

| 任务 | 依赖 | 优先级 | 状态 |
|------|------|--------|------|
| 异步定位机制 | thread::spawn | 高 | 已完成 |
| 防抖机制 | Instant + Duration | 高 | 已完成 |
| FocusInput 定位（macOS） | Accessibility API | 中 | 待实现 |
| 多显示器位置映射 | TieZ 方案 | 中 | 待实现 |
| 设置页定位策略选择 | 前端 UI | 中 | 待实现 |

### P3：体验优化

| 任务 | 依赖 | 优先级 | 状态 |
|------|------|--------|------|
| 定位动画过渡 | Tauri 动画 API | 低 | 待评估 |
| 贴边收纳 | 自研 | 低 | 待评估 |

## 验证要求

- 托盘点击后面板显示在托盘图标下方居中
- 快捷键唤起后面板跟随鼠标光标弹出，不超出屏幕
- 面板记住上次关闭的位置，下次在相同位置弹出
- 多显示器环境下面板始终在光标所在的显示器
- **快速多次唤起无抖动**：防抖机制生效
- **面板唤起无卡顿**：异步定位不阻塞主线程
- **定位失败自动恢复**：回退机制生效
- `pnpm build` 通过
- `cd src-tauri && cargo check` 通过
- `pnpm tauri dev` 验证实际行为
