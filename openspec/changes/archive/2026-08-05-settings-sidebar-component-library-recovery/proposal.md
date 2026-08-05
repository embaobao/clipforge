# 提案：设置页 Sidebar 组件库接入修复

## 优先级

P0。设置页当前视觉和交互回归直接影响用户判断，必须先于继续扩大设置项、Agent 配置或其它长期改造。

## 背景

设置页已经声明要使用 Animate UI Radix Sidebar 和 Animate UI Tabs，但当前实现仍混有自写的简化 Sidebar provider / rail / trigger 行为，导致：

- 侧栏不可明确收起，用户看不到组件库定义的 trigger / rail 交互。
- collapsed / icon 模式没有按组件库状态工作，样式仍像手写导航。
- Sidebar tooltip、badge、mobile sheet、键盘快捷键等组件库能力没有完整接入。
- CSS 继续围绕半成品 DOM 写覆盖，容易让页面看起来“跟没改一样”。

## 目标

1. 设置页 Sidebar 必须使用 Animate UI registry 的 `components-radix-sidebar`，不再维护自写替代实现。
2. 设置页保留 Animate UI Tabs 作为二级导航，Tabs 视觉必须明确、可点击、键盘可达。
3. 侧栏提供可见 `SidebarTrigger`、可点击 `SidebarRail`、`collapsible="icon"` 折叠模式。
4. 折叠后只展示图标，通过组件库 `SidebarMenuButton tooltip` 显示完整分类名。
5. 样式通过组件库 className 与 Tailwind utilities 完成，不再新增手写 Sidebar/Tabs 适配 CSS。

## 非目标

- 不重写主面板、主列表、顶部工具栏。
- 不新增设置项，不改变设置服务字段语义。
- 不把设置页做成营销页或 AI 工作台。
- 不手写新的 Sidebar 状态管理、mobile drawer 或 tooltip 行为。

## 成功标准

1. `src/components/animate-ui/components/radix/sidebar.tsx` 来自 shadcn/Animate UI registry，并暴露 `SidebarProvider`、`Sidebar`、`SidebarTrigger`、`SidebarRail`、`SidebarMenuButton tooltip`。
2. `SettingsSidebar` 使用组件库 `SidebarMenuButton` 的 `tooltip` 和 `SidebarMenuBadge`，不自写折叠态 tooltip。
3. `SettingsApp` 在内容区标题旁展示 `SidebarTrigger`，侧栏用 `collapsible="icon"`。
4. collapsed 状态下 sidebar 宽度收起为 icon rail，文本隐藏但 tooltip 可用。
5. `pnpm exec tsc --noEmit`、`node scripts/verify-settings-surface.mjs`、`pnpm openspec validate settings-sidebar-component-library-recovery --strict`、`git diff --check` 通过。
