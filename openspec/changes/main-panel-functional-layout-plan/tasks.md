# 任务：主面板功能布局完整规划

> 本提案固化主面板的功能布局契约（区域、状态、响应式、热路径保护）。
> 组件/目录拆分策略由 [`frontend-surface-architecture-refactor`](../frontend-surface-architecture-refactor/proposal.md) 统一承接；本文件把主面板布局落地拆成可验收阶段，并与代码现状对齐（2026-07-16 测绘）。
>
> **代码现状关键点**（影响排期）：主面板的 `TopToolbar` / `GlassSearchBar` / `SearchAutocomplete` / `MultiSelectToolbar` / `StatusLine` / `VirtualList` / `ClipContextMenu` / `TrashContextMenu` 在 `src/App.tsx` 内**已是独立函数组件**，本轮多数任务是"抽出到 `src/clipboard/` 独立文件 + 接 props"，而非从零写。历史行 `renderItem`（QuickPastePanel L4621-4737）与回收站行（TrashPanel L4150-4235）是镜像变体，应设计 `variant` 复用。

## Phase A：布局契约确认（无代码改动）

- [x] 固化区域契约：TopCommandBar / ModeBar / ClipboardList / StatusFeedback / OverlayLayer（见 design.md §2）
- [x] 固化状态矩阵：普通历史 / 收藏 / 回收站 / 搜索中 / 无结果 / 多选 / 复制成功 / 文件缺失 / Agent 打开 / 详情打开（见 design.md §3）
- [x] 固化响应式规则：<420px icon-only、<360px ModeBar 折叠、长文案截断 + tooltip（见 design.md §4）
- [x] 固化热路径优先级：P0 搜索/选中/复制/滚动 > P1 收藏/删除/回收站/详情 > P2 Agent/设置 > P3 扩展
- [x] 与 `frontend-surface-architecture-refactor` 对齐：本提案出布局契约，架构提案出拆分阶段

## Phase B：纯展示组件抽离（src/clipboard/components/）

> 由低风险到高风险，每步后跑 `pnpm exec tsc --noEmit` + `node scripts/verify-hot-path.mjs`，手动 `pnpm tauri dev` 验选中/复制/键盘导航/右键菜单四条热路径。

- [x] 纯 helper 迁 `src/clipboard/clipboard-domain.ts`：middleEllipsis / splitLineForMiddleEllipsis / getDisplayText / getClipboardLine / getFilePathsFromClip / isFileClipMissing / getItemTooltip / getAiSummaryStatusLabel + AppTooltipContent / TrFunction 类型（消除行组件→App 循环依赖；纯搬运，tsc + 对抗式 review 确认零行为回归）
- [x] `AppTooltip.tsx` 迁 `src/clipboard/components/`（4 个 stopPropagation handler 全保留）
- [x] `ClipboardEmptyState.tsx`：合并 history/trash 两处重复空态，`variant: "history" | "trash"`，零状态依赖
- [x] `ClipboardContentPreview.tsx`：抽出历史行 `div.quick-content`（AI 摘要徽标 / 图片缩略 / 文件计数 / middle-ellipsis 文本 + AppTooltip），纯展示；IIFE→三元等价（review 确认）
- [x] `ClipboardRowActions.tsx`：抽出历史行 `div.row-actions`（open-target / favorite），纯按钮组 + `stopPropagation`
- [ ] `PanelStatusFeedback.tsx`：把 `StatusLine` 移入文件 + 抽出 completion toast。`showCompletionToast` 的 timer 留父级，子组件只渲染 `status` / `toast` props
- [ ] `ClipboardRow.tsx`：组合 ContentPreview + RowActions，处理 `index` / 激活分组 `in-active-group` / `quick-index-num` / 右键菜单回调 + TrashPanel 行 `variant` 复用。**需 `pnpm tauri dev` 实机验证**行选中/复制/右键菜单/分组滚动的事件顺序（tsc 查不出）

## Phase C：交互组件归位（src/clipboard/components/）

> 这些组件在 App.tsx 内已存在，本轮只做"移到独立文件 + 接 props + 修 import"，不改键盘/选中逻辑。

