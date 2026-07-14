# 提案：悬浮面板交互升级

## 背景

ClipForge 悬浮面板在多显示器、Retina、快捷键高频触达等场景下存在定位不准、交互不闭环、视觉突兀等问题。本提案汇总本轮面板交互与定位的系统性升级，统一在「逻辑点空间」下做几何计算，并引入分组快捷键、固定（pin）、完成提示等能力，对齐 EcoPaste / Maccy 的成熟做法。

## 目标

- 多显示器/Retina/混合 DPI 下，面板准确落在鼠标/输入框所在屏，不偏移、不错屏。
- 快捷键（Ctrl+V）可重复触发（toggle），点击条目直接粘贴并关闭，失焦/外部点击自动关闭且不影响正常输入。
- 长列表支持「分组 + 数字快捷键」：每 10 项一组，Cmd+0-9 触发激活组对应项，Cmd+↑/↓ 切组。
- pin 固定面板（对齐 EcoPaste：仅标志位、保持当前位置、所有自动隐藏路径跳过）。
- 多选工具栏 icon-only + tooltip，去删除二次确认，支持批量收藏，操作完成有短时 toast。

## 非目标

- 远程同步、AI/语义检索不在本轮范围。
- 富媒体（图片/文件）采集见独立提案。

## 关键设计

- **统一逻辑点空间**：光标用 `CGEvent.location()`（macOS，绕开 tao `cursor_position()` 主屏 scale bug）；显示器命中用 `monitor_from_point`(逻辑) → work_area 几何 → primary 兜底，绝不回退 `current_monitor()`（隐藏态陈旧屏）。
- **分组模型**：VirtualList 按视口中心算「激活分组」起始并上报；`Cmd+0-9` = 激活组内第 N 项；`Cmd+↑/↓` 命令式切组 + 焦点跟随新组第一项；纯 `↑/↓` 仍逐项移动。
- **pin**：`PANEL_PINNED` 标志位，所有隐藏路径（hide_panel / hide_panel_before_paste / 前端 Escape / 前端失焦）在 pinned 时跳过；不移动面板。
- **完成提示**：`completionToast` 状态 + 1.2s 自动清除，聚合复制/删除/批量收藏后浮现。
- **轻量动效边界**：底部导航可引入 Animate UI Tabs 的 active highlight；列表选择态可参考 Animate UI Icons 的 hover/selected smooth highlight，但必须保留现有虚线框、分组快捷键与 active row 语义，不把选择态改成新的卡片体系。
