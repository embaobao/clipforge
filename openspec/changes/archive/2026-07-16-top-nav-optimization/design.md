# 设计：主面板顶部导航与底部 Dock 收敛

## 1. 当前状态

该 change 当前只有 `proposal.md`，缺少任务、设计和规范增量。本设计把它收敛为主面板布局优化：顶部工具栏承接视图切换、搜索、Agent 和菜单；底部 Dock 退出主路径。

## 2. 设计原则

- 主面板是快速剪贴板工具，不新增营销式顶部区域。
- 顶部工具栏必须可拖拽，但按钮、搜索框和菜单必须保持可点击。
- 删除底部 Dock 后，列表高度增加，但列表滚动、选中、复制和多选不改变语义。
- Trash 是低频入口，移入菜单；快捷键仍可直接切换。
- Onboarding 不再出现在主面板菜单，改由设置面板承载。

## 3. 目标布局

```text
QuickPanel
  TopToolbar data-tauri-drag-region
    ViewSwitch: History / Favorites
    SearchField
    AgentButton
    StatusIndicator
    MoreMenu
      Trash
      Settings
  ClipList
  DetailOverlay / AgentOverlay
```

窄宽度下的降级：

- 视图切换可缩成 icon-only，但 Tooltip 和可访问 label 必须保留。
- Search 激活时可压缩次要按钮，但不能隐藏当前输入。
- Agent 状态徽章不得撑高工具栏。

## 4. 组件边界

建议新增：

```text
src/clipboard/components/TopToolbar.tsx
src/clipboard/components/ViewSwitch.tsx
src/clipboard/components/PanelMoreMenu.tsx
```

如果当前主面板仍集中在 `src/App.tsx`，第一阶段可以先在该文件内替换布局；但被触碰后必须遵守文件大小和后续拆分提案要求，不能继续向 `App.css` 追加大量样式。

## 5. 交互细节

- `TopToolbar` 外层可拖拽。
- 所有可点击控件必须阻止拖拽冒泡。
- 菜单展开方向从顶部向下。
- `Trash` 菜单项在 trash 视图时显示当前态。
- `Cmd/Ctrl+,` 打开设置保持不变。
- `T` 切换 trash 视图保持不变。

## 6. 验证策略

需要覆盖三类验证：

- 自动化：TypeScript、build、Rust check。
- UI smoke：历史/收藏/trash 切换、搜索输入、Agent 打开、设置打开。
- Tauri dev 手动：拖拽窗口、按钮点击不被拖拽吞掉、列表底部不被遮挡。
