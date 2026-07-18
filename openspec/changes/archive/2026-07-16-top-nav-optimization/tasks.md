# 任务：主面板顶部导航与底部 Dock 收敛

## Phase 1：现状与边界确认

- [x] 确认当前 `BottomDock`、`StatusLine`、搜索栏和菜单入口所在组件
- [x] 确认 History / Favorites / Trash 的状态切换与快捷键入口
- [x] 确认 Onboarding 入口迁移由 `onboarding-to-settings-proposal` 承接
- [x] 确认不改变多选、复制、删除、收藏和详情打开逻辑

## Phase 2：顶部工具栏组件

- [x] 新增或抽出 `TopToolbar`
- [x] 将 History / Favorites 视图切换移入顶部工具栏
- [x] 将搜索框整合进顶部工具栏并保持输入焦点稳定
- [x] 将 Agent 入口和状态指示移入顶部工具栏右侧
- [x] 将 Settings / Trash 放入顶部菜单

## Phase 3：移除底部 Dock

- [x] 移除 `BottomDock` 渲染
- [x] 移除底部 Dock 折叠状态和滚动隐藏逻辑
- [x] 调整列表容器高度和底部间距
- [x] 删除或迁移底部 Dock 专属样式

## Phase 4：拖拽与可点击区域

- [x] 顶部工具栏外层设置 `data-tauri-drag-region`
- [x] 搜索框、视图按钮、Agent 按钮和菜单按钮阻止拖拽冒泡
- [x] 验证菜单从顶部向下展开
- [x] 验证窄窗口下文字不会挤压搜索框

## Phase 5：国际化与文案

- [x] 新增或复用 History、Favorites、Trash、Settings、Agent 的 i18n key
- [x] Onboarding 不再作为主面板菜单项
- [x] Tooltip 文案补齐中英文
- [x] 运行硬编码文案检查脚本

## Phase 6：验证

- [x] `pnpm exec tsc --noEmit` 通过
- [x] `pnpm run check:i18n` 通过
- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [ ] `pnpm tauri dev` 验证顶部拖拽窗口
- [ ] `pnpm tauri dev` 验证搜索输入和按钮点击不触发拖拽
- [x] `pnpm tauri dev` 验证 History / Favorites / Trash 切换
- [x] `pnpm tauri dev` 验证列表底部不被遮挡
- [x] `pnpm tauri dev` 验证快捷键 `T` 和 `Cmd/Ctrl+,` 保持可用

### Phase 6 复跑记录（2026-07-16）

- 已复跑 `pnpm check:i18n`：通过，History / Favorites / Trash / Settings / Agent 相关 key 仍与双语字典对齐。
- 已复跑 `pnpm exec tsc --noEmit`：通过。
- 已运行 `node scripts/verify-agent-panel.mjs`：通过；该脚本已同步 top-nav 后的 `top-toolbar-action-slot` / `top-agent-button` Agent 入口，证明 Agent 入口仍同步打开 overlay 且不等待 native 调用。
- 已运行 `pnpm openspec validate top-nav-optimization --strict`：通过。
- 已运行 `node scripts/verify-settings-surface.mjs`：通过；已用源码级 probe 证明 top toolbar 的拖拽排除、History / Favorites / Trash 切换，以及 `T` / `Cmd-Ctrl+,` 快捷键分支仍在。列表底部不被遮挡仍需真实 `pnpm tauri dev` GUI 证据，因此保持未勾选。
- 已运行 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev` 和 `CLIPFORGE_DEV_OPEN=settings:onboarding ... pnpm tauri dev`：应用日志记录 `settings_dom_probe top_nav pass=true`，覆盖顶部 toolbar 存在、`data-tauri-drag-region`、History / Favorites 按钮可点击、搜索槽和 Agent 入口可见、顶部菜单可打开且 Trash / Settings 项存在。该证据仍不能证明真实窗口拖拽、搜索输入与按钮点击不会触发拖拽、Trash 切换、列表底部遮挡和快捷键，因此 Phase 6 项保持未勾选。

### Phase 6 交互补强记录（2026-07-16）

- 已补强 `CLIPFORGE_DEV_SETTINGS_DOM_PROBE` 的 top-nav 分支，并运行 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev`：应用日志记录 `settings_dom_probe top_nav pass=true`。
- 该 probe 在真实 Tauri dev WebView 内验证：History / Favorites / Trash 切换后 `.app-shell.view-*` 状态正确，列表工作区不存在底部 Dock/固定底栏遮挡且仍在 viewport 内，`T` 与 `Cmd/Ctrl+,` 快捷键分支会 `preventDefault`，其中 `T` 能切到 Trash。
- 仍未勾选真实窗口拖拽、搜索输入和按钮点击不触发拖拽；这两项需要人工/系统级窗口拖拽证据，DOM probe 不能替代。
