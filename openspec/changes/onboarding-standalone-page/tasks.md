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
- [x] 新增 `src/onboarding/OnboardingStepper.tsx`（分步指示器与切换）--2026-10-13:从 OnboardingWizard 内联 stepper 抽为独立受控组件（onStepClick 上抛、aria-current/ dev-probe 保留）;Wizard 三处 setStepIndex 收敛为 goToStep 统一入口（与 onStepChange 日志同源）
- [x] 新增 `src/onboarding/onboarding.css`（Eco 风格，surface scoped）
- [x] 固定 `640x560` 窗口下由引导 shell 承担纵向滚动，并新增 `verify-onboarding-surface.mjs` 回归门禁
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

- [x] `SettingsSidebar.tsx` 默认 `collapsible` 从 `"icon"` 改为 `"none"` --〔实现修订 2026-10-13〕Tailwind v3 迁移后设置页已无 shadcn Sidebar,由自研 `SettingsShell.tsx` 承担:删除收起/展开切换（aside 固定 `w-[172px]` 常驻,icon+文案恒显）,等效达成「不折叠」意图
- [x] `settings.tsx` 移除 sidebar 的 `!absolute !inset-y-0 !h-full` 浮动 className --〔实现修订〕自研 Shell 无浮动定位问题;随常驻化删除 `navCollapsed` 状态、localStorage 持久化与 collapse/expand i18n 键（2×2）
- [x] 移除 `SettingsSectionHeader` 里的 `SidebarTrigger`（或确认保留为无折叠占位）--Phase 0 边界冻结时已删（「SidebarTrigger:删除」）,2026-10-13 复核无残留
- [x] sidebar 固定宽度常驻；内容区 `SidebarInset` 保持滚动 --aside `w-[172px] shrink-0` + main `min-w-0 flex-1 overflow-auto`
- [x] `settings.css` 调整 sidebar 全量样式与过窄响应式降级 --〔实现修订〕Tailwind v3 迁移后 settings.css 已删,样式走 Tailwind 语义类;过窄降级=侧栏固定宽不可压 + 内容区 `min-w-0` 收缩滚动,无需额外断点

## Phase 5：后续 C - 显示与兜底

- [x] 新增 `src/settings/components/SettingsSectionFallback.tsx`（loading/error/permission-missing/empty 四态）--2026-10-13:四态统一组件（tone→默认图标/语义色,文案与动作由调用方注入,dev 探针 data-fallback-tone）
- [x] 各 section 接入兜底状态判定 --〔实现修订〕引导窗口 loading/error 态已接 SettingsSectionFallback（错误条含重试,替换原纯文本 status）;设置页 sections 为 catalog 静态渲染无异步加载态,error 由 SettingsErrorBoundary 按页签隔离,permission-missing 由引导/设置的权限卡承担——判定面已覆盖,不另造窗口级 loading
- [x] 为设置页与引导页各包 React Error Boundary，捕获渲染异常 --此前批次已落地:SettingsErrorBoundary 挂 settings-main/onboarding-main/settings.tsx 页签层三处,本次补 fallback.shown 事件日志
- [x] 窗口过窄的 CSS 媒体/容器查询降级（sidebar 最小可读宽度 + 内容横向滚动）--〔实现修订〕侧栏固定 172px（shrink-0 不可压）即「最小可读宽度」,内容区 min-w-0 + overflow-auto 收缩滚动,固定窗口宽度下无需断点
- [x] 引导权限检测失败 / 设置保存失败的步骤内错误条 + 重试 --2026-10-13:OnboardingApp 错误态与权限提示行分离,error=SettingsSectionFallback（title=设置页兜底文案,message=原始错误,action=重试,重试闭包捕获原操作）

## Phase 6：后续 C - 标准化日志

- [x] `onboarding-window` 模块：`onboarding.open` / `onboarding.step` / `onboarding.complete` / `permission.check` --2026-10-13:新建 `src/onboarding/onboarding-log.ts`（四事件 info 摘要,失败静默）;接线:挂载→open(+perf)、Wizard goToStep→step、完成→complete、权限检测→permission.check(status 摘要)
- [x] `settings-window` 模块：`settings.section` / `settings.changed` / `fallback.shown` / `render-error` --〔实现修订〕settings.section/changed 的 perf 采样此前已有;2026-10-13 新建 `src/settings/settings-log.ts` 补事件流水:settings.changed（patch 成功,记路径数/revision）、settings.fallback.shown（ErrorBoundary 兜底渲染）;render-error 由既有 `Settings surface failed` error 日志承担
- [x] 确认日志只记摘要（key 名、状态、耗时、计数），不记设置值原文/权限 token/剪贴板正文 --两个 log 模块头注释明确边界;meta 仅 step key/权限 status/路径计数/revision
- [x] 性能采样复用 `window.__clipforgePerf`（`onboarding.open` / `settings.section` / `settings.changed`）--2026-10-13 新增 onboarding.open（挂载→初始数据就绪）;settings.section/changed 此前已有（performance-smoke 为独立模块,每窗口各自 collector）

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
