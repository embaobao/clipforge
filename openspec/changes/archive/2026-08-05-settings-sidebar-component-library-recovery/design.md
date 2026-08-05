# 设计：设置页组件库 Sidebar 修复

## 1. 组件来源

使用项目 `components.json` 已配置的 Animate UI registry：

```bash
npx shadcn@latest add @animate-ui/components-radix-sidebar -y --overwrite
npx shadcn@latest add @animate-ui/components-radix-sheet @animate-ui/components-animate-tooltip -y --overwrite
```

该组件库版本提供：

- `SidebarProvider`
- `Sidebar`
- `SidebarInset`
- `SidebarTrigger`
- `SidebarRail`
- `SidebarMenuButton`
- `SidebarMenuBadge`
- mobile `Sheet`
- collapsed tooltip

## 2. 页面结构

设置页结构保持组件库文档顺序：

```tsx
<SidebarProvider>
  <SettingsSidebar>
    <SidebarHeader />
    <SidebarContent />
    <SidebarFooter />
    <SidebarRail />
  </SettingsSidebar>
  <SidebarInset>
    <SettingsSectionHeader>
      <SidebarTrigger />
    </SettingsSectionHeader>
    <Tabs />
  </SidebarInset>
</SidebarProvider>
```

## 3. Sidebar 行为

- `SettingsSidebar` 透传 `collapsible="icon"`。
- `SidebarTrigger` 放在内容区标题左侧，作为明确收起/展开入口。
- `SidebarRail` 保留组件库点击区域，用于鼠标贴边收起/展开。
- `SidebarMenuButton` 使用 `tooltip={item.label}`；折叠态由组件库决定何时显示。
- badge 使用 `SidebarMenuBadge`，不再自己写绝对定位。

## 4. Tabs 行为

- 二级导航继续使用 Animate UI Tabs。
- Tabs 保持 `data-dev-probe=settings-section-tab:*`，验证脚本可检测。
- Tabs 样式只在 `.settings-window-shell .settings-section-tabs` 下覆盖。

## 5. 样式边界

设置页 Sidebar / Header / Tabs 的视觉只通过组件库 props 和 Tailwind className 控制：

- `SidebarProvider className`
- `Sidebar className`
- `SidebarMenuButton className`
- `SidebarTrigger className`
- `Tabs / TabsList / TabsTrigger className`

不修改：

- `.app-shell`
- `.quick-row`
- 主面板 dropdown
- 组件库源码 class 结构
- 不强制设置页 Sidebar 固定宽高；保留组件库默认响应式宽度和折叠行为。

## 6. 验证

自动验证：

- TypeScript 编译。
- 设置页 verifier 检查组件库 trigger、collapsible、tooltip、badge、Tabs。
- OpenSpec strict validate。
- `git diff --check`。

人工验证：

- 打开设置页，点击标题区 Sidebar trigger。
- 点击侧栏 rail。
- 折叠态 hover 分类图标显示 tooltip。
- 点击一级分类后 Tabs 内容切换正常。
