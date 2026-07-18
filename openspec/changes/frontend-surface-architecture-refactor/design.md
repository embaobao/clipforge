# 设计：前端 Surface 架构、路由拆分与样式系统重整

## 1. 总体架构原则

ClipForge 前端按 surface 组织，而不是按“当前谁先写在 App.tsx 里”组织。

```text
src/
  app/                 # 应用启动、route tree、全局 provider、错误边界
  components/
    ui/                # shadcn/Radix 基础组件，只做通用 primitive
    animate-ui/        # registry 组件，不改造成业务组件
    layout/            # AppShell、SurfaceFrame、PanelOverlay 等跨 surface 布局组件
  theme/               # tokens.css、tailwind.css、semantic.css
  clipboard/           # 主面板：历史、收藏、搜索、回收站、列表热路径
  workspace/           # 详情页、聚合页、预览/编辑/AI 摘要辅助层
  settings/            # 设置窗口：信息架构、字段渲染、复杂设置面板
  agent/               # Agent overlay / chat / references / tool preview
  services/            # Tauri command 适配、数据 contract、纯业务服务
  stores/              # 仅跨组件 UI 状态；业务数据不塞全局 store
  routes/              # TanStack Router route 定义和导航 helper
```

### 分层定义

| 层级 | 职责 | 禁止事项 |
| --- | --- | --- |
| 基础组件 | Button/Input/Dropdown/Tabs/Tooltip/Sidebar 等组件库包装 | 不包含 ClipItem、settings、agent provider 等业务类型 |
| 组合组件 | Toolbar、FieldRow、StatusPanel、OverlayShell、VirtualListFrame | 不直接调用 Tauri command |
| 业务组件 | ClipboardRow、SettingsField、AgentMessageRow、DetailPreview | 不拥有跨页面全局状态 |
| Surface 页面 | QuickPanelPage、SettingsPage、WorkspaceDetailPage、AgentPanelPage | 不实现基础控件细节 |
| hooks/state | useClipboardSearch、usePanelSelection、useSettingsDraft | 不渲染 UI，不操作 CSS class |
| services | clipboardService、settingsService、aiSummaryService | 不依赖 React，不读 DOM |

## 2. 业务功能区与页面体验

### 总览

ClipForge 的前端体验分为五个业务功能区。所有页面、组件和样式迁移都围绕这些功能区组织，避免“看到哪里缺就往 `App.tsx` 里补”的反复。

```text
AppShell
  QuickClipboardSurface        # 默认主体验，复制/搜索/选择/删除
    DetailSurface              # 当前 clip 的二级详情
    AgentSurface               # 当前上下文的辅助处理
  SettingsSurface              # 独立配置和诊断
  SystemFeedbackSurface        # 跨 surface 的短反馈契约
```

### 快速剪贴板区

定位：ClipForge 第一主体验，必须等价或优于 Clipy 的快速唤起、选择、搜索、复制和删除。

```text
QuickClipboardSurface
  TopCommandBar
    History/Favorites
    Search
    Agent
    More: Trash/Settings
  ModeBar
    search summary / selected count / trash actions
  ClipboardList
    fixed-height rows
    inline actions
  StatusFeedback
  OverlayLayer
```

### 快速复用主面板草稿落地

2026-07-16 的布局草稿进一步收紧主面板形态：它是一个悬浮 quick reuse panel，顶部固定搜索和菜单入口，中部用少量 tab 切换视图，主体分为置顶区和全部条目区。

```text
QuickReusePanel
  QuickPanelFrame
    PanelHeader
      SearchBox
      PanelMoreMenuTrigger
    ClipboardViewTabs
    RetentionHint
    ClipboardBoard
      PinnedClipboardSection
        ClipboardRow
        PinToggleButton
      AllClipboardSection
        VirtualClipboardList
          ClipboardRow
          ClipboardRowActions
    OverlayLayer
      PanelMoreMenu
      Tooltip
      SearchPopover
      ContextMenu
```

关键布局定义：

