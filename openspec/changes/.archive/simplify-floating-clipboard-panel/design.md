# 设计：简化高密度悬浮剪贴板面板

## 设计原则

1. 快捷优先：面板打开后第一动作必须是搜索、方向键选择或数字复制，不需要先理解复杂导航。
2. 焦点可信：窗口激活、搜索输入焦点、active item 和复制目标都要有可检测状态，避免“看起来打开但键盘不可用”。
3. 高密度但不拥挤：主列表显示原始内容一行摘要，所有预览、状态和批量动作都进入固定高度区域。
4. 可扩展但不前置：图片、文件、表格/图表、插件动作、Agent/AI 只通过内容模型和动作槽预留，不抢占当前文本复制主路径。
5. token 驱动：颜色、圆角、阴影、玻璃、动效、尺寸和 z-index 必须来自统一 style token，不在组件里写散落 raw value。

## 信息架构

面板分为四个层级：

1. 顶部搜索层：Safari 式液态玻璃地址栏；未激活时为小胶囊或隐藏，激活后横向展开为低高度搜索条。
2. 快速预览层：`Space` 触发单条快速预览，只展示轻量摘要、链接和复制/打开动作。
3. 主列表层：高密度剪贴板内容列表，承担主要空间。
4. 工作台下钻层：`ArrowRight` 进入单条详情或多选聚合详情，列表不再显示。
5. 底部动态层：状态、导航、当前动作、多选聚合操作。

不再保留常驻侧边栏。历史、收藏、垃圾箱、设置是同一悬浮面板内的视图状态，由底部操作栏切换。

## 布局

```text
┌──────────────────────────────┐
│  compact glass island        │
│  expanded search + @ tokens  │
├──────────────────────────────┤
│  quick preview (Space)       │
├──────────────────────────────┤
│  1  copied content ... tail  │
│  2  copied content ... tail  │
│  3  copied content ... tail  │
│  ...                         │
├──────────────────────────────┤
│  status       nav/actions    │
└──────────────────────────────┘

多选底部操作时：
┌──────────────────────────────┐
│ 全选   聚合详情   复制   删除 │
└──────────────────────────────┘

详情下钻时：

```text
┌──────────────────────────────┐
│ glass search                 │
├──────────────────────────────┤
│ 列表 / 内容详情     actions  │
│ Google  模板  解析           │
│ content renderer             │
│ links / plugin output        │
├──────────────────────────────┤
│ status       nav/actions     │
└──────────────────────────────┘
```
```

### 区域尺寸

- 面板主体：优先适配悬浮窗，宽度以 420-560px 为主，避免桌面管理后台化。
- 顶部搜索层：默认不遮挡列表；搜索激活后预留固定低高度，autocomplete 横向滚动但不覆盖主内容。
- 快速预览层：固定高度，内容内部滚动，预览开关不改变列表行高；只由 `Space` 触发。
- 主列表层：独占剩余高度；文本行使用固定高度和中间省略。
- 工作台下钻层：独占列表区域；用于单条详情、多选聚合、后续插件解析和动作台。
- 底部动态层：固定高度；多选时贴底显示透明玻璃操作条，不做漂浮卡片。

## 路由与状态拆分

P1 已引入 TanStack Router 的 code-based memory router，只管理悬浮面板内部工作台层级，不使用浏览器 URL 历史：

- `/`：快速列表，支持搜索、复制、收藏、行内多选和垃圾箱视图。
- `/clip/$clipId`：单条详情工作台，支持内容渲染、链接罗列、复制/打开和插件动作槽。
- `/aggregate`：多选聚合工作台，支持聚合预览、聚合复制、表格导出入口和批量插件动作槽。

Zustand 用于维护工作台路由状态和面板 UI 状态：

- `useWorkspaceStore`：记录当前下钻层级，供快捷键和底部导航统一回退。
- `usePanelUiStore`：维护快速预览、当前预览条目和窗口关闭状态。

路由不负责剪贴板数据读写；采集、复制、删除、恢复仍由主业务层调用 Tauri command，避免快捷复制路径被路由拆分拖慢。

## 框架状态模型

面板状态拆成五类：

- `windowState`：visible、focused、position、lastActiveAt、activationSource。
- `inputState`：query、isSearchFocused、compositionState、lastInputAt。
- `listState`：view、activeItemId、hoverItemId、selectedIds、previewItemId、scrollAnchor。
- `contentState`：items、favorites、trash、contentTypes、detectedLinks、detectedFiles。
- `integrationState`：clipboardWatcher、lastClipboardWrite、pluginActions、agentBridgeStatus。

