# 架构说明

ClipForge 分为三层：前端交互层、Tauri 原生能力层、本地数据与服务契约层。

```text
React UI
  |-- 快速面板 / 设置窗口 / 虚拟列表
  |-- Zustand UI 状态
  |-- TypeScript 服务契约

Tauri Commands
  |-- 剪贴板读取与写入
  |-- 全局快捷键 / 状态栏菜单
  |-- 窗口定位 / 置顶 / 透明窗口
  |-- 配置文件和日志

Local Runtime
  |-- SQLite 持久数据库
  |-- FTS 检索
  |-- JSON5 用户配置
  |-- 后续同步 / 导入导出 / MCP
```

## 前端

前端使用 React + TypeScript + Vite。UI 不是营销页，而是工具型应用界面，重点是：

- 快速面板默认高密度。
- 主列表使用虚拟滚动，避免历史记录变大后卡顿。
- 搜索和类型 Tag 直接作用于主列表。
- 设置窗口与快速面板分离，避免设置表单影响快捷唤起性能。

Zustand 只用于跨组件 UI 状态，例如当前预览项、关闭动画状态。业务数据仍由 Tauri command 和本地数据库驱动。

## Tauri/Rust

Rust 层负责所有系统能力：

- `read_clipboard_text` / `write_clipboard_text`
- `capture_clip_record`
- `query_clip_records`
- `soft_delete_clip_records`
- `update_clip_record`
- `cleanup_clip_records`
- `read_user_settings` / `write_user_settings`
- `append_app_log`
- `open_settings_window`
- `check_accessibility_permission`

平台相关逻辑必须留在 Rust 层，前端只消费稳定命令。

## 数据

当前数据目标：

- SQLite 永久保存剪贴板历史。
- 软删除优先，按配置定期硬删除。
- 查询使用分页 cursor，默认限制返回条数。
- 长期目标支持 100,000 条记录仍保持快速检索。

## 配置与日志

用户配置映射到系统用户目录下的 JSON5 文件。日志写入本地文件，便于定位剪贴板采集、快捷键、窗口和数据库问题。

设置页展示配置路径和数据库路径，后续每个配置项都应该能在 UI 中直接修改。