- `QuickPanelFrame` 是主面板外框，不使用营销式 hero 或多层卡片；默认固定宽度和最大高度，内部只有一个主滚动区。
- `PanelHeader` 固定在顶部，搜索输入是主焦点；右上角 Logo/Menu 触发器只承载低频动作。
- `ClipboardViewTabs` 只保留 2-3 个一级视图，例如历史、收藏、回收站；不得把设置、Agent、详情等二级 surface 塞进 tab。
- `RetentionHint` 是轻提示区域，用于解释面板留白、自动退出、短状态等，不阻塞列表，不改变 row 布局。
- `PinnedClipboardSection` 是固定项摘要区，数量必须受控；超过阈值后折叠或进入收藏/置顶视图。
- `AllClipboardSection` 是主列表滚动区；搜索结果、历史和回收站仍直接替换这里的列表内容。
- `PinToggleButton` 固定在行右侧，hover/focus 时显示，已置顶状态可常驻；按钮出现不能改变行宽、行高或文本换行。

组件映射：

| 草稿元素 | 业务组件 | 成熟组件 / primitive | 约束 |
| --- | --- | --- | --- |
| 顶部搜索 | `SearchBox` | shadcn `Input`，目标迁移 `Input Group`，`Kbd` | P0 热路径；固定高度；输入不触发 route 切换 |
| Logo/Menu | `PanelMoreMenu` | Animate UI / Radix `Dropdown Menu`，`Button`/`Avatar` | 承载设置、回收站、快捷键、退出；菜单项分组，不写自定义菜单基础件 |
| 横向 tab | `ClipboardViewTabs` | Animate UI `Tabs` | 只做主列表视图切换，最多少量 tab；不做多行滚动 tab |
| 置顶分组 | `PinnedClipboardSection` | 参考 Animate UI community `Pin List` | 只借鉴 pinned/unpinned 分组和置顶动效；不替换虚拟列表核心 |
| 全部列表 | `VirtualClipboardList` | 自定义领域性能组件 | 保留固定行高、虚拟滚动、键盘选中和复制热路径 |
| 行内容 | `ClipboardRow` | 自定义业务组件 + `Badge`/`Tooltip`/lucide icon | 标题、摘要、类型、状态清晰分层；异常状态局部呈现 |
| 置顶动作 | `PinToggleButton` | `Button` + lucide `Pin` + `Tooltip` | icon-only，稳定尺寸，可键盘访问 |

不采用草稿中的做法：

- 不把 `Pin List` 社区组件作为整个剪贴板列表实现，因为主列表需要虚拟滚动、固定行高、键盘选择和复制热路径。
- 不把 Logo 菜单做成账户体系；ClipForge 当前菜单语义是应用动作菜单，不是 SaaS account menu。
- 不做超过 3 个以上横向 tab 的滚动 tab；复杂分类进入筛选、搜索或设置页。

交互定义：

- 默认首屏是列表，不展示欢迎页、营销页或大卡片首页。
- 历史、收藏、回收站和搜索结果共用同一个列表区域。
- 搜索输入保持焦点稳定，结果直接刷新列表。
- 行选中使用低噪声背景、左侧 accent 或轻边框，不再使用粗虚线框。
- 行内动作只在 hover、focus、多选或状态需要时显性；收藏状态可常驻。
- 多选动作进入 ModeBar 或底部轻量动作区，不能改变行高。
- 文件缺失、权限缺失、敏感内容等异常只在行内局部表达，不阻塞其它条目。

### 内容详情区

定位：单条 clip 的二级处理，不是主入口。

```text
DetailSurface
  DetailHeader / WorkspaceCrumb
  PreviewArea
    text / markdown / html / json / link / image / file
  EditArea
    quick editor / tag editor
  AuxiliaryPanels
    AI summary / recommendations / metadata
```

交互定义：

