# 设计：主面板功能布局完整规划

## 1. 设计原则

- 主面板首先是剪贴板工具，首屏必须围绕历史、收藏、搜索、复制和删除。
- 布局使用工具型密度：信息清晰、控件稳定、少装饰，不做落地页和大卡片首页。
- 搜索结果直接替换列表内容，不创建独立搜索页。
- 详情、Agent、确认弹窗都属于 OverlayLayer，不得改变基础列表布局。
- 所有扩展能力默认让位于 P0 热路径。

## 2. 页面区域

```text
┌────────────────────────────────────────────┐
│ TopCommandBar                              │
│ [History][Favorites] [Search........] [A][…]│
├────────────────────────────────────────────┤
│ ModeBar / Status Strip                     │
├────────────────────────────────────────────┤
│ ClipboardList                              │
│  Row 01  text/file/image preview    actions│
│  Row 02  text/file/image preview    actions│
│  Row 03  text/file/image preview    actions│
├────────────────────────────────────────────┤
│ Toast / Undo / transient feedback          │
└────────────────────────────────────────────┘
OverlayLayer: DetailPanel / AgentPanel / ConfirmDialog
```

### TopCommandBar

职责：

- 一级视图切换：History / Favorites。
- 搜索输入。
- Agent 入口和上下文计数。
- More menu：Trash / Settings。
- 窗口拖拽区域。

约束：

- 高度目标 28-36px；不能回到 48px Dock 级别。
- 搜索框是中间主控件，窄宽度下保留输入区域。
- 所有按钮必须阻止拖拽冒泡。
- Trash 不回到一级并列入口。

### ModeBar

职责：

- 普通模式：展示轻量过滤/结果数量/当前视图提示，可为空。
- 搜索模式：展示搜索命中信息和清除入口。
- 多选模式：展示选择数量、批量复制、批量删除、取消。
- 删除/回收站模式：展示恢复/永久删除的危险态动作。

约束：

- 只在有状态需要表达时出现；默认不占据主视觉。
- 高度稳定，不能因文案变化推挤列表。
- 危险动作必须有确认态或二次点击态。

### ClipboardList

职责：

- 承载 History / Favorites / Trash / Search results。
- 支持键盘上下移动、鼠标 hover、行内动作。
- 支持 text/html/rtf/image/file 等多格式预览。

行结构：

```text
ClipboardRow
  SelectionIndex / TypeIcon
  ContentPreview
    PrimaryLine
    SecondaryLine / Metadata
  InlineActions
    Copy
    Favorite
    Delete / Restore
    Detail
```

约束：

- 普通文本行保持紧凑；图片/文件只做小预览，不撑成卡片。
- 选中态不能使用粗虚线框；使用低噪声背景、左侧 accent 或轻边框。
- 行内动作只有 hover、focus 或多选时显性；收藏状态可常驻小图标。
- 文件缺失、敏感内容、采集禁用等异常状态在行内局部表达，不遮挡全列表。

### StatusFeedback

职责：

- 复制成功、删除成功、恢复成功、保存失败等短反馈。
- 支持撤销删除。
- 表达文件缺失、权限缺失等可恢复问题。

约束：

- 反馈不改变列表滚动位置。
- 不使用大面积 toast 覆盖行内容。
- 长文案必须截断或进入 tooltip。

### OverlayLayer

职责：

- DetailPanel：富文本详情、文件详情、来源信息、编辑/复制扩展。
- AgentPanel：只作为辅助操作层，读取当前 clip 或选中上下文。
- ConfirmDialog：危险动作确认。

约束：

- Overlay 不得阻塞主列表滚动和选中状态恢复。
- Agent 打开失败或 provider 不可用时只显示可恢复状态，不阻塞剪贴板复制。
- DetailPanel 关闭后焦点回到原行。

## 3. 状态模型

主面板布局至少要覆盖以下状态组合：

| 状态 | 布局要求 |
| --- | --- |
| 普通历史 | TopCommandBar + ClipboardList，ModeBar 可隐藏 |
| 收藏 | ViewSwitch 当前态明确，列表只显示收藏 |
| 回收站 | MoreMenu Trash 当前态，ModeBar 提供恢复/永久删除语义 |
| 搜索中 | 搜索框保留焦点，列表直接显示命中项 |
| 无结果 | 列表区域显示紧凑空态，不出现大营销插画 |
| 多选 | ModeBar 显示选择数量和批量动作，行高不跳变 |
| 复制成功 | 行内或底部轻反馈，不打断键盘操作 |
| 文件缺失 | 行内 warning，不阻止其它条目使用 |
| Agent 打开 | OverlayLayer 出现，列表保留上下文 |
| 详情打开 | DetailPanel 覆层，关闭后回到原行 |

## 4. 响应式规则

- 宽度 < 420px：History/Favorites 文案可隐藏为 icon-only，搜索框保留最小宽度 96px。
- 高度 < 360px：ModeBar 默认折叠为单行，OverlayLayer 只使用当前可见高度内部滚动。
- 英文长文案：按钮使用 aria-label + tooltip，视觉文本可截断。
- 图片/文件行：预览缩略图固定尺寸，不改变整列宽度。
- 多选状态：批量动作可收进 More menu，但选择数量必须可见。

## 5. 组件拆分规划

第一阶段允许在 `src/App.tsx` 内继续承载已有状态，但新增/重构时按以下边界迁移：

```text
src/clipboard/
  components/
    TopCommandBar.tsx
    ModeBar.tsx
    ClipboardList.tsx
    ClipboardRow.tsx
    RowActions.tsx
    PanelStatusFeedback.tsx
    PanelMoreMenu.tsx
  hooks/
    usePanelKeyboard.ts
    usePanelSearch.ts
    usePanelSelection.ts
  clipboard.css
```

迁移顺序：

1. 先抽纯展示组件：`ClipboardRow`、`RowActions`、`PanelStatusFeedback`。
2. 再抽交互组件：`ModeBar`、`TopCommandBar`。
3. 最后抽 hooks；热路径逻辑每一步都要复跑选中、滚动、复制验证。

## 6. 性能与验证

- 主面板打开、选中、滚动、复制、粘贴反馈 P95 目标 <= 300ms。
- TopCommandBar、ModeBar、RowActions 不得引入 provider/model/settings 同步检查。
- 搜索过滤优先使用已有本地数据；远程/AI 能力只能后置。
- 每个阶段至少跑 `pnpm exec tsc --noEmit`、相关 verifier、`pnpm openspec validate main-panel-functional-layout-plan --strict`。
- 真实 Tauri dev 验证由人工或 debug probe 记录：主面板可见、搜索可输入、行可复制、多选可取消、详情/Agent 可关闭。