关键规则：

- 窗口唤起后必须执行焦点确认：面板可见、窗口已激活、搜索输入可输入、active item 已建立。
- 搜索输入处于 IME 组合输入时，快捷键不得抢夺输入；普通数字键始终保留给搜索输入。
- active item 是复制目标、目标光标和详情预览的共同来源。
- 单条快速预览由 `Space` 显式触发；多选模式下 `Space` 切换当前 active item 的选择状态。
- 删除进入垃圾箱，不直接丢失；彻底删除只在垃圾箱内出现。
- 底部固定 dock 只保留导航和设置，不承载删除、复制、预览等上下文动作；上下文动作只在触发相关模式后显示为浮动动态操作栏。

## 关键交互

- 行主体点击：默认复制该条内容。
- 数字块点击：进入多选并切换该条选择；多选中继续点击数字块切换选择。
- 键盘方向键：移动 active item，目标光标随 active item 变化。
- Enter：复制 active item。
- 普通数字键：输入搜索，不直接选择或复制条目。
- `Cmd+1` 到 `Cmd+9`：复制对应可见项；多选模式下切换选择。
- `Space`：单条模式切换快速预览；多选模式切换 active item 选择。
- `ArrowRight`：单条模式下钻到详情工作台；多选模式下钻到聚合工作台。
- 多选底部栏：默认只显示选中数量、全选、聚合详情、复制、删除和关闭；聚合预览在 `/aggregate` 工作台展示。
- 左右方向键：右键进入下一层详情/聚合工作台，左键返回列表；`Esc` 按相同层级逐层返回。
- 垃圾箱：从底部入口进入；垃圾箱内保留恢复/彻底删除能力。

## 悬浮窗与焦点检测

悬浮窗不是普通页面，必须单独设计激活链路：

- 唤起入口：全局快捷键、托盘、快速菜单、应用内入口都归一到 `openPanel(source)`。
- 定位策略：优先使用最近鼠标/光标所在屏幕，其次使用上次面板位置，最后使用主屏幕居中。
- 激活确认：打开后检测窗口 focused 状态；若未聚焦，执行一次原生层 focus/raise。
- 输入确认：搜索 input 获得焦点后记录 `isSearchFocused`；失败时显示底部状态，不弹出干扰式错误。
- 回退策略：焦点失败时仍允许方向键和 `Cmd+数字` 快捷在窗口层生效，确保复制主路径可用。

这些状态需要通过底部状态线给出短文本反馈，例如“监听中 / 搜索已聚焦 / 聚焦恢复中 / 写回保护”。

## 键盘性能路径

键盘路径是主路径，不是辅助功能：

- 普通数字键 1-9：默认作为搜索输入，不触发复制或选择。
- `Cmd+1` 到 `Cmd+9`：复制当前可见项；多选模式下切换选择。
- `ArrowUp/ArrowDown`：只移动 active item，不触发重新布局。
- `Enter`：复制 active item；多选模式下复制聚合结果。
- `Space`：多选模式下切换 active item 选择。
- `Esc`：优先关闭预览/多选，其次清空搜索，最后关闭面板。
- `/` 或直接输入：聚焦搜索；已有焦点时保持输入。
- `@`：触发 token autocomplete，显示预置筛选、内容类型、收藏、文件、链接和 saved search，不再使用常驻 tag 筛选行。

性能约束：

- 快捷键处理避免依赖 React 大范围重渲染；active/hover 状态需要局部更新。
- 搜索输入使用轻量 debounce 或 deferred 过滤；输入回显不能延迟。
- 列表超过 50 条时预留虚拟列表或窗口化能力。
- 动效只使用 transform/opacity，禁止通过 height/top/left 驱动复制目标移动。

## 内容类型扩展

剪贴板条目统一使用内容类型抽象，而不是只面向文本：

```ts
type ClipboardContentKind =
  | "text"
  | "link"
  | "image"
  | "file"
  | "table"
  | "chart"
  | "richText"
  | "unknown";
```

展示规则：

- 文本：主列表显示原始一行内容，中间省略。
- 链接：主列表仍显示文本；详情/预览区单独列出链接，可打开。
- 图片：主列表显示尺寸/来源摘要；预览区显示缩略图，复制仍走原始 clipboard payload。
- 文件：主列表显示文件名和数量；预览区显示路径/类型，可打开所在位置。
- 表格/图表：主列表显示行列/标题摘要；预览区显示紧凑表格或静态缩略图。
- unknown：保留基础复制能力，使用通用摘要和类型标识。