- 从列表进入详情后保留当前 clip 上下文；返回后焦点回到原行。
- 详情页允许内部滚动，不能让内容卡片或底部操作遮挡正文。
- 编辑动作必须有保存、取消和失败反馈；取消不丢预览。
- “打开来源”只由明确按钮或 `Ctrl/Cmd+J` 触发。
- AI 摘要是辅助 panel，不改变详情正文主结构。

### 设置管理区

定位：配置、权限和诊断集中区，独立于快速剪贴板面板。

```text
SettingsSurface
  SettingsSidebar
    Shortcut & Language
    Display & Panel
    Capture & Content
    Storage & Logs
    MCP & Agent
    Updates
    Tags
  SettingsTabs
  SettingsFieldArea
  SettingsStickyStatusBar
```

交互定义：

- Sidebar 管一级分类，Tabs 管二级内容；二者状态互不重置。
- 普通字段由 catalog 驱动；复杂行为使用专用 panel。
- 保存反馈集中在 sticky status bar 和 section chip，避免每个字段散落 toast。
- 诊断、更新、权限和危险操作必须与普通配置视觉分区。
- 设置页可以显示更多信息密度，但不能采用营销页布局。

### Agent 辅助区

定位：剪贴板上下文的辅助处理层，不是 ClipForge 的默认中心。

```text
AgentSurface
  AgentHeader
  ContextReferenceBar
  MessageList
  ToolPreview
  Composer
  ResultActions
```

交互定义：

- 从主面板以 overlay 打开，关闭后焦点回主列表。
- 可以读取当前 clip、多选上下文和 filtered clips，但不能在主面板首屏同步检查 provider。
- provider 缺失、SDK 未启用或工具不可用时显示可恢复状态，不阻塞复制热路径。
- Agent 输出写回必须由明确按钮触发：复制、保存为 clip、粘贴；不能静默改用户内容。

### 系统状态区

定位：跨 surface 的统一反馈契约。

```text
SystemFeedback
  CopySaved
  DeleteUndo
  RestoreSaved
  SaveFailed
  FileMissing
  PermissionMissing
  ProviderDisabled
```

交互定义：

- 反馈不改变列表滚动位置。
- 成功反馈短；失败反馈说明可执行下一步。
- 删除类反馈必须支持撤销或二次确认。
- 长文案截断并进入 tooltip / detail，不遮挡主列表。

### 交互优先级

| 优先级 | 范围 | 约束 |
| --- | --- | --- |
| P0 | 面板打开、搜索、列表选中、复制/粘贴、滚动 | 任何拆分不得阻塞或延迟这些路径 |
| P1 | 收藏、删除、回收站、详情、设置入口、多选 | 必须稳定可达，但不能挤压 P0 |
| P2 | Agent、AI 摘要、推荐、MCP 工具提示 | 懒加载/overlay，不进入首屏热路径 |
| P3 | 诊断、更新、provider 模板、日志导出 | 设置页内完成，不进入主面板 |

## 3. 路由拆分方案

当前仓库已有 `@tanstack/react-router`，并已在 workspace 内存路由中使用。后续不引入 React Router 或其它路由体系，统一扩展现有 TanStack Router 模式。

### 路由边界

```text
RootRoute
  /quick
    /                # History / Favorites / Search / Trash 仍可由 query/state 表达
    /clip/$clipId    # detail route，保留当前 workspace 语义
    /aggregate       # multi-select aggregate
  /settings
    /$section
    /$section/$tab
  /agent
    /                # panel overlay / standalone window 共用 AgentPage
```

### Tauri 窗口适配

- 主快速面板继续使用内存路由，不依赖浏览器 URL。
- 设置窗口可以使用同一 route tree 的 `/settings/...` 分支，入口由 `?window=settings` 迁移到明确 route 初始化。
- Agent overlay 与未来独立 Agent 窗口共用 `agent` route 组件，但 overlay 壳由主面板控制。
- 路由只表达页面/surface 状态，不接管剪贴板热路径选择状态；`selectedId`、滚动、multi-select 等仍由主面板 hooks 管理。

### 懒加载策略

