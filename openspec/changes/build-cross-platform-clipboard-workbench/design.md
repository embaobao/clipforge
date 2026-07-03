# 设计：ClipForge 跨平台剪贴板工具架构

## 技术选择

采用 Tauri v2 + React + TypeScript：

- Tauri 的常驻内存和安装包体积更适合剪贴板管理器。
- Rust 原生层适合收敛剪贴板、快捷键、托盘、SQLite 和平台权限。
- React 前端适合构建快速菜单、列表、搜索、详情和设置面板。

## 模块划分

```text
React UI
  - 快速粘贴面板
  - 搜索框
  - 历史列表
  - 详情预览
  - 片段/文件夹/归档/设置面板

Tauri commands
  - read_clipboard_text
  - write_clipboard_text
  - 后续：register_global_shortcut
  - 后续：open_tray_menu

Data layer
  - 当前：localStorage
  - 后续：SQLite clips table
  - 后续：embedding queue + vector index

MCP layer
  - 后续：MCP server
  - search / copy / archive / delete tools
  - 不在主界面提供复杂 AI 配置
```

## 交互设计

- 应用启动默认进入快速粘贴面板，并自动 focus 搜索框。
- 搜索不改变文件夹层级，结果直接显示在主列表。
- 列表行固定结构，避免新增内容导致按钮和文本跳动。
- 详情面板保持复制、归档、保存片段、删除等高频操作。
- 批量操作基于当前过滤结果，支持全选当前和删除选中。
- 片段和文件夹按 Clipy 习惯优先服务快速粘贴，不做成复杂控制台。

## 性能设计

- 剪贴板采集使用低频轮询 MVP，当前间隔 900ms。
- 写入前按内容去重，最多保留 300 条。
- 搜索在前端内存中即时过滤，后续数据量变大后迁移到 SQLite FTS 和向量召回。
- 原生权限能力不散落在前端插件里，减少跨平台权限差异。

## 风险

- Linux 剪贴板后端依赖桌面环境，后续需要专项验证。
- 系统级粘贴模拟涉及 macOS Accessibility、Windows input injection、Linux compositor 差异，第一阶段不承诺。
- 语义检索需要隐私策略，默认应本地化。
