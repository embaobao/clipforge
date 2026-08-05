# 任务：引导页面独立化（Eco 模式）与设置页配套优化

## Phase 0：边界冻结（已确认，2026-07-30）

- [x] 引导窗口与功能界面：只弹引导窗口，功能界面靠托盘 + 快捷键
- [x] `SidebarTrigger`：删除
- [x] `onboarding.html`：独立入口
- [x] 引导窗口尺寸：`640x560`，`resizable: false`
- [x] `onboardingShownAt` 中间态：引入
- [x] 与 `frontend-surface-architecture-refactor` / `settings-interface-redesign` 的对齐边界已确认（区域划分与样式分层以其为基线）
- [x] 本提案仅产出方案，不实现代码（已对齐用户要求）

## Phase 1：首期 A - 引导独立窗口骨架

- [x] 新增 `onboarding.html` 入口（仿 `settings.html`）
- [x] 新增 `src/onboarding-main.tsx`（仿 `settings-main.tsx`）挂载 `OnboardingApp`
- [x] 新增 `src/onboarding/OnboardingApp.tsx`，复用引导步骤逻辑并去掉设置页框架依赖
- [ ] 新增 `src/onboarding/OnboardingStepper.tsx`（分步指示器与切换）
- [x] 新增 `src/onboarding/onboarding.css`（Eco 风格，surface scoped）
- [x] `tauri.conf.json` 新增 `onboarding` 窗口配置（`640x560`，`resizable:false`，`center`）
- [x] `lib.rs` 新增 `open_onboarding_window_internal` / `open_onboarding_window` 命令并注册

## Phase 2：首期 A - 设置页触发按钮与内嵌移除

- [x] 新增 `src/settings/components/OnboardingEntryCard.tsx`（状态摘要 + “打开引导”按钮）
- [x] `settings.tsx` 的 `onboarding` tab 改为渲染 `OnboardingEntryCard`
- [x] 移除 `settings.tsx` 的 `<OnboardingWizard />` 内嵌渲染
- [x] 触发按钮调用 `invoke("open_onboarding_window")`
- [x] 状态读取复用 `state.settings.onboardingCompleted`

## Phase 3：首期 A - 首启动自动判断

- [x] 在启动检测处（`setup_app` 或首启动逻辑）读取 `onboardingCompleted`
- [x] `false` 且 `onboardingShownAt` 为空且辅助功能权限缺失 → 调用 `open_onboarding_window`（source=auto）
- [x] 记录 `onboardingShownAt = now`，避免下次自动弹
- [x] 引导完成/跳过 → `updateSettings({ onboardingCompleted: true })` 并关闭窗口
- [ ] 验证托盘菜单与全局快捷键唤起主面板不被引导窗口阻塞

## Phase 4：后续 B - sidebar 全量常驻

- [ ] `SettingsSidebar.tsx` 默认 `collapsible` 从 `"icon"` 改为 `"none"`
- [ ] `settings.tsx` 移除 sidebar 的 `!absolute !inset-y-0 !h-full` 浮动 className
- [ ] 移除 `SettingsSectionHeader` 里的 `SidebarTrigger`（或确认保留为无折叠占位）
- [ ] sidebar 固定宽度常驻；内容区 `SidebarInset` 保持滚动
- [ ] `settings.css` 调整 sidebar 全量样式与过窄响应式降级

## Phase 5：后续 C - 显示与兜底

- [ ] 新增 `src/settings/components/SettingsSectionFallback.tsx`（loading/error/permission-missing/empty 四态）
- [ ] 各 section 接入兜底状态判定
- [ ] 为设置页与引导页各包 React Error Boundary，捕获渲染异常
- [ ] 窗口过窄的 CSS 媒体/容器查询降级（sidebar 最小可读宽度 + 内容横向滚动）
- [ ] 引导权限检测失败 / 设置保存失败的步骤内错误条 + 重试

## Phase 6：后续 C - 标准化日志

- [ ] `onboarding-window` 模块：`onboarding.open` / `onboarding.step` / `onboarding.complete` / `permission.check`
- [ ] `settings-window` 模块：`settings.section` / `settings.changed` / `fallback.shown` / `render-error`
- [ ] 确认日志只记摘要（key 名、状态、耗时、计数），不记设置值原文/权限 token/剪贴板正文
- [ ] 性能采样复用 `window.__clipforgePerf`（`onboarding.open` / `settings.section` / `settings.changed`）

## Phase 7：文档与开发者体验

- [x] 更新 `docs/PROPOSAL_ROADMAP.md`（本提案进度与依赖）
- [x] 更新 `openspec/project.md`（如需要）
- [ ] 在设置页与引导页相关文档标注 surface 边界与样式分层
- [ ] 提供 Eco 风格视觉与兜底态的截图/录屏验证记录（实机）

## Phase 8：验证与发布门禁

- [ ] `pnpm openspec validate onboarding-standalone-page --strict`
- [ ] `pnpm openspec validate --changes --strict`
- [ ] `pnpm build`
- [ ] `cd src-tauri && cargo check`
- [ ] `pnpm tauri dev` 验证：首启动自动弹引导、引导窗口五步可用、完成/跳过、设置页触发按钮、sidebar 全量、兜底四态、日志输出
- [ ] 验证托盘与全局快捷键唤起主面板不被阻塞
- [ ] 验证 `onboarding.open` / `settings.section` P95 <= 300ms
- [ ] 验证日志不含敏感值（设置原文/token/剪贴板正文）
- [ ] 记录未完成的真实桌面权限与实机验证项，不虚报完成

## 分阶段验收说明

- 首期 A 只验收 Phase 1-3：独立窗口、设置页轻入口、首启动只弹一次且不阻塞功能界面。
- Phase 4 的 sidebar 常驻可以单独验收；不得用 sidebar 未完成阻塞首期 A 的窗口链路。
- Phase 5-6 的兜底与日志为健壮性增强；不得在未完成真实兜底/日志验证前勾选最终发布门禁。