```text
立即加载：
  app shell
  clipboard quick panel
  clipboard search/list/row 基础能力

懒加载：
  settings surface
  agent chat surface
  workspace rich previews
  AI summary / recommendation panel
  diagnostics and code examples
```

设置页、Agent、详情复杂预览都不应进入主面板首屏 bundle 热路径。

## 4. 主面板功能布局

主面板继续遵守剪贴板工具优先级：

```text
QuickPanelPage
  TopCommandBar
    ViewSwitch: History / Favorites
    SearchBox
    AgentShortcut
    MoreMenu: Trash / Settings
  ModeBar
    SearchSummary | MultiSelectActions | TrashActions | Empty
  ClipboardList
    VirtualClipboardList
      ClipboardRow
        SelectionIndex
        ContentPreview
        RowActions
  StatusFeedback
    CopyToast | DeleteUndo | FileMissing | ProviderDisabled
  OverlayLayer
    WorkspaceDetailOverlay
    AgentOverlay
    ConfirmDialog
```

### 组件目录

```text
src/clipboard/
  components/
    TopCommandBar.tsx
    PanelMoreMenu.tsx
    SearchBox.tsx
    SearchAutocomplete.tsx
    ModeBar.tsx
    MultiSelectActions.tsx
    ClipboardList.tsx
    VirtualClipboardList.tsx
    ClipboardRow.tsx
    ClipboardRowActions.tsx
    ClipboardContentPreview.tsx
    ClipboardEmptyState.tsx
    PanelStatusFeedback.tsx
  hooks/
    useClipboardQuery.ts
    useClipboardSelection.ts
    useClipboardKeyboard.ts
    useClipboardContextMenu.ts
    useClipboardPersistence.ts
  styles/
    clipboard.css
    clipboard-row.css
```

### 热路径保护

- `ClipboardRow` 行高固定，默认 36px；图片/文件只允许固定缩略信息，不把行撑成卡片。
- `VirtualClipboardList` 只负责虚拟滚动和 active item frame，不包含业务菜单。
- `TopCommandBar` 不调用 settings/provider/AI 检查。
- Agent、详情、AI 摘要通过 overlay/lazy route 进入，不阻塞搜索和复制。
- `Ctrl/Cmd+J` 才打开目标 URL/path；`ArrowRight` 和“进入详情”只进入详情。

## 5. Workspace / Detail 分层

```text
src/workspace/
  routes/
    WorkspaceRoutes.tsx
  components/
    WorkspaceCrumb.tsx
    WorkspaceActionStrip.tsx
    DetailPage.tsx
    AggregatePage.tsx
    PreviewTabs.tsx
  previews/
    MarkdownPreview.tsx
    HtmlPreview.tsx
    JsonPreview.tsx
    LinkPreview.tsx
    ImageFilePreview.tsx
    FileListPreview.tsx
  editor/
    DetailQuickEditor.tsx
    TagEditor.tsx
  ai/
    DetailAiSummaryPanel.tsx
  styles/
    workspace.css
    previews.css
```

现有 `workspace-panels.tsx` 的职责应按“导航壳 / 预览 / 编辑 / AI 辅助”拆开。详情页可以更丰富，但它仍是辅助 surface，不改变主面板列表布局。

## 6. 设置页分层

设置页采用“字段目录驱动 + 复杂面板插槽”的混合模式。

```text
src/settings/
  routes/
    SettingsRoutes.tsx
  schema/
    settings-field-catalog.ts
    settings-section-model.ts
  components/
    SettingsShell.tsx
    SettingsSidebar.tsx
    SettingsSectionHeader.tsx
    SettingsTabs.tsx
    SettingsStatusBar.tsx
    SettingsField.tsx
    SettingsFieldRow.tsx
    SettingsActionGroup.tsx
  fields/
    ToggleField.tsx
    SegmentField.tsx
    NumberField.tsx
    SliderField.tsx
    ReadonlyField.tsx
    CodeTabsField.tsx
  panels/
    OnboardingPanel.tsx
    AccessibilityPanel.tsx
    FloatingPanelDiagnostics.tsx
    McpStatusPanel.tsx
    AgentProviderPanel.tsx
    UpdatePanel.tsx
    LogDiagnosticsPanel.tsx
    TagRulesPanel.tsx
  hooks/
    useSettingsState.ts
    useSettingsNavigation.ts
    useSettingsActions.ts
  styles/
    settings.css
```