行内操作保持克制：收藏、打开、更多。删除进入更多或多选底部栏，不常驻占用主复制区域。

## 插件与 Agent/AI 扩展

当前主面板不暴露复杂 AI 设置，但从设计阶段保留扩展点：

- 内容解析插件：把剪贴板 payload 解析成 text/link/image/file/table/chart 等摘要。
- 动作插件：对选中内容提供打开、转换、发送到工具、复制为指定格式等动作。
- Agent Bridge：以稳定工具接口读取当前选中项、搜索结果、收藏、垃圾箱恢复状态和复制动作结果。
- 权限边界：Agent 默认只能读取用户明确选中或触发的内容；批量读取历史需要显式授权。
- 状态反馈：Agent/插件状态收到底部状态线或更多菜单，不占据主列表。

后续 AI 能力优先作为“动作槽”和“工具接口”，不改变 ClipForge 首先是快速剪贴板工具的定位。

### Agent Bridge 工具边界

Agent/AI 相关能力在 P1 只规划接口，不进入主视觉：

- `clipboard.search`：按 query、kind、favorite、limit 搜索有限结果。
- `clipboard.get_selected`：读取用户当前明确选中的条目。
- `clipboard.copy`：写入内容到系统剪贴板，并进入写回防护。
- `clipboard.favorite`：收藏或取消收藏条目。
- `clipboard.delete_to_trash`：删除到垃圾箱，不做不可恢复删除。
- `clipboard.restore_from_trash`：从垃圾箱恢复条目。

默认不提供全量历史 dump 工具。需要导出或批量读取时，应进入设置/授权流程，而不是从悬浮面板隐式开放。

## 组件拆分

- `ClipForgeShell`：面板根布局，管理四层区域和窗口状态。
- `GlassSearchBar`：搜索输入、焦点状态、筛选 chips、预览触发。
- `FilterChips`：横向滚动筛选区，带左右过渡阴影。
- `PreviewBand`：顶部固定预览区，负责单条详情、链接罗列和内容类型预览。
- `WorkspaceRouterProvider`：TanStack Router 内存路由入口，维护列表、详情、聚合工作台。
- `ClipDetailWorkspace`：单条详情页，承载 Markdown/JSON/图片/链接/插件解析入口。
- `MultiAggregateWorkspace`：多选聚合页，承载聚合复制、表格导出和批量动作入口。
- `ClipboardList`：高密度列表容器，负责滚动、active item 和虚拟列表预留。
- `ClipboardRow`：单行复制目标，展示数字块、类型标识、原始内容摘要、收藏/打开入口。
- `ShortcutIndexButton`：数字快捷块，多选入口和选择状态载体。
- `BottomDock`：底部动态操作栏，承载状态、视图切换、更多动作。
- `AggregatePreviewSheet`：多选聚合预览，固定高度，内部文本滚动。
- `TrashPanel`：垃圾箱视图，保留恢复和彻底删除。
- `TargetFocusRing`：鼠标/键盘共享的目标聚焦动效。
- `StatusLine`：采集、焦点、写回、Agent/插件状态统一出口。
- `useClipboardPanelState`：面板状态聚合。
- `useKeyboardShortcuts`：键盘快捷与 IME 保护。
- `useTargetCursor`：目标光标位置和 reduced-motion 处理。

## 设计 Token

完整 token 规范见 `style-tokens.md`。成熟开源项目借鉴与取舍见 `reference-borrowing.md`。实现时遵守以下约束：

- shadcn 标准语义 token 是组件颜色入口：`background`、`foreground`、`primary`、`muted`、`accent`、`destructive` 等。
- ClipForge 产品 token 只描述产品特有能力：玻璃层、像素阴影、固定行高、预览高度、底部栏高度、复制目标焦点。
- 组件不得直接写 raw hex、随机 box-shadow、随机 blur、随机 z-index。
- 暗色模式必须通过同一 token 覆盖，不在组件里写 `dark:` 特例颜色。
- 图标使用 lucide-react；按钮内图标遵循 shadcn 语义和统一尺寸。

## 搜索与 Autocomplete

搜索区使用地址栏模型，不使用常驻筛选工具条：

