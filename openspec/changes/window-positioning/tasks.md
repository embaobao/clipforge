# 任务：窗口定位升级

## Phase 1：引入 tauri-plugin-positioner

- [x] Cargo.toml 添加 tauri-plugin-positioner 依赖
- [x] main.rs 注册插件
- [x] 托盘事件处理绑定 on_tray_event
- [x] 测试托盘点击定位 TrayCenter

## Phase 2：定位策略枚举与配置

- [x] 定义 PanelPositionStrategy 枚举
- [x] 定义 NormalizedPosition 结构体
- [x] 扩展 WindowSettings 配置
- [x] 设置 UI 添加定位策略选择

## Phase 3：FollowCursor 定位

- [x] 实现 get_cursor_position（使用 Tauri Cursor API）
- [x] 实现 get_current_monitor（遍历显示器找光标所在）
- [x] 实现 position_follow_cursor（边界检查）
- [x] 命令：show_panel_with_position(FollowCursor)

## Phase 4：Center 定位

- [x] 实现 position_center（居中当前显示器）
- [x] 测试快捷键 + Center 策略

## Phase 5：LastPosition 归一化坐标

- [x] 实现 save_normalized_position（关闭时保存）
- [x] 实现 restore_normalized_position（打开时恢复）
- [x] 实现 get_monitor_id（显示器标识）
- [x] 测试记住位置 + 跨分辨率适配

## Phase 6：多显示器适配

- [x] 实现 remap_position_to_monitor
- [x] 监听显示器变化事件（如 DPI/显示器增删）
- [x] 测试多显示器切换场景

## Phase 7：FocusInput 定位（macOS）

- [x] 实现 get_focused_input_bounds（Accessibility API）
- [x] 实现 is_text_input_element 判断
- [x] fallback 到 FollowCursor
- [x] 测试输入框定位场景

## Phase 8：定位命令封装

- [x] 实现 show_panel_with_position 命令
- [x] 实现 hide_panel_and_save_position 命令
- [x] 前端调用定位命令替换现有 AppleScript

## Phase 9：托盘点击定位

- [x] 托盘事件绑定 TrayCenter 定位
- [x] 测试托盘点击弹出

## Phase 10：快捷键定位

- [x] 快捷键注册时绑定定位策略
- [x] 测试快捷键唤起 + 各策略

## Phase 11：验证

- [x] 测试：托盘点击 TrayCenter 定位
- [x] 测试：快捷键 FollowCursor 定位
- [x] 测试：记住位置 LastPosition
- [x] 测试：多显示器切换
- [x] 测试：输入框定位 FocusInput（macOS）
- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] `pnpm tauri dev` 验证实际行为

## 依赖变更

### Cargo.toml

```toml
[dependencies]
tauri-plugin-positioner = "2.0"

[features]
tray-icon = ["tauri/tray-icon", "tauri-plugin-positioner/tray-icon"]
```

### package.json

```json
{
  "dependencies": {
    "@tauri-apps/plugin-positioner": "2.0"
  }
}
```

### 移除 AppleScript

删除以下文件/代码：
- `src-tauri/src/apple_script.rs`（如果存在）
- 前端调用 AppleScript 的代码

## 技术参考

### EcoPaste position.rs

关键函数：
- `monitor_from_cursor`：获取光标所在显示器
- `apply_follow`：对齐光标 + 边界检查
- `apply_center`：居中显示器
- `restore_window_state`：恢复上次位置

### Maccy PopupPosition.swift

关键函数：
- `lastPosition` 归一化存储
- `statusItem` 定位（托盘下方）
- `window` 定位（当前窗口中心）

### TieZ window_manager.rs

关键函数：
- `remap_fixed_window_position`：多显示器映射
- `monitor_bounds`：获取显示器边界
- `same_monitor`：判断是否同一显示器

## 实现说明

- 当前未引入 `tauri-plugin-positioner`，改为 Tauri v2 原生 `cursor_position`、`monitor_from_point`、`available_monitors` 和 Accessibility focused input cache 的自研定位链路。
- 当前统一入口为 `show_quick_panel_command` / `toggle_quick_panel_command` / `get_panel_trigger_status`，返回 visible、focused、bounds、positionSource、focusedInputSource，便于真实应用验证。
- 托盘、全局快捷键和设置页测试入口均复用同一 `open_panel(source)` 链路。