### 字段渲染规则

- `SETTINGS_FIELD_CATALOG` 是普通字段的单一入口。
- enum -> Animate UI ToggleGroup / Tabs-like segmented control。
- boolean -> Switch 或 Toggle，不能用普通按钮伪装。
- bounded number -> Number input + bounds hint，必要时用 Slider。
- readonly/path -> code-like readonly field + copy action。
- code/example -> Code Tabs。
- permission、diagnostics、update、tag rules 等复杂行为保留 panel 组件。

`settings.tsx` 最终只保留 route shell/provider 级逻辑，不再直接写每个 setting row。

## 7. Agent 分层

```text
src/agent/
  routes/
    AgentRoutes.tsx
  components/
    AgentPanelShell.tsx
    AgentHeader.tsx
    AgentMessageList.tsx
    AgentMessageRow.tsx
    AgentComposer.tsx
    AgentReferencePicker.tsx
    AgentToolPreview.tsx
    AgentAttachmentChip.tsx
  hooks/
    useAgentConversation.ts
    useAgentReferences.ts
    useAgentRunConfirmation.ts
  styles/
    agent.css
    agent-message.css
```

Agent 是辅助层，不是主入口。它可以读当前 clip、多选上下文和 filtered clips，但不得把 provider 检查、模型状态或 tool preview 注入主列表组件。

## 8. 组件库策略

项目默认组件参考知识库为 [`docs/COMPONENT_REFERENCE.md`](../../../docs/COMPONENT_REFERENCE.md)。后续组件选型、安装、更新、业务区映射和 CLI 使用边界，以该文档为默认依据；如果官方 shadcn 文档更新，需要先更新该文档，再改业务实现。

### 保留并优先使用

- `@radix-ui/*` / `radix-ui`：Dropdown、Tooltip、Tabs、Dialog、Switch、Menu 等无障碍原语。
- shadcn 风格 `src/components/ui/*`：Button、Input、Separator、Skeleton、Avatar 等基础件。
- Animate UI registry：Sidebar、Tabs、ToggleGroup、Tooltip、motion-friendly 组件。
- `lucide-react`：所有工具按钮图标优先使用 lucide。
- `@floating-ui/react`：仅用于 autocomplete、context popover 等需要精准定位的浮层。

### 禁止新增并行基础件

- 不再手写新的 Button/Input/Dropdown/Tooltip/Sidebar/Tabs 基础实现。
- 不在业务组件里直接写一套 hover/focus/disabled 视觉规则。
- 不为了单个页面引入新的重型 UI 框架。

### 允许自定义

- `VirtualClipboardList` 这类领域性能组件可自定义，因为组件库不负责剪贴板列表热路径。
- `ClipboardContentPreview`、`DetailPreview` 可按业务格式定制，但只消费主题 token。

### shadcn 映射基线

| ClipForge 需求 | 默认参考组件 |
| --- | --- |
| 表单字段 | `Field`, `Input`, `Switch`, `Slider`, `Select`, `Toggle Group` |
| 主面板工具栏 | `Button`, `Button Group`, `Dropdown Menu`, `Tooltip`, `Kbd` |
| 搜索建议 | `Input Group`, `Popover`, `Command`, `Combobox` |
| 设置页导航 | `Sidebar`, `Tabs`, `Separator`, `Scroll Area` |
| 危险确认 | `Alert Dialog` |
| Overlay / 辅助面板 | `Sheet`, `Dialog`, `Drawer` 按平台和交互选择 |
| 右键菜单 | `Context Menu` |
| 状态反馈 | `Alert`, `Badge`, `Skeleton`, `Spinner`, `Empty`, `Sonner` |
| 详情预览 | `Tabs`, `Scroll Area`, `Typography`, `Aspect Ratio`, `Card` |
| Agent 聊天 | `message`, `bubble`, `message-scroller`, `attachment`, `Badge`, `Tooltip` |

