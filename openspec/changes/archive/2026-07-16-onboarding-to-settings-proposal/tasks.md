# 任务：初次引导程序迁移至设置面板

## Phase 1：依赖与边界确认

- [x] 确认 `onboardingCompleted` 字段已存在于 `AppSettings` 接口、默认设置和 Rust 配置 schema 中
- [x] 确认 `request_accessibility_permission`、`check_accessibility_permission` 命令可用
- [x] 确认设置面板的 `SECTIONS` 数组可扩展，新增分类不影响现有分类
- [x] 确认现有 `main.onboarding.*` 文案不足以复用，本切片改为新增 `settings.onboarding.*` 中英文 key

## Phase 2：新建 OnboardingWizard 组件

- [x] 在 `src/settings/` 目录下创建 `onboarding-wizard.tsx` 组件
- [x] 实现引导步骤数据结构（步骤标题、内容、操作）
- [x] 实现步骤切换逻辑（next/back/skip）
- [x] 实现步骤指示器组件（小圆点 + 当前步骤高亮）
- [x] 实现五个引导步骤的内容渲染：
  - 步骤 1：欢迎与简介
  - 步骤 2：权限开启（接入 `request_accessibility_permission`）
  - 步骤 3：采集范围设置（接入现有采集开关逻辑）
  - 步骤 4：快捷键设置（接入现有快捷键设置逻辑）
  - 步骤 5：功能介绍（展示核心功能卡片）
- [x] 实现引导完成时更新 `onboardingCompleted` 状态

## Phase 3：修改 SettingsApp 组件

- [x] 在 `SECTIONS` 数组中新增 `onboarding` 分类（图标使用 `BookOpen`）
- [x] 实现 `onboarding` 分类的内容渲染（调用 `OnboardingWizard` 组件）
- [x] 实现引导完成状态的检测逻辑
- [x] 支持通过 URL 参数自动切换到引导分类（`section=onboarding` / `tab=onboarding`）
- [x] 添加引导完成后的"已完成"状态展示

## Phase 4：修改 App.tsx（悬浮面板）

- [x] 移除 `ScenarioOnboardingLayer` 组件及其调用
- [x] 移除 `ShortcutDemo`、`OnboardingInlineAction`、`OnboardingAnchors` 组件
- [x] 移除 `makeOnboardingSteps` 函数
- [x] 移除菜单中的 Onboarding 入口（`? Onboarding (?)`）
- [x] 添加应用启动时的引导检测逻辑（通过 Rust command 获取 `onboardingCompleted`）
- [x] 若 `onboardingCompleted` 为 `false`，自动调用 `open_settings_window_with_section` 打开设置面板并进入引导分类

## Phase 5：修改 src-tauri/src/lib.rs

- [x] 确认 `get_clipforge_settings` 返回 `onboardingCompleted` 字段
- [x] 确认 `update_clipforge_settings` 支持更新 `onboardingCompleted` 字段
- [x] 确认设置窗口打开入口支持初始分类参数语义（如 `section=onboarding`）
- [x] 若不支持初始分类参数，新增 `open_settings_window_with_section` 命令

## Phase 6：CSS 样式调整

- [x] 在 `src/settings.css` 中新增 `.onboarding-wizard` 相关样式：
  - 引导卡片布局
  - 步骤指示器样式
  - 按钮样式（主按钮、辅助按钮、权限开启按钮）
  - 权限状态样式（警告/成功）
  - 步骤切换动画
- [x] 在 `src/App.css` 中删除悬浮面板引导相关样式：
  - `.scenario-onboarding-layer`
  - `.onboarding-shortcut-demo`
  - `.onboarding-anchors`
  - `.onboarding-anchor`
  - `.centered-onboarding-*`

## Phase 7：国际化与文案

- [x] 确认现有引导文案 key 不足以复用（`main.onboarding.*`），改为新增设置页专用 key
- [x] 新增引导步骤标题和描述的 i18n key（`settings.onboarding.*`）
- [x] 补齐英文文案
- [x] 运行硬编码文案检查脚本，确认本切片新增可见文案已接入 i18n；历史候选保留为既有扫描结果

## Phase 8：验证

- [x] `pnpm exec tsc --noEmit` 通过
- [x] `pnpm run check:i18n` 通过
- [x] `openspec validate onboarding-to-settings-proposal --strict` 通过
- [x] `pnpm build` 通过
- [x] `cd src-tauri && cargo check` 通过
- [x] `pnpm tauri dev` 验证首次启动自动打开设置面板并进入引导
- [x] `pnpm tauri dev` 验证五个引导步骤内容正确、操作正常
- [ ] `pnpm tauri dev` 验证权限开启流程（开启后状态正确更新）
- [x] `pnpm tauri dev` 验证引导过程中设置实时保存
- [ ] `pnpm tauri dev` 验证引导完成后重新启动不再自动打开设置面板
- [x] `pnpm tauri dev` 验证设置面板中可重新查看引导内容
- [ ] `pnpm tauri dev` 验证悬浮面板功能正常（历史、搜索、复制）
- [x] `pnpm tauri dev` 验证菜单中不再有 Onboarding 入口

验证记录（2026-07-15）：在单实例 `pnpm tauri dev` 下临时设置 `onboardingCompleted=false` 后，日志确认启动读取为 false，并调用 `open_settings_window_with_section("onboarding")`；原生日志记录 `url=http://localhost:1420/settings.html?section=onboarding visible=true`。当前 dev bare 进程在 macOS 下仍返回 `focused=false`，且系统截图为黑屏，后续五步内容、权限流程、实时保存和主面板回归仍需人工/可视化验证后再勾选。

验证切片（2026-07-16）：已运行 `node scripts/verify-settings-surface.mjs`、`pnpm exec tsc --noEmit`、`pnpm openspec validate onboarding-to-settings-proposal --strict`，均通过。该探针覆盖五步流程、capture / shortcut 的实时保存 wiring、`onboardingCompleted` 启动门禁、设置页重开 onboarding 以及菜单中移除 Onboarding；权限开启和主面板历史/搜索/复制仍需真实 `pnpm tauri dev` 证据，因此保持未勾选。

验证切片（2026-07-16）：已运行 `CLIPFORGE_DEV_OPEN=settings:onboarding CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev`，应用日志记录 `settings_dom_probe settings pass=true`；覆盖 `onboarding.step.click.welcome/accessibility/capture/shortcut/tour`、`onboarding.step.active.*`、`onboarding.capture.toggle.changed before=false after=true`、`onboarding.finish.completedState`，并采样 `settings.changed p95=122ms`。该证据可确认五步切换、引导中设置实时保存、完成态和设置页重新打开引导内容；真实系统权限授权、重启后不自动打开设置页、主面板历史/搜索/复制和菜单无 Onboarding 入口仍需后续实机证据。

验证切片（2026-07-16）：已补强 top-nav dev probe 并运行 `CLIPFORGE_DEV_OPEN=settings CLIPFORGE_DEV_PERF_REPEAT=1 CLIPFORGE_DEV_SETTINGS_DOM_PROBE=1 pnpm tauri dev`，应用日志记录 `settings_dom_probe top_nav pass=true` 且包含 `topNav.menu.onboarding.absent=true`；可确认主面板顶部菜单不再暴露 Onboarding 入口。真实系统权限授权、重启后不自动打开设置页、主面板历史/搜索/复制仍需后续实机证据。
