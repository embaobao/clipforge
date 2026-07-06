# 提案：NSPanel 悬浮面板

## 背景

当前 ClipForge 使用 WebviewWindow 作为面板，存在以下问题：
1. **无法覆盖原生全屏 Space**：macOS 全屏应用（如 Safari、Finder）上方无法显示
2. **焦点管理不稳定**：面板可能抢夺焦点，影响用户操作
3. **不够原生体验**：WebviewWindow 不是 macOS 标准 NSPanel

参考项目调研结论：
- **EcoPaste** 使用 tauri-nspanel 实现 macOS 悬浮面板，完美覆盖全屏应用
- **Maccy** 使用 FloatingPanel（NSPanel 子类），`.nonactivatingPanel` + `.statusBar` level

## 目标

- macOS 上使用 **NSPanel** 替代 WebviewWindow 作为快捷面板
- 配置 NSPanel 属性：
  - `.nonactivatingPanel`：不抢焦点
  - `.statusBar` level：浮动在普通窗口上方
  - `hidesOnDeactivate = false`：失焦不自动隐藏（手动控制）
  - `can_join_all_spaces`：覆盖所有 Space
  - `full_screen_auxiliary`：覆盖全屏应用
- Windows 端继续使用 WebviewWindow + `always_on_top`

## 非目标

- 不替换主窗口（管理窗口仍是 WebviewWindow）
- 不实现多面板（只有一个快捷面板）
- 不引入复杂窗口动画

## 用户价值

- 用户在 Safari 全屏模式下，快捷键仍能唤起面板
- 面板不抢焦点，用户可以继续在原应用输入
- 面板体验更原生，符合 macOS 视觉语言

## 技术调研结论

### NSPanel 关键属性（参考 Maccy）

```swift
// Maccy FloatingPanel.swift
styleMask: [.nonactivatingPanel, .resizable, .closable, .fullSizeContentView]
level = .statusBar           // 与菜单栏同层
isFloatingPanel = true       // 浮动在其他窗口上方
collectionBehavior = [.auxiliary, .stationary, .moveToActiveSpace, .fullScreenAuxiliary]
hidesOnDeactivate = false    // 失焦不自动隐藏（手动处理）
backgroundColor = .clear     // 圆角裁切
canBecomeKey = true          // 允许接收键盘焦点
```

### tauri-nspanel 方案（参考 EcoPaste）

EcoPaste 使用 tauri-nspanel crate：
- 将 Tauri WebviewWindow 转换为 NSPanel
- 支持 PanelLevel::Floating
- 支持 CollectionBehavior 配置
- 异步显示（解决 macOS NSPanel 显示延迟问题）

### NSPanel vs WebviewWindow

| 维度 | NSPanel | WebviewWindow |
|------|---------|---------------|
| 覆盖全屏 Space | ✅ | ❌ |
| 不抢焦点 | ✅ nonactivatingPanel | ❌ 需手动配置 |
| 浮动层级 | ✅ statusBar level | ⚠️ alwaysOnTop |
| 原生体验 | ✅ macOS 标准 | ❌ WebView |
| 跨平台 | ❌ macOS only | ✅ 全平台 |

### 方案选择

**ClipForge 方案**：
- macOS：使用 tauri-nspanel 实现 NSPanel
- Windows/Linux：继续使用 WebviewWindow + `always_on_top`

### tauri-nspanel API

```rust
use tauri_nspanel::{NSPanel, PanelLevel, PanelStyleMask, PanelCollectionBehavior};

// 创建 NSPanel
let panel = NSPanel::new(
    app,
    "quick-panel",
    PanelStyleMask::nonactivatingPanel()
        | PanelStyleMask::resizable()
        | PanelStyleMask::closable()
        | PanelStyleMask::fullSizeContentView(),
)?;

// 配置属性
panel.set_level(PanelLevel::Floating);
panel.set_collection_behavior(
    PanelCollectionBehavior::auxiliary()
        | PanelCollectionBehavior::moveToActiveSpace()
        | PanelCollectionBehavior::fullScreenAuxiliary()
);
panel.set_hides_on_deactivate(false);
panel.set_can_become_key(true);
panel.set_background_color(Color::CLEAR);

// 显示面板
panel.show();

// 隐藏面板
panel.hide();
```

### 窗口分离方案

ClipForge 需要两个窗口：
1. **快捷面板（NSPanel）**：轻量、悬浮、快速唤起
2. **管理窗口（WebviewWindow）**：完整功能、设置、详情

避免将管理功能塞入 NSPanel，保持快捷面板轻量。