- 默认态：顶部中心小透明胶囊，只显示搜索图标或完全弱化，不显示 placeholder 文本，避免抢占内容注意力。
- 激活态：胶囊横向展开到面板可用宽度，背景保持透明液态玻璃，只用细边框和轻 blur，不使用实体白色块。
- 普通输入：直接过滤列表，不弹出筛选建议，主列表仍是主要反馈。
- `@` 输入：进入 token suggestion 模式；建议包括 `@全部`、`@收藏`、`@链接`、`@文件`、`@代码`、`@命令`、`@Markdown` 和 saved search。
- token 应用后：输入框展示对应 token 状态，列表过滤同步生效；再次输入普通文本时和 token 组合过滤。
- 建议层：低高度、横向滚动、透明玻璃，不覆盖列表内容；列表区域为建议层预留固定高度。
- 键盘：`ArrowLeft/ArrowRight` 在建议间移动，`Enter` 应用建议，`Esc` 退出建议或清空搜索。

## 视觉策略

- 搜索区参考 Safari 地址栏的“胶囊展开”动效：宽度、透明度、blur、scale 使用 transform/opacity 过渡，不用大面积白底和厚阴影。
- 主列表使用 40px 左右行高，内容一行显示，中间省略；active/hover 只允许轻描边或浅色底，不允许投影。
- 行内只保留必要图标：链接打开、收藏。删除不常驻。
- 底部栏保持固定高度，状态在左，导航/动作在右。
- 多选栏为底部悬浮 sheet，固定高度，滚动只发生在聚合预览文本内。
- 列表滚动条必须使用预留 gutter 或外侧轨道，不得覆盖内容文本和右侧操作按钮。
- 风格是“像素 + 模糊玻璃 + 极简工具”，像素感用于品牌边缘、焦点环和微阴影，不使用厚重游戏化像素字体。
- `banner.png` 的蓝、白、深墨色作为品牌来源，但界面不做单一蓝色主题；功能色必须保持可读和语义清晰。
- 参考 pi.dev 的克制黑白对比和清晰留白，但主面板优先高密度，不做营销式 hero。

## 液态玻璃使用边界

液态玻璃只用于表达悬浮层级，不用于每一个列表行：

- 强使用：顶部搜索岛、底部动态 dock、多选聚合 sheet。
- 弱使用：顶部预览带背景。
- 禁止使用：每条 row、垃圾箱列表项、普通图标按钮。

如果引入 `liquid-glass-react`：

- 只包裹 1-3 个关键悬浮区域，避免列表滚动时大量实例影响性能。
- 参数先收敛到 token：`displacementScale`、`blurAmount`、`saturation`、`aberrationIntensity`、`elasticity`、`cornerRadius`。
- 必须提供 CSS glass fallback，保证 WebView、低性能设备或 reduced-motion 下仍可用。

## 动效策略

- 借鉴 Target Cursor 的“目标聚焦”而非替换系统鼠标。
- hover/active 行显示 `.target-focus-ring`：细蓝色框、轻微 scale/opacity 过渡。
- 键盘移动时同样移动聚焦框，表达“即将复制”的目标。
- 动画时长 150-260ms，使用 transform/opacity，遵守 `prefers-reduced-motion`。
- 复制成功只做短暂确认：目标行闪烁/底部状态更新/轻 toast 三选一，不能阻塞后续输入。
- 多选 sheet 进入和退出使用 translateY + opacity，不改变列表布局高度。
- 筛选 chips 横向滚动边缘使用渐变阴影表示可滚动，不使用明显分割线。

## 可访问性与可验证性

- 所有 icon-only 按钮必须有 aria-label。
- 焦点环不能被移除；键盘 active 和 DOM focus 要能被视觉区分。
- 搜索输入、列表、底部 dock 的 Tab 顺序与视觉顺序一致。
- 删除、多选删除、彻底删除需要可恢复或确认机制。
- `prefers-reduced-motion` 下关闭目标光标移动动画，仅保留状态变化。
- 验证时必须覆盖鼠标、键盘、IME 输入、窗口重新唤起、垃圾箱恢复、多选聚合复制。

## 路由评估

暂不引入 TanStack Router。当前面板状态包括 history/favorites/trash/settings，都是悬浮工具内部状态。引入 Router 会增加 routeTree、插件配置和页面拆分成本，但不会提升快捷复制体验。后续如果设置页、管理页、MCP 页面拆成完整多页面应用，再单独评估。

## 开发顺序

1. 先落 token：把 shadcn 语义 token 和 `--cf-*` 产品 token 接入全局 CSS。
2. 再拆组件：从当前 `App.tsx` 提取 shell、search、list、preview、dock、sheet。
3. 再改交互：数字块、多选、聚合预览、目标光标、IME 保护。
4. 再补扩展槽：内容类型摘要、链接罗列、Agent/插件状态占位。
5. 最后验证真实应用：Web 界面和 Tauri 应用样式以应用为准保持一致。
