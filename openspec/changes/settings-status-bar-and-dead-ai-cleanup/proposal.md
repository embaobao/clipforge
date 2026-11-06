# 提案：设置页底部状态信息栏与死残留清理（settings-status-bar-and-dead-ai-cleanup）

> 所属波次：W1/W5 横切（设置页体验 + 死代码卫生），见 [product-iteration-master-plan](../product-iteration-master-plan/proposal.md)。

## 状态

体验修复提案（2026-10-09 用户截图反馈 + 调查发现）。三组问题：设置页底部缺常驻状态信息、「配置已同步」伪 toast 常驻不消失、旧 AI 线死残留仍可见。

## 调查结论（证据）

**1. 底部信息栏缺失（用户明确要求）**：SettingsShell 底部栏现有 `ClipForge v{version}` + 恢复默认/导出按钮（src/settings/components/SettingsShell.tsx:123-132），无 channel/更新状态。版本与更新数据已在手：`state.update`（status/channel/errorCode/errorMessage/lastCheckedAt，settings.tsx:141-155 启动 Promise.all + :177-179 safeInvokeUpdateCheck），UpdateDistributionSection 已在用（src/settings/sections/AgentUpdateTagSections.tsx:160-309）。

**2. 「伪 toast」（截图红框问题）**：文案「配置已同步到 JSON5」不是 toast——设置窗口没挂 sonner（src/settings-main.tsx:14-24 无 Toaster），它是 SettingsStickyStatusBar 的常驻 fallback：`stickyStatusPrimary = state.status || state.saveFeedback.message || state.configStatus || tr(activeSection.labelKey)`（settings.tsx:700-701），前两者为空时 configStatus 永久兜底，停在内容区左下角，像 toast 却不消失。

**3. 死残留（旧 AI 侧车已删但入口漏清）**：
- ClipContextMenu「AI 分析」项（src/clipboard/components/ClipContextMenu.tsx:170-177）：唯一渲染方 QuickPastePanel.tsx:172-196 不传 onAnalyzeClipboard（全仓零命中）→ 永远灰死但仍可见——用户「AI 菜单还在」的直接原因；
- Onboarding Agent 功能卡片（src/onboarding/components/onboarding-wizard-shared.ts:98-104）：文案承诺「唤起 Agent 协助」，悬浮 Agent 面板已删，无法兑现；
- i18n 死键簇（zh-CN.json/en-US.json 对称无引用）：sceneAi.*、detail.aiSummary.*(15 键)、detail.aiRecommend.*、status/toast/list.aiSummary*、joyride.*；
- 托盘菜单、设置「MCP 与 Agent」section、详情页 PiAnalysisBar 均为新 pi 线，**保留勿删**。

**4. 多选状态（待用户拍板，不默认实施）**：selectedIds/multiSelectMode 是 App 组件 state（src/App.tsx:239-241），每次 showQuickPanel 无条件清空（App.tsx:392-398）——这是「每次打开面板选择没了」的根因，属设计行为；此前幻影 blur 导致面板反复自隐会放大该现象（已在 4427fc4 修复）。是否改为「跨唤起保留选择」见 tasks 待定项。

## What

1. **底部信息栏**：SettingsShell 底部栏扩展为 `v{version} · {channel} · {更新状态 badge}`；badge tone 映射 state.update.status（failed→destructive / checking→muted / available→foreground / 默认→muted），title 显示 lastCheckedAt + errorMessage；Shell 保持无业务状态（新增 versionMeta/updateBadge props，settings.tsx 算好传入）。新增 5 个 i18n 键（settings.update.badge.*）zh/en 对称。
2. **伪 toast 转 transient**：configStatus 写入后 2.5s 自动清除（useEffect + timer ref），主位回落当前 section 名；失败态由 status/saveFeedback 承担，不依赖 configStatus。
3. **死残留清理**：删 ClipContextMenu「AI 分析」项 + props 两行（43,69-70）；删 Onboarding Agent 卡片 + i18n 两键 + Bot 图标 import；清理上述 i18n 死键簇（zh/en 对称删除，check:i18n 门禁通过）。
4. **视觉契约同步**：docs/DESIGN_SYSTEM.md §7.2 底部规范补「状态信息栏（版本·channel·更新态）」条目。

## Impact

- 前端 only：src/settings.tsx、src/settings/components/SettingsShell.tsx、src/settings/components/SettingsStickyStatusBar.tsx（可能不动）、src/clipboard/components/ClipContextMenu.tsx、src/onboarding/components/onboarding-wizard-shared.ts、i18n 两 locale、docs/DESIGN_SYSTEM.md。
- 无 Rust 改动；无行为破坏（删的都是不可见/不可达项）。
- 与 codebase-modularity-refactor Phase 5（settings 组件拆分）可能碰同文件，实施时串行或先拆后改。

## 不做

- 不改多选语义（待用户拍板后另立任务）。
- 不动新 pi 线任何入口。
- 不重做设置页信息架构。
