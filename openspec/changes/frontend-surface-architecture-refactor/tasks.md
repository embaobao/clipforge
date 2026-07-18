# 任务：前端 Surface 架构、路由拆分与样式系统重整

> 本提案先确定整体拆分和布局方案，再进入整合开发。每一阶段都必须保持热路径可用，不做一次性大重写。

## Phase 0：方案确认

- [x] 盘点当前组件、路由、样式和 OpenSpec 约束
- [x] 确认 `ctx7` 当前 quota 阻塞，路由设计先基于仓库已安装的 `@tanstack/react-router` 和现有 `WorkspaceRouterProvider`
- [x] 输出前端分层、路由、样式、主题、页面布局的详细设计
- [x] 补充业务功能区、主要页面布局和交互体验定义
- [x] 新增 `docs/COMPONENT_REFERENCE.md` 作为项目默认 shadcn/组件参考知识库
- [x] 根据 2026-07-16 主面板草稿补充快速复用面板布局和组件映射
- [x] 用户确认本方案可作为后续整合开发基线

## Phase 1：架构护栏与任务补齐

- [x] 为 `main-panel-functional-layout-plan` 补 `tasks.md`
- [x] 为主面板、设置页、workspace、Agent 增加稳定 surface marker 约定（4 个 surface 根挂 `data-surface`，design.md §9 登记）
- [x] 在 verifier 中增加 surface marker / 文件边界检查（`scripts/verify-surface-boundaries.mjs`，已注册 `test:unit` + `test:boundaries`）
- [x] 标记 `src/App.css` legacy 区域，新增注释说明禁止继续追加全局覆盖（顶部 LEGACY banner + P-FINAL 不再增长断言）
- [x] 更新 `docs/PROPOSAL_ROADMAP.md` 或 `openspec/project.md`，记录该提案与模块化提案的关系（frontend-surface 状态推进、3 个历史提案标记 superseded、project.md 架构原则补 surface 基线）

## Phase 2：组件系统底座整理

- [ ] 后续新增组件前先查 `docs/COMPONENT_REFERENCE.md`
- [ ] 梳理 `src/components/ui`：Button/Input/Dropdown/Separator/Skeleton/Kbd 是否满足当前业务
- [ ] 梳理 `src/components/animate-ui`：Sidebar/Tabs/ToggleGroup/Tooltip 的使用边界
- [ ] 新增 `src/components/layout`：SurfaceFrame、OverlayLayer、StatusFeedbackShell 等跨 surface 组合组件
- [ ] 禁止新增手写基础控件，后续基础交互优先复用 Radix/shadcn/Animate UI
- [ ] 为公共 props 类型补中文文档注释

## Phase 3：主题与样式分层

- [x] 新增 `src/theme/tokens.css`（已迁出 App.css 的 :root 语义 token 与 @theme inline）
- [ ] 新增 `src/theme/semantic.css`
- [ ] 新增 `src/theme/tailwind.css`，把 Tailwind v4 `@theme inline` 映射集中管理
- [ ] 主入口只导入主题和当前 surface 样式，不再依赖单一 `App.css`
- [x] 建立 surface root class：`clipboard-surface`、`settings-surface`、`workspace-surface`、`agent-surface`（目录 + README 已建，后续迁移样式）
- [x] 迁移后禁止新全局 `.quick-row` / `.toolbar` / `.dropdown-content` 覆盖（P0 已收口）

## Phase 4：主面板展示层拆分

- [x] 新建 `src/clipboard/components/ClipboardRow.tsx`（待 tauri dev 实机验证：行选中/复制/右键菜单/虚拟滚动对齐）
- [x] 新建 `src/clipboard/components/ClipboardContentPreview.tsx`（历史行 quick-content：AI 摘要徽标/图片/文件/middle-ellipsis+tooltip；helper 已迁 clipboard-domain，对抗式 review 确认零回归）
- [x] 新建 `src/clipboard/components/ClipboardRowActions.tsx`（历史行 open-target/favorite + stopPropagation）
- [x] 新建 `src/clipboard/components/ClipboardEmptyState.tsx`（合并 history/trash 两处空态，`variant` 复用）
- [x] 新建 `src/clipboard/clipboard-domain.ts`（迁纯 helper 消除循环依赖）+ `src/clipboard/components/AppTooltip.tsx`
- [ ] 新建 `src/clipboard/components/PanelStatusFeedback.tsx`
- [ ] 迁移对应样式到 `src/clipboard/styles/clipboard-row.css`（独立成步，需 tauri dev 视觉验证）
- [ ] 保持现有选择、复制、搜索、虚拟滚动行为不变
- [x] 复跑 `node scripts/verify-hot-path.mjs`（通过）

## Phase 5：主面板交互层拆分

