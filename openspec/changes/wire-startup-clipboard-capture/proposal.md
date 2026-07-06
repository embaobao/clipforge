# 提案：打通启动剪贴板捕获

## 背景

当前 ClipForge 已有 Tauri 原生剪贴板读写命令，也有前端轮询，但用户启动 App 时还缺一个明确可见的闭环：系统剪贴板里的当前文本应立即进入“快速粘贴”面板，并被选中展示，用户可以马上确认 Clipy 类剪贴板效果是否成立。

## 目标

- 本 change 的优先级重新聚焦为“极速悬浮调用面板 + Agent 快速访问”，先保证核心剪贴板调用体验稳定，再扩展管理、品牌和高级能力。
- 将“悬浮快捷面板”提升为 P0 核心能力：快捷键触发后必须能在当前工作上下文上方快速出现，而不是普通管理窗口。
- macOS 优先接入 `tauri-nspanel`，用 NSPanel 覆盖原生全屏 Space；普通 Tauri `alwaysOnTop` 仅作为非 macOS 或降级路径。
- 快捷面板显示前必须先探测当前输入位置；拿不到输入控件再使用当前鼠标所在屏幕，最后才退到右侧兜底。
- 支持二次触发隐藏、失焦延迟隐藏、点击列表复制、数字键/Enter 快速粘贴，保证 Clipy 类“快速复制/粘贴”链路稳定。
- App 启动后立即读取当前系统剪贴板文本。
- 新文本自动写入历史并出现在快速粘贴面板顶部。
- 已存在文本不重复插入，而是提升到顶部并选中。
- 工具栏提供“读取剪贴板”按钮，便于手动验证复制后的捕获效果。
- Agent/MCP 只作为标准外部工具接口暴露读、写、查、删、导入导出能力，不进入主流程，不新增复杂 AI 配置面板。

## 非目标

- 不实现图片、文件等非文本格式。
- 不引入新的 UI 组件库迁移。
- 不在当前阶段实现复杂 AI/MCP 配置；MCP 只保留标准服务接口和后续命令边界。
- 不复刻 EcoPaste 的完整功能集合；只借鉴成熟窗口生命周期、粘贴模拟和本地存储架构，ClipForge 仍聚焦更轻的快捷调用面板。

## 用户价值

用户复制任意文本后启动 ClipForge，或在 App 内点击“读取剪贴板”，即可看到当前系统剪贴板内容出现在快速粘贴列表顶部，并可直接复制回写。

## 技术调研结论

- `tauri-nspanel` 是 macOS 全屏 Space 上方显示快捷面板的 P0 方案：将 `main` webview window 转成 NSPanel，并设置 `Floating`、`nonactivating_panel`、`full_screen_auxiliary`、`can_join_all_spaces`，必要时启用 `ActivationPolicy::Accessory`。
- `tauri-plugin-positioner` 适合托盘/屏幕角落等固定位置兜底，但不提供当前输入控件坐标探测；ClipForge 的热路径仍应先走 Accessibility/AX focused element，再退到鼠标所在屏幕和右侧侧拉。
- EcoPaste 的成熟经验可直接借鉴到粘贴链路：选中内容后先写入系统剪贴板，再隐藏或释放 NSPanel，短延迟后模拟系统粘贴快捷键，避免面板自身吞掉 Cmd/Ctrl+V。
- Cap 等多窗口 Tauri 应用说明“核心体验窗口”和“设置/管理窗口”应分离：快捷面板保持轻、透明、固定最大尺寸；设置和管理走单独窗口或宽面板，避免切换时重排卡顿。
- Agent 快速访问不需要造复杂平台：统一复用 `ClipboardRepository`、`SearchIndex`、`ExternalToolBridge` 契约，后续 MCP 仅暴露 `clipboard.capture/search/copy/update/delete/export/import` 等标准工具。
