# 任务：NSPanel 悬浮面板

## Phase 1：引入 tauri-nspanel（macOS）

- [ ] Cargo.toml 添加 tauri-nspanel 依赖
- [ ] 评估 tauri-nspanel 与 Tauri v2 最新版本兼容性
- [ ] 如果官方版本不兼容，fork 并适配
- [ ] objc2-app-kit 依赖

## Phase 2：创建 quick-panel 页面

- [ ] 创建 quick-panel.html 独立页面
- [ ] 创建 quick-panel.tsx React 入口
- [ ] 实现 QuickPastePanel 组件（轻量版）
- [ ] 样式：透明背景 + 圆角裁切 + 毛玻璃效果

## Phase 3：NSPanel 创建与配置（macOS）

- [ ] 实现 create_quick_panel 函数
- [ ] 配置 PanelStyleMask（nonactivatingPanel + borderless）
- [ ] 设置 PanelLevel::Floating
- [ ] 设置 CollectionBehavior（canJoinAllSpaces + fullScreenAuxiliary）
- [ ] 设置 hides_on_deactivate(false)
- [ ] 设置 can_become_key(true)
- [ ] 设置透明背景

## Phase 4：显示/隐藏命令（macOS）

- [ ] 实现 show_quick_panel 命令
- [ ] 实现 hide_quick_panel 命令
- [ ] 实现 toggle_quick_panel 命令
- [ ] 实现 focus_quick_panel 命令
- [ ] 实现 release_focus 命令

## Phase 5：NSPanel 定位集成

- [ ] 实现 position_panel 函数（集成窗口定位模块）
- [ ] 支持 FollowCursor/Center/TrayCenter/LastPosition/FocusInput
- [ ] 测试各定位策略

## Phase 6：焦点管理

- [ ] 实现 on_resign_key 失焦监听
- [ ] 延迟隐藏逻辑（默认 3 秒）
- [ ] 点击搜索框获得焦点
- [ ] 粘贴完成后释放焦点

## Phase 7：Windows/Linux WebviewWindow 方案

- [ ] create_quick_panel（WebviewWindow）
- [ ] always_on_top 配置
- [ ] transparent + decorations(false)
- [ ] show/hide 命令

## Phase 8：快捷键集成

- [ ] 快捷键注册绑定 toggle_quick_panel
- [ ] 托盘点击绑定 show_quick_panel
- [ ] 二次触发隐藏

## Phase 9：前端事件监听

- [ ] 监听 quick-panel://show 事件
- [ ] 监听 quick-panel://hide 事件
- [ ] 粘贴完成后调用 release_focus
- [ ] 状态重置逻辑

## Phase 10：验证

- [ ] 测试：Safari 全屏模式唤起面板
- [ ] 测试：面板不抢焦点
- [ ] 测试：点击搜索框获得焦点
- [ ] 测试：失焦延迟隐藏
- [ ] 测试：Windows/Linux always_on_top
- [ ] `pnpm build` 通过
- [ ] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证实际行为

## 依赖变更

### Cargo.toml

```toml
[target.'cfg(target_os = "macos")'.dependencies]
tauri-nspanel = "0.1"  # 或 git 版本
objc2-app-kit = "0.2"

[features]
macos-private-api = ["tauri/macos-private-api"]
```

### package.json

无需新增依赖。

### 文件新增

- `quick-panel.html`：快捷面板独立页面
- `src/quick-panel.tsx`：快捷面板 React 入口
- `src/components/QuickPastePanel.tsx`：轻量快捷面板组件

### 文件修改

- `src-tauri/src/main.rs`：注册 NSPanel
- `src-tauri/src/panel/mod.rs`：NSPanel 模块（新增）
- `src-tauri/src/panel/commands.rs`：NSPanel 命令（新增）
- `src-tauri/Cargo.toml`：添加依赖