- [ ] `TopCommandBar.tsx`：移动 `TopToolbar`（L3904-4034）+ 视图切换 Tabs；确认不引入 settings/provider 检查
- [ ] `SearchBox.tsx`：移动 `GlassSearchBar`（L3646-3732）
- [ ] `SearchAutocomplete.tsx`：移动 `SearchAutocomplete`（L3736-3821），保留 floating-ui portal 到 body
- [ ] `ModeBar.tsx`：移动 `MultiSelectToolbar`（L3823-3902），`variant` 区分 trash/默认
- [ ] `PanelMoreMenu.tsx`：把 TopToolbar 内 DropdownMenu（L3991-4030，Trash/Settings/快捷键）抽成独立组件
- [ ] 确认 `ArrowRight` 仅进详情、`Ctrl/Cmd+J` 才打开 URL/path，语义不漂移

## Phase D：列表与虚拟滚动归位（src/clipboard/components/）

- [ ] `VirtualClipboardList.tsx`：移动 `VirtualList`（L4338-4491）泛型组件，保留固定行高 36px、OVERSCAN、`target-focus-ring` 对齐、触底加载、分组滚动
- [ ] 抽离 `useContextMenu` hook：统一 QuickPastePanel L4557 / TrashPanel L4092 散落的 `contextMenu` state + 全局关闭监听
- [ ] 键盘导航 `useEffect`（App.tsx L2549-~2850，约 300 行）本轮**不迁**：依赖十几个 App 级 state，留待 `useClipboardKeyboard` hook 专项（Phase F）

## Phase E：样式迁移（src/clipboard/styles/）

> 见 App.css 测绘：以 L9888（Current polish）+ L10370（P0）+ L10692（Final visible polish）为最终真值，前序 33 层 P- 覆盖全是死代码，迁时直接删而非合并。

- [ ] `clipboard-row.css`：迁 `.quick-row` 系列最终态（基础/hover/active/selected/copied/selecting/in-active-group）+ `.quick-content` / `.quick-line` / `.quick-index` / `.quick-fav` / `.quick-media-*` / `.row-actions` / `.file-missing`；删失效的 `.target-focus-ring` / `.quick-row::after` / `@keyframes target-cursor-pulse`
- [ ] 保留 `:root` token / `*` reset / `.app-shell` / `.icon-button` 裸类 / `.dropdown-content` / `.kind-pill` 等共享选择器在 App.css（多 surface 共享，迁移清单见 App.css 测绘"绝对不能动"表）
- [ ] `clipboard-panel.css`（后续）：`.app-shell.multi-selecting .quick-panel` 留白 / `.empty-list` / `.toolbar-status`

## Phase F：交互 hooks 抽离（src/clipboard/hooks/，高风险，独立排期）

- [ ] `useClipboardSelection.ts`：selectedId / selectedIds / multiSelectMode / activeGroupStart
- [ ] `useClipboardKeyboard.ts`：迁 App.tsx L2549-~2850 键盘 useEffect（ArrowUp/Down、Enter、Cmd+I/,/F/J/A/C、Ctrl+X/Delete、Cmd+0-9），每条键绑定单独复跑验证
- [ ] `useClipboardContextMenu.ts`：右键菜单打开/定位/全局关闭
- [ ] 每抽一个 hook 跑 `node scripts/verify-runtime-boundaries.mjs` + `node scripts/perf-smoke.mjs`

## Phase G：布局验收

- [ ] 10 个状态组合全部可视（design.md §3 矩阵）
- [ ] 主列表是首屏第一视觉主体，顶部命令区不压缩列表到不可用
- [ ] 搜索结果直接展示在主列表，不进二级面板
- [ ] 多选 ModeBar 不遮挡行内容、不改变行高
- [ ] 详情/Agent 覆层关闭后焦点回原行
- [ ] <420px / <360px 降级：icon-only + 最小搜索宽 96px + ModeBar 折叠
- [ ] 打开/滚动/选中/复制反馈 P95 ≤ 300ms（perf-smoke）
- [ ] `pnpm openspec validate main-panel-functional-layout-plan --strict` 通过

## 依赖与边界

- 组件目录 `src/clipboard/components/`、样式 `src/clipboard/styles/`、hooks `src/clipboard/hooks/` 由 `frontend-surface-architecture-refactor` Phase 4/5 确认为主面板 surface 边界。
- VirtualList / 键盘导航 / 写回抑制 / 分组滚动属于热路径，迁移以"行为不变"为唯一标准，不做性能或语义改写。
- Agent / 详情 / workspace 覆层样式不进 `clipboard/`，归各自 surface。
