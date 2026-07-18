# 任务：设置页 Sidebar 组件库接入修复

## Phase 1：组件库接入

- [x] 读取用户提供的 Animate UI Sidebar 文档
- [x] 通过 shadcn registry 安装 `@animate-ui/components-radix-sidebar`
- [x] 通过 shadcn registry 补齐 `sheet` 与 `components/animate/tooltip`
- [x] 修复 registry 组件在当前 TypeScript 配置下的编译兼容问题

## Phase 2：设置页接入

- [x] `SettingsSidebar` 使用 registry `SidebarMenuButton tooltip`
- [x] `SettingsSidebar` 使用 registry `SidebarMenuBadge`
- [x] `SettingsSidebar` 透传 `collapsible="icon"`
- [x] `SettingsApp` 内容区加入 registry `SidebarTrigger`
- [x] Sidebar / Header / Tabs 直接使用组件库与 Tailwind className，不再手写额外适配 CSS

## Phase 3：验证

- [x] `pnpm exec tsc --noEmit` 通过
- [x] `node scripts/verify-settings-surface.mjs` 通过
- [x] `pnpm openspec validate settings-sidebar-component-library-recovery --strict` 通过
- [x] `git diff --check` 通过
- [x] 记录 Context7 quota 阻塞，已使用用户提供文档和 shadcn registry `view` 结果

## 实现记录

- 2026-07-16：用户明确要求“能用组件用组件不要自己实现”。本轮通过 `npx shadcn@latest view @animate-ui/components-radix-sidebar` 确认 registry 源码，再用 `npx shadcn@latest add @animate-ui/components-radix-sidebar -y --overwrite` 安装官方 Sidebar；随后补齐 registry 依赖 `@animate-ui/components-radix-sheet` 与 `@animate-ui/components-animate-tooltip`。
- 2026-07-16：`SettingsSidebar` 已改为组合 registry `SidebarMenuButton tooltip`、`SidebarMenuBadge`、`SidebarRail`，并透传 `collapsible="icon"`；`SettingsApp` 内容标题区新增 registry `SidebarTrigger`。
- 2026-07-16：根据用户反馈删除 `src/settings/sidebar-layout.css` 路线，并清理旧 `settings-window-*`、`settings-redesign-sidebar-*`、`settings-section-tabs` 等无用 CSS；设置页 Sidebar / Header / Tabs 改为直接使用组件库与 Tailwind className。未强制设置 Sidebar 宽高，保留组件库默认响应式行为。
- 2026-07-16：已复跑 `pnpm exec tsc --noEmit`、`node scripts/verify-settings-surface.mjs`、`pnpm openspec validate settings-sidebar-component-library-recovery --strict`、`pnpm openspec validate settings-interface-redesign --strict`、`pnpm check:i18n`、`node scripts/verify-file-size.mjs`、`git diff --check`、`cargo check`、`pnpm build`，均通过。`pnpm build` 生成本地 unsigned DMG，Rust 侧仍有既有 15 个 warning。
