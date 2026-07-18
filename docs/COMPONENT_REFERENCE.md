# ClipForge 组件参考知识库

更新时间：2026-07-16

本文件是 ClipForge 默认的项目组件参考文档。后续前端页面、组件拆分、样式重整和功能区设计，优先查本文件，再查具体组件官方文档。

来源：

- shadcn/ui LLM 索引：[https://ui.shadcn.com/llms.txt](https://ui.shadcn.com/llms.txt)
- shadcn CLI 文档：[https://ui.shadcn.com/docs/cli](https://ui.shadcn.com/docs/cli)
- 本项目 `components.json`
- `pnpm dlx shadcn@latest info --json`

> 说明：`ctx7` 当前返回 monthly quota exceeded，不能作为本轮 shadcn 文档来源。本文件先使用用户提供的官方 shadcn URL、shadcn CLI 输出和本项目现状固化。

## 当前项目配置

```text
framework: Vite
typescript: true
rsc: false
tailwindVersion: v4
style: new-york
base: radix
iconLibrary: lucide
importAlias: @
ui alias: @/components/ui
components path: src/components
ui path: src/components/ui
global css: src/App.css
registries:
  @shadcn: https://ui.shadcn.com/r/styles/{style}/{name}.json
  @animate-ui: https://animate-ui.com/r/{name}.json
```

当前已安装 shadcn/ui 组件：

```text
attachment
avatar
bubble
button
dropdown-menu
hover-card
input
kbd
message-scroller
message
separator
skeleton
```

当前已安装 Animate UI / Radix 组件：

```text
animate/avatar-group
animate/code-tabs
animate/tabs
animate/toggle-group
animate/tooltip
radix/sheet
radix/sidebar
radix/checkbox primitive
```

## 布局草稿组件映射：快速复用主面板

本节对应 2026-07-16 的主面板布局草稿。该草稿确认主面板是“悬浮、快速复用、轻信息密度”的剪贴板面板，不是设置页、Agent 工作台或营销首页。

草稿结构：

```text
QuickReusePanel
  PanelFrame
    PanelHeader
      SearchBox
      AccountMenuTrigger / LogoButton
    ViewTabs
    RetentionHint
    ClipboardBoard
      PinnedSection
        ClipboardRow + PinToggle
      AllItemsSection
        ClipboardRow + PinToggle
    CornerPinIndicator
```

组件映射：

| 草稿区域 | 目标业务组件 | 首选基础组件 | 说明 |
| --- | --- | --- | --- |
| 悬浮外框 | `QuickPanelFrame` | 自定义 layout + token | 固定宽度、轻阴影、圆角；不使用 `Card`，避免主面板卡片化。 |
| 顶部搜索 | `SearchBox` | `Input Group`, `Input`, `Button`, `Kbd` | 搜索是 P0 热路径；输入框固定高度，不因结果变化抖动。 |
| 右上 Logo/Menu | `PanelMoreMenu` | `Dropdown Menu`, `Avatar`/`Button`, `Kbd` | Logo 作为菜单触发器；菜单承载设置、回收站、快捷键、退出等低频动作。 |
| 视图 tab | `ClipboardViewTabs` | Animate UI `Tabs` | 只保留 2-3 个顶层 tab，如历史、收藏、回收站；不做多层横向滚动 tab。 |
| 留存提示 | `RetentionHint` | `Badge`, `Tooltip` | 显示“面板留白明确触发退场提示”这类轻提示；不阻塞列表。 |
| 置顶列表 | `PinnedClipboardSection` | 自定义 `VirtualClipboardList` + 可选 Animate UI `Pin List` 思路 | 置顶区最多展示少量固定项；可借鉴 `Pin List` 的 pinned/unpinned 分组，但不能牺牲虚拟滚动和固定行高。 |
| 全部列表 | `AllClipboardSection` | 自定义 `VirtualClipboardList` + `ClipboardRow` | 所有历史仍以性能优先，不直接整表替换为社区 `PinList`。 |
| 置顶按钮 | `PinToggleButton` | `Button`, `Tooltip`, lucide `Pin` | 图标按钮固定尺寸；hover/focus 时可显性，已置顶时常驻。 |
| 行内容 | `ClipboardRow` | 自定义业务组件 + `Badge`/`Tooltip` | 行高稳定；左侧类型图标、标题、摘要、时间/状态分层。 |

Animate UI 官方参考：

- `Tabs` 用于分层内容切换，核心结构是 `Tabs` / `TabsList` / `TabsTrigger` / `TabsContents` / `TabsContent`。
- `Dropdown Menu` 用于按钮触发的一组动作，菜单项应按 `Label`、`Group`、`Separator`、`Shortcut` 分组。
- `Pin List` 提供 pinned/unpinned 分组和置顶动效思路，但在 ClipForge 主列表中只能作为交互参考；热路径列表仍由 `VirtualClipboardList` 和固定高度 `ClipboardRow` 控制。

布局约束：

- 面板宽度、搜索框高度、tab 高度、行高、pin 按钮尺寸必须稳定，hover 和置顶状态不能改变布局尺寸。
- `PinnedSection` 只展示当前固定区，数量过多时折叠或进入过滤视图，不挤压搜索和 tab。
- `AllItemsSection` 是主滚动区；搜索时直接替换这里的内容，不切 route。
- 菜单、tooltip、popover 必须挂在 overlay 层，不能被面板滚动容器裁切。
- 不使用夸张动效；pin/unpin 动效短、可关闭，并尊重 reduced motion。

## CLI 使用规则

项目包管理器是 `pnpm`，所有 shadcn CLI 命令默认使用：

```bash
pnpm dlx shadcn@latest <command>
```

常用命令：

```bash
# 查看项目配置和已安装组件
pnpm dlx shadcn@latest info --json

# 查官方组件文档
pnpm dlx shadcn@latest docs button dialog select

# 搜索 registry
pnpm dlx shadcn@latest search @shadcn -q "sidebar"

# 安装组件
pnpm dlx shadcn@latest add button card dialog

# 预览安装改动，不写文件
pnpm dlx shadcn@latest add dialog --dry-run

# 查看 registry item 源码
pnpm dlx shadcn@latest view button card dialog

# 查看本地文件与 registry 的差异
pnpm dlx shadcn@latest add button --diff button.tsx
```

禁止事项：

- 不手动从 GitHub 拉 raw 组件文件替代 CLI。
- 不在未看 `info --json` 的情况下猜 alias、base、icon library 或 CSS 文件。
- 不用 `--overwrite` 覆盖已有组件，除非用户明确要求。
- 不为单个业务组件新造 Button、Input、Dropdown、Tabs、Tooltip、Sidebar 等基础控件。
- 不在业务组件中硬编码 raw color；优先使用语义 token 和组件变体。

## shadcn 组件分类

### Form & Input

用于配置表单、搜索输入、字段编辑：

- `Field`
- `Button`
- `Button Group`
- `Input`
- `Input Group`
- `Textarea`
- `Checkbox`
- `Radio Group`
- `Select`
- `Native Select`
- `Switch`
- `Slider`
- `Combobox`
- `Label`

ClipForge 映射：

- 搜索框：`Input Group` + `Input` + icon/button addon；当前未安装时先用现有 `Input`，迁移阶段补 `input-group`。
- 设置字段：`Field` / `FieldGroup` 作为目标结构；当前 `setting-row` 必须逐步迁移。
- enum 短选项：`Toggle Group`，当前已有 Animate UI ToggleGroup。
- boolean：`Switch`，当前未安装时不得用普通按钮伪装长期方案。
- 数值：`Input` + bounds hint；比例/范围用 `Slider`。
- 搜索建议或 provider 选择：`Combobox` 或 `Select`，不得手写复杂下拉。

### Layout & Navigation

用于应用结构、页面导航和内容分区：

- `Accordion`
- `Breadcrumb`
- `Navigation Menu`
- `Sidebar`
- `Tabs`
- `Separator`
- `Scroll Area`
- `Resizable`

ClipForge 映射：

- 设置页一级导航：`Sidebar`，当前已用 Animate UI Sidebar。
- 设置页二级导航：`Tabs`，当前已用 Animate UI Tabs。
- 详情页路径和返回：`Breadcrumb` 或等价 WorkspaceCrumb。
- 设置页 / Agent / Detail 内部长内容滚动：`Scroll Area` 是目标组件，当前局部自写滚动应逐步收敛。
- 可调整详情/Agent 宽度时再考虑 `Resizable`，不要先做复杂分栏。
- 分区线：`Separator`，不要用手写 `border-t` 当通用组件。

### Overlays & Dialogs

用于浮层、菜单、确认、辅助信息：

- `Dialog`
- `Alert Dialog`
- `Sheet`
- `Drawer`
- `Popover`
- `Tooltip`
- `Hover Card`
- `Context Menu`
- `Dropdown Menu`
- `Menubar`
- `Command`

ClipForge 映射：

- 顶部 More 菜单：`Dropdown Menu`。
- 右键行菜单：目标使用 `Context Menu`，迁移前可保留现有定位逻辑但不得继续扩大自写菜单体系。
- 删除/清空回收站：`Alert Dialog`。
- Agent overlay：桌面优先 `Sheet` 或专用 `OverlayLayer` 组合，不把 Agent 做成主页面卡片。
- 搜索建议：`Popover` / `Command` 视交互复杂度选择；热路径性能优先。
- 图标解释：`Tooltip`，当前设置页已用 Animate UI Tooltip。
- 详情 hover 预览：`Hover Card`。

### Feedback & Status

用于状态、加载和空态：

- `Alert`
- `Toast` / `Sonner`
- `Progress`
- `Spinner`
- `Skeleton`
- `Badge`
- `Empty`

ClipForge 映射：

- 错误和权限缺失：`Alert`。
- 复制/保存短反馈：优先统一 `StatusFeedbackShell`；若引入 toast，使用 `Sonner`，不手写多套 toast。
- 加载 provider / update / diagnostics：`Spinner` 或 `Progress`。
- 设置页或 Agent 首屏加载：`Skeleton`。
- AI 状态、文件缺失、provider 状态：`Badge`。
- 无历史、无搜索结果、空回收站：`Empty`，不要做营销插画空态。

### Display & Media

用于内容承载和信息展示：

- `Avatar`
- `Card`
- `Table`
- `Data Table`
- `Chart`
- `Carousel`
- `Aspect Ratio`
- `Typography`
- `Item`
- `Kbd`

ClipForge 映射：

- 用户/Agent 标识：`Avatar`，必须有 fallback。
- 设置页复杂 panel：可用完整 `Card` composition，但不要卡片套卡片。
- 日志、诊断表、provider 列表：`Table`；高级排序过滤才用 `Data Table`。
- 快捷键提示：`Kbd`，当前已安装。
- 剪贴板行：优先自定义 `ClipboardRow`，可参考 `Item` 语义，但必须保留固定行高和虚拟滚动性能。
- 图片预览：`Aspect Ratio` 可用于详情页，不用于主列表撑大行高。
- 文本/Markdown 预览：优先使用主题化 `Typography` / Typeset 思路，不在主列表里展示长排版。

### Misc

- `Collapsible`
- `Toggle`
- `Toggle Group`
- `Pagination`
- `Direction`

ClipForge 映射：

- 设置页高级项折叠：`Collapsible` 或 `Accordion`。
- icon-only 状态按钮：`Toggle`。
- 视图切换/密度/语言：`Toggle Group`。
- 历史列表不使用分页，继续虚拟滚动；设置/诊断长列表才考虑 `Pagination`。
- RTL 暂非当前目标，未来国际化扩展再评估 `Direction`。

## ClipForge Surface 到组件映射

| Surface | 区域 | 首选组件 |
| --- | --- | --- |
| 快速剪贴板区 | TopCommandBar | `Button`, `Toggle Group`/`Tabs`, `Dropdown Menu`, `Tooltip`, `Kbd` |
| 快速剪贴板区 | SearchBox | `Input Group`, `Input`, `Popover`/`Command`, `Button` |
| 快速剪贴板区 | ModeBar | `Badge`, `Button Group`, `Separator`, `Tooltip` |
| 快速剪贴板区 | ClipboardList | 自定义 `VirtualClipboardList` + `ClipboardRow`; 状态用 `Badge`/`Tooltip` |
| 快速剪贴板区 | Empty/Status | `Empty`, `Alert`, `Skeleton`, `Spinner` |
| 内容详情区 | Header/Crumb | `Breadcrumb`, `Button`, `Dropdown Menu` |
| 内容详情区 | Preview | `Tabs`, `Scroll Area`, `Typography`, `Aspect Ratio`, `Badge` |
| 内容详情区 | Edit | `Field`, `Textarea`, `Input`, `Button`, `Alert Dialog` |
| 设置管理区 | Shell | `Sidebar`, `Tabs`, `Scroll Area`, `Separator` |
| 设置管理区 | Fields | `Field`, `Input`, `Switch`, `Slider`, `Select`, `Toggle Group`, `Code Tabs` |
| 设置管理区 | Diagnostics | `Card`, `Alert`, `Progress`, `Table`, `Button` |
| Agent 辅助区 | Chat | 当前 `message`, `bubble`, `message-scroller`, `attachment`; 后续补 `Scroll Area`, `Badge`, `Tooltip` |
| Agent 辅助区 | Composer | `Textarea`, `Button`, `Attachment`, `Popover`, `Command` |
| Agent 辅助区 | ToolPreview | `Collapsible`, `Badge`, `Alert`, `Skeleton` |
| 系统状态区 | Feedback | `Alert`, `Badge`, `Sonner` 或统一 `StatusFeedbackShell` |

## 新增组件前检查清单

1. 先运行 `pnpm dlx shadcn@latest info --json`，确认 base、aliases、已安装组件。
2. 若是 shadcn 官方组件，运行 `pnpm dlx shadcn@latest docs <component>`。
3. 若组件未安装，先运行 `pnpm dlx shadcn@latest add <component> --dry-run`。
4. 若本地已有同名组件，使用 `--diff` 检查，不直接覆盖。
5. 安装后阅读新增文件，确认 imports、alias、icons、composition 没有偏离项目配置。
6. 业务组件只组合这些基础件，不复制基础件实现。
7. 更新本文件的“当前已安装组件”和对应 OpenSpec tasks。

## 与前端架构提案的关系

本文件是 [`frontend-surface-architecture-refactor`](../openspec/changes/frontend-surface-architecture-refactor/proposal.md) 的组件知识库附件。该提案定义业务 surface 和拆分顺序，本文件定义每个 surface 优先使用哪些成熟组件。

后续如果更新 shadcn 组件库、安装新的 registry 组件或改变 `components.json`，必须同步更新本文件。