## 9. 样式与主题分层

```text
src/theme/
  tokens.css          # 颜色、半径、阴影、间距、字体、z-index
  semantic.css        # --cf-surface, --cf-row-active, --cf-danger 等语义 token
  tailwind.css        # Tailwind v4 @theme inline 映射

src/clipboard/styles/
  clipboard.css
  clipboard-row.css

src/settings/styles/
  settings.css

src/workspace/styles/
  workspace.css
  previews.css

src/agent/styles/
  agent.css
```

### Token 方向

ClipForge 是轻量剪贴板工具，不采用营销页视觉。视觉策略：

- 主色：中性黑白灰为基础，低饱和功能色只用于状态。
- 行状态：低噪声背景 + 左侧 accent，不用粗虚线框。
- 圆角：工具型控件默认 6-8px，除非组件库 token 明确要求。
- 字体：系统 UI 字体；数字、快捷键、代码使用 monospace。
- 动效：只保留 toolbar/overlay/active row 的短动效；尊重 reduced motion。

### 样式边界规则

- `App.css` 停止新增业务样式，只保留迁移前兼容区，后续逐段删除。
- 新组件样式必须放在对应 surface 下。
- 选择器必须以 surface root 开头：`.clipboard-surface`、`.settings-surface`、`.workspace-surface`、`.agent-surface`。
- 禁止新的全局 `.quick-row` / `.toolbar` / `.dropdown-content` 覆盖。
- `!important` 只允许临时迁移注释块使用，并必须带移除任务。
- 组件库 slot 样式优先通过 className / Tailwind utilities，不写跨 surface 覆盖。

### Surface marker 约定（Phase 1 落地）

每个 surface 的根节点必须携带稳定 marker，作为 verifier 锚点和样式作用域根：

- `data-surface="<domain>"`：surface 身份 marker，domain ∈ `clipboard` / `settings` / `workspace` / `agent`。恒定不变，不随 UI 状态切换（与 `surface-${activeSurface}` 这类行为态 class 区分开）。
- `<domain>-surface` class：surface 样式作用域根，surface 自有 CSS 选择器以此开头。

| surface | 根节点 | marker 落点 |
| --- | --- | --- |
| clipboard | 主面板 `<main>` shell | `src/App.tsx`（`<main data-surface="clipboard">`） |
| settings | 设置窗内容根 `<div>` | `src/settings.tsx`（`<div class="settings-surface" data-surface="settings">`） |
| workspace | 详情/聚合 `<section>` | `src/workspace/workspace-panels.tsx`（`workspace-detail-page` / `workspace-aggregate-page`） |
| agent | Agent 覆层面板 `<div>` | `src/App.tsx`（`agent-overlay-panel`，与现有 `data-agent-overlay-panel` 共存） |

约束：

- marker 是 verifier 的稳定锚点，禁止用 className 派生值替代 `data-surface`。
- 新增 surface 时先在此表登记根节点与落点，再让 `verify-surface-boundaries.mjs` 断言其存在。
- `data-surface` 只表达身份，不承载可见样式；可见样式走 `<domain>-surface` class + 主题 token。

## 10. 状态与服务分层

### 状态

- 主面板本地热路径状态：`useClipboardSelection`、`useClipboardKeyboard`、`useClipboardQuery`。
- 跨组件 UI 状态：保留 Zustand，如 workspace route store、panel closing store。
- 设置页状态：`useSettingsState` 负责加载、patch、save feedback、error。
- Agent 状态：会话、引用、确认动作独立 hook。

### 服务

