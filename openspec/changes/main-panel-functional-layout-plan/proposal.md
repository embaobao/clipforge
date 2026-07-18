# 提案：主面板功能布局完整规划

## 优先级

P1。主面板是 ClipForge 的核心入口，必须优先服务快速剪贴板使用：快捷唤起、搜索、历史、收藏、回收站、复制/粘贴、删除、多选、详情和 Agent 入口。该提案不替代已有 `top-nav-optimization`，而是把主面板整体功能布局收敛成可执行的主规划。

## 当前状态

`top-nav-optimization` 已覆盖顶部工具栏和底部 Dock 移除，但它只解决导航位置和入口权重问题，不完整覆盖主面板的信息架构、列表密度、状态反馈、详情/Agent 覆层、多选工具条、空态、错误态和响应式策略。

当前主面板仍存在以下规划缺口：

1. **功能区域边界不完整**：顶部工具栏、搜索、列表、批量操作、详情、Agent 和状态反馈缺少统一布局契约。
2. **状态层级不清晰**：搜索中、无结果、复制成功、删除、文件缺失、Agent 上下文计数、多选等状态容易互相挤压。
3. **热路径保护缺少页面级规划**：选中、滚动、复制、粘贴必须优先于扩展面板和二级功能。
4. **响应式规则不足**：小宽度、小高度、英文长文案、图像/文件条目和多选状态需要统一降级。
5. **后续拆分缺少落点**：`App.tsx` / `App.css` 已过大，主面板需要按 surface 拆组件，但不能在重构过程中破坏热路径。

## 目标

1. 固化主面板的完整功能布局：顶部命令区、搜索区、视图区、列表区、行内动作区、状态区、详情/Agent 覆层。
2. 明确每个区域的职责、优先级、尺寸约束和降级策略。
3. 规划主面板组件拆分顺序，避免继续向 `App.tsx` / `App.css` 堆叠。
4. 保持 Clipy 等价能力优先，不把主面板做成 AI 工作台或设置页入口。
5. 为后续开发提供可验收的任务清单和 spec delta。

## 非目标

- 不在本提案中实现新的 AI/provider 功能。
- 不改变剪贴板采集、写回、删除、收藏、文件存在性检查的数据语义。
- 不迁移 Settings Service 到主面板热路径。
- 不引入营销首页、复杂仪表盘或长期知识库视图。
- 不要求一次性完成大规模视觉重写；允许按任务阶段交付，但最终布局必须符合本提案。

## 主布局规划

```text
QuickPanel
  TopCommandBar
    ViewSwitch: History / Favorites
    SearchBox
    AgentShortcut
    MoreMenu: Trash / Settings
  ModeBar
    SearchSummary | MultiSelectActions | FilterStatus
  ClipboardList
    ClipboardRow
      TypeIndicator
      ContentPreview
      Metadata
      InlineActions: Copy / Favorite / Delete / Detail
  StatusFeedback
    CopySavedToast | DeleteUndo | FileMissing | ProviderDisabled
  OverlayLayer
    DetailPanel
    AgentPanel
    ConfirmDialog
```

## 布局优先级

1. **P0 热路径**：搜索输入、列表选中、复制/粘贴、键盘上下移动、Enter/快捷键复制。
2. **P1 管理动作**：收藏、删除、批量删除、回收站、详情打开。
3. **P2 辅助入口**：Agent、设置、状态提示、诊断信息。
4. **P3 扩展能力**：AI 摘要、相似推荐、MCP 工具入口；默认不得占用主列表首屏。

## 成功标准

1. 主面板布局规划覆盖 History、Favorites、Trash、Search、Multi-select、Detail、Agent、Settings、Status、File/Image rows。
2. 主列表在普通状态下是第一视觉主体，顶部命令区不得压缩列表到不可用。
3. 搜索结果直接展示在主列表，不进入二级面板。
4. 多选模式有明确的 ModeBar 或等价工具条，不遮挡行内容。
5. 详情和 Agent 使用覆层/侧层，不改变列表基础布局，不阻塞复制热路径。
6. 小窗口下有明确降级：文字可隐藏为 icon-only，但控件可达、Tooltip/aria-label 保留。
7. 后续实现不得让主面板打开、滚动、选中、复制/粘贴反馈 P95 超过 300ms。
8. OpenSpec strict validate 通过。

## 与现有提案关系

- `top-nav-optimization`：本提案的顶部命令区子集，继续作为独立实现提案。
- `onboarding-to-settings-proposal`：保证主面板不再承载 Onboarding。
- `settings-interface-redesign`：主面板只保留 Settings 入口，不承载设置表单。
- `clipboard-agent-panel`：Agent 入口保留在主面板，但 Agent 面板必须是辅助层，不抢主列表主导权。
- `file-image-clipboard-support` / `clipboard-multi-format-fidelity`：文件、图片、多格式条目必须遵守本提案的行高和预览降级策略。
