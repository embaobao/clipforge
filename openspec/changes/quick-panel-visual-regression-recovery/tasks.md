# 任务：主面板与设置页视觉回归修复

## Phase 0：停止扩大影响

- [x] 暂停继续重写主列表选中交互
- [x] 确认本提案优先级高于继续推进主页面长期布局规划
- [x] 确认 Context7 / 治理脚本不属于本轮修复范围

## Phase 1：问题归档

- [x] 记录主列表选中交互被错误覆盖的问题
- [x] 记录顶部菜单样式变大、变虚、header 低对比的问题
- [x] 记录顶部工具栏修复越界到 quick-row 的问题
- [x] 记录设置页样式需要按容器和 slot 收口的问题

## Phase 2：主列表选中交互恢复

- [x] 移除最后追加的 `.quick-row` / `.target-focus-ring` 覆盖块
- [ ] 检查 `src/App.css` 中是否仍有本轮新增的 quick-row 强覆盖影响原交互
- [ ] 如仍有影响，只撤本轮新增覆盖，不重写列表交互
- [ ] 运行主面板后由用户目视确认列表选中/hover/active 恢复

## Phase 3：顶部菜单修复

- [ ] 为 `.app-shell .top-toolbar-menu.dropdown-content` 定义独立菜单背景、尺寸、padding、radius、shadow
- [ ] 为 `.top-toolbar-menu-header` 修复对比度和高度
- [ ] 为 `.top-toolbar-menu .dropdown-item` 修复行高、hover、快捷键对齐
- [ ] 确认不影响详情页 `detail-action-menu` 和其它 dropdown
- [ ] 运行主面板后由用户目视确认顶部菜单恢复可接受状态

## Phase 4：顶部工具栏边界收口

- [ ] 保留 History / Favorites / Search / Agent / Menu 不重叠的必要样式
- [ ] 移除与顶部工具栏无关的 P-FINAL 覆盖
- [ ] 确认搜索输入、Agent 按钮、菜单按钮仍阻止拖拽冒泡

## Phase 5：设置页样式边界复核

- [ ] 确认设置页最终覆盖均绑定 `.settings-window-shell` 或设置页 `data-slot`
- [ ] 确认设置页 Sidebar / Tabs / Code Tabs 不影响主面板 dropdown 或 quick-row
- [ ] 确认设置页仍使用本地 Animate UI Sidebar / Code Tabs 组件

## Phase 6：验证

- [ ] `pnpm exec tsc --noEmit` 通过
- [ ] `node scripts/verify-settings-surface.mjs` 通过
- [ ] `pnpm openspec validate quick-panel-visual-regression-recovery --strict` 通过
- [ ] `git diff --check` 通过
- [ ] 用户确认主列表选中交互恢复
- [ ] 用户确认顶部菜单样式恢复