- `services/clipboard.ts`：clip 查询、复制、删除、收藏、恢复。
- `services/settings.ts`：设置读取和 patch。
- `services/ai-summary.ts`：摘要和推荐。
- `services/contracts.ts`：Tauri command payload contract。

React 组件不直接拼接复杂 command payload；复杂 payload builder 放 service 或 domain helper。

## 11. 迁移阶段

### Phase A：架构护栏

- 新增本提案和 spec。
- 补 `main-panel-functional-layout-plan/tasks.md`，把主面板拆分阶段任务化。
- 标记 `App.css` 的 legacy 区域和禁止新增规则。
- verifier 增加 surface marker 检查：`data-surface="clipboard"` / `settings` / `workspace` / `agent`。

### Phase B：主面板纯展示拆分

- 抽 `ClipboardRow`、`ClipboardContentPreview`、`ClipboardRowActions`。
- 抽 `PanelStatusFeedback`、`ClipboardEmptyState`。
- 样式迁到 `src/clipboard/styles/clipboard-row.css`。
- 不改变选择、复制、搜索、虚拟滚动逻辑。

### Phase C：主面板交互拆分

- 抽 `TopCommandBar`、`PanelMoreMenu`、`SearchBox`、`ModeBar`。
- 抽 `useClipboardSelection`、`useClipboardKeyboard`、`useClipboardContextMenu`。
- 清理对应 `App.css` 覆盖，不再追加新 `P-FINAL`。

### Phase D：路由与懒加载

- 把当前 `WorkspaceRouterProvider` 扩展为 app route tree 的一个分支。
- Settings 和 Agent 建立 route module，并使用 lazy import。
- 主面板只同步 route intent，不直接渲染所有 surface 代码。

### Phase E：设置页字段渲染

- 抽 `SettingsShell`、`SettingsTabs`、`SettingsField`。
- 普通字段由 `SETTINGS_FIELD_CATALOG` 驱动。
- 复杂 panel 按域拆到 `src/settings/panels/`。
- 设置页样式迁移到 `src/settings/styles/settings.css`。

### Phase F：Workspace / Agent 收敛

- `workspace-panels.tsx` 拆 preview/editor/ai。
- `agent-panel.tsx` 和 `agent-chat-page.tsx` 拆 shell/message/composer/tool preview。
- Agent 样式迁到 `src/agent/styles/`。

### Phase G：清理兼容层

- 删除已迁移的 `App.css` legacy block。
- 从 file-size exemptions 中移除已达标文件。
- verifier 从源码字符串断言迁到 marker/行为级断言。

### Phase H：历史文档与提案收口

- 确认本提案已经吸收主面板布局、设置页组件化、视觉回归、路由拆分和样式分层决策。
- 把被吸收的历史提案在 `docs/PROPOSAL_ROADMAP.md` 标记为 superseded。
- 检查 `rg "<change-name>" openspec docs src scripts`，确认没有 active 引用。
- 对已归档 change 只保留 archive/spec 记录；对未归档但已被本提案替代的历史文档，确认后删除或归档。
- 删除前必须复跑 `pnpm openspec validate --specs --strict`，避免 spec delta 丢失。

## 12. 验证矩阵

每个阶段至少执行：

```bash
pnpm exec tsc --noEmit
node scripts/verify-file-size.mjs
node scripts/verify-hot-path.mjs
node scripts/verify-settings-surface.mjs
pnpm openspec validate frontend-surface-architecture-refactor --strict
```

涉及主面板：

```bash
node scripts/verify-runtime-boundaries.mjs
node scripts/perf-smoke.mjs
```

涉及 Tauri 原生能力或设置保存：

```bash
pnpm build
cd src-tauri && cargo check
```

手动或截图验收：

- 主面板打开后列表首屏可用。
- 搜索框聚焦、输入、清除和建议下拉可用。
- 行 hover/active/selected/copy 状态不重叠。
- 顶部菜单紧凑且不影响其它 dropdown。
- 设置页 Sidebar 折叠和 Tabs 切换正常。
- Agent overlay 关闭后焦点回主面板。