- [ ] 新建 `src/clipboard/components/TopCommandBar.tsx`
- [ ] 新建 `src/clipboard/components/PanelMoreMenu.tsx`
- [ ] 新建 `src/clipboard/components/SearchBox.tsx`
- [ ] 新建 `src/clipboard/components/ClipboardViewTabs.tsx`
- [ ] 新建 `src/clipboard/components/PinnedClipboardSection.tsx`
- [ ] 新建 `src/clipboard/components/PinToggleButton.tsx`
- [ ] 新建 `src/clipboard/components/SearchAutocomplete.tsx`
- [ ] 新建 `src/clipboard/components/ModeBar.tsx`
- [ ] 新建 `src/clipboard/hooks/useClipboardSelection.ts`
- [ ] 新建 `src/clipboard/hooks/useClipboardKeyboard.ts`
- [ ] 新建 `src/clipboard/hooks/useClipboardContextMenu.ts`
- [ ] 清理已迁移的 `App.css` toolbar / quick-row 覆盖
- [ ] 确认 `ArrowRight` 与 `Ctrl/Cmd+J` 语义不漂移

## Phase 6：路由拆分与懒加载

- [ ] 新建 `src/app/AppRoutes.tsx`
- [ ] 新建 `src/routes/quick-routes.tsx`
- [ ] 新建 `src/settings/routes/SettingsRoutes.tsx`
- [ ] 新建 `src/agent/routes/AgentRoutes.tsx`
- [ ] 将现有 `WorkspaceRouterProvider` 整合为 workspace route 分支
- [ ] Settings / Agent / Workspace rich previews 使用 lazy import
- [ ] 保持主面板首屏 bundle 只加载剪贴板热路径必要组件

## Phase 7：设置页字段化拆分

- [ ] 新建 `src/settings/components/SettingsShell.tsx`
- [ ] 新建 `src/settings/components/SettingsTabs.tsx`
- [x] 新建 `src/settings/components/SettingsField.tsx`（分派器：switch/number/slider/segment 直接复用 controls 原语，action/code/readonly 返回 null）
- [x] 新建 `src/settings/components/SettingsFieldRow.tsx`（filter+sort+map+extraNodes）
- [~] 新建 `src/settings/fields/*Field.tsx`（暂折叠进 SettingsField 分派器，独立 wrapper 文件留待需要独立状态时再拆）
- [~] 常规字段由 `SETTINGS_FIELD_CATALOG` 驱动渲染（capture-types 试点已通；其余 tab 待逐个接入，需先补 field-runtime-spec + 核对 labelKey drift）
- [ ] 复杂面板拆入 `src/settings/panels/`
- [ ] 迁移设置页样式到 `src/settings/styles/settings.css`
- [x] 复跑 `node scripts/verify-settings-surface.mjs`（通过；顺带修了预存的 sidebar className stale 断言）
- [x] catalog 完整性：新增 `segment` type、`settingsKey` 字段、5 条 toggle→segment、6 条 capture labelKey 纠正（catalog 休眠，零运行时影响）；新增 `src/settings/field-runtime-spec.ts`

## Phase 8：Workspace 和 Agent 拆分

- [ ] 拆 `src/workspace/workspace-panels.tsx` 为 routes/components/previews/editor/ai
- [ ] 拆 `src/agent-panel.tsx` 为 AgentPanelShell、conversation hook、source actions
- [ ] 拆 `src/agent-chat-page.tsx` 为 message list、composer、reference picker、tool preview
- [ ] 迁移 Agent 样式到 `src/agent/styles/agent.css`
- [ ] 确认 Agent provider 不进入主面板热路径

## Phase 9：验证与清理

- [ ] `pnpm exec tsc --noEmit` 通过
- [ ] `node scripts/verify-file-size.mjs` 通过
- [ ] `node scripts/verify-hot-path.mjs` 通过
- [ ] `node scripts/verify-settings-surface.mjs` 通过
- [ ] `node scripts/verify-runtime-boundaries.mjs` 通过
- [ ] `pnpm openspec validate frontend-surface-architecture-refactor --strict` 通过
- [ ] 涉及 Tauri 能力时执行 `pnpm build` 和 `cd src-tauri && cargo check`
- [ ] 已迁移文件从 `scripts/file-size-exemptions.json` 逐步移除
- [ ] 删除不再使用的 `App.css` legacy blocks

## Phase 10：历史文档和遗留提案收口

- [ ] 梳理被本提案吸收的历史提案：`main-panel-functional-layout-plan`、`quick-panel-visual-regression-recovery`、`settings-sidebar-component-library-recovery`、旧设置页/顶部导航归档说明
- [ ] 在 `docs/PROPOSAL_ROADMAP.md` 标记 superseded / archived / active 三种状态，避免后续误把历史文档当当前方案
- [ ] 使用 `rg` 检查待删除文档是否仍被 active proposal、spec、script 或源码引用
- [ ] 对仍有 spec 价值的内容先并入 `openspec/specs/*` 或本提案 spec
- [ ] 用户确认后删除或归档历史遗留文档和提案
- [ ] 删除后执行 `pnpm openspec validate --specs --strict`
