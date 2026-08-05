# 设计：视觉回归修复边界

## 1. 修复面划分

本提案只允许触碰四个明确区域：

```text
MainPanel
  QuickListSelection      // 恢复，不重设
  TopToolbar              // 只收紧布局
  TopToolbarMenu          // 单独菜单视觉

SettingsWindow
  AnimateSidebarSlots     // 设置页容器内样式
  AnimateTabsSlots        // 设置页容器内样式
  CodeTabsSlots           // 设置页容器内样式
```

## 2. 主列表选中交互

修复策略：

- 不新增 `.quick-row.active` / `.quick-row.selected` 的最终覆盖。
- 不隐藏或重写既有 `target-focus-ring`，除非有明确旧规则证据和用户确认。
- 如果要调整“虚线不好看”，必须先形成独立视觉方案并截图确认，不能直接覆盖交互。

验收点：

- 鼠标 hover、键盘上下选择、点击复制、多选选择四种状态均保持原语义。
- 行内收藏、详情、删除按钮显示逻辑不被 CSS 覆盖影响。

## 3. 顶部菜单

目标样式：

- 宽度 152-176px。
- padding 4-6px。
- 圆角 10px 或以下。
- 背景接近实色白，保留轻微 blur 即可。
- header 使用 12px 左右，muted 但可读。
- item 高度 28-32px。
- hover 背景轻量，不使用大面积厚灰块。
- 快捷键在右侧对齐。

建议 CSS 边界：

```css
.app-shell .top-toolbar-menu.dropdown-content { ... }
.app-shell .top-toolbar-menu .dropdown-item { ... }
.app-shell .top-toolbar-menu-header.dropdown-label { ... }
```

禁止：

- 修改全局 `.dropdown-content` 来修顶部菜单。
- 用 `!important` 覆盖所有 dropdown 行为。
- 让 menu 样式影响详情页 action menu。

## 4. 顶部工具栏

允许调整：

- `.top-toolbar` grid column、gap、height。
- `.top-view-tabs` trigger 宽高。
- `.top-agent-button` / `.top-menu-trigger` 尺寸。
- `.top-toolbar .toolbar` 与搜索框高度。

禁止调整：

- `.quick-row`、`.target-focus-ring`、`.virtual-list`。
- 复制、粘贴、选中、多选状态逻辑。
- 非 top-toolbar 的 dropdown 样式。

## 5. 设置页样式收口

设置页改造方向继续采用 Animate UI 组合组件，但样式必须满足：

- 所有设置页最终覆盖以 `.settings-window-shell` 或 `.settings-window-body[data-slot="sidebar-provider"]` 为根。
- 不写影响 `.app-shell` 的设置页样式。
- Sidebar / Tabs / Code Tabs 用 `data-slot` 绑定，避免影响其它 tabs/dropdown。
- 不把设置页视觉问题用主面板 CSS 修。

## 6. 验证策略

自动验证：

- `pnpm exec tsc --noEmit`
- `node scripts/verify-settings-surface.mjs`
- `pnpm openspec validate quick-panel-visual-regression-recovery --strict`
- `git diff --check`

运行态验证：

- 打开主面板，确认列表选中态恢复。
- 打开顶部菜单，确认 header、Trash、Settings、快捷键视觉正常。
- 点击菜单 Trash / Settings，确认动作仍在。
- 打开设置页，确认 Sidebar/Tabs/Code Tabs 没有退化。

用户目视验收：

- 这类回归必须以用户截图或用户明确确认作为最终证据，不只靠静态脚本